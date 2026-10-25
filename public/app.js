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

const pad = (v, n) => String(v).padStart(n, '0');
const fmt = n => (n || 0).toLocaleString('pt-BR');
const pct = (x, casas = 1) => (isFinite(x) ? x : 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
const $ = id => document.getElementById(id);
const bandeira = iso => iso ? `<img class="flag" src="https://flagcdn.com/w40/${iso.toLowerCase()}.png" alt="" onerror="this.remove()">` : '';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- configuração
const PADRAO = {
  turno: '2', fonte: 'auto', destaque: 'vencedor', ordem: 'comp', soComVotos: true, cidades: true,
  rotulos: true, brasil: true, vertical: false, tour: false, tourSeg: '8', intervalo: '60',
};
const cfg = Object.assign({}, PADRAO, JSON.parse(localStorage.getItem('cfg-apuracao') || '{}'));
const salvarCfg = () => localStorage.setItem('cfg-apuracao', JSON.stringify(cfg));

// ---------------------------------------------------------------- estado
let T = TURNOS[cfg.turno];
let cands = [];               // [{n, nome, partido, sq, cor}]
let candSet = new Set();
let cidades = new Map();      // mun -> {cd, nome, iso, cont, lat, lon, secoes:[], bu:{}, of:null}
let ofExterior = null, brasil = null;
let cacheBU = {};
let sel = { tipo: 'mundo', id: null };
let aba = 'paises';
let atualizando = false, ultimaAtualizacao = null, timerAtual = null, timerTour = null, tourIdx = 0;
let pendentesBU = 0;
let geracao = 0; // incrementa a cada troca de turno para descartar downloads antigos

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
const espera = ms => new Promise(r => setTimeout(r, ms));
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

async function carregarCandidatos() {
  const j = await getJSON(`${BASE}/${T.ele}/dados/zz/zz-c0001-e${pad(T.ele, 6)}-u.json`);
  ofExterior = oficialDe(j);
  definirCandidatos(candidatosDe(j));
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
  for (const [cd, sc] of Object.entries(snap.cidades)) {
    let c = cidades.get(cd);
    if (!c) { c = { cd, nome: sc.nome, iso: null, cont: null, lat: null, lon: null }; cidades.set(cd, c); }
    c.secoes = sc.secoes; c.bu = sc.bu; c.of = sc.of;
  }
  ultimaAtualizacao = new Date(snap.gerado);
  return true;
}

async function carregarBrasil() {
  try { brasil = oficialDe(await getJSON(`${BASE}/${T.ele}/dados/br/br-c0001-e${pad(T.ele, 6)}-u.json`)); }
  catch { brasil = null; }
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
  const r = await baixar(`${dir}/${h.hash}/${nm}`);
  const buf = await r.arrayBuffer();
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

async function atualizar() {
  if (atualizando) return;
  atualizando = true;
  status('Atualizando…');
  try {
    if (modoServidor === null) {
      try { modoServidor = (await (await fetch('saude', { cache: 'no-store' })).json()).ok === true; } catch { modoServidor = false; }
    }
    if (modoServidor) {
      let ok = false;
      try { ok = await carregarSnapshot(); } catch (e) { console.warn(e); }
      status(ok ? '' : 'Servidor ainda sincronizando com o TSE…');
      return;
    }
    // sem servidor de sincronização: consulta o TSE direto do navegador
    await carregarCandidatos();
    await carregarSecoes();
    const tarefas = [];
    if (cfg.fonte !== 'oficial') tarefas.push(carregarBUs());
    if (cfg.fonte !== 'bu') tarefas.push(carregarOficiaisCidades());
    if (cfg.brasil) tarefas.push(carregarBrasil());
    await Promise.all(tarefas);
    ultimaAtualizacao = new Date();
    status('');
  } catch (e) {
    console.error(e);
    status('Falha ao atualizar: ' + e.message);
  } finally {
    atualizando = false;
    render();
    programarAtualizacao();
  }
}
function programarAtualizacao() {
  clearTimeout(timerAtual);
  const s = +cfg.intervalo;
  if (s > 0) timerAtual = setTimeout(atualizar, s * 1000);
}
function status(msg) { $('statusCarga').textContent = msg; }

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
  if (of) { of.secTot = c.of.secTot; of.secRec = c.of.secRec; }
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
  return todas;
}

function nomeSel(s) {
  if (s.tipo === 'continente') return CONTINENTES[s.id];
  if (s.tipo === 'pais') return PAISES[s.id]?.[0] || s.id;
  if (s.tipo === 'cidade') return cidades.get(s.id)?.nome || s.id;
  return 'Todo o exterior';
}

// ---------------------------------------------------------------- mapa
const mapa = L.map('mapa', { zoomControl: false, worldCopyJump: true, minZoom: 2, zoomSnap: 0.25, attributionControl: true })
  .setView([20, 10], 2);
mapa.attributionControl.setPrefix(false).addAttribution('Mapa: Natural Earth · Dados: TSE');
L.geoJSON(MUNDO_GEO, { interactive: false, style: { weight: 0.5, color: '#2a3550', fillColor: '#151d33', fillOpacity: 1 } }).addTo(mapa);
mapa.createPane('cidadesPane').style.zIndex = 450;

const camadaPaises = L.geoJSON(PAISES_GEO, {
  style: () => ({ weight: 0.6, color: '#3b4252', fillOpacity: 0, fillColor: '#000' }),
  onEachFeature: (f, layer) => {
    layer.on('click', () => selecionar({ tipo: 'pais', id: f.properties.iso }));
    layer.on('mouseover', () => layer.setStyle({ weight: 2, color: '#fff' }));
    layer.on('mouseout', () => estilizarPais(layer));
  },
}).addTo(mapa);

const marcadores = new Map(); // mun -> circleMarker
const camadaCidades = L.layerGroup().addTo(mapa);

function corPara(d, r) {
  if (!r.validos) return null;
  if (cfg.destaque === 'vencedor') {
    return { cor: r.lider.cor, op: 0.3 + 0.6 * Math.min(1, r.margem / 40) };
  }
  const c = r.lista.find(x => String(x.n) === cfg.destaque);
  return { cor: c.cor, op: 0.08 + 0.85 * (c.pct / 100) };
}

let dadosPaisCache = {};
function estilizarPais(layer) {
  const iso = layer.feature.properties.iso;
  const info = dadosPaisCache[iso];
  const selecionado = sel.tipo === 'pais' && sel.id === iso;
  const visivel = sel.tipo === 'mundo' || sel.tipo === 'pais' || (sel.tipo === 'continente' && PAISES[iso]?.[1] === sel.id) ||
    (sel.tipo === 'cidade' && cidades.get(sel.id)?.iso === iso);
  const c = info && corPara(info.d, info.r);
  layer.setStyle({
    weight: selecionado ? 2.5 : 0.6,
    color: selecionado ? '#ffffff' : '#4b5563',
    fillColor: c ? c.cor : '#1f2937',
    fillOpacity: c ? c.op * (visivel ? 1 : 0.35) : (visivel ? 0.25 : 0.1),
  });
  if (selecionado) layer.bringToFront();
}

function renderMapa() {
  dadosPaisCache = {};
  const porPais = {};
  for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
  for (const [iso, lista] of Object.entries(porPais)) {
    const d = agregar(lista);
    dadosPaisCache[iso] = { d, r: resumo(d) };
  }
  camadaPaises.eachLayer(l => {
    estilizarPais(l);
    const info = dadosPaisCache[l.feature.properties.iso];
    l.unbindTooltip();
    if (info) l.bindTooltip(tooltipHTML(PAISES[l.feature.properties.iso][0], l.feature.properties.iso, info.d, info.r), { sticky: true, className: 'tip' });
  });

  // cidades
  const mostrar = cfg.cidades;
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
    const cor = corPara(d, r);
    const naSel = cidadesDa(sel).includes(c);
    const esconder = !mostrar || (cfg.soComVotos && !r.validos);
    if (esconder) { camadaCidades.removeLayer(m); continue; }
    camadaCidades.addLayer(m);
    const raio = r.validos ? Math.min(28, 4 + Math.sqrt(d.comp) / 2.2) : 3;
    m.setRadius(raio);
    m.setStyle({
      fillColor: cor ? cor.cor : '#6b7280', fillOpacity: cor ? 0.9 : 0.5,
      opacity: naSel ? 1 : 0.3, color: sel.tipo === 'cidade' && sel.id === c.cd ? '#facc15' : '#fff',
      weight: sel.tipo === 'cidade' && sel.id === c.cd ? 3 : 1.2,
    });
    m.unbindTooltip();
    if (r.validos) ranking.push({ c, d, r, m });
    else m.bindTooltip(tooltipHTML(c.nome, c.iso, d, r), { className: 'tip' });
  }
  // rótulos fixos para as maiores cidades da seleção
  ranking.sort((a, b) => b.d.comp - a.d.comp);
  const nRotulos = cfg.rotulos ? (sel.tipo === 'mundo' ? 8 : 12) : 0;
  let rot = 0;
  for (const it of ranking) {
    const naSel = cidadesDa(sel).includes(it.c);
    if (naSel && rot < nRotulos) {
      rot++;
      it.m.bindTooltip(`<b>${esc(it.c.nome)}</b> <span style="color:${it.r.lider.cor}">${esc(it.r.lider.nome)} ${pct(it.r.lider.pct, 0)}</span>`,
        { permanent: true, direction: 'top', offset: [0, -6], className: 'rotulo' });
    } else {
      it.m.bindTooltip(tooltipHTML(it.c.nome, it.c.iso, it.d, it.r), { className: 'tip' });
    }
  }
}

