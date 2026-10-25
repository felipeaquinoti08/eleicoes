'use strict';

const BASE = 'https://resultados.tse.jus.br/oficial/ele2026';
const TURNOS = {
  1: { ele: 6257, pleito: 3220, nome: '1º turno' },
  2: { ele: 6258, pleito: 3221, nome: '2º turno' },
};
const CORES_FIXAS = {
  13: '#e5242f', 22: '#2563eb', 30: '#f97316', 55: '#16a34a', 14: '#a855f7', 70: '#06b6d4',
  27: '#eab308', 16: '#db2777', 21: '#b91c1c', 29: '#92400e', 35: '#65a30d', 80: '#f472b6',
};
const PALETA_EXTRA = ['#14b8a6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#84cc16', '#ef4444'];

const UF_NOMES = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};
const REGIOES = {
  N: ['Norte', ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO']],
  NE: ['Nordeste', ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']],
  CO: ['Centro-Oeste', ['DF', 'GO', 'MS', 'MT']],
  SE: ['Sudeste', ['ES', 'MG', 'RJ', 'SP']],
  S: ['Sul', ['PR', 'RS', 'SC']],
};
const UFS = Object.keys(UF_NOMES);
const REGIAO_DA_UF = Object.fromEntries(Object.entries(REGIOES).flatMap(([r, [, l]]) => l.map(uf => [uf, r])));
const IBGE_PARA_TSE = Object.fromEntries(Object.entries(MUNICIPIOS).map(([cd, m]) => [m[2], cd]));

const pad = (v, n) => String(v).padStart(n, '0');
const fmt = n => (n || 0).toLocaleString('pt-BR');
const pct = (x, casas = 1) => (isFinite(x) ? x : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
const $ = id => document.getElementById(id);
const bandeira = iso => iso ? `<img class="flag" src="https://flagcdn.com/w40/${iso.toLowerCase()}.png" alt="" onerror="this.remove()">` : '';
const seloUF = uf => `<span class="selo-uf">${uf}</span>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const espera = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- configuração
const PADRAO = {
  turno: '2', fonte: 'auto', destaque: 'vencedor', ordem: 'comp', soComVotos: true, cidades: true,
  rotulos: true, brasil: true, projecao: true, modo: 'completo', tour: false, tourSeg: '8', intervalo: '30', som: true,
};
const cfg = Object.assign({}, PADRAO, JSON.parse(localStorage.getItem('cfg-apuracao') || '{}'));
const salvarCfg = () => localStorage.setItem('cfg-apuracao', JSON.stringify(cfg));
// o padrão antigo era 1 min; quem ficou com ele salvo passa para 30 s (o servidor agora confere o TSE a cada 30 s)
if (cfg.intervalo === '60' && !cfg.intervalo30) { cfg.intervalo = '30'; cfg.intervalo30 = true; salvarCfg(); }

// Modos de exibição: "completo" (navegador, celular e TV, padrão) e "live" (vertical 9:16 com tour, para transmissão).
// O endereço pode fixar o modo, útil para TV e OBS: ?modo=live, ?modo=completo ou ?modo=tv (completo, em tela cheia, com tour).
const parametroModo = new URLSearchParams(location.search).get('modo');
if (parametroModo === 'live' || parametroModo === 'completo') cfg.modo = parametroModo;
const modoTV = parametroModo === 'tv';
if (modoTV) { cfg.modo = 'completo'; cfg.tour = true; }
const ehLive = () => cfg.modo === 'live';

// ---------------------------------------------------------------- estado
let T = TURNOS[cfg.turno];
let cands = [];               // [{n, nome, partido, sq, cor}]
let candSet = new Set();
let cidades = new Map();      // exterior: mun -> {cd, nome, iso, cont, lat, lon, secoes:[], bu:{}, of:null}
let ufs = {};                 // UF -> totalização oficial
let munDados = {};            // UF -> {codTSE -> totalização oficial}
let munDados1 = {};           // idem, do 1º turno (referência na dica do município durante o 2º turno)
let ofExterior = null, brasil = null;
let cacheBU = {};
let sel = { tipo: 'total' };
let aba = 'ufs';
let atualizando = false, ultimaAtualizacao = null, timerAtual = null, timerTour = null, tourIdx = 0;
let pendentesBU = 0;
let geracao = 0; // incrementa a cada troca de turno para descartar downloads antigos
let assinaturaAnterior = null;
let projecao = null;          // dados/projecao-2.json (só no modo servidor, 2º turno)

function chaveCache() { return 'bu-' + T.pleito; }
function carregarCache() {
  try { cacheBU = JSON.parse(localStorage.getItem(chaveCache()) || '{}'); } catch { cacheBU = {}; }
}
let timerCache = null;
function salvarCache() {
  clearTimeout(timerCache);
  timerCache = setTimeout(() => {
    try { localStorage.setItem(chaveCache(), JSON.stringify(cacheBU)); } catch (e) { console.warn(e); }
  }, 1500);
}

function iniciarCidades() {
  cidades = new Map();
  for (const [cd, [nome, iso, lat, lon]] of Object.entries(CIDADES)) {
    cidades.set(cd, { cd, nome, iso, cont: PAISES[iso][1], lat, lon, secoes: [], bu: {}, of: null });
  }
}

// ---------------------------------------------------------------- rede
// O CDN do TSE devolve 429/5xx de forma intermitente em dia de eleição: tenta de novo com espera crescente.
async function baixar(url, tentativas = 6) {
  for (let i = 0; ; i++) {
    let r = null;
    try { r = await fetch(url, { cache: 'no-cache' }); } catch (e) { if (i >= tentativas - 1) throw e; }
    if (r && r.ok) return r;
    if (r && r.status !== 429 && r.status < 500) throw new Error(r.status + ' ' + url);
    if (i >= tentativas - 1) throw new Error((r ? r.status : 'rede') + ' ' + url);
    await espera(Math.min(15000, 700 * 2 ** i) + Math.random() * 500);
  }
}
async function getJSON(url) { return (await baixar(url)).json(); }
async function emParalelo(itens, limite, fn) {
  let i = 0;
  const trab = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const item = itens[i++];
      try { await fn(item); } catch (e) { console.warn(e.message || e); }
    }
  });
  await Promise.all(trab);
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

function definirCandidatos(lista) {
  if (cands.length) return;
  let extra = 0;
  cands = [...lista].sort((a, b) => a.n - b.n).map(c => ({ ...c, cor: CORES_FIXAS[c.n] || PALETA_EXTRA[extra++ % PALETA_EXTRA.length] }));
  candSet = new Set(cands.map(c => String(c.n)));
  montarSelectsCandidatos();
}

// Modo servidor: o job de sincronização (server/sync.js) publica um snapshot único por turno.
// Se ele existir, o painel lê só esse arquivo e não consulta o TSE diretamente.
let modoServidor = null; // null = ainda não detectado
async function carregarSnapshot() {
  const r = await fetch(`dados/turno-${cfg.turno}.json`, { cache: 'no-cache' });
  if (!r.ok) return false;
  const snap = await r.json();
  definirCandidatos(snap.candidatos);
  ofExterior = snap.ofExterior;
  brasil = snap.brasil;
  ufs = snap.ufs || {};
  for (const [cd, sc] of Object.entries(snap.cidades)) {
    let c = cidades.get(cd);
    if (!c) { c = { cd, nome: sc.nome, iso: null, cont: null, lat: null, lon: null }; cidades.set(cd, c); }
    c.secoes = sc.secoes; c.bu = sc.bu; c.of = sc.of;
  }
  ultimaAtualizacao = new Date(snap.gerado);
  return true;
}

// ---------------------------------------------------------------- modo direto (sem servidor)
async function carregarCandidatos() {
  const j = await getJSON(`${BASE}/${T.ele}/dados/zz/zz-c0001-e${pad(T.ele, 6)}-u.json`);
  ofExterior = oficialDe(j);
  definirCandidatos(candidatosDe(j));
}

async function carregarBrasil() {
  try { brasil = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/br/br-c0001-e${pad(T.ele, 6)}-u.json`)); }
  catch { /* mantém o anterior */ }
}

