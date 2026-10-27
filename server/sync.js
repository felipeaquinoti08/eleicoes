'use strict';
// Job de sincronização: baixa do TSE os boletins de urna (BU) e a totalização oficial do exterior
// e grava um snapshot único por turno em dados/turno-<n>.json, que o painel consome.
const fs = require('fs');
const path = require('path');
const BU = require('../public/bu.js');
const projecao = require('./projecao');
const armazenamento = require('./armazenamento');
const eleicao = require('./eleicao-atual');
const ritmo = require('./ritmo');

// Códigos da eleição atual (ciclo, eleição e pleito de cada turno), descobertos na configuração do TSE por
// server/eleicao-atual.js e fixados quando a coleta começa. Uma eleição nova reinicia o processo.
let ELEICAO = eleicao.PADRAO, BASE = ELEICAO.base, TURNOS = ELEICAO.turnos;
let descartarEstado = false; // o estado gravado é de outra eleição
function configurarEleicao() {
  ELEICAO = eleicao.obter();
  BASE = ELEICAO.base;
  TURNOS = ELEICAO.tipo === 'geral' ? ELEICAO.turnos : {};
  const marca = armazenamento.lerJSON('cache-eleicao.json');
  descartarEstado = !!marca && marca.id !== ELEICAO.id;
  if (descartarEstado) log(`estado gravado é da eleição ${marca.id}; a coleta de ${ELEICAO.id} começa do zero`);
  armazenamento.gravarJSON('cache-eleicao.json', { id: ELEICAO.id, desde: new Date().toISOString() });
}
// estado da coleta gravado antes (null se for de outra eleição)
const lerEstado = nome => (descartarEstado ? null : armazenamento.lerJSON(nome));
const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];
const CONCORRENCIA = +process.env.CONCORRENCIA || 4;