function tooltipHTML(nome, iso, d, r) {
  let h = `<div class="tip-titulo">${bandeira(iso)} ${esc(nome)}</div>`;
  if (!r.validos) return h + `<div class="tip-sem">Sem votos apurados · ${fmt(d.secRec)}/${fmt(d.secTot)} seções</div>`;
  for (const c of r.lista.slice(0, 4)) {
    h += `<div class="tip-linha"><i style="background:${c.cor}"></i>${esc(c.nome)} <b>${pct(c.pct)}</b> <small>${fmt(c.votos)}</small></div>`;
  }
  return h + `<div class="tip-sem">${fmt(d.comp)} votantes · ${fmt(d.secRec)}/${fmt(d.secTot)} seções</div>`;
}

function enquadrar() {
  if (sel.tipo === 'mundo') { mapa.flyTo([20, 10], cfg.vertical ? 1.5 : 2, { duration: 1 }); return; }
  const pts = cidadesDa(sel).filter(c => c.lat != null).map(c => [c.lat, c.lon]);
  let bounds = pts.length ? L.latLngBounds(pts) : null;
  if (sel.tipo === 'pais') camadaPaises.eachLayer(l => { if (l.feature.properties.iso === sel.id) bounds = bounds ? bounds.extend(l.getBounds()) : l.getBounds(); });
  if (!bounds) return;
  const maxZoom = sel.tipo === 'cidade' ? 7 : sel.tipo === 'pais' ? 6 : 4;
  mapa.flyToBounds(bounds, { padding: [40, 40], maxZoom, duration: 1 });
}