async function carregarUFs() {
  await emParalelo(UFS, 6, async uf => {
    const u = uf.toLowerCase();
    ufs[uf] = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}-c0001-e${pad(T.ele, 6)}-u.json`));
  });
}

async function carregarSecoes() {
  const j = await getJSON(`${BASE}/arquivo-urna/${T.pleito}/config/zz/zz-p${pad(T.pleito, 6)}-cs.json`);
  const zz = j.abr ? j.abr.find(a => a.cd === 'zz') : j;
  for (const mu of zz.mu) {
    let c = cidades.get(mu.cd);
    if (!c) { // cidade nova não mapeada: aparece no ranking sem ponto no mapa
      c = { cd: mu.cd, nome: mu.nm, iso: null, cont: null, lat: null, lon: null, secoes: [], bu: {}, of: null };
      cidades.set(mu.cd, c);
    }
    c.secoes = [];
    for (const z of mu.zon) for (const s of z.sec) {
      if (s.nsp) continue; // seção agregada a outra (votos vêm no BU da principal)
      c.secoes.push({ zona: z.cd, ns: s.ns, quando: s.da ? `${s.da} ${s.ha}` : null, agregadas: s.nsa || [] });
    }
  }
}

async function baixarBU(c, s) {
  const g = geracao;
  const chave = `${c.cd}-${s.zona}-${s.ns}`;
  const dir = `${BASE}/arquivo-urna/${T.pleito}/dados/zz/${c.cd}/${s.zona}/${s.ns}`;
  const aux = await getJSON(`${dir}/p${pad(T.pleito, 6)}-zz-m${c.cd}-z${s.zona}-s${s.ns}-aux.json`);
  const hashes = (aux.hashes || []).filter(h => (h.arq || []).some(a => a.tp === 'bu') && !/exclu|cancel/i.test(h.st || ''));
  const h = hashes[hashes.length - 1];
  if (g !== geracao) return;
  if (!h) { cacheBU[chave] = { q: s.quando, r: null }; return; }
  const nm = h.arq.find(a => a.tp === 'bu').nm;
  const buf = await (await baixar(`${dir}/${h.hash}/${nm}`)).arrayBuffer();
  if (g !== geracao) return;
  const res = BU.decodificar(buf, T.ele, 1);
  cacheBU[chave] = { q: s.quando, r: res };
  c.bu[`${s.zona}-${s.ns}`] = res;
  salvarCache();
  agendarRender();
}

async function carregarBUs() {
  const fila = [];
  for (const c of cidades.values()) for (const s of c.secoes) {
    if (!s.quando) continue;
    const chave = `${c.cd}-${s.zona}-${s.ns}`;
    const em = cacheBU[chave];
    if (em && em.q === s.quando) { if (em.r) c.bu[`${s.zona}-${s.ns}`] = em.r; continue; }
    fila.push([c, s]);
  }
  pendentesBU = fila.length;
  agendarRender();
  await emParalelo(fila, 6, async ([c, s]) => {
    try { await baixarBU(c, s); } finally { pendentesBU--; }
  });
}

async function carregarOficiaisCidades() {
  if (!ofExterior || ofExterior.secRec === 0) return; // TSE ainda não divulgou nada no exterior
  await emParalelo([...cidades.values()], 6, async c => {
    c.of = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/zz/zz${c.cd}-c0001-e${pad(T.ele, 6)}-u.json`));
    agendarRender();
  });
}

// municípios de uma UF: no servidor vêm prontos; no modo direto, baixa só os que mudaram
const versaoMun = {};
async function carregarMunicipiosUF(uf) {
  if (modoServidor) {
    const r = await fetch(`dados/turno-${cfg.turno}-mun-${uf}.json`, { cache: 'no-cache' });
    if (r.ok) munDados[uf] = (await r.json()).municipios;
    // no 2º turno, o 1º turno de cada município serve de referência na dica do mapa
    if (cfg.turno === '2' && !munDados1[uf]) {
      const r1 = await fetch(`dados/turno-1-mun-${uf}.json`, { cache: 'no-cache' }).catch(() => null);
      if (r1 && r1.ok) munDados1[uf] = (await r1.json()).municipios;
    }
    return;
  }
  const u = uf.toLowerCase();
  const ab = await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}-e${pad(T.ele, 6)}-ab.json`);
  const dados = (munDados[uf] ||= {});
  const fila = [];
  for (const a of ab.abr || []) {
    if (a.tpabr !== 'mun' || !(+a.s?.st > 0)) continue;
    const v = `${a.s.st}|${a.dt} ${a.ht}|${a.e?.c}`;
    if (versaoMun[a.cdabr] !== v) fila.push([a.cdabr, v]);
  }
  await emParalelo(fila, 6, async ([cd, v]) => {
    dados[cd] = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/${u}/${u}${cd}-c0001-e${pad(T.ele, 6)}-u.json`));
    versaoMun[cd] = v;
    agendarRender();
  });
}

function ufEmFoco() {
  if (sel.tipo === 'uf') return sel.id;
  if (sel.tipo === 'municipio') return MUNICIPIOS[sel.id][0];
  return null;
}

async function atualizar() {
  if (atualizando) return;
  atualizando = true;
  status('Atualizando…');
  let ok = true;
  try {
    if (modoServidor === null) {
      try { modoServidor = (await (await fetch('saude', { cache: 'no-store' })).json()).ok === true; } catch { modoServidor = false; }
    }
    if (modoServidor) {
      try { ok = await carregarSnapshot(); } catch (e) { ok = false; console.warn(e); }
      const uf = ufEmFoco();
      if (uf) await carregarMunicipiosUF(uf).catch(e => console.warn(e));
      projecao = null;
      if (cfg.turno === '2') {
        try { const rp = await fetch('dados/projecao-2.json', { cache: 'no-cache' }); if (rp.ok) projecao = await rp.json(); } catch { /* sem projeção */ }
      }
      status(ok ? '' : 'Servidor ainda sincronizando com o TSE…');
      return;
    }
    // sem servidor de sincronização: consulta o TSE direto do navegador
    await carregarCandidatos();
    await Promise.all([carregarUFs(), cfg.brasil ? carregarBrasil() : null]);
    agendarRender();
    await carregarSecoes();
    const tarefas = [];
    if (cfg.fonte !== 'oficial') tarefas.push(carregarBUs());
    if (cfg.fonte !== 'bu') tarefas.push(carregarOficiaisCidades());
    const uf = ufEmFoco();
    if (uf) tarefas.push(carregarMunicipiosUF(uf));
    await Promise.all(tarefas);
    ultimaAtualizacao = new Date();
    status('');
  } catch (e) {
    ok = false;
    console.error(e);
    status('Falha ao atualizar: ' + e.message);
  } finally {
    atualizando = false;
    render();
    if (ok) avisarNovosDados();
    programarAtualizacao();
  }
}
function programarAtualizacao() {
  clearTimeout(timerAtual);
  const s = +cfg.intervalo;
  if (s > 0) timerAtual = setTimeout(atualizar, s * 1000);
}
function status(msg) { $('statusCarga').textContent = msg; }

// toca o bipe e pisca o aviso quando a apuração avançou desde a última atualização
// Fotografia por local (UFs e países do exterior) para descobrir onde a apuração avançou entre duas atualizações.
function fotografarLocais() {
  const f = {};
  for (const uf of UFS) f['uf:' + uf] = dadosUF(uf);
  const porPais = {};
  for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
  for (const [iso, l] of Object.entries(porPais)) f['pais:' + iso] = agregar(l);
  return f;
}
let fotoAnterior = null;
let timerAviso = null;

function avisarNovosDados() {
  if (!cands.length) return;
  const d = agregarSel({ tipo: 'total' });
  const assinatura = `${cfg.turno}|${d.secRec}|${d.comp}|${Object.values(d.votos).join(',')}`;
  const mudou = assinaturaAnterior !== null && assinatura !== assinaturaAnterior && d.comp > 0;
  assinaturaAnterior = assinatura;
  const foto = fotografarLocais();
  const antes = fotoAnterior;
  fotoAnterior = foto;
  if (!mudou) return;

  // locais que ganharam votos desde a última atualização, dos que mais cresceram para os que menos
  const novos = [];
  if (antes) {
    for (const [k, agora] of Object.entries(foto)) {
      const a = antes[k];
      const delta = agora.comp - (a ? a.comp : 0);
      if (delta > 0) novos.push({ k, delta, d: agora });
    }
    novos.sort((x, y) => y.delta - x.delta);
  }
  const linhas = novos.slice(0, 4).map(({ k, delta, d }) => {
    const [tipo, id] = k.split(':');
    const r = resumo(d);
    const rotulo = tipo === 'uf' ? `${seloUF(id)}${esc(UF_NOMES[id])}` : `${bandeira(id)}${esc(PAISES[id]?.[0] || id)}`;
    const placar = r.lista.slice(0, 2).map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ');
    return `<div class="nd-linha"><span class="nd-local">${rotulo}</span><span class="nd-delta">+${fmt(delta)} votos</span><span class="nd-placar">${placar}</span><small>${pct(r.pctSec)} apurado</small></div>`;
  });
  if (novos.length > 4) linhas.push(`<div class="nd-mais">e mais ${novos.length - 4} ${novos.length - 4 === 1 ? 'local' : 'locais'}</div>`);
  if (!linhas.length) { // sem a fotografia anterior (primeira atualização): mostra o total
    const r = resumo(d);
    linhas.push(`<div class="nd-linha"><span class="nd-local">Total</span><span class="nd-placar">${r.lista.slice(0, 2).map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ')}</span></div>`);
  }
  $('ndLista').innerHTML = linhas.join('');
  const el = $('novosDados');
  el.classList.remove('mostrar'); void el.offsetWidth; el.classList.add('mostrar');
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => el.classList.remove('mostrar'), 9000);
  if (cfg.som) Som.tocar();
}