const pad = (v, n) => String(v).padStart(n, '0');
const espera = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Freio global: quando o TSE responde 429, todas as requisições esperam juntas (em vez de cada uma
// insistir sozinha), e a espera cresce enquanto os 429 continuam. Um IP que insiste demais fica bloqueado.
// Dois freios independentes: "lote" (boletins de urna e municípios, milhares de arquivos) e "principal" (Brasil,
// governador, suplementares). Assim uma avalanche de 429 nos lotes não segura a atualização dos resultados principais.
const freios = { principal: { pausaAte: 0, seguidos: 0 }, lote: { pausaAte: 0, seguidos: 0 } };
async function baixar(url, tentativas = +process.env.TENTATIVAS || 15, grupo = 'principal') {
  const f = freios[grupo] || freios.principal;
  for (let i = 0; ; i++) {
    const falta = f.pausaAte - Date.now();
    if (falta > 0) await espera(falta + Math.random() * 500);
    let r = null;
    try { r = await fetch(url, { headers: { 'User-Agent': 'apuracao-eleicoes/1.0' } }); } catch (e) { if (i >= tentativas - 1) throw e; }
    if (r && r.ok) { f.seguidos = Math.max(0, f.seguidos - 1); return r; }
    if (r && r.status !== 429 && r.status < 500) throw Object.assign(new Error(r.status + ' ' + url), { status: r.status });
    if (r && r.status === 429) {
      f.seguidos++;
      // o freio principal espera menos: são poucos arquivos e precisam chegar logo
      const teto = grupo === 'lote' ? 60000 : 8000;
      f.pausaAte = Math.max(f.pausaAte, Date.now() + Math.min(teto, 1000 * 1.5 ** Math.min(f.seguidos, 12)));
    }
    if (i >= tentativas - 1) throw new Error((r ? r.status : 'rede') + ' ' + url);
    await espera(Math.min(20000, 1000 * 1.6 ** i) + Math.random() * 1000);
  }
}
const statusFreio = () => Object.fromEntries(Object.entries(freios).map(([k, f]) => [k, { pausaAte: f.pausaAte > Date.now() ? new Date(f.pausaAte).toISOString() : null, respostas429Seguidas: f.seguidos }]));
const getJSON = async (url, grupo) => (await baixar(url, undefined, grupo)).json();
const getLote = url => getJSON(url, 'lote');

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

// grava na pasta local ou no Azure Blob (server/armazenamento.js); o nome é relativo à raiz dos dados
const gravarJSON = (nome, obj) => armazenamento.gravarJSON(nome, obj);


// cache de BUs já decodificados (sobrevive a reinícios do container)
const caches = {};
function cacheDo(pleito) {
  if (!caches[pleito]) {
    caches[pleito] = lerEstado(`cache-bu-${pleito}.json`) || {};
  }
  return caches[pleito];
}

// fotos dos candidatos: baixadas uma vez e servidas pelo próprio servidor (o TSE limita requisições)
async function baixarFotos(n, T, candidatos) {
  for (const c of candidatos) {
    if (!/^\d+$/.test(c.sq)) continue;
    const arq = `fotos/${c.sq}.jpeg`;
    if (armazenamento.existe(arq)) continue;
    try {
      const buf = Buffer.from(await (await baixar(`${BASE}/${T.ele}/fotos/br/${c.sq}.jpeg`, 4)).arrayBuffer());
      armazenamento.gravar(arq, buf);
    } catch (e) { log(`aviso foto ${c.nome}:`, e.message); }
  }
}

// Estado de cada turno, montado por dois loops independentes (Brasil e exterior) e publicado num snapshot só.
// Separados porque o download dos BUs do exterior pode levar minutos sob 429 e não pode atrasar os estados.
const estados = {};
function estadoDo(n) {
  if (!estados[n]) {
    let ant = lerEstado(`turno-${n}.json`);
    if (ant && ant.ele && +ant.ele !== +TURNOS[n].ele) ant = null; // snapshot de outra eleição
    ant = ant || sementeDoHistorico(n) || {};
    estados[n] = { candidatos: ant.candidatos || [], ofExterior: ant.ofExterior || null, brasil: ant.brasil || null, ufs: ant.ufs || {}, cidades: ant.cidades || {}, situacao: ant.situacao || null, situacaoBR: ant.situacaoBR || {} };
    if (ant.semente) { log(`turno ${n}: sem dados gravados, começando pelo resultado do histórico embutido`); setImmediate(() => publicar(n)); }
  }
  return estados[n];
}

// Deploy do zero (pasta de dados vazia): se a eleição do turno já está no histórico embutido, monta o resultado
// inicial (país, estados e exterior) a partir dele, para o painel não abrir vazio enquanto o TSE limita requisições.
function sementeDoHistorico(n) {
  try {
    const ano = BASE.match(/ele(\d{4})/)[1];
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'historico-base', `${ano}-${n}t-federal.json`), 'utf8'));
    const pres = doc.cargos.find(c => c.cd === 1);
    if (!pres) return null;
    const total = l => ({
      secTot: l.secTot, secRec: l.secRec, aptos: l.aptos, comp: l.comp, brancos: l.brancos, nulos: l.nulos,
      votos: Object.fromEntries(l.cands.map(c => [c.n, c.votos])), hora: null,
    });
    const br = pres.locais.find(l => l.uf === 'BR');
    const zz = pres.locais.find(l => l.uf === 'ZZ');
    if (!br) return null;
    return {
      semente: true,
      candidatos: br.cands.map(c => ({ n: c.n, nome: c.nome, partido: c.partido, sq: c.sq || null })).sort((a, b) => a.n - b.n),
      brasil: total(br), ofExterior: zz ? total(zz) : null,
      ufs: Object.fromEntries(pres.locais.filter(l => UFS.includes(l.uf)).map(l => [l.uf, total(l)])),
      situacaoBR: Object.fromEntries(br.cands.map(c => [c.n, c.st || ''])),
      // o histórico só guarda como completa uma eleição com a apuração encerrada
      situacao: doc.completo ? { aoVivo: false, dataEleicao: doc.data, finalizada: true, verificadoEm: new Date().toISOString() } : null,
    };
  } catch { return null; }
}
function publicar(n) {
  const T = TURNOS[n], e = estadoDo(n);
  if (!e.candidatos.length) return;
  gravarJSON(`turno-${n}.json`, { gerado: new Date().toISOString(), turno: n, ele: T.ele, pleito: T.pleito, ...e });
}