// ---------------------------------------------------------------- seleção
function selecionar(s, { mover = true, manual = true } = {}) {
  sel = s;
  if (manual && cfg.tour) pararTour(true);
  if (s.tipo === 'mundo') aba = 'paises';
  else if (s.tipo === 'continente') aba = 'paises';
  else if (s.tipo === 'pais') aba = 'cidades';
  else if (s.tipo === 'cidade') aba = 'secoes';
  sincronizarFiltros();
  render();
  if (mover) enquadrar();
}

function voltar() {
  if (sel.tipo === 'cidade') { const c = cidades.get(sel.id); selecionar(c.iso ? { tipo: 'pais', id: c.iso } : { tipo: 'mundo' }); }
  else if (sel.tipo === 'pais') selecionar({ tipo: 'continente', id: PAISES[sel.id][1] });
  else selecionar({ tipo: 'mundo' });
}

function trilha() {
  const partes = [{ s: { tipo: 'mundo' }, nome: '🌍 Mundo' }];
  let cont = null, iso = null;
  if (sel.tipo === 'continente') cont = sel.id;
  if (sel.tipo === 'pais') { iso = sel.id; cont = PAISES[iso][1]; }
  if (sel.tipo === 'cidade') { const c = cidades.get(sel.id); iso = c.iso; cont = c.cont; }
  if (cont) partes.push({ s: { tipo: 'continente', id: cont }, nome: CONTINENTES[cont] });
  if (iso) partes.push({ s: { tipo: 'pais', id: iso }, nome: bandeira(iso) + ' ' + esc(PAISES[iso][0]) });
  if (sel.tipo === 'cidade') partes.push({ s: sel, nome: esc(cidades.get(sel.id).nome) });
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
  const lista = cidadesDa(sel);
  const d = agregar(lista);
  const r = resumo(d);

  $('subtitulo').innerHTML = `Urnas no exterior · Presidente · ${T.nome} · ${sel.tipo === 'pais' || sel.tipo === 'cidade' ? bandeira(sel.tipo === 'pais' ? sel.id : cidades.get(sel.id).iso) : ''} ${esc(nomeSel(sel))}`;
  const dTot = agregar([...cidades.values()]);
  const rTot = resumo(dTot);
  $('pctSecoes').textContent = pct(rTot.pctSec, 2);
  $('barraSecoes').style.width = rTot.pctSec + '%';
  const hora = ultimaAtualizacao ? ultimaAtualizacao.toLocaleTimeString('pt-BR') : '–';
  $('ultimaAtual').textContent = `${fmt(dTot.secRec)} de ${fmt(dTot.secTot)} seções · atualizado ${hora}` + (pendentesBU > 0 ? ` · baixando ${fmt(pendentesBU)} BUs` : '');

  trilha();
  renderPlacar(d, r);
  renderEstatisticas(d, r);
  renderMapa();
  renderRanking();
  renderTicker();
  renderLegenda();
  $('selo').innerHTML = sel.tipo === 'mundo' ? '' :
    `<div>${sel.tipo === 'pais' ? bandeira(sel.id) : sel.tipo === 'cidade' ? bandeira(cidades.get(sel.id).iso) : ''} ${esc(nomeSel(sel))}</div>` +
    (r.validos ? `<small>${fmt(d.comp)} votantes</small>` : '<small>sem votos apurados</small>');
}