// ---------------------------------------------------------------- visitantes online
// id anônimo por navegador (não identifica a pessoa); só existe no modo servidor
function iniciarPresenca() {
  let id = localStorage.getItem('id-visitante');
  if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now()).replace(/[^a-z0-9]/g, '').slice(0, 24);
    localStorage.setItem('id-visitante', id);
  }
  const sinal = async () => {
    if (!modoServidor) return;
    try {
      const r = await fetch(`presenca?c=${id}`, { cache: 'no-store' });
      const { online } = await r.json();
      $('online').classList.remove('oculto');
      $('online').textContent = `👥 ${fmt(online)} online`;
    } catch { /* sem contador */ }
  };
  setTimeout(sinal, 1500);
  setInterval(sinal, 30000);
}

// ---------------------------------------------------------------- agregação
function vazio() { return { secTot: 0, secRec: 0, aptos: 0, comp: 0, votos: {}, brancos: 0, nulos: 0, nCid: 0, nCidVotos: 0 }; }

function somar(acc, d) {
  acc.secTot += d.secTot; acc.secRec += d.secRec; acc.aptos += d.aptos; acc.comp += d.comp;
  acc.brancos += d.brancos; acc.nulos += d.nulos;
  for (const k in d.votos) {
    if (candSet.size && !candSet.has(String(k))) { acc.nulos += d.votos[k]; continue; } // número inexistente = nulo
    acc.votos[k] = (acc.votos[k] || 0) + d.votos[k];
  }
  return acc;
}

function dadosBU(c) {
  const d = vazio();
  d.secTot = c.secoes.length;
  for (const r of Object.values(c.bu)) { somar(d, { ...vazio(), aptos: r.aptos, comp: r.comp, votos: r.votos, brancos: r.brancos, nulos: r.nulos }); d.secRec++; }
  return d;
}

function dadosCidade(c) {
  const bu = cfg.fonte !== 'oficial' ? dadosBU(c) : null;
  const of = cfg.fonte !== 'bu' && c.of ? somar(vazio(), c.of) : null;
  let d = bu || vazio();
  if (of && (!bu || of.secRec >= bu.secRec)) d = of;
  if (!d.secTot) d.secTot = c.secoes.length;
  d.nCid = 1; d.nCidVotos = d.comp > 0 ? 1 : 0;
  return d;
}

function agregar(lista) {
  const acc = vazio();
  for (const c of lista) { const d = dadosCidade(c); somar(acc, d); acc.nCid++; acc.nCidVotos += d.nCidVotos; }
  return acc;
}

const dadosUF = uf => ufs[uf] ? somar(vazio(), ufs[uf]) : vazio();
function dadosMun(cd) {
  const o = munDados[MUNICIPIOS[cd]?.[0]]?.[cd];
  return o ? somar(vazio(), o) : vazio();
}
function somaUFs(lista) { const acc = vazio(); for (const uf of lista) somar(acc, dadosUF(uf)); return acc; }

const ehExterior = s => ['mundo', 'continente', 'pais', 'cidade'].includes(s.tipo);

// Exterior oficial derivado: em 2026 o TSE deixou os arquivos do exterior (zz) parados e só atualiza a
// totalização do exterior dentro do total do país. Então exterior = total do país − soma das 27 UFs.
function exteriorDerivado() {
  if (!brasil || !Object.keys(ufs).length) return null;
  const s = somaUFs(UFS);
  const d = vazio();
  for (const k of ['secTot', 'secRec', 'aptos', 'comp', 'brancos', 'nulos']) d[k] = (brasil[k] || 0) - (s[k] || 0);
  for (const c of cands) d.votos[c.n] = (brasil.votos[c.n] || 0) - (s.votos[c.n] || 0);
  const negativo = Object.values(d.votos).some(v => v < 0) || ['secTot', 'secRec', 'comp'].some(k => d[k] < 0);
  return negativo || d.secRec <= 0 ? null : d; // UFs mais novas que o total do país: não dá para derivar
}
// Exterior inteiro: usa o derivado do TSE quando ele tem mais seções que os boletins de urna já baixados
function dadosExterior() {
  const bu = agregar([...cidades.values()]);
  const der = cfg.fonte !== 'bu' ? exteriorDerivado() : null;
  if (der && der.secRec > bu.secRec) return Object.assign(der, { nCid: bu.nCid, nCidVotos: bu.nCidVotos, derivado: true, secBU: bu.secRec });
  return bu;
}

function agregarSel(s) {
  switch (s.tipo) {
    case 'total': return somar(somaUFs(UFS), dadosExterior());
    case 'brasil': return somaUFs(UFS);
    case 'regiao': return somaUFs(REGIOES[s.id][1]);
    case 'uf': return dadosUF(s.id);
    case 'municipio': return dadosMun(s.id);
    case 'mundo': return dadosExterior();
    default: return agregar(cidadesDa(s));
  }
}

function resumo(d) {
  const validos = Object.values(d.votos).reduce((a, b) => a + b, 0);
  const lista = cands.map(c => ({ ...c, votos: d.votos[c.n] || 0, pct: validos ? 100 * (d.votos[c.n] || 0) / validos : 0 }))
    .sort((a, b) => b.votos - a.votos || a.n - b.n);
  const lider = validos ? lista[0] : null;
  const margem = validos && lista[1] ? lista[0].pct - lista[1].pct : (validos ? 100 : 0);
  return { validos, lista, lider, margem, pctSec: d.secTot ? 100 * d.secRec / d.secTot : 0 };
}

function cidadesDa(s) {
  const todas = [...cidades.values()];
  if (s.tipo === 'continente') return todas.filter(c => c.cont === s.id);
  if (s.tipo === 'pais') return todas.filter(c => c.iso === s.id);
  if (s.tipo === 'cidade') return todas.filter(c => c.cd === s.id);
  if (s.tipo === 'mundo' || s.tipo === 'total') return todas;
  return [];
}

function nomeSel(s) {
  switch (s.tipo) {
    case 'total': return 'Brasil + exterior';
    case 'brasil': return 'Brasil';
    case 'regiao': return 'Região ' + REGIOES[s.id][0];
    case 'uf': return UF_NOMES[s.id];
    case 'municipio': return `${MUNICIPIOS[s.id][1]} (${MUNICIPIOS[s.id][0]})`;
    case 'mundo': return 'Exterior';
    case 'continente': return CONTINENTES[s.id];
    case 'pais': return PAISES[s.id]?.[0] || s.id;
    case 'cidade': return cidades.get(s.id)?.nome || s.id;
  }
  return '';
}
function iconeSel(s) {
  if (s.tipo === 'pais') return bandeira(s.id);
  if (s.tipo === 'cidade') return bandeira(cidades.get(s.id)?.iso);
  if (s.tipo === 'uf') return seloUF(s.id);
  if (s.tipo === 'municipio') return seloUF(MUNICIPIOS[s.id][0]);
  if (['total', 'brasil', 'regiao'].includes(s.tipo)) return bandeira('BR');
  return '';
}

// ---------------------------------------------------------------- mapa
const mapa = L.map('mapa', { zoomControl: false, worldCopyJump: true, minZoom: 2, zoomSnap: 0.25, attributionControl: true })
  .setView([-14, -52], 4);
mapa.attributionControl.setPrefix(false).addAttribution('Mapas: IBGE, Natural Earth · Dados: TSE');
L.geoJSON(MUNDO_GEO, { interactive: false, style: { weight: 0.5, color: '#2a3550', fillColor: '#151d33', fillOpacity: 1 } }).addTo(mapa);
mapa.createPane('munPane').style.zIndex = 410;
mapa.createPane('ufPane').style.zIndex = 420;
mapa.createPane('cidadesPane').style.zIndex = 450;

function corPara(r) {
  if (!r.validos) return null;
  if (cfg.destaque === 'vencedor') return { cor: r.lider.cor, op: 0.3 + 0.6 * Math.min(1, r.margem / 40) };
  const c = r.lista.find(x => String(x.n) === cfg.destaque);
  return { cor: c.cor, op: 0.08 + 0.85 * (c.pct / 100) };
}

// --- exterior: países e cidades
const camadaPaises = L.geoJSON(PAISES_GEO, {
  style: () => ({ weight: 0.6, color: '#3b4252', fillOpacity: 0, fillColor: '#000' }),
  onEachFeature: (f, layer) => {
    layer.on('click', () => selecionar({ tipo: 'pais', id: f.properties.iso }));
    layer.on('mouseover', () => layer.setStyle({ weight: 2, color: '#fff' }));
    layer.on('mouseout', () => estilizarPais(layer));
  },
}).addTo(mapa);
const marcadores = new Map();
const camadaCidades = L.layerGroup().addTo(mapa);

