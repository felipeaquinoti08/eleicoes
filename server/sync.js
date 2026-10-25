'use strict';
// Job de sincronização: baixa do TSE os boletins de urna (BU) e a totalização oficial do exterior
// e grava um snapshot único por turno em dados/turno-<n>.json, que o painel consome.
const fs = require('fs');
const path = require('path');
const BU = require('../public/bu.js');

const BASE = 'https://resultados.tse.jus.br/oficial/ele2026';
const TURNOS = {
  1: { ele: 6257, pleito: 3220 },
  2: { ele: 6258, pleito: 3221 },
};
const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const DIR_DADOS = process.env.DIR_DADOS || path.join(__dirname, '..', 'dados');
const CONCORRENCIA = +process.env.CONCORRENCIA || 6;

const pad = (v, n) => String(v).padStart(n, '0');
const espera = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function baixar(url, tentativas = +process.env.TENTATIVAS || 12) {
  for (let i = 0; ; i++) {
    let r = null;
    try { r = await fetch(url, { headers: { 'User-Agent': 'apuracao-exterior/1.0' } }); } catch (e) { if (i >= tentativas - 1) throw e; }
    if (r && r.ok) return r;
    if (r && r.status !== 429 && r.status < 500) throw Object.assign(new Error(r.status + ' ' + url), { status: r.status });
    if (i >= tentativas - 1) throw new Error((r ? r.status : 'rede') + ' ' + url);
    await espera(Math.min(20000, 1000 * 1.6 ** i) + Math.random() * 1000);
  }
}
const getJSON = async url => (await baixar(url)).json();

async function emParalelo(itens, limite, fn) {
  let i = 0, erros = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const item = itens[i++];
      try { await fn(item); } catch (e) { erros++; if (erros <= 5) log('aviso:', e.message); }
    }
  }));
  return erros;
}

function candidatosDe(j) {
  const out = [];
  for (const a of j.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
    out.push({ n: c.n, nome: c.nmu, completo: c.nm, partido: p.sg, sq: c.sqcand, vap: +c.vap, vice: c.vs?.[0]?.nmu || '' });
  }
  return out;
}
function oficialDe(j) {
  const votos = {};
  for (const c of candidatosDe(j)) votos[c.n] = c.vap;
  return {
    secTot: +j.s.ts, secRec: +j.s.st, aptos: +(j.e.est || 0), comp: +(j.e.c || 0), votos,
    brancos: +(j.v.vb || 0), nulos: +(j.v.tvn || j.v.vn || 0), hora: `${j.dg} ${j.hg}`,
  };
}

function gravarJSON(arquivo, obj) {
  const tmp = arquivo + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, arquivo); // troca atômica: o servidor nunca entrega arquivo pela metade
}

const oficiaisAnteriores = {};
const ufsAnteriores = {};