function foto(c) { return modoServidor ? `dados/fotos/${c.sq}.jpeg` : `${BASE}/${T.ele}/fotos/br/${c.sq}.jpeg`; }
// se a foto falhar, mostra as iniciais do candidato no lugar
const iniciais = nome => nome.split(/s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("");
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
      <div class="duelo-barra"><div style="width:${pa}%;background:${a.cor}"></div><div style="width:${100 - pa}%;background:${b.cor}"></div><i></i></div>`;
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

function renderEstatisticas(d, r) {
  const itens = [
    ['Seções', `${fmt(d.secRec)}/${fmt(d.secTot)} <small>${pct(r.pctSec)}</small>`],
    ['Votantes', fmt(d.comp) + (d.aptos ? ` <small>${pct(100 * d.comp / d.aptos)} dos aptos</small>` : '')],
    ['Válidos', fmt(r.validos)],
    ['Brancos', fmt(d.brancos) + (d.comp ? ` <small>${pct(100 * d.brancos / d.comp)}</small>` : '')],
    ['Nulos', fmt(d.nulos) + (d.comp ? ` <small>${pct(100 * d.nulos / d.comp)}</small>` : '')],
  ];
  if (sel.tipo === 'mundo' || sel.tipo === 'continente') itens.splice(1, 0, ['Cidades', `${fmt(d.nCidVotos)}/${fmt(d.nCid)}`]);
  let h = itens.map(([k, v]) => `<div class="est"><span>${k}</span><b>${v}</b></div>`).join('');
  if (cfg.brasil && brasil) {
    const rb = resumo(brasil);
    h += rb.validos
      ? `<div class="est brasil"><span>Brasil (oficial ${pct(rb.pctSec)})</span><b>${rb.lista.slice(0, 2).map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ')}</b></div>`
      : `<div class="est brasil"><span>Brasil (oficial)</span><b><small>aguardando divulgação</small></b></div>`;
  }
  $('estatisticas').innerHTML = h;
}