// --- Brasil: UFs e municípios
let camadaUFs = null;
carregarGeo('ufs').then(geo => {
  camadaUFs = L.geoJSON(geo, {
    pane: 'ufPane',
    onEachFeature: (f, layer) => {
      layer.on('click', () => selecionar({ tipo: 'uf', id: f.properties.uf }));
      layer.on('mouseover', () => layer.setStyle({ weight: 2.5, color: '#fff' }));
      layer.on('mouseout', () => estilizarUF(layer));
    },
  }).addTo(mapa);
  render();
});
let camadaMun = null, ufCamadaMun = null;
async function mostrarMunicipios(uf) {
  if (ufCamadaMun === uf) return;
  if (camadaMun) { mapa.removeLayer(camadaMun); camadaMun = null; }
  ufCamadaMun = uf;
  if (!uf) return;
  const geo = await carregarGeo(`mun-${uf}`);
  if (ufCamadaMun !== uf) return;
  camadaMun = L.geoJSON(geo, {
    pane: 'munPane',
    onEachFeature: (f, layer) => {
      const cd = IBGE_PARA_TSE[f.properties.ibge];
      if (!cd) return;
      layer.on('click', () => selecionar({ tipo: 'municipio', id: cd }));
      layer.on('mouseover', () => layer.setStyle({ weight: 2, color: '#fff' }));
      layer.on('mouseout', () => estilizarMun(layer));
    },
  }).addTo(mapa);
  renderMapa();
}

let dadosPaisCache = {};
function estilizarPais(layer) {
  const iso = layer.feature.properties.iso;
  const info = dadosPaisCache[iso];
  const selecionado = sel.tipo === 'pais' && sel.id === iso;
  const visivel = !ehExterior(sel) && sel.tipo !== 'total' ? false :
    sel.tipo !== 'continente' || PAISES[iso]?.[1] === sel.id;
  const c = info && corPara(info.r);
  layer.setStyle({
    weight: selecionado ? 2.5 : 0.6,
    color: selecionado ? '#ffffff' : '#4b5563',
    fillColor: c ? c.cor : '#1f2937',
    fillOpacity: c ? c.op * (visivel ? 1 : 0.35) : (visivel ? 0.25 : 0.1),
  });
  if (selecionado) layer.bringToFront();
}

function estilizarUF(layer) {
  const uf = layer.feature.properties.uf;
  const r = resumo(dadosUF(uf));
  const c = corPara(r);
  const foco = ufEmFoco();
  const naSel = sel.tipo === 'total' || sel.tipo === 'brasil' || (sel.tipo === 'regiao' && REGIAO_DA_UF[uf] === sel.id) || foco === uf;
  layer.setStyle({
    weight: foco === uf ? 3 : 1, color: foco === uf ? '#facc15' : '#0b1020',
    fillColor: c ? c.cor : '#334155',
    // com a UF aberta, os municípios aparecem por baixo: a UF fica só com a borda
    fillOpacity: foco === uf ? 0 : (c ? c.op : 0.35) * (naSel ? 1 : 0.35),
  });
  // a UF aberta fica por cima só como contorno: o mouse passa para os municípios embaixo dela
  const el = layer.getElement();
  if (el) el.style.pointerEvents = foco === uf ? 'none' : '';
  if (foco === uf) layer.closeTooltip();
}

function estilizarMun(layer) {
  const cd = IBGE_PARA_TSE[layer.feature.properties.ibge];
  const r = resumo(cd ? dadosMun(cd) : vazio());
  const c = corPara(r);
  const selec = sel.tipo === 'municipio' && sel.id === cd;
  layer.setStyle({
    weight: selec ? 3 : 0.4, color: selec ? '#facc15' : '#0b1020',
    fillColor: c ? c.cor : '#334155', fillOpacity: c ? c.op : 0.3,
  });
  if (selec) layer.bringToFront();
}

function rotuloUF(uf, r) {
  return r.validos ? `<b>${uf}</b> <span style="color:${r.lider.cor}">${pct(r.lider.pct, 0)}</span>` : `<b>${uf}</b>`;
}

function renderMapa() {
  // Brasil
  if (camadaUFs) {
    const comRotulo = cfg.rotulos && ['total', 'brasil', 'regiao'].includes(sel.tipo);
    camadaUFs.eachLayer(l => {
      estilizarUF(l);
      const uf = l.feature.properties.uf;
      const d = dadosUF(uf), r = resumo(d);
      l.unbindTooltip();
      if (comRotulo && (sel.tipo !== 'regiao' || REGIAO_DA_UF[uf] === sel.id)) {
        l.bindTooltip(rotuloUF(uf, r), { permanent: true, direction: 'center', className: 'rotulo rotulo-uf' });
      } else {
        l.bindTooltip(tooltipHTML(seloUF(uf) + esc(UF_NOMES[uf]), d, r), { sticky: true, className: 'tip' });
      }
    });
  }
  if (camadaMun) {
    camadaMun.eachLayer(l => {
      estilizarMun(l);
      const cd = IBGE_PARA_TSE[l.feature.properties.ibge];
      if (!cd) return;
      const d = dadosMun(cd);
      l.unbindTooltip();
      l.bindTooltip(tooltipMunicipio(cd, d, resumo(d)), { sticky: true, className: 'tip' });
    });
  }

  // exterior
  dadosPaisCache = {};
  const porPais = {};
  for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
  for (const [iso, lista] of Object.entries(porPais)) {
    const d = agregar(lista);
    dadosPaisCache[iso] = { d, r: resumo(d) };
  }
  camadaPaises.eachLayer(l => {
    estilizarPais(l);
    const iso = l.feature.properties.iso;
    const info = dadosPaisCache[iso];
    l.unbindTooltip();
    if (info) l.bindTooltip(tooltipHTML(bandeira(iso) + esc(PAISES[iso][0]), info.d, info.r), { sticky: true, className: 'tip' });
  });

  const noExterior = ehExterior(sel);
  const naSelecao = new Set(cidadesDa(sel).map(c => c.cd));
  const ranking = [];
  for (const c of cidades.values()) {
    if (c.lat == null) continue;
    const d = dadosCidade(c), r = resumo(d);
    let m = marcadores.get(c.cd);
    if (!m) {
      m = L.circleMarker([c.lat, c.lon], { pane: 'cidadesPane', weight: 1.5, color: '#fff' });
      m.on('click', e => { L.DomEvent.stopPropagation(e); selecionar({ tipo: 'cidade', id: c.cd }); });
      marcadores.set(c.cd, m);
    }
    if (!cfg.cidades || (cfg.soComVotos && !r.validos) || !(noExterior || sel.tipo === 'total')) { camadaCidades.removeLayer(m); continue; }
    camadaCidades.addLayer(m);
    const cor = corPara(r);
    const atual = sel.tipo === 'cidade' && sel.id === c.cd;
    m.setRadius(r.validos ? Math.min(28, 4 + Math.sqrt(d.comp) / 2.2) : 3);
    m.setStyle({
      fillColor: cor ? cor.cor : '#6b7280', fillOpacity: cor ? 0.9 : 0.5,
      opacity: naSelecao.has(c.cd) ? 1 : 0.3, color: atual ? '#facc15' : '#fff', weight: atual ? 3 : 1.2,
    });
    m.unbindTooltip();
    if (r.validos) ranking.push({ c, d, r, m });
    else m.bindTooltip(tooltipHTML(bandeira(c.iso) + esc(c.nome), d, r), { className: 'tip' });
  }
  ranking.sort((a, b) => b.d.comp - a.d.comp);
  const nRotulos = cfg.rotulos && noExterior ? (sel.tipo === 'mundo' ? 8 : 12) : 0;
  let rot = 0;
  for (const it of ranking) {
    if (naSelecao.has(it.c.cd) && rot < nRotulos) {
      rot++;
      it.m.bindTooltip(`<b>${esc(it.c.nome)}</b> <span style="color:${it.r.lider.cor}">${esc(it.r.lider.nome)} ${pct(it.r.lider.pct, 0)}</span>`,
        { permanent: true, direction: 'top', offset: [0, -6], className: 'rotulo' });
    } else {
      it.m.bindTooltip(tooltipHTML(bandeira(it.c.iso) + esc(it.c.nome), it.d, it.r), { className: 'tip' });
    }
  }
}

// dica do município: resultado do 2º turno (ou "ainda sem apuração") e o 1º turno como referência
function tooltipMunicipio(cd, d, r) {
  const [uf, nome, , capital] = MUNICIPIOS[cd];
  let h = `<div class="tip-titulo">${esc(nome)} <small>${uf}${capital ? ' · capital' : ''}</small></div>`;
  if (r.validos) {
    for (const c of r.lista.slice(0, 4)) {
      h += `<div class="tip-linha"><i style="background:${c.cor}"></i>${esc(c.nome)} <b>${pct(c.pct)}</b> <small>${fmt(c.votos)}</small></div>`;
    }
    h += `<div class="tip-sem">${fmt(d.comp)} votantes · ${fmt(d.secRec)}/${fmt(d.secTot)} seções (${pct(r.pctSec)})</div>`;
  } else {
    h += `<div class="tip-sem">Ainda sem apuração${d.secTot ? ` · 0/${fmt(d.secTot)} seções` : ''}</div>`;
  }
  const ref = cfg.turno === '2' ? munDados1[uf]?.[cd] : null;
  if (ref) {
    const v = ref.votos, tot = Object.values(v).reduce((a, b) => a + b, 0);
    if (tot) {
      h += '<div class="tip-ref">No 1º turno: ' + cands.map(c => `<span style="color:${c.cor}">${esc(c.nome)} ${pct(100 * (v[c.n] || 0) / tot)}</span>`).join(' · ') + '</div>';
    }
  }
  return h;
}