// cache de BUs já decodificados (sobrevive a reinícios do container)
const caches = {};
function cacheDo(pleito) {
  if (!caches[pleito]) {
    const arq = path.join(DIR_DADOS, `cache-bu-${pleito}.json`);
    try { caches[pleito] = JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { caches[pleito] = {}; }
  }
  return caches[pleito];
}

// fotos dos candidatos: baixadas uma vez e servidas pelo próprio servidor (o TSE limita requisições)
async function baixarFotos(n, T, candidatos) {
  const dir = path.join(DIR_DADOS, 'fotos');
  fs.mkdirSync(dir, { recursive: true });
  for (const c of candidatos) {
    if (!/^\d+$/.test(c.sq)) continue;
    const arq = path.join(dir, `${c.sq}.jpeg`);
    if (fs.existsSync(arq)) continue;
    try {
      const buf = Buffer.from(await (await baixar(`${BASE}/${T.ele}/fotos/br/${c.sq}.jpeg`, 4)).arrayBuffer());
      fs.writeFileSync(arq, buf);
    } catch (e) { log(`aviso foto ${c.nome}:`, e.message); }
  }
}

async function sincronizarTurno(n) {
  const T = TURNOS[n];
  const inicio = Date.now();
  const cache = cacheDo(T.pleito);

  const zzJ = await getJSON(`${BASE}/${T.ele}/dados/zz/zz-c0001-e${pad(T.ele, 6)}-u.json`);
  const candidatos = candidatosDe(zzJ).sort((a, b) => a.n - b.n);
  const ofExterior = oficialDe(zzJ);

  await baixarFotos(n, T, candidatos);

  let brasil = null;
  try { brasil = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/br/br-c0001-e${pad(T.ele, 6)}-u.json`)); } catch (e) { log('aviso brasil:', e.message); }

  // totalização oficial por UF (o Brasil todo cabe em 27 arquivos)
  const ufsAnt = (ufsAnteriores[n] ||= {});
  const ufs = {};
  await emParalelo(UFS, CONCORRENCIA, async uf => {
    const u = uf.toLowerCase();
    ufs[uf] = ufsAnt[uf] = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}-c0001-e${pad(T.ele, 6)}-u.json`));
  });
  for (const uf of UFS) if (!ufs[uf] && ufsAnt[uf]) ufs[uf] = ufsAnt[uf];

  const cs = await getJSON(`${BASE}/arquivo-urna/${T.pleito}/config/zz/zz-p${pad(T.pleito, 6)}-cs.json`);
  const zz = cs.abr ? cs.abr.find(a => a.cd === 'zz') : cs;
  const cidades = {};
  const fila = [];
  for (const mu of zz.mu) {
    const c = cidades[mu.cd] = { nome: mu.nm, secoes: [], bu: {}, of: null };
    for (const z of mu.zon) for (const s of z.sec) {
      if (s.nsp) continue;
      const quando = s.da ? `${s.da} ${s.ha}` : null;
      c.secoes.push({ zona: z.cd, ns: s.ns, quando, agregadas: s.nsa || [] });
      if (!quando) continue;
      const chave = `${mu.cd}-${z.cd}-${s.ns}`;
      const em = cache[chave];
      if (em && em.q === quando) { if (em.r) c.bu[`${z.cd}-${s.ns}`] = em.r; }
      else fila.push({ mun: mu.cd, zona: z.cd, ns: s.ns, quando, chave, c });
    }
  }

  const publicar = () => gravarJSON(path.join(DIR_DADOS, `turno-${n}.json`), {
    gerado: new Date().toISOString(), turno: n, ele: T.ele, pleito: T.pleito,
    candidatos, ofExterior, brasil, ufs, cidades,
  });
  publicar();
  // durante a primeira carga (centenas de BUs), publica parciais para o painel ir se populando
  const parcial = setInterval(() => {
    try { publicar(); gravarJSON(path.join(DIR_DADOS, `cache-bu-${T.pleito}.json`), cache); log(`turno ${n}: parcial ${feitos}/${fila.length} BUs novos`); }
    catch (e) { log("aviso parcial:", e.message); }
  }, 20000);
  let feitos = 0;
  const errosBU = await emParalelo(fila, CONCORRENCIA, async it => {
    const dir = `${BASE}/arquivo-urna/${T.pleito}/dados/zz/${it.mun}/${it.zona}/${it.ns}`;
    const aux = await getJSON(`${dir}/p${pad(T.pleito, 6)}-zz-m${it.mun}-z${it.zona}-s${it.ns}-aux.json`);
    const hashes = (aux.hashes || []).filter(h => (h.arq || []).some(a => a.tp === 'bu') && !/exclu|cancel/i.test(h.st || ''));
    const h = hashes[hashes.length - 1];
    if (!h) { cache[it.chave] = { q: it.quando, r: null }; return; }
    const nm = h.arq.find(a => a.tp === 'bu').nm;
    const buf = await (await baixar(`${dir}/${h.hash}/${nm}`)).arrayBuffer();
    const r = BU.decodificar(buf, T.ele, 1);
    cache[it.chave] = { q: it.quando, r };
    it.c.bu[`${it.zona}-${it.ns}`] = r;
    feitos++;
  }).finally(() => clearInterval(parcial));
  gravarJSON(path.join(DIR_DADOS, `cache-bu-${T.pleito}.json`), cache);

  // totalização oficial por cidade: só depois que o TSE começar a divulgar o exterior
  let errosOf = 0;
  const ultimoOf = (oficiaisAnteriores[n] ||= {});
  if (ofExterior.secRec > 0) {
    errosOf = await emParalelo(Object.keys(cidades), CONCORRENCIA, async mun => {
      cidades[mun].of = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/zz/zz${mun}-c0001-e${pad(T.ele, 6)}-u.json`));
      ultimoOf[mun] = cidades[mun].of;
    });
    for (const mun in cidades) if (!cidades[mun].of && ultimoOf[mun]) cidades[mun].of = ultimoOf[mun]; // falhou agora: mantém o anterior
  }

  const nBU = Object.values(cidades).reduce((a, c) => a + Object.keys(c.bu).length, 0);
  const nSec = Object.values(cidades).reduce((a, c) => a + c.secoes.length, 0);
  publicar();
  log(`turno ${n}: ${nBU}/${nSec} seções com BU (${fila.length} novos, ${errosBU} falhas), oficial ${ofExterior.secRec}/${ofExterior.secTot}` +
    (errosOf ? `, ${errosOf} falhas oficiais` : '') + ` em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
}

// ---------------------------------------------------------------- municípios do Brasil
// O arquivo <uf>-e<ele>-ab.json traz as estatísticas de todos os municípios da UF; só baixamos o
// resultado (um arquivo por município) dos que mudaram desde a última passada.
const estadoMun = {};
function estadoMunDo(n) {
  if (!estadoMun[n]) {
    try { estadoMun[n] = JSON.parse(fs.readFileSync(path.join(DIR_DADOS, `cache-mun-${n}.json`), "utf8")); } catch { estadoMun[n] = {}; }
  }
  return estadoMun[n];
}

async function sincronizarMunicipios(n) {
  const T = TURNOS[n];
  const est = estadoMunDo(n);
  const inicio = Date.now();
  let baixados = 0, erros = 0;
  // capitais e UFs mais populosas primeiro
  const ordem = ["SP","MG","RJ","BA","PR","RS","PE","CE","PA","SC","GO","MA","AM","ES","PB","RN","MT","AL","PI","DF","MS","SE","RO","TO","AC","AP","RR"];
  for (const uf of ordem) {
    const u = uf.toLowerCase();
    let ab;
    try { ab = await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}-e${pad(T.ele, 6)}-ab.json`); } catch (e) { erros++; continue; }
    const mun = (est[uf] ||= {});
    const fila = [];
    for (const a of ab.abr || []) {
      if (a.tpabr !== "mun" || !a.s || !(+a.s.st > 0)) continue;
      const versao = `${a.s.st}|${a.dt} ${a.ht}|${a.e?.c}`;
      if (mun[a.cdabr]?.v !== versao) fila.push({ cd: a.cdabr, versao });
    }
    if (!fila.length) continue;
    erros += await emParalelo(fila, CONCORRENCIA, async it => {
      const r = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}${it.cd}-c0001-e${pad(T.ele, 6)}-u.json`));
      mun[it.cd] = { ...r, v: it.versao };
      baixados++;
    });
    gravarJSON(path.join(DIR_DADOS, `turno-${n}-mun-${uf}.json`), { gerado: new Date().toISOString(), uf, municipios: mun });
    gravarJSON(path.join(DIR_DADOS, `cache-mun-${n}.json`), est);
  }
  if (baixados || erros) log(`turno ${n}: municípios ${baixados} atualizados, ${erros} falhas em ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
}

// passadas contínuas, com uma pausa entre elas
async function loopMunicipios(n, pausaMin) {
  for (;;) {
    try { await sincronizarMunicipios(n); } catch (e) { log(`erro municípios turno ${n}:`, e.message); }
    await espera(pausaMin * 60 * 1000);
  }
}

function agendar(n, minutos) {
  let rodando = false, retentativa = null;
  const rodar = async () => {
    if (rodando) return;
    rodando = true;
    clearTimeout(retentativa);
    try { await sincronizarTurno(n); }
    catch (e) {
      log(`erro turno ${n}: ${e.message} (nova tentativa em 1 min)`);
      retentativa = setTimeout(rodar, 60 * 1000);
    }
    finally { rodando = false; }
  };
  rodar();
  return setInterval(rodar, minutos * 60 * 1000);
}

function iniciar() {
  fs.mkdirSync(DIR_DADOS, { recursive: true });
  const min = +process.env.SYNC_INTERVALO_MIN || 5;
  const turnos = (process.env.TURNOS || '2,1').split(',').map(s => s.trim()).filter(t => TURNOS[t]);
  for (const t of turnos) agendar(t, t === '1' ? Math.max(min, 60) : min); // 1º turno já está encerrado
  // municípios: o 1º turno já acabou, então depois da primeira carga só confere a cada 60 min
  for (const t of (process.env.TURNOS_MUN || '2,1').split(',').map(s => s.trim()).filter(t => TURNOS[t])) loopMunicipios(t, t === '1' ? 60 : 1);
  log(`sincronização ativa: turnos ${turnos.join(', ')} a cada ${min} min (1º turno a cada ${Math.max(min, 60)} min)`);
}

module.exports = { iniciar, sincronizarTurno };
if (require.main === module) {
  if (process.argv[2] === '--uma-vez') {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
    Promise.all((process.argv[3] || '2').split(',').map(sincronizarTurno)).catch(e => { console.error(e); process.exit(1); });
  } else iniciar();
}