const fotosEmAndamento = {};
// Brasil: roda a cada SYNC_BRASIL_S (30 s). Primeiro baixa só o total do país, que diz quando o TSE gerou o
// último dado; as 27 UFs só são baixadas quando esse horário muda (ou a cada 10 min, por garantia).
// ---------------------------------------------------------------- ao vivo ou resultados
// A eleição está "ao vivo" no dia da votação e, depois dele (até 3 dias), enquanto a apuração não chegar a 100%.
// Fora disso o painel mostra "Resultados". A data de cada eleição vem da configuração do TSE.
let datasEleicao = { em: 0, mapa: {} };
async function dataDaEleicao(ele) {
  if (Date.now() - datasEleicao.em > 60 * 60 * 1000) {
    try {
      const cfg = await getJSON('https://resultados.tse.jus.br/oficial/comum/config/ele-c.json');
      const mapa = {};
      for (const p of cfg.pl || []) for (const e of p.e || []) mapa[e.cd] = p.dt;
      datasEleicao = { em: Date.now(), mapa };
    } catch (er) { log('aviso: configuração do TSE indisponível para a data da eleição:', er.message); }
  }
  return datasEleicao.mapa[String(ele)] || null;
}
const hojeBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); // aaaa-mm-dd
async function situacaoDoTurno(n, e) {
  const dt = await dataDaEleicao(TURNOS[n].ele); // dd/mm/aaaa
  const data = dt ? dt.split('/').reverse().join('-') : null;
  const hoje = hojeBrasilia();
  const dias = data ? Math.round((Date.parse(hoje) - Date.parse(data)) / 86400000) : null;
  const finalizada = !!e.brasil && e.brasil.secTot > 0 && e.brasil.secRec >= e.brasil.secTot;
  const aoVivo = data !== null && dias >= 0 && (dias === 0 || (dias <= 3 && !finalizada));
  return { aoVivo, dataEleicao: data, finalizada, verificadoEm: new Date().toISOString() };
}