function tooltipHTML(titulo, d, r) {
  let h = `<div class="tip-titulo">${titulo}</div>`;
  if (!r.validos) return h + `<div class="tip-sem">Sem votos apurados · ${fmt(d.secRec)}/${fmt(d.secTot)} seções</div>`;
  for (const c of r.lista.slice(0, 4)) {
    h += `<div class="tip-linha"><i style="background:${c.cor}"></i>${esc(c.nome)} <b>${pct(c.pct)}</b> <small>${fmt(c.votos)}</small></div>`;
  }
  return h + `<div class="tip-sem">${fmt(d.comp)} votantes · ${fmt(d.secRec)}/${fmt(d.secTot)} seções (${pct(r.pctSec)})</div>`;
}

function limitesUFs(lista) {
  let b = null;
  if (camadaUFs) camadaUFs.eachLayer(l => { if (lista.includes(l.feature.properties.uf)) b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
  return b;
}

function enquadrar() {
  const op = { padding: [30, 30], duration: 1 };
  if (sel.tipo === 'total') { mapa.flyTo([-5, -35], ehLive() ? 2.25 : 2.75, { duration: 1 }); return; }
  if (sel.tipo === 'mundo') { mapa.flyTo([20, 10], ehLive() ? 1.5 : 2, { duration: 1 }); return; }
  if (sel.tipo === 'brasil') { const b = limitesUFs(UFS); if (b) mapa.flyToBounds(b, op); return; }
  if (sel.tipo === 'regiao') { const b = limitesUFs(REGIOES[sel.id][1]); if (b) mapa.flyToBounds(b, { ...op, maxZoom: 6 }); return; }
  if (sel.tipo === 'uf') { const b = limitesUFs([sel.id]); if (b) mapa.flyToBounds(b, { ...op, maxZoom: 8 }); return; }
  if (sel.tipo === 'municipio') {
    let b = null;
    if (camadaMun) camadaMun.eachLayer(l => { if (IBGE_PARA_TSE[l.feature.properties.ibge] === sel.id) b = l.getBounds(); });
    if (b) mapa.flyToBounds(b, { ...op, maxZoom: 10 }); else { const u = limitesUFs([MUNICIPIOS[sel.id][0]]); if (u) mapa.flyToBounds(u, op); }
    return;
  }
  const pts = cidadesDa(sel).filter(c => c.lat != null).map(c => [c.lat, c.lon]);
  let bounds = pts.length ? L.latLngBounds(pts) : null;
  if (sel.tipo === 'pais') camadaPaises.eachLayer(l => { if (l.feature.properties.iso === sel.id) bounds = bounds ? bounds.extend(l.getBounds()) : l.getBounds(); });
  if (!bounds) return;
  mapa.flyToBounds(bounds, { padding: [40, 40], maxZoom: sel.tipo === 'cidade' ? 7 : sel.tipo === 'pais' ? 6 : 4, duration: 1 });
}

// ---------------------------------------------------------------- seleção
function selecionar(s, { mover = true, manual = true } = {}) {
  sel = s;
  if (manual && cfg.tour) pararTour(true);
  aba = { total: 'ufs', brasil: 'ufs', regiao: 'ufs', uf: 'municipios', municipio: 'municipios', mundo: 'paises', continente: 'paises', pais: 'cidades', cidade: 'secoes' }[s.tipo];
  const uf = ufEmFoco();
  mostrarMunicipios(uf).then(() => { if (mover && uf && sel.tipo === 'municipio') enquadrar(); });
  if (uf && !munDados[uf]) carregarMunicipiosUF(uf).then(render).catch(e => console.warn(e));
  sincronizarFiltros();
  render();
  if (mover) enquadrar();
}

function caminho(s) {
  const p = [{ s: { tipo: 'total' }, nome: 'Total' }];
  const add = (x) => p.push({ s: x, nome: iconeSel(x) + esc(x.tipo === 'municipio' ? MUNICIPIOS[x.id][1] : nomeSel(x)) });
  if (['brasil', 'regiao', 'uf', 'municipio'].includes(s.tipo)) {
    add({ tipo: 'brasil' });
    const uf = s.tipo === 'uf' ? s.id : s.tipo === 'municipio' ? MUNICIPIOS[s.id][0] : null;
    const reg = s.tipo === 'regiao' ? s.id : uf ? REGIAO_DA_UF[uf] : null;
    if (reg) p.push({ s: { tipo: 'regiao', id: reg }, nome: REGIOES[reg][0] });
    if (uf) add({ tipo: 'uf', id: uf });
    if (s.tipo === 'municipio') add(s);
  } else if (ehExterior(s)) {
    p.push({ s: { tipo: 'mundo' }, nome: '🌍 Exterior' });
    let cont = null, iso = null;
    if (s.tipo === 'continente') cont = s.id;
    if (s.tipo === 'pais') { iso = s.id; cont = PAISES[iso][1]; }
    if (s.tipo === 'cidade') { const c = cidades.get(s.id); iso = c.iso; cont = c.cont; }
    if (cont) p.push({ s: { tipo: 'continente', id: cont }, nome: CONTINENTES[cont] });
    if (iso) add({ tipo: 'pais', id: iso });
    if (s.tipo === 'cidade') add(s);
  }
  return p;
}

function voltar() {
  const p = caminho(sel);
  if (p.length > 1) selecionar(p[p.length - 2].s);
}

function trilha() {
  const partes = caminho(sel);
  const el = $('trilha');
  el.innerHTML = partes.map((p, i) => `<button data-i="${i}" class="${i === partes.length - 1 ? 'atual' : ''}">${p.nome}</button>`).join('<span>›</span>');
  el.querySelectorAll('button').forEach(b => b.onclick = () => selecionar(partes[+b.dataset.i].s));
}

// ---------------------------------------------------------------- render
let timerRender = null;
function agendarRender() {
  if (timerRender) return;
  timerRender = setTimeout(() => { timerRender = null; render(); }, 600);
}

function render() {
  if (!cands.length) return;
  const d = agregarSel(sel);
  const r = resumo(d);

  $('subtitulo').innerHTML = `Presidente · ${T.nome} · ${iconeSel(sel)} ${esc(nomeSel(sel))}`;
  const dTot = agregarSel({ tipo: 'total' });
  const rTot = resumo(dTot);
  $('pctSecoes').textContent = pct(rTot.pctSec, 2);
  $('barraSecoes').style.width = rTot.pctSec + '%';
  const hora = ultimaAtualizacao ? ultimaAtualizacao.toLocaleTimeString('pt-BR') : '–';
  // horário em que o TSE gerou o último dado: deixa claro quando a demora é do TSE e não do painel
  const tse = horaTSE();
  const parado = tse && cfg.turno === '2' && Date.now() - tse.data > 15 * 60 * 1000;
  $('ultimaAtual').innerHTML = `${fmt(dTot.secRec)} de ${fmt(dTot.secTot)} seções · atualizado ${hora}` +
    (tse ? ` · <span class="${parado ? 'tse-parado' : ''}" title="Horário em que o TSE gerou o último dado publicado">${parado ? '⚠ TSE sem novos dados desde ' : 'dado do TSE das '}${tse.texto}</span>` : '') +
    (pendentesBU > 0 ? ` · baixando ${fmt(pendentesBU)} BUs` : '');

  trilha();
  renderChips();
  renderPlacar(d, r);
  renderEstatisticas(d, r);
  renderMapa();
  renderRanking();
  renderTicker();
  renderLegenda();
  $('selo').innerHTML = sel.tipo === 'total' ? '' :
    `<div>${iconeSel(sel)} ${esc(nomeSel(sel))}</div>` + (r.validos ? `<small>${fmt(d.comp)} votantes · ${pct(r.pctSec)} das seções</small>` : '<small>sem votos apurados</small>');
}

// "25/10/2026 17:06:31" (horário de Brasília) do total oficial do país -> { data, texto }
function horaTSE() {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/.exec(brasil?.hora || '');
  if (!m) return null;
  const data = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00-03:00`);
  const hoje = new Date().toISOString().slice(0, 10) === `${m[3]}-${m[2]}-${m[1]}`;
  return { data, texto: hoje ? `${m[4]}:${m[5]}` : `${m[1]}/${m[2]} ${m[4]}:${m[5]}` };
}

function foto(c) { return modoServidor ? `dados/fotos/${c.sq}.jpeg` : `${BASE}/${T.ele}/fotos/br/${c.sq}.jpeg`; }
// se a foto falhar, mostra as iniciais do candidato no lugar
const iniciais = nome => nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('');
function imgFoto(c) { return `<span class="foto" data-ini="${esc(iniciais(c.nome))}"><img src="${foto(c)}" alt="" onerror="this.remove()"></span>`; }

function renderPlacar(d, r) {
  const el = $('placar');
  if (cands.length === 2) {
    const [a, b] = [...cands].map(c => r.lista.find(x => x.n === c.n));
    const lado = (c, cls) => `
      <div class="duelo-cand ${cls} ${r.lider && r.lider.n === c.n ? 'lider' : ''}" style="--cor:${c.cor}">
        ${imgFoto(c)}
        <div class="info">
          <div class="nome">${esc(c.nome)}</div>
          <div class="partido">${esc(c.n)} · ${esc(c.partido)}</div>
          <div class="pct">${pct(c.pct, 2)}</div>
          <div class="votos">${fmt(c.votos)} votos</div>
        </div>
      </div>`;
    const tot = a.votos + b.votos;
    const pa = tot ? 100 * a.votos / tot : 50;
    el.className = 'duelo';
    el.innerHTML = `<div class="duelo-lados">${lado(a, 'esq')}<div class="vs">×</div>${lado(b, 'dir')}</div>
      <div class="duelo-barra"><div style="width:${pa}%;background:${a.cor}"></div><div style="width:${100 - pa}%;background:${b.cor}"></div><i></i></div>` + htmlProjecao();
  } else {
    el.className = 'barras';
    const max = Math.max(1, ...r.lista.map(c => c.pct));
    el.innerHTML = r.lista.map((c, i) => `
      <div class="barra-cand ${i === 0 && r.validos ? 'lider' : ''}" style="--cor:${c.cor}">
        ${imgFoto(c)}
        <div class="bc-info"><div class="bc-nome">${esc(c.nome)} <small>${esc(c.n)} · ${esc(c.partido)}</small></div>
          <div class="bc-trilho"><div style="width:${100 * c.pct / max}%"></div></div></div>
        <div class="bc-num"><b>${pct(c.pct, 2)}</b><small>${fmt(c.votos)}</small></div>
      </div>`).join('');
  }
}

// projeção do resultado final (experimental): só para Total, Brasil e estados, no 2º turno
function escopoProjecao() {
  if (!cfg.projecao || !projecao || cfg.turno !== '2') return null;
  const k = sel.tipo === 'total' ? 'total' : sel.tipo === 'brasil' ? 'brasil' : sel.tipo === 'uf' ? sel.id : null;
  return k ? { k, p: projecao.disponivel ? projecao.escopos[k] : null } : null;
}
function htmlProjecao() {
  const e = escopoProjecao();
  if (!e) return '';
  const topo = '<div class="proj-topo"><b>PROJEÇÃO</b> <span class="proj-exp">experimental</span><button class="proj-ajuda" onclick="mostrarMetodo()">como calculamos</button></div>';
  if (!e.p) return `<div class="projecao">${topo}<div class="proj-indef">${esc(projecao.motivo || 'sem dados suficientes para este local')}</div></div>`;
  const [a, b] = cands.map(c => ({ ...c, pct: e.p.pct[c.n], faixa: e.p.faixa[c.n] }));
  const venc = e.p.vencedor ? cands.find(c => String(c.n) === String(e.p.vencedor)) : null;
  const [lo, hi] = a.faixa;
  return `<div class="projecao">${topo}
    <div class="proj-linha"><span style="color:${a.cor}">${esc(a.nome)} <b>${pct(a.pct)}</b></span><span style="color:${b.cor}"><b>${pct(b.pct)}</b> ${esc(b.nome)}</span></div>
    <div class="proj-barra" style="--a:${a.cor};--b:${b.cor}"><div class="proj-faixa" style="left:${lo}%;width:${hi - lo}%"></div><div class="proj-ponto" style="left:${a.pct}%"></div><i></i></div>
    <div class="proj-rodape">faixa provável de ${esc(a.nome)}: ${pct(lo)} a ${pct(hi)} · ${pct(e.p.pesoApurado, 0)} do eleitorado apurado</div>
    <div class="proj-veredito ${venc ? '' : 'indef'}" ${venc ? `style="background:${venc.cor}"` : ''}>${venc ? `Projeção indica vitória de ${esc(venc.nome)}` : 'Ainda indefinido: a faixa provável cruza os 50%'}</div>
  </div>`;
}
function mostrarMetodo() { $('metodo').classList.remove('oculto'); }

function renderEstatisticas(d, r) {
  const itens = [
    ['Seções apuradas', `${fmt(d.secRec)}/${fmt(d.secTot)} <small>${pct(r.pctSec)}</small>`],
    ['Votantes', fmt(d.comp) + (d.aptos ? ` <small>${pct(100 * d.comp / d.aptos)} dos aptos</small>` : '')],
    ['Válidos', fmt(r.validos)],
    ['Brancos', fmt(d.brancos) + (d.comp ? ` <small>${pct(100 * d.brancos / d.comp)}</small>` : '')],
    ['Nulos', fmt(d.nulos) + (d.comp ? ` <small>${pct(100 * d.nulos / d.comp)}</small>` : '')],
  ];
  if (['mundo', 'continente'].includes(sel.tipo)) itens.splice(1, 0, ['Cidades', `${fmt(d.nCidVotos)}/${fmt(d.nCid)}`]);
  if (sel.tipo === 'mundo' && d.derivado) {
    itens.push(['Fonte', `<small>TSE oficial (total do país − estados). Países e cidades: boletins de ${fmt(d.secBU)} seções</small>`]);
  }
  if (sel.tipo === 'total') {
    const dx = dadosExterior();
    itens.splice(1, 0, ['Exterior', `${fmt(dx.comp)} <small>votantes</small>`]);
  }
  let h = itens.map(([k, v]) => `<div class="est"><span>${k}</span><b>${v}</b></div>`).join('');
  if (cfg.brasil && brasil) {
    const rb = resumo(brasil);
    h += rb.validos
      ? `<div class="est brasil"><span>TSE oficial · total do país (${pct(rb.pctSec)} das seções)</span><b>${rb.lista.slice(0, 2).map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ')}</b></div>`
      : `<div class="est brasil"><span>TSE oficial · total do país</span><b><small>aguardando divulgação (a partir das 17h de Brasília)</small></b></div>`;
  }
  $('estatisticas').innerHTML = h;
}

function item(chave, nome, icone, d, s) { return { chave, nome, icone, d, r: resumo(d), s }; }
const itemExterior = () => item('ZZ', 'Exterior', '<span class="selo-uf selo-zz">🌍</span>', dadosExterior(), { tipo: 'mundo' });

function itensRanking() {
  let itens = [];
  if (aba === 'ufs') {
    const lista = sel.tipo === 'regiao' ? REGIOES[sel.id][1] : UFS;
    itens = lista.map(uf => item(uf, UF_NOMES[uf], seloUF(uf), dadosUF(uf), { tipo: 'uf', id: uf }));
    // no Total, o exterior entra na comparação como mais um "estado" (no TSE ele é a UF ZZ)
    if (sel.tipo === 'total') itens.push(itemExterior());
  } else if (aba === 'regioes') {
    itens = Object.entries(REGIOES).map(([k, [n, l]]) => item(k, n, '', somaUFs(l), { tipo: 'regiao', id: k }));
    if (sel.tipo === 'total') itens.push(itemExterior());
  } else if (aba === 'municipios') {
    const uf = ufEmFoco();
    const dados = munDados[uf] || {};
    itens = Object.entries(MUNICIPIOS).filter(([, m]) => m[0] === uf)
      .map(([cd, m]) => item(cd, esc(m[1]) + (m[3] ? ' <small>capital</small>' : ''), '', dados[cd] ? somar(vazio(), dados[cd]) : vazio(), { tipo: 'municipio', id: cd }));
  } else if (aba === 'secoes' && sel.tipo === 'cidade') {
    const c = cidades.get(sel.id);
    for (const s of c.secoes) {
      const r0 = c.bu[`${s.zona}-${s.ns}`];
      const d = vazio(); d.secTot = 1;
      if (r0) { somar(d, { ...vazio(), aptos: r0.aptos, comp: r0.comp, votos: r0.votos, brancos: r0.brancos, nulos: r0.nulos }); d.secRec = 1; }
      itens.push(item(s.ns, `Seção ${s.ns}` + (s.agregadas.length ? ` <small>+${s.agregadas.length} agreg.</small>` : ''), '', d, null));
    }
  } else {
    const todas = cidadesDa(sel.tipo === 'total' ? { tipo: 'mundo' } : sel);
    if (aba === 'continentes') {
      for (const k of Object.keys(CONTINENTES)) {
        const d = agregar(todas.filter(c => c.cont === k));
        if (d.nCid) itens.push(item(k, CONTINENTES[k], '', d, { tipo: 'continente', id: k }));
      }
    } else if (aba === 'paises') {
      for (const iso of new Set(todas.map(c => c.iso).filter(Boolean))) {
        itens.push(item(iso, PAISES[iso][0], bandeira(iso), agregar(todas.filter(c => c.iso === iso)), { tipo: 'pais', id: iso }));
      }
    } else {
      for (const c of todas) itens.push(item(c.cd, esc(c.nome), bandeira(c.iso), dadosCidade(c), { tipo: 'cidade', id: c.cd }));
    }
  }
  return ordenar(itens);
}

function ordenar(itens) {
  if (cfg.soComVotos) itens = itens.filter(i => i.r.validos > 0);
  const o = cfg.ordem;
  const pctDe = (i, n) => i.r.lista.find(c => String(c.n) === n)?.pct || 0;
  itens.sort((a, b) => {
    if (o === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR');
    if (o === 'margem') return b.r.margem - a.r.margem;
    if (o === 'apuracao') return b.r.pctSec - a.r.pctSec || b.d.comp - a.d.comp;
    if (o.startsWith('cand:')) { const n = o.slice(5); return pctDe(b, n) - pctDe(a, n) || b.d.comp - a.d.comp; }
    return b.d.comp - a.d.comp;
  });
  return itens;
}

function abasDaSelecao() {
  switch (sel.tipo) {
    case 'total': return [['ufs', 'Estados + exterior'], ['regioes', 'Regiões'], ['paises', 'Países']];
    case 'brasil': return [['ufs', 'Estados'], ['regioes', 'Regiões']];
    case 'regiao': return [['ufs', 'Estados']];
    case 'uf': case 'municipio': return [['municipios', 'Municípios']];
    case 'mundo': return [['paises', 'Países'], ['continentes', 'Continentes'], ['cidades', 'Cidades']];
    case 'continente': return [['paises', 'Países'], ['cidades', 'Cidades']];
    case 'pais': return [['cidades', 'Cidades']];
    case 'cidade': return [['secoes', 'Seções']];
  }
  return [];
}

function renderRanking() {
  const abas = abasDaSelecao();
  if (!abas.some(a => a[0] === aba)) aba = abas[0][0];
  $('abas').innerHTML = abas.map(([k, n]) => `<button data-k="${k}" class="${k === aba ? 'ativa' : ''}">${n}</button>`).join('');
  $('abas').querySelectorAll('button').forEach(b => b.onclick = () => { aba = b.dataset.k; renderRanking(); });
  $('rankingTitulo').textContent = sel.tipo === 'total' ? 'Comparativo geral' : `Em ${nomeSel(sel)}`;

  const itens = itensRanking();
  const ol = $('rankingLista');
  if (!itens.length) {
    const carregando = aba === 'municipios' && !munDados[ufEmFoco()];
    ol.innerHTML = `<li class="vazio">${carregando ? 'Carregando municípios…' : 'Nenhum voto apurado ainda nesta seleção.'}</li>`;
    return;
  }
  const atual = sel.tipo === 'municipio' ? sel.id : null;
  ol.innerHTML = itens.map((i, idx) => {
    const barras = i.r.validos
      ? i.r.lista.filter(c => c.votos > 0).map(c => `<div title="${esc(c.nome)} ${pct(c.pct)}" style="width:${c.pct}%;background:${c.cor}"></div>`).join('')
      : '';
    const lider = i.r.lider ? `<span class="rk-lider" style="color:${i.r.lider.cor}">${esc(i.r.lider.nome)} ${pct(i.r.lider.pct)}</span>` : '<span class="rk-lider sem">aguardando</span>';
    const tops = i.r.validos ? i.r.lista.slice(0, cands.length === 2 ? 2 : 3).map(c => `<span style="color:${c.cor}">${fmt(c.votos)}</span>`).join(' · ') : '';
    return `<li data-idx="${idx}" class="${i.s ? 'clicavel' : ''} ${i.chave === atual ? 'atual' : ''}">
      <div class="rk-pos">${idx + 1}</div>
      <div class="rk-corpo">
        <div class="rk-linha1">${i.icone}<span class="rk-nome">${i.nome}</span>${lider}</div>
        <div class="rk-barra">${barras}</div>
        <div class="rk-linha2"><span>${tops}</span><span>${fmt(i.d.comp)} votantes · ${pct(i.r.pctSec, 0)} seç.</span></div>
      </div></li>`;
  }).join('');
  ol.querySelectorAll('li.clicavel').forEach(li => li.onclick = () => selecionar(itens[+li.dataset.idx].s));
}

function renderChips() {
  const el = $('continentes');
  let chips;
  if (ehExterior(sel)) {
    chips = [[{ tipo: 'total' }, 'Total'], [{ tipo: 'mundo' }, '🌍 Exterior'], ...Object.entries(CONTINENTES).map(([k, v]) => [{ tipo: 'continente', id: k }, v])];
  } else {
    chips = [[{ tipo: 'total' }, 'Total'], [{ tipo: 'brasil' }, bandeira('BR') + 'Brasil'], ...Object.entries(REGIOES).map(([k, [n]]) => [{ tipo: 'regiao', id: k }, n]), [{ tipo: 'mundo' }, '🌍 Exterior']];
  }
  const chave = s => s.tipo + ':' + (s.id || '');
  const ativa = caminho(sel).map(p => chave(p.s));
  const html = chips.map(([s, n], i) => `<button data-i="${i}" class="${ativa[ativa.length - 1] === chave(s) || (ativa.includes(chave(s)) && s.tipo !== 'total') ? 'ativa' : ''}">${n}</button>`).join('');
  if (el.dataset.h === html) return;
  el.dataset.h = html;
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(b => b.onclick = () => selecionar(chips[+b.dataset.i][0]));
}

function renderTicker() {
  const itens = [];
  for (const uf of UFS) { const d = dadosUF(uf); itens.push({ rot: `${seloUF(uf)}<b>${esc(UF_NOMES[uf].toUpperCase())}</b>`, d, r: resumo(d) }); }
  const porPais = {};
  for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
  for (const [iso, l] of Object.entries(porPais)) { const d = agregar(l); itens.push({ rot: `${bandeira(iso)}<b>${esc(PAISES[iso][0].toUpperCase())}</b>`, d, r: resumo(d) }); }
  const lista = itens.filter(i => i.r.validos).sort((a, b) => b.d.comp - a.d.comp).slice(0, 50);
  const html = lista.map(i => `<span class="tk">${i.rot} ` +
    i.r.lista.slice(0, 2).map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ') + ` <small>${pct(i.r.pctSec, 0)} apurado</small></span>`).join('');
  const trilho = $('tickerTrilho');
  const novo = html ? html + html : '<span class="tk">Aguardando os primeiros resultados…</span>';
  if (trilho.dataset.h !== novo) {
    trilho.dataset.h = novo;
    trilho.innerHTML = novo;
    trilho.style.animationDuration = Math.max(30, lista.length * 6) + 's';
  }
}

function renderLegenda() {
  const el = $('legenda');
  if (cfg.destaque === 'vencedor') {
    el.innerHTML = '<b>Quem lidera</b>' + cands.filter((c, i) => cands.length <= 4 || i < 6).map(c => `<span><i style="background:${c.cor}"></i>${esc(c.nome)}</span>`).join('') +
      '<small>cor mais forte = vantagem maior</small><span><i class="sem-dados"></i><small>cinza = ainda sem apuração</small></span>';
  } else {
    const c = cands.find(x => String(x.n) === cfg.destaque);
    el.innerHTML = `<b>% de ${esc(c.nome)}</b><div class="grad" style="background:linear-gradient(90deg, transparent, ${c.cor})"></div><span class="esc"><small>0%</small><small>100%</small></span>`;
  }
}

// ---------------------------------------------------------------- tour
function iniciarTour() {
  clearInterval(timerTour);
  tourIdx = 0;
  const passo = () => {
    const ufsComVotos = UFS.map(uf => ({ uf, d: dadosUF(uf) })).filter(x => x.d.comp > 0).sort((a, b) => b.d.comp - a.d.comp).slice(0, 12);
    const porPais = {};
    for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
    const paises = Object.entries(porPais).map(([iso, l]) => ({ iso, d: agregar(l) }))
      .filter(p => p.d.comp > 0).sort((a, b) => b.d.comp - a.d.comp).slice(0, 10);
    const roteiro = [
      { tipo: 'total' }, { tipo: 'brasil' }, ...ufsComVotos.map(x => ({ tipo: 'uf', id: x.uf })),
      { tipo: 'mundo' }, ...paises.map(p => ({ tipo: 'pais', id: p.iso })),
    ];
    selecionar(roteiro[tourIdx % roteiro.length], { manual: false });
    tourIdx++;
  };
  passo();
  timerTour = setInterval(passo, +cfg.tourSeg * 1000);
}
function pararTour(desmarcar) {
  clearInterval(timerTour);
  if (desmarcar) { cfg.tour = false; $('fTour').checked = false; salvarCfg(); }
}

// ---------------------------------------------------------------- filtros
function montarSelectsCandidatos() {
  $('fDestaque').innerHTML = '<option value="vencedor">Quem está na frente</option>' +
    cands.map(c => `<option value="${c.n}">% de votos de ${esc(c.nome)}</option>`).join('');
  $('fOrdem').innerHTML = '<option value="comp">Mais votantes</option><option value="margem">Maior vantagem</option>' +
    '<option value="apuracao">% de seções apuradas</option><option value="nome">Nome (A-Z)</option>' +
    cands.map(c => `<option value="cand:${c.n}">Maior % de ${esc(c.nome)}</option>`).join('');
  if (![...$('fDestaque').options].some(o => o.value === cfg.destaque)) cfg.destaque = 'vencedor';
  if (![...$('fOrdem').options].some(o => o.value === cfg.ordem)) cfg.ordem = 'comp';
  $('fDestaque').value = cfg.destaque;
  $('fOrdem').value = cfg.ordem;
}

// "Ir para": todas as seleções possíveis num select só
const DESTINOS = [];
function montarFiltrosLocais() {
  const grupos = [
    ['Geral', [[{ tipo: 'total' }, 'Total (Brasil + exterior)'], [{ tipo: 'brasil' }, 'Brasil'], [{ tipo: 'mundo' }, 'Exterior']]],
    ['Regiões', Object.entries(REGIOES).map(([k, [n]]) => [{ tipo: 'regiao', id: k }, n])],
    ['Estados', UFS.map(uf => [{ tipo: 'uf', id: uf }, `${UF_NOMES[uf]} (${uf})`]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))],
    ['Exterior · continentes', Object.entries(CONTINENTES).map(([k, v]) => [{ tipo: 'continente', id: k }, v])],
    ['Exterior · países', Object.keys(PAISES).map(iso => [{ tipo: 'pais', id: iso }, PAISES[iso][0]]).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))],
  ];
  let h = '';
  for (const [g, l] of grupos) {
    h += `<optgroup label="${g}">` + l.map(([s, n]) => { DESTINOS.push(s); return `<option value="${DESTINOS.length - 1}">${esc(n)}</option>`; }).join('') + '</optgroup>';
  }
  $('fLocal').innerHTML = h;
  const opcoes = Object.entries(MUNICIPIOS).map(([, m]) => `<option value="${esc(m[1])} - ${m[0]}"></option>`);
  for (const c of cidades.values()) opcoes.push(`<option value="${esc(c.nome)} - ${esc(PAISES[c.iso]?.[0] || 'Exterior')}"></option>`);
  $('listaCidades').innerHTML = opcoes.join('');
}

function sincronizarFiltros() {
  const chave = s => s.tipo + ':' + (s.id || '');
  const alvo = caminho(sel).map(p => chave(p.s)).reverse().find(k => DESTINOS.some(d => chave(d) === k));
  const i = DESTINOS.findIndex(d => chave(d) === alvo);
  if (i >= 0) $('fLocal').value = String(i);
  if (sel.tipo !== 'municipio' && sel.tipo !== 'cidade') $('fBusca').value = '';
}

function buscar(q) {
  q = q.trim().toLowerCase();
  if (!q) return;
  const [nome, onde = ''] = q.split(' - ');
  const mun = Object.entries(MUNICIPIOS).find(([, m]) => m[1].toLowerCase() === nome && (!onde || m[0].toLowerCase() === onde));
  if (mun) return selecionar({ tipo: 'municipio', id: mun[0] });
  const cid = [...cidades.values()].find(c => c.nome.toLowerCase() === nome) || [...cidades.values()].find(c => c.nome.toLowerCase().includes(nome));
  if (cid) return selecionar({ tipo: 'cidade', id: cid.cd });
  const parcial = Object.entries(MUNICIPIOS).find(([, m]) => m[1].toLowerCase().includes(nome));
  if (parcial) selecionar({ tipo: 'municipio', id: parcial[0] });
}

function aplicarLayout() {
  document.body.classList.toggle('vertical', ehLive());
  document.body.classList.toggle('modo-live', ehLive());
  document.body.classList.toggle('modo-tv', modoTV);
  setTimeout(() => { mapa.invalidateSize(); enquadrar(); }, 50);
}

function atualizarBotaoSom() {
  const b = $('btnSom');
  b.textContent = cfg.som ? '🔊' : '🔇';
  b.title = cfg.som ? 'Som ligado (S)' : 'Som desligado (S)';
  b.classList.toggle('pendente', cfg.som && !Som.liberado());
  Som.definir(cfg.som);
}

function ligarFiltros() {
  const chk = { fProjecao: 'projecao', fSoComVotos: 'soComVotos', fCidades: 'cidades', fRotulos: 'rotulos', fBrasil: 'brasil', fTour: 'tour', fSom: 'som' };
  const sels = { fModo: 'modo', fTurno: 'turno', fFonte: 'fonte', fDestaque: 'destaque', fOrdem: 'ordem', fTourSeg: 'tourSeg', fIntervalo: 'intervalo' };
  // um controle ausente no HTML (ex.: página antiga em cache) não pode impedir a carga dos dados
  for (const lista of [chk, sels]) for (const id of Object.keys(lista)) if (!$(id)) { console.warn('controle ausente:', id); delete lista[id]; }
  for (const [id, k] of Object.entries(chk)) $(id).checked = cfg[k];
  for (const [id, k] of Object.entries(sels)) if ($(id).querySelector(`option[value="${cfg[k]}"]`)) $(id).value = cfg[k];

  for (const [id, k] of Object.entries(chk)) $(id).onchange = () => {
    cfg[k] = $(id).checked; salvarCfg();

    if (k === 'tour') cfg.tour ? iniciarTour() : pararTour(false);
    if (k === 'som') { atualizarBotaoSom(); if (cfg.som) Som.tocar(); }
    render();
  };
  for (const [id, k] of Object.entries(sels)) $(id).onchange = () => {
    cfg[k] = $(id).value; salvarCfg();
    if (k === 'modo') {
      // o live já entra com o tour rodando; o completo começa parado para o visitante navegar
      cfg.tour = ehLive(); $('fTour').checked = cfg.tour; salvarCfg();
      cfg.tour ? iniciarTour() : pararTour(false);
      aplicarLayout(); render();
    }
    else if (k === 'turno') trocarTurno();
    else if (k === 'fonte') { render(); atualizar(); }
    else if (k === 'intervalo') programarAtualizacao();
    else if (k === 'tourSeg' && cfg.tour) iniciarTour();
    else render();
  };
  $('fLocal').onchange = () => selecionar(DESTINOS[+$('fLocal').value]);
  $('fBusca').onchange = () => buscar($('fBusca').value);
  $('btnFiltros').onclick = () => $('painel').classList.toggle('oculto');
  $('btnSom').onclick = () => { if (!Som.liberado()) { Som.ativar(); cfg.som = true; } else cfg.som = !cfg.som; salvarCfg(); $('fSom').checked = cfg.som; atualizarBotaoSom(); if (cfg.som) Som.tocar(); };
  $('fecharPainel').onclick = () => $('painel').classList.add('oculto');
  $('btnAtualizar').onclick = () => atualizar();
  $('btnCache').onclick = () => {
    Object.keys(localStorage).filter(k => k.startsWith('bu-')).forEach(k => localStorage.removeItem(k));
    trocarTurno();
  };
  document.addEventListener('pointerdown', () => setTimeout(atualizarBotaoSom, 50));
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') $('painel').classList.toggle('oculto');
    else if (k === 't') { $('fTour').checked = !cfg.tour; $('fTour').onchange(); }
    else if (k === 'v' || k === 'l') { $('fModo').value = ehLive() ? 'completo' : 'live'; $('fModo').onchange(); }
    else if (k === 's') { $('fSom').checked = !cfg.som; $('fSom').onchange(); }
    else if (k === 'r') atualizar();
    else if (k === 'escape') { if (sel.tipo !== 'total') selecionar({ tipo: 'total' }); }
    else if (k === 'backspace') voltar();
    setTimeout(atualizarBotaoSom, 50);
  });
}

function trocarTurno() {
  geracao++;
  T = TURNOS[cfg.turno];
  cands = []; candSet = new Set(); ofExterior = null; brasil = null; ufs = {}; munDados = {}; munDados1 = {};
  assinaturaAnterior = null; fotoAnterior = null;
  for (const k in versaoMun) delete versaoMun[k];
  iniciarCidades();
  carregarCache();
  render();
  atualizando = false;
  atualizar();
}

// ---------------------------------------------------------------- início
iniciarCidades();
carregarCache();
montarFiltrosLocais();
ligarFiltros();
sincronizarFiltros();
atualizarBotaoSom();
iniciarPresenca();
aplicarLayout();
atualizar().then(() => { if (cfg.tour) iniciarTour(); });