function itensRanking() {
  const todas = cidadesDa(sel);
  let itens = [];
  if (aba === 'secoes' && sel.tipo === 'cidade') {
    const c = cidades.get(sel.id);
    for (const s of c.secoes) {
      const r0 = c.bu[`${s.zona}-${s.ns}`];
      const d = vazio(); d.secTot = 1;
      if (r0) { somar(d, { ...vazio(), aptos: r0.aptos, comp: r0.comp, votos: r0.votos, brancos: r0.brancos, nulos: r0.nulos }); d.secRec = 1; }
      itens.push({ chave: s.ns, nome: `Seção ${s.ns}` + (s.agregadas.length ? ` <small>+${s.agregadas.length} agreg.</small>` : ''), iso: null, d, r: resumo(d), s: null });
    }
    return ordenar(itens);
  }
  if (aba === 'continentes') {
    for (const k of Object.keys(CONTINENTES)) {
      const d = agregar(todas.filter(c => c.cont === k));
      if (d.nCid) itens.push({ chave: k, nome: CONTINENTES[k], iso: null, d, r: resumo(d), s: { tipo: 'continente', id: k } });
    }
  } else if (aba === 'paises') {
    const isos = [...new Set(todas.map(c => c.iso).filter(Boolean))];
    for (const iso of isos) {
      const d = agregar(todas.filter(c => c.iso === iso));
      itens.push({ chave: iso, nome: PAISES[iso][0], iso, d, r: resumo(d), s: { tipo: 'pais', id: iso } });
    }
  } else {
    for (const c of todas) {
      const d = dadosCidade(c);
      itens.push({ chave: c.cd, nome: c.nome, iso: c.iso, d, r: resumo(d), s: { tipo: 'cidade', id: c.cd } });
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

function renderRanking() {
  const abas = sel.tipo === 'cidade' ? [['secoes', 'Seções']] :
    sel.tipo === 'pais' ? [['cidades', 'Cidades']] :
      sel.tipo === 'continente' ? [['paises', 'Países'], ['cidades', 'Cidades']] :
        [['paises', 'Países'], ['continentes', 'Continentes'], ['cidades', 'Cidades']];
  if (!abas.some(a => a[0] === aba)) aba = abas[0][0];
  $('abas').innerHTML = abas.map(([k, n]) => `<button data-k="${k}" class="${k === aba ? 'ativa' : ''}">${n}</button>`).join('');
  $('abas').querySelectorAll('button').forEach(b => b.onclick = () => { aba = b.dataset.k; renderRanking(); });
  $('rankingTitulo').textContent = sel.tipo === 'mundo' ? 'Comparativo mundial' : `Em ${nomeSel(sel)}`;

  const itens = itensRanking();
  const ol = $('rankingLista');
  if (!itens.length) { ol.innerHTML = '<li class="vazio">Nenhum voto apurado ainda nesta seleção.</li>'; return; }
  ol.innerHTML = itens.map((i, idx) => {
    const barras = i.r.validos
      ? i.r.lista.filter(c => c.votos > 0).map(c => `<div title="${esc(c.nome)} ${pct(c.pct)}" style="width:${c.pct}%;background:${c.cor}"></div>`).join('')
      : '';
    const lider = i.r.lider ? `<span class="rk-lider" style="color:${i.r.lider.cor}">${esc(i.r.lider.nome)} ${pct(i.r.lider.pct)}</span>` : '<span class="rk-lider sem">aguardando</span>';
    const tops = i.r.validos ? i.r.lista.slice(0, cands.length === 2 ? 2 : 3).map(c => `<span style="color:${c.cor}">${fmt(c.votos)}</span>`).join(' · ') : '';
    return `<li data-idx="${idx}" class="${i.s ? 'clicavel' : ''}">
      <div class="rk-pos">${idx + 1}</div>
      <div class="rk-corpo">
        <div class="rk-linha1">${bandeira(i.iso)}<span class="rk-nome">${i.nome}</span>${lider}</div>
        <div class="rk-barra">${barras}</div>
        <div class="rk-linha2"><span>${tops}</span><span>${fmt(i.d.comp)} votantes · ${fmt(i.d.secRec)}/${fmt(i.d.secTot)} seç.</span></div>
      </div></li>`;
  }).join('');
  ol.querySelectorAll('li.clicavel').forEach(li => li.onclick = () => selecionar(itens[+li.dataset.idx].s));
}

function renderTicker() {
  const porPais = {};
  for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
  const itens = Object.entries(porPais).map(([iso, l]) => { const d = agregar(l); return { iso, d, r: resumo(d) }; })
    .filter(i => i.r.validos).sort((a, b) => b.d.comp - a.d.comp).slice(0, 40);
  const html = itens.map(i => `<span class="tk">${bandeira(i.iso)}<b>${esc(PAISES[i.iso][0].toUpperCase())}</b> ` +
    i.r.lista.slice(0, 2).map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ') + '</span>').join('');
  const trilho = $('tickerTrilho');
  const novo = html ? html + html : '<span class="tk">Aguardando os primeiros boletins de urna do exterior…</span>';
  if (trilho.dataset.h !== novo) {
    trilho.dataset.h = novo;
    trilho.innerHTML = novo;
    trilho.style.animationDuration = Math.max(30, itens.length * 6) + 's';
  }
}

function renderLegenda() {
  const el = $('legenda');
  if (cfg.destaque === 'vencedor') {
    el.innerHTML = '<b>Quem lidera</b>' + cands.filter((c, i) => cands.length <= 4 || i < 6).map(c => `<span><i style="background:${c.cor}"></i>${esc(c.nome)}</span>`).join('') +
      '<small>cor mais forte = vantagem maior</small>';
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
    const porPais = {};
    for (const c of cidades.values()) if (c.iso) (porPais[c.iso] ||= []).push(c);
    const paises = Object.entries(porPais).map(([iso, l]) => ({ iso, d: agregar(l) }))
      .filter(p => p.d.comp > 0).sort((a, b) => b.d.comp - a.d.comp).slice(0, 25);
    const roteiro = [{ tipo: 'mundo' }, ...paises.map(p => ({ tipo: 'pais', id: p.iso }))];
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

function montarFiltrosLocais() {
  $('fContinente').innerHTML = '<option value="">Todos</option>' + Object.entries(CONTINENTES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('continentes').innerHTML = '<button data-k="">🌍 Mundo</button>' + Object.entries(CONTINENTES).map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('');
  $('continentes').querySelectorAll('button').forEach(b => b.onclick = () => selecionar(b.dataset.k ? { tipo: 'continente', id: b.dataset.k } : { tipo: 'mundo' }));
  $('listaCidades').innerHTML = [...cidades.values()].map(c => `<option value="${esc(c.nome)}">${esc(PAISES[c.iso]?.[0] || '')}</option>`).join('');
}

function montarPaises(cont) {
  const isos = Object.keys(PAISES).filter(i => !cont || PAISES[i][1] === cont).sort((a, b) => PAISES[a][0].localeCompare(PAISES[b][0], 'pt-BR'));
  $('fPais').innerHTML = '<option value="">Todos</option>' + isos.map(i => `<option value="${i}">${PAISES[i][0]}</option>`).join('');
}

function sincronizarFiltros() {
  let cont = '', iso = '';
  if (sel.tipo === 'continente') cont = sel.id;
  if (sel.tipo === 'pais') { iso = sel.id; cont = PAISES[iso][1]; }
  if (sel.tipo === 'cidade') { const c = cidades.get(sel.id); iso = c.iso || ''; cont = c.cont || ''; }
  $('fContinente').value = cont;
  montarPaises(cont);
  $('fPais').value = iso;
  if (sel.tipo !== 'cidade') $('fBusca').value = '';
  $('continentes').querySelectorAll('button').forEach(b => b.classList.toggle('ativa', b.dataset.k === cont && sel.tipo !== 'mundo' || (!b.dataset.k && sel.tipo === 'mundo')));
}

function aplicarLayout() {
  document.body.classList.toggle('vertical', cfg.vertical);
  setTimeout(() => { mapa.invalidateSize(); enquadrar(); }, 50);
}

function ligarFiltros() {
  const chk = { fSoComVotos: 'soComVotos', fCidades: 'cidades', fRotulos: 'rotulos', fBrasil: 'brasil', fVertical: 'vertical', fTour: 'tour' };
  const sels = { fTurno: 'turno', fFonte: 'fonte', fDestaque: 'destaque', fOrdem: 'ordem', fTourSeg: 'tourSeg', fIntervalo: 'intervalo' };
  for (const [id, k] of Object.entries(chk)) $(id).checked = cfg[k];
  for (const [id, k] of Object.entries(sels)) if ($(id).querySelector(`option[value="${cfg[k]}"]`)) $(id).value = cfg[k];

  for (const [id, k] of Object.entries(chk)) $(id).onchange = () => {
    cfg[k] = $(id).checked; salvarCfg();
    if (k === 'vertical') aplicarLayout();
    if (k === 'tour') cfg.tour ? iniciarTour() : pararTour(false);
    if (k === 'brasil' && cfg.brasil) carregarBrasil().then(render);
    render();
  };
  for (const [id, k] of Object.entries(sels)) $(id).onchange = () => {
    cfg[k] = $(id).value; salvarCfg();
    if (k === 'turno') trocarTurno();
    else if (k === 'fonte') { render(); atualizar(); }
    else if (k === 'intervalo') programarAtualizacao();
    else if (k === 'tourSeg' && cfg.tour) iniciarTour();
    else render();
  };
  $('fContinente').onchange = () => selecionar($('fContinente').value ? { tipo: 'continente', id: $('fContinente').value } : { tipo: 'mundo' });
  $('fPais').onchange = () => selecionar($('fPais').value ? { tipo: 'pais', id: $('fPais').value } : ($('fContinente').value ? { tipo: 'continente', id: $('fContinente').value } : { tipo: 'mundo' }));
  $('fBusca').onchange = () => {
    const q = $('fBusca').value.trim().toLowerCase();
    const c = [...cidades.values()].find(x => x.nome.toLowerCase() === q) || [...cidades.values()].find(x => x.nome.toLowerCase().includes(q));
    if (q && c) selecionar({ tipo: 'cidade', id: c.cd });
  };
  $('btnFiltros').onclick = () => $('painel').classList.toggle('oculto');
  $('fecharPainel').onclick = () => $('painel').classList.add('oculto');
  $('btnAtualizar').onclick = () => atualizar();
  $('btnCache').onclick = () => {
    Object.keys(localStorage).filter(k => k.startsWith('bu-')).forEach(k => localStorage.removeItem(k));
    trocarTurno();
  };
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') $('painel').classList.toggle('oculto');
    else if (k === 't') { $('fTour').checked = !cfg.tour; $('fTour').onchange(); }
    else if (k === 'v') { $('fVertical').checked = !cfg.vertical; $('fVertical').onchange(); }
    else if (k === 'r') atualizar();
    else if (k === 'escape') sel.tipo === 'mundo' ? null : selecionar({ tipo: 'mundo' });
    else if (k === 'backspace') voltar();
  });
}

function trocarTurno() {
  geracao++;
  T = TURNOS[cfg.turno];
  cands = []; candSet = new Set(); ofExterior = null; brasil = null;
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
montarPaises('');
ligarFiltros();
sincronizarFiltros();
aplicarLayout();
atualizar().then(() => { if (cfg.tour) iniciarTour(); });