const ultimaCompleta = {};
async function sincronizarNacional(n) {
  const T = TURNOS[n], e = estadoDo(n);
  const inicio = Date.now();
  let brJ = null;
  try { brJ = await getJSON(`${BASE}/${T.ele}/dados/br/br-c0001-e${pad(T.ele, 6)}-u.json`); } catch (er) { log("aviso brasil:", er.message); }
  const horaTSE = brJ ? `${brJ.dg} ${brJ.hg}` : null;
  if (brJ) {
    // situação oficial de cada candidato no país (Eleito, Não eleito, 2º turno), mostrada no placar
    e.situacaoBR = {};
    for (const a of brJ.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) e.situacaoBR[c.n] = c.st || '';
  }
  const situacaoAntes = JSON.stringify(e.situacao || {});
  e.situacao = await situacaoDoTurno(n, { brasil: brJ ? oficialDe(brJ) : e.brasil });
  if (JSON.stringify({ ...e.situacao, verificadoEm: 0 }) !== JSON.stringify({ ...JSON.parse(situacaoAntes), verificadoEm: 0 })) publicar(n);
  const temTudo = e.candidatos.length && UFS.every(uf => e.ufs[uf]);
  if (brJ && temTudo && e.brasil?.hora === horaTSE && Date.now() - (ultimaCompleta[n] || 0) < 10 * 60 * 1000) {
    return { ...resumoNacional(e), semNovidade: true }; // o TSE não publicou nada desde a última passada
  }
  if (brJ) {
    e.brasil = oficialDe(brJ);
    if (!e.candidatos.length) e.candidatos = candidatosDe(brJ).sort((a, b) => a.n - b.n);
  }
  // total oficial do exterior (o TSE às vezes deixa esse arquivo parado; o painel deriva do total do país)
  try {
    const zzJ = await getJSON(`${BASE}/${T.ele}/dados/zz/zz-c0001-e${pad(T.ele, 6)}-u.json`);
    e.candidatos = candidatosDe(zzJ).sort((a, b) => a.n - b.n);
    e.ofExterior = oficialDe(zzJ);
  } catch (er) { log("aviso exterior oficial:", er.message); }
  if (!e.candidatos.length) throw new Error("sem lista de candidatos");
  if (!fotosEmAndamento[n]) { // em paralelo: as fotos não seguram o resultado
    fotosEmAndamento[n] = baixarFotos(n, T, e.candidatos).finally(() => { fotosEmAndamento[n] = null; });
  }
  // totalização oficial por UF; se uma falhar, fica o valor anterior
  const falhas = await emParalelo(UFS, CONCORRENCIA, async uf => {
    const u = uf.toLowerCase();
    e.ufs[uf] = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}-c0001-e${pad(T.ele, 6)}-u.json`));
  });
  ultimaCompleta[n] = Date.now();
  publicar(n);
  const r = resumoNacional(e);
  log(`turno ${n}: Brasil ${r.secoesApuradas} seções nas UFs (TSE ${horaTSE || "?"})${falhas ? `, ${falhas} UFs com falha` : ""} em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  return { ...r, ufsComFalha: falhas, semNovidade: false };
}
function resumoNacional(e) {
  return {
    secoesApuradas: Object.values(e.ufs).reduce((a, u) => a + u.secRec, 0),
    secoesTotal: Object.values(e.ufs).reduce((a, u) => a + u.secTot, 0),
    tseGeradoEm: e.brasil?.hora || null,
  };
}

async function sincronizarExterior(n) {
  const T = TURNOS[n], e = estadoDo(n);
  const inicio = Date.now();
  const cache = cacheDo(T.pleito);
  // com a totalização oficial do exterior completa, os boletins não acrescentam nada: não baixa os que faltam
  const exteriorEncerrado = !!e.ofExterior && e.ofExterior.secTot > 0 && e.ofExterior.secRec >= e.ofExterior.secTot;
  const cs = await getLote(`${BASE}/arquivo-urna/${T.pleito}/config/zz/zz-p${pad(T.pleito, 6)}-cs.json`);
  const zz = cs.abr ? cs.abr.find(a => a.cd === "zz") : cs;
  const cidades = {};
  const fila = [];
  for (const mu of zz.mu) {
    const c = cidades[mu.cd] = { nome: mu.nm, secoes: [], bu: {}, of: e.cidades[mu.cd]?.of || null };
    for (const z of mu.zon) for (const s of z.sec) {
      if (s.nsp) continue;
      const quando = s.da ? `${s.da} ${s.ha}` : null;
      c.secoes.push({ zona: z.cd, ns: s.ns, quando, agregadas: s.nsa || [] });
      if (!quando) continue;
      const chave = `${mu.cd}-${z.cd}-${s.ns}`;
      const em = cache[chave];
      if (em && em.q === quando) { if (em.r) c.bu[`${z.cd}-${s.ns}`] = em.r; }
      else if (!exteriorEncerrado) fila.push({ mun: mu.cd, zona: z.cd, ns: s.ns, quando, chave, c });
    }
  }
  e.cidades = cidades;
  publicar(n);
  // durante cargas grandes (centenas de BUs), publica parciais para o painel ir se populando
  let feitos = 0;
  const parcial = setInterval(() => {
    try { publicar(n); gravarJSON(`cache-bu-${T.pleito}.json`, cache); log(`turno ${n}: parcial ${feitos}/${fila.length} BUs novos`); }
    catch (er) { log("aviso parcial:", er.message); }
  }, 20000);
  const errosBU = await emParalelo(fila, CONCORRENCIA, async it => {
    const dir = `${BASE}/arquivo-urna/${T.pleito}/dados/zz/${it.mun}/${it.zona}/${it.ns}`;
    const aux = await getLote(`${dir}/p${pad(T.pleito, 6)}-zz-m${it.mun}-z${it.zona}-s${it.ns}-aux.json`);
    const hashes = (aux.hashes || []).filter(h => (h.arq || []).some(a => a.tp === "bu") && !/exclu|cancel/i.test(h.st || ""));
    const h = hashes[hashes.length - 1];
    if (!h) { cache[it.chave] = { q: it.quando, r: null }; return; }
    const nm = h.arq.find(a => a.tp === "bu").nm;
    const buf = await (await baixar(`${dir}/${h.hash}/${nm}`, undefined, 'lote')).arrayBuffer();
    const r = BU.decodificar(buf, T.ele, 1);
    cache[it.chave] = { q: it.quando, r };
    it.c.bu[`${it.zona}-${it.ns}`] = r;
    feitos++;
  }).finally(() => clearInterval(parcial));
  gravarJSON(`cache-bu-${T.pleito}.json`, cache);

  // totalização oficial por cidade: só depois que o TSE começar a divulgar o exterior
  let errosOf = 0;
  if (e.ofExterior && e.ofExterior.secRec > 0) {
    errosOf = await emParalelo(Object.keys(cidades), CONCORRENCIA, async mun => {
      cidades[mun].of = oficialDe(await getLote(`${BASE}/${T.ele}/dados/zz/zz${mun}-c0001-e${pad(T.ele, 6)}-u.json`));
    });
  }
  publicar(n);
  const nBU = Object.values(cidades).reduce((a, c) => a + Object.keys(c.bu).length, 0);
  const nSec = Object.values(cidades).reduce((a, c) => a + c.secoes.length, 0);
  log(`turno ${n}: exterior ${nBU}/${nSec} seções com BU (${fila.length} novos, ${errosBU} falhas), oficial ${e.ofExterior?.secRec ?? 0}/${e.ofExterior?.secTot ?? 0}` +
    (errosOf ? `, ${errosOf} falhas oficiais` : "") + ` em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  return { secoesComBU: nBU, secoesTotal: nSec, buNovos: fila.length, buFalhas: errosBU, oficialApuradas: e.ofExterior?.secRec ?? 0 };
}

// ---------------------------------------------------------------- municípios do Brasil
// O arquivo <uf>-e<ele>-ab.json traz as estatísticas de todos os municípios da UF; só baixamos o
// resultado (um arquivo por município) dos que mudaram desde a última passada.
const estadoMun = {};
function estadoMunDo(n) {
  if (!estadoMun[n]) {
    estadoMun[n] = lerEstado(`cache-mun-${n}.json`) || {};
  }
  return estadoMun[n];
}

async function sincronizarMunicipios(n) {
  const T = TURNOS[n];
  const est = estadoMunDo(n);
  const inicio = Date.now();
  let baixados = 0, erros = 0, velhos = 0;
  // capitais e UFs mais populosas primeiro
  const ordem = ["SP","MG","RJ","BA","PR","RS","PE","CE","PA","SC","GO","MA","AM","ES","PB","RN","MT","AL","PI","DF","MS","SE","RO","TO","AC","AP","RR"];
  for (const uf of ordem) {
    const u = uf.toLowerCase();
    let ab;
    try { ab = await getLote(`${BASE}/${T.ele}/dados/${u}/${u}-e${pad(T.ele, 6)}-ab.json`); } catch (e) { erros++; continue; }
    const mun = (est[uf] ||= {});
    const fila = [];
    for (const a of ab.abr || []) {
      if (a.tpabr !== "mun" || !a.s || !(+a.s.st > 0)) continue;
      const versao = `${a.s.st}|${a.dt} ${a.ht}|${a.e?.c}`;
      const atual = mun[a.cdabr];
      // entra na fila se mudou OU se o que temos está atrás do agregado (cópia velha do CDN gravada antes)
      if (atual?.v !== versao || (atual.secRec || 0) < +a.s.st) fila.push({ cd: a.cdabr, versao, st: +a.s.st });
    }
    if (!fila.length) continue;
    erros += await emParalelo(fila, CONCORRENCIA, async it => {
      const url = `${BASE}/${T.ele}/dados/${u}/${u}${it.cd}-c0001-e${pad(T.ele, 6)}-u.json`;
      let r = oficialDe(await getLote(url));
      // o CDN do TSE às vezes devolve uma cópia antiga do arquivo do município: confere com o agregado do
      // estado e, se vier atrás, pede de novo furando o cache
      if (r.secRec < it.st) r = oficialDe(await getLote(`${url}?t=${Date.now()}`));
      if (r.secRec < it.st) {
        velhos++;
        if (!mun[it.cd] || mun[it.cd].secRec < r.secRec) mun[it.cd] = { ...r, v: null }; // guarda o melhor, sem marcar como em dia
        return;
      }
      mun[it.cd] = { ...r, v: it.versao };
      baixados++;
    });
    gravarJSON(`turno-${n}-mun-${uf}.json`, { gerado: new Date().toISOString(), uf, municipios: mun });
    gravarJSON(`cache-mun-${n}.json`, est);
  }
  if (baixados || erros || velhos) log(`turno ${n}: municípios ${baixados} atualizados, ${velhos} ainda com cópia antiga do TSE (nova tentativa na próxima passada), ${erros} falhas em ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
  const comDados = Object.values(est).reduce((a, m) => a + Object.keys(m).length, 0);
  return { municipiosComDados: comDados, atualizadosNestaPassada: baixados, aguardandoCopiaNova: velhos, falhas: erros };
}

// ---------------------------------------------------------------- projeção do 2º turno
let MUNICIPIOS = null;
function municipios() {
  if (!MUNICIPIOS) {
    const src = fs.readFileSync(path.join(__dirname, "..", "public", "municipios.js"), "utf8");
    MUNICIPIOS = JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
  }
  return MUNICIPIOS;
}
function atualizarProjecao() {
  try {
    const e1 = estadoDo("1"), e2 = estadoDo("2");
    const mun1 = estadoMunDo("1");
    if (!e2.candidatos.length || !e1.candidatos.length || !Object.keys(mun1).length) return; // falta a base do 1º turno
    const r = projecao.calcular({
      cands: e2.candidatos.map(c => c.n), cands1: e1.candidatos.map(c => c.n),
      mun1, mun2: estadoMunDo("2"), municipios: municipios(),
      bu1: cacheDo(TURNOS[1].pleito), bu2: cacheDo(TURNOS[2].pleito),
    });
    gravarJSON("projecao-2.json", r);
    marcar("2", "projecao", { ok: true, ultimoSucesso: r.gerado, disponivel: r.disponivel, pesoApurado: r.pesoApurado, erro: null });
  } catch (er) {
    marcar("2", "projecao", { ok: false, erro: er.message });
    log("erro projeção:", er.message);
  }
}

// passadas contínuas, com uma pausa entre elas
async function loopMunicipios(n, pausaMin) {
  for (;;) {
    const inicio = Date.now();
    marcar(n, "municipios", { rodando: true });
    try {
      const r = await sincronizarMunicipios(n);
      if (n === '2') atualizarProjecao();
      marcar(n, "municipios", { ok: true, ultimoSucesso: new Date().toISOString(), duracaoS: +((Date.now() - inicio) / 1000).toFixed(1), erro: null, ...r });
    } catch (e) {
      marcar(n, "municipios", { ok: false, ultimaFalha: new Date().toISOString(), erro: e.message });
      log(`erro municípios turno ${n}:`, e.message);
    }
    marcar(n, "municipios", { rodando: false, intervaloMin: ritmo.intervalo(pausaMin), proxima: new Date(Date.now() + ritmo.intervalo(pausaMin) * 60 * 1000).toISOString() });
    await ritmo.esperarProxima(Date.now(), pausaMin);
  }
}

// estado de cada coleta, exposto em /saude
const STATUS = {};
function marcar(n, nome, dados) { const t = (STATUS["turno" + n] ||= {}); t[nome] = { ...(t[nome] || {}), ...dados }; }
function status() { return { ...STATUS, freioTSE: statusFreio(), ritmo: ritmo.status() }; }

// roda fn já na subida e depois a cada `minutos` enquanto a eleição está ativa; fora dela, só 2 vezes ao dia (ritmo.js)
function agendar(n, minutos, fn, nome, ativa = ritmo.eleicaoAtiva) {
  (async () => {
    for (;;) {
      const inicio = Date.now();
      marcar(n, nome, { rodando: true, intervaloMin: ritmo.intervalo(minutos, ativa) });
      let falhou = false;
      try {
        const r = await fn(n);
        if (String(n) === '2' && fn === sincronizarExterior) atualizarProjecao();
        marcar(n, nome, { ok: true, ultimoSucesso: new Date().toISOString(), duracaoS: +((Date.now() - inicio) / 1000).toFixed(1), erro: null, ...r });
      } catch (e) {
        falhou = true;
        marcar(n, nome, { ok: false, ultimaFalha: new Date().toISOString(), erro: e.message });
      }
      // falha: nova tentativa em 1 min durante a eleição, em 60 min fora dela
      const proxMin = falhou ? Math.min(ritmo.intervalo(minutos, ativa), ativa() ? 1 : 60) : ritmo.intervalo(minutos, ativa);
      if (falhou) log(`erro ${nome} turno ${n}: ${STATUS['turno' + n][nome].erro} (nova tentativa em ${proxMin} min)`);
      marcar(n, nome, { rodando: false, proxima: new Date(Date.now() + proxMin * 60 * 1000).toISOString() });
      if (falhou) await espera(proxMin * 60 * 1000);
      else await ritmo.esperarProxima(Date.now(), minutos, ativa);
    }
  })();
}

function iniciar() {
  configurarEleicao();
  const brasilMin0 = (+process.env.SYNC_BRASIL_S || 30) / 60;
  // eleições suplementares do dia (prefeitos etc.), lidas da configuração do TSE, em qualquer ano
  if (process.env.SUPLEMENTARES !== '0') {
    const sup = require('./suplementares').criar({ getJSON, baixar, gravarJSON, log, armazenamento });
    agendar('2', brasilMin0, () => sup.sincronizar(), 'suplementares', () => ritmo.eleicaoAtiva() || sup.ativa());
  }
  if (ELEICAO.tipo !== 'geral') return iniciarOutroTipo(brasilMin0);
  const min = +process.env.SYNC_INTERVALO_MIN || 5;
  const turnos = (process.env.TURNOS || '2,1').split(',').map(s => s.trim()).filter(t => TURNOS[t]);
  const brasilMin = (+process.env.SYNC_BRASIL_S || 30) / 60;
  for (const t of turnos) {
    const m = t === '1' ? Math.max(min, 60) : min; // 1º turno já está encerrado
    estadoDo(t);
    agendar(t, t === '1' ? m : brasilMin, sincronizarNacional, 'brasil');
    agendar(t, m, sincronizarExterior, 'exterior');
  } // 1º turno já está encerrado
  // municípios: o 1º turno já acabou, então depois da primeira carga só confere a cada 60 min
  for (const t of (process.env.TURNOS_MUN || '2,1').split(',').map(s => s.trim()).filter(t => TURNOS[t])) loopMunicipios(t, t === '1' ? 60 : 1);
  // governador no 2º turno (só nos estados com 2º turno), no mesmo ritmo do Brasil
  if (process.env.GOVERNADOR !== '0' && turnos.includes('2') && ELEICAO.estadual?.[2]) {
    const gov = require('./governador').criar({ getJSON, baixar, emParalelo, gravarJSON, log, armazenamento, lerEstado, CONCORRENCIA, eleicao: ELEICAO });
    agendar('2', brasilMin, () => gov.sincronizar(), 'governador');
  }
  log(`sincronização ativa: turnos ${turnos.join(', ')}; Brasil a cada ${brasilMin * 60} s, exterior a cada ${min} min (1º turno a cada ${Math.max(min, 60)} min)${ritmo.eleicaoAtiva() ? '' : ` (fora de eleição: cada coleta só a cada ${ritmo.status().foraDeEleicaoH} h, até a véspera da votação)`}`);
}

// eleição municipal: a coleta de prefeitos fica em server/municipal.js
function iniciarOutroTipo(brasilMin) {
  let mod;
  try { mod = require('./municipal'); } catch { log(`eleição ${ELEICAO.id} (${ELEICAO.tipo}): coleta ao vivo ainda não disponível para este tipo`); return; }
  const mun = mod.criar({ getJSON, getLote, baixar, emParalelo, gravarJSON, log, armazenamento, lerEstado, CONCORRENCIA, eleicao: ELEICAO });
  for (const t of Object.keys(ELEICAO.turnos)) agendar(t, t === '1' && ELEICAO.turnos[2] && new Date() > new Date(ELEICAO.turnos[2].data) ? 60 : brasilMin, () => mun.sincronizar(t), 'prefeitos');
  log(`sincronização ativa: eleição municipal ${ELEICAO.id}, turnos ${Object.keys(ELEICAO.turnos).join(', ')}${ritmo.eleicaoAtiva() ? '' : ` (fora de eleição: cada coleta só a cada ${ritmo.status().foraDeEleicaoH} h, até a véspera da votação)`}`);
}

const sincronizarTurno = async n => { await sincronizarNacional(n); await sincronizarExterior(n); };
module.exports = { iniciar, sincronizarTurno, sincronizarMunicipios, status };
if (require.main === module) {
  if (process.argv[2] === '--uma-vez') {
    armazenamento.iniciar().then(eleicao.atualizar).then(configurarEleicao).then(() => Promise.all((process.argv[3] || '2').split(',').map(sincronizarTurno))).catch(e => { console.error(e); process.exit(1); });
  } else armazenamento.iniciar().then(eleicao.atualizar).then(iniciar);
}
