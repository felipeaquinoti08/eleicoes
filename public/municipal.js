'use strict';
// Painel de eleição municipal (prefeitos). Aberto sozinho na página inicial quando a eleição atual do TSE é
// municipal (2028, 2032...). Lê os arquivos publicados por server/municipal.js:
//   prefeitos-<t>.json (resumo nacional) e prefeitos-<t>-<UF>.json (cada município do estado).
const DADOS = window.DADOS_BASE || 'dados/';
const ELEICAO = window.ELEICAO || { ano: '', turnos: { 1: {} } };

const UF_NOMES = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
};
const CORES_PARTIDO = {
  PT: '#e5242f', PL: '#2563eb', 'UNIÃO': '#0ea5e9', PSD: '#16a34a', MDB: '#22c55e', PSDB: '#60a5fa', REPUBLICANOS: '#1e40af',
  PP: '#38bdf8', PSB: '#f59e0b', PDT: '#ef4444', PSOL: '#facc15', NOVO: '#f97316', PODE: '#84cc16', AVANTE: '#06b6d4',
  'PC do B': '#b91c1c', PCdoB: '#b91c1c', PV: '#10b981', SOLIDARIEDADE: '#fb923c', CIDADANIA: '#ec4899', REDE: '#14b8a6',
  PRD: '#6366f1', 'MISSÃO': '#a855f7', DC: '#eab308', PSTU: '#db2777', UP: '#f472b6', PCO: '#7f1d1d', PMB: '#c084fc',
  AGIR: '#4ade80', MOBILIZA: '#a3e635', PRTB: '#15803d',
};
const PALETA = ['#14b8a6', '#8b5cf6', '#f59e0b', '#0ea5e9', '#84cc16', '#ef4444', '#a855f7', '#22d3ee'];
const corExtra = {};
const corPartido = sg => CORES_PARTIDO[sg] || (corExtra[sg] ||= PALETA[Object.keys(corExtra).length % PALETA.length]);

const $ = id => document.getElementById(id);
const fmt = n => (n || 0).toLocaleString('pt-BR');
const pct = (x, c = 1) => (isFinite(x) ? x : 0).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const IBGE_PARA_TSE = Object.fromEntries(Object.entries(MUNICIPIOS).map(([cd, m]) => [m[2], cd]));
const nomeMun = cd => MUNICIPIOS[cd]?.[1] || cd;
const iniciais = n => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('');

// ---------------------------------------------------------------- estado
const params = new URLSearchParams(location.search);
const modo = params.get('modo');
if (modo === 'live') document.body.classList.add('vertical', 'modo-live');
if (modo === 'tv') document.body.classList.add('tv', 'modo-tv');
const turnosDisp = Object.keys(ELEICAO.turnos || { 1: {} }).sort();
let turno = turnosDisp[0];
let turnoEscolhido = false; // turno pedido no endereço ou clicado
let resumo = null;              // prefeitos-<t>.json
const porUF = {};               // `${t}-${UF}` -> prefeitos-<t>-<UF>.json
let ufSel = null, munSel = null;
let ultimoSec = null, ultimaVersaoResumo = '';

// resultado do município com % sobre os votos nominais
function comPct(r) {
  if (!r) return null;
  // o resumo das capitais traz só os 3 primeiros, com o total de válidos à parte
  const validos = r.validos ?? r.cands.reduce((a, c) => a + c.votos, 0);
  return { ...r, validos, cands: r.cands.map(c => ({ ...c, pct: validos ? 100 * c.votos / validos : 0 })) };
}

// ---------------------------------------------------------------- dados
async function obter(nome) {
  const r = await fetch(DADOS + nome, { cache: 'no-cache' });
  return r.ok ? r.json() : null;
}
async function carregarResumo() {
  // turno padrão: o 2º, se já tiver votos; senão o 1º
  if (!resumo && !turnoEscolhido && turnosDisp.includes('2')) {
    const r2 = await obter('prefeitos-2.json').catch(() => null);
    if (r2?.totais?.comVotos) { turno = '2'; resumo = r2; return true; }
  }
  const r = await obter(`prefeitos-${turno}.json`).catch(() => null);
  if (r) resumo = r;
  return !!r;
}
async function carregarUF(uf, forcar = false) {
  const k = `${turno}-${uf}`;
  if (!porUF[k] || forcar) porUF[k] = await obter(`prefeitos-${turno}-${uf}.json`).catch(() => null) || porUF[k] || { municipios: {} };
  return porUF[k];
}

// ---------------------------------------------------------------- mapa
const mapa = L.map('mapaMun', { zoomControl: false, zoomSnap: 0.25, attributionControl: true }).setView([-14, -52], 4);
mapa.attributionControl.setPrefix(false).addAttribution('Mapas: IBGE · Dados: TSE');
let camadaUFs = null, camadaMun = null;
const prontoUFs = carregarGeo('ufs').then(g => {
  camadaUFs = L.geoJSON(g, { onEachFeature: (f, layer) => layer.on('click', () => irPara(f.properties.uf, null)) }).addTo(mapa);
});

// partido com mais prefeituras (eleitos + liderando) num estado
function liderUF(uf) {
  const ps = Object.entries(resumo?.ufs?.[uf]?.partidos || {}).map(([sg, p]) => ({ sg, n: p.eleitos + p.lidera }));
  ps.sort((a, b) => b.n - a.n);
  return ps[0] ? { ...ps[0], total: ps.reduce((a, p) => a + p.n, 0) } : null;
}

let enquadrado = '';
async function renderMapa() {
  await prontoUFs;
  if (camadaMun) { mapa.removeLayer(camadaMun); camadaMun = null; }
  const legenda = {};
  camadaUFs.eachLayer(layer => {
    const uf = layer.feature.properties.uf;
    const l = liderUF(uf);
    const ativo = uf === ufSel;
    const cor = l ? corPartido(l.sg) : '#334155';
    if (l && !ufSel) legenda[l.sg] = cor;
    layer.setStyle({
      weight: ativo ? 3 : 1, color: ativo ? '#facc15' : '#0b1020', fillColor: cor,
      fillOpacity: ufSel ? (ativo ? 0 : 0.12) : l ? 0.35 + 0.5 * Math.min(1, l.n / Math.max(1, l.total) * 2) : 0.2,
    });
    const el = layer.getElement();
    if (el) el.style.pointerEvents = ativo ? 'none' : '';
    const u = resumo?.ufs?.[uf];
    layer.unbindTooltip();
    layer.bindTooltip(uf === 'DF' ? '<b>Distrito Federal</b><br><small>sem eleição municipal</small>'
      : `<b>${esc(UF_NOMES[uf])}</b>${l ? `<br><span style="color:${cor}">●</span> ${esc(l.sg)}: ${fmt(l.n)} prefeituras` : ''}${u ? `<br><small>${fmt(u.comVotos)} de ${fmt(u.municipios)} municípios com votos</small>` : ''}`,
    { sticky: true, className: 'tip' });
  });

  if (ufSel) {
    const [g, dados] = await Promise.all([carregarGeo(`mun-${ufSel}`), carregarUF(ufSel)]);
    camadaMun = L.geoJSON(g, {
      style: f => {
        const cd = IBGE_PARA_TSE[f.properties.ibge];
        const r = comPct(dados.municipios[cd]);
        const v = r?.validos ? (r.cands.find(c => c.eleito) || r.cands[0]) : null;
        if (v) legenda[v.partido] = corPartido(v.partido);
        const margem = r?.cands[1] ? r.cands[0].pct - r.cands[1].pct : 100;
        return { weight: cd === munSel ? 3 : 0.4, color: cd === munSel ? '#facc15' : '#0b1020', fillColor: v ? corPartido(v.partido) : '#334155', fillOpacity: v ? 0.35 + 0.55 * Math.min(1, margem / 40) : 0.25 };
      },
      onEachFeature: (f, layer) => {
        const cd = IBGE_PARA_TSE[f.properties.ibge];
        const r = comPct(dados.municipios[cd]);
        layer.on('click', () => irPara(ufSel, cd));
        layer.on('mouseover', () => layer.setStyle({ weight: 2, color: '#fff' }));
        layer.on('mouseout', () => camadaMun.resetStyle(layer));
        let h = `<b>${esc(nomeMun(cd))}</b>`;
        if (r?.validos) h += r.cands.slice(0, 3).map(c => `<br><span style="color:${corPartido(c.partido)}">●</span> ${esc(c.nome)} <small>${esc(c.partido)}</small> <b>${pct(c.pct)}</b>${c.eleito ? ' ✓' : ''}`).join('') + `<br><small>${pct(r.secTot ? 100 * r.secRec / r.secTot : 0)} das seções</small>`;
        else h += turno === '2' ? '<br><small>sem 2º turno</small>' : '<br><small>sem votos ainda</small>';
        layer.bindTooltip(h, { sticky: true, className: 'tip' });
      },
    }).addTo(mapa);
  }
  $('legendaMun').innerHTML = Object.entries(legenda).sort().slice(0, 18).map(([sg, c]) => `<div><i style="background:${c}"></i>${esc(sg)}</div>`).join('') || '<small>aguardando votos</small>';

  const alvo = munSel ? `m${munSel}` : ufSel ? `u${ufSel}` : 'br';
  if (alvo === enquadrado) return;
  enquadrado = alvo;
  if (munSel && camadaMun) camadaMun.eachLayer(l => { if (IBGE_PARA_TSE[l.feature.properties.ibge] === munSel) { l.bringToFront(); mapa.flyToBounds(l.getBounds(), { padding: [80, 80], maxZoom: 9, duration: 1 }); } });
  else if (ufSel) camadaUFs.eachLayer(l => { if (l.feature.properties.uf === ufSel) mapa.flyToBounds(l.getBounds(), { padding: [30, 30], maxZoom: 8, duration: 1 }); });
  else mapa.flyTo([-14, -52], 4, { duration: 1 });
}

// ---------------------------------------------------------------- cabeçalho e coluna da esquerda
function renderTopo() {
  const t = resumo?.totais || {};
  const vivo = !!resumo?.situacao?.aoVivo;
  const selo = $('seloAoVivo');
  selo.classList.toggle('resultado', !vivo);
  selo.innerHTML = vivo ? '<i></i>AO VIVO' : resumo?.situacao?.finalizada ? 'RESULTADO FINAL' : 'RESULTADO';
  document.title = `${vivo ? 'Ao vivo' : 'Resultados'} · Prefeitos ${ELEICAO.ano} · Apuração de Eleições`;
  $('subtitulo').textContent = `Prefeitos · ${turno}º turno · Eleições Municipais ${ELEICAO.ano}`;
  const p = t.secTot ? 100 * t.secRec / t.secTot : 0;
  $('pctSecoes').textContent = pct(p, 2);
  $('barraSecoes').style.width = `${p}%`;
  $('ultimaAtual').textContent = resumo ? `${fmt(t.secRec)} de ${fmt(t.secTot)} seções · atualizado ${new Date(resumo.gerado).toLocaleTimeString('pt-BR')}` : 'aguardando a coleta…';
  $('turnosMun').innerHTML = turnosDisp.length > 1
    ? turnosDisp.map(x => `<button data-t="${x}" class="${x === turno ? 'ativa' : ''}">${x}º turno</button>`).join('') : '';
  $('turnosMun').querySelectorAll('button').forEach(b => (b.onclick = () => trocarTurno(b.dataset.t)));
}

function renderPartidos() {
  const t = resumo?.totais || {};
  $('numerosMun').innerHTML = [
    ['Municípios com votos', `${fmt(t.comVotos)} <small>de ${fmt(t.municipios)}</small>`],
    ['Totalmente apurados', fmt(t.apurados)],
    [turno === '1' ? 'Prefeitos eleitos' : 'Eleitos no 2º turno', fmt(t.definidos)],
    [turno === '1' ? 'Vão ao 2º turno' : 'Comparecimento', turno === '1' ? fmt(t.segundoTurno) : pct(t.aptos ? 100 * t.comp / t.aptos : 0)],
  ].map(([k, v]) => `<div class="n"><span>${k}</span><b>${v}</b></div>`).join('');
  const lista = resumo?.partidosGeral?.length ? resumo.partidosGeral : resumo?.partidos || [];
  $('partidosSub').textContent = resumo?.partidosGeral?.length ? 'eleitos + liderando · eleição toda' : 'eleitos + liderando';
  const max = Math.max(1, ...lista.map(p => p.eleitos + p.lidera));
  $('listaPartidos').innerHTML = lista.slice(0, 30).map(p => {
    const cor = corPartido(p.sg);
    return `<li title="${esc(p.sg)}: ${fmt(p.eleitos)} eleitos, ${fmt(p.lidera)} liderando"><span class="sg" style="color:${cor}">${esc(p.sg)}</span>
      <span class="trilho"><i style="width:${100 * p.eleitos / max}%;background:${cor}"></i><i style="width:${100 * p.lidera / max}%;background:${cor};opacity:.4"></i></span>
      <span class="num"><b>${fmt(p.eleitos + p.lidera)}</b><small>${p.lidera ? `${fmt(p.eleitos)} eleitos` : 'eleitos'}</small></span></li>`;
  }).join('') || '<li class="vazio-mun">Aguardando os primeiros votos.</li>';
}

// ---------------------------------------------------------------- coluna da direita
function linhaMun(cd, r, uf) {
  const rp = comPct(r);
  const v = rp?.validos ? (rp.cands.find(c => c.eleito) || rp.cands[0]) : null;
  const cor = v ? corPartido(v.partido) : 'var(--suave)';
  const ap = r?.secTot ? 100 * r.secRec / r.secTot : 0;
  return `<li data-uf="${uf}" data-cd="${cd}"><span class="nm">${esc(nomeMun(cd))}${MUNICIPIOS[cd]?.[3] ? ' <small>capital</small>' : ''}${uf !== ufSel ? ` <small>${uf}</small>` : ''}</span>
    <span class="pc" style="color:${cor}">${v ? pct(v.pct) : '–'}</span>
    <span class="ld" style="color:${cor}">${v ? `${esc(v.nome)} · ${esc(v.partido)}${v.eleito ? ' ✓' : v.turno2 ? ' · 2º turno' : ''}` : 'sem votos ainda'}</span>
    <span class="ap">${pct(ap, 0)} apurado</span></li>`;
}
function ligarLista(el) { el.querySelectorAll('li[data-cd]').forEach(li => (li.onclick = () => irPara(li.dataset.uf, li.dataset.cd))); }

function cardMunicipio(uf, cd, r) {
  const rp = comPct(r);
  if (!rp) return `<p class="vazio-mun">${turno === '2' ? 'Este município não tem 2º turno.' : 'Sem dados deste município ainda.'}</p>`;
  const max = Math.max(1, ...rp.cands.map(c => c.pct));
  const ap = rp.secTot ? 100 * rp.secRec / rp.secTot : 0;
  return `<div class="mun-cab"><h2>${esc(nomeMun(cd))} <small>${uf}</small></h2>
      <div class="info">Prefeito · ${turno}º turno · ${pct(ap)} das seções (${fmt(rp.secRec)}/${fmt(rp.secTot)})</div></div>` +
    rp.cands.map(c => {
      const cor = corPartido(c.partido);
      const foto = `<img class="foto" src="${DADOS}fotos/${esc(c.sq)}.jpeg" alt="" onerror="this.outerHTML='<div class=&quot;foto&quot;>${esc(iniciais(c.nome))}</div>'">`;
      return `<div class="cand-mun" style="--cor:${cor}">${foto}
        <div><div class="nome">${esc(c.nome)} <small>${esc(c.n)} · ${esc(c.partido)}</small>${c.eleito ? '<span class="selo-mun eleito">ELEITO</span>' : c.turno2 ? '<span class="selo-mun t2">2º TURNO</span>' : ''}</div>
          <div class="trilho"><i style="width:${100 * c.pct / max}%"></i></div></div>
        <div class="pc">${pct(c.pct, 2)}<small>${fmt(c.votos)} votos</small></div></div>`;
    }).join('') +
    `<div class="estat-mun"><div>Votantes<b>${fmt(rp.comp)}</b></div><div>Comparecimento<b>${pct(rp.aptos ? 100 * rp.comp / rp.aptos : 0)}</b></div><div>Válidos<b>${fmt(rp.validos)}</b></div>
      <div>Brancos<b>${fmt(rp.brancos)}</b></div><div>Nulos<b>${fmt(rp.nulos)}</b></div><div>Eleitores<b>${fmt(rp.aptos)}</b></div></div>`;
}

async function renderLado() {
  const el = $('ladoMun');
  if (munSel) {
    const dados = await carregarUF(ufSel);
    el.innerHTML = `<button class="voltar-mun" id="voltarUF">← ${esc(UF_NOMES[ufSel])}</button>` + cardMunicipio(ufSel, munSel, dados.municipios[munSel]);
    $('voltarUF').onclick = () => irPara(ufSel, null);
    return;
  }
  if (ufSel) {
    const dados = await carregarUF(ufSel);
    const u = resumo?.ufs?.[ufSel] || {};
    const ps = Object.entries(u.partidos || {}).map(([sg, p]) => ({ sg, n: p.eleitos + p.lidera })).sort((a, b) => b.n - a.n).slice(0, 5);
    const itens = Object.entries(dados.municipios).sort((a, b) => (b[1].aptos || 0) - (a[1].aptos || 0));
    el.innerHTML = `<h2>${esc(UF_NOMES[ufSel])} <small>${fmt(u.comVotos)} de ${fmt(u.municipios)} municípios com votos</small></h2>
      <div class="info" style="margin-bottom:8px">${ps.map(p => `<b style="color:${corPartido(p.sg)}">${esc(p.sg)}</b> ${fmt(p.n)}`).join(' · ')}</div>
      <input class="filtro-lista" id="filtroUF" placeholder="Filtrar municípios de ${esc(UF_NOMES[ufSel])}…">
      <ol class="lista-mun" id="listaUF">${itens.map(([cd, r]) => linhaMun(cd, r, ufSel)).join('') || `<li class="vazio-mun">${turno === '2' ? 'Nenhum município com 2º turno neste estado.' : 'Aguardando votos.'}</li>`}</ol>`;
    ligarLista(el);
    $('filtroUF').oninput = e => {
      const q = e.target.value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      el.querySelectorAll('#listaUF li[data-cd]').forEach(li => { li.style.display = nomeMun(li.dataset.cd).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(q) ? '' : 'none'; });
    };
    return;
  }
  // Brasil: capitais e, no 1º turno, os municípios que vão ao 2º turno
  const caps = resumo?.capitais || [];
  let h = `<h2>Capitais <small>${caps.length} com eleição</small></h2><ol class="lista-mun">${caps.map(c => linhaMun(c.cd, { ...c, cands: c.cands }, c.uf)).join('') || '<li class="vazio-mun">Aguardando votos.</li>'}</ol>`;
  if (turno === '1' && resumo?.segundoTurno?.length) {
    h += `<h2 style="margin-top:14px">2º turno <small>${fmt(resumo.segundoTurno.length)} municípios</small></h2><ol class="lista-mun">` +
      resumo.segundoTurno.slice(0, 60).map(m => `<li data-uf="${m.uf}" data-cd="${m.cd}"><span class="nm">${esc(m.nome)} <small>${m.uf}</small></span><span class="pc"></span>
        <span class="ld">${m.cands.map(c => `<b style="color:${corPartido(c.partido)}">${esc(c.nome)}</b> <small>${esc(c.partido)}</small>`).join(' × ')}</span><span class="ap"></span></li>`).join('') + '</ol>';
  }
  h += '<p class="vazio-mun" style="padding:10px 0">Clique num estado no mapa para ver os prefeitos de cada município.</p>';
  el.innerHTML = h;
  ligarLista(el);
}

function renderTrilha() {
  const partes = [['Brasil', () => irPara(null, null), !ufSel]];
  if (ufSel) partes.push([UF_NOMES[ufSel], () => irPara(ufSel, null), !munSel]);
  if (munSel) partes.push([nomeMun(munSel), null, true]);
  $('trilhaMun').innerHTML = partes.map(([n], i) => `${i ? '<span class="sep">›</span>' : ''}<button data-i="${i}" class="${partes[i][2] ? 'atual' : ''}">${esc(n)}</button>`).join('');
  $('trilhaMun').querySelectorAll('button').forEach(b => { const f = partes[+b.dataset.i][1]; if (f) b.onclick = f; });
}

function renderTicker() {
  const caps = resumo?.capitais || [];
  $('tickerTrilho').innerHTML = caps.map(c => {
    const rp = comPct(c);
    const [a, b] = rp.cands;
    if (!a?.votos) return `<span class="ticker-mun"><b>${c.uf}</b> ${esc(c.nome)}: aguardando votos</span>`;
    return `<span class="ticker-mun"><b>${c.uf}</b> ${esc(c.nome).toUpperCase()} <b style="color:${corPartido(a.partido)}">${esc(a.nome)} ${pct(a.pct)}</b>${b ? ` × <b style="color:${corPartido(b.partido)}">${esc(b.nome)} ${pct(b.pct)}</b>` : ''} <small>${pct(c.secTot ? 100 * c.secRec / c.secTot : 0, 0)} apurado</small></span>`;
  }).join('');
}

function render() { renderTopo(); renderPartidos(); renderTrilha(); renderLado(); renderMapa(); }

// ---------------------------------------------------------------- navegação
async function irPara(uf, cd, { manual = true } = {}) {
  if (uf === 'DF') return;
  if (manual) pararTour();
  ufSel = uf; munSel = cd;
  history.replaceState(null, '', `#${turno}${uf ? `/${uf}` : ''}${cd ? `/${cd}` : ''}`);
  if (uf) await carregarUF(uf);
  renderTrilha(); renderLado(); renderMapa();
}
async function trocarTurno(t) {
  turno = t; turnoEscolhido = true; enquadrado = '';
  await carregarResumo();
  if (munSel && !(await carregarUF(ufSel)).municipios[munSel]) munSel = null;
  render();
}

// busca de município (todos os do Brasil)
$('listaMunicipios').innerHTML = Object.entries(MUNICIPIOS).filter(([, m]) => m[0] !== 'DF' && m[0] !== 'ZZ')
  .map(([cd, m]) => `<option value="${esc(m[1])} - ${m[0]}" data-cd="${cd}">`).join('');
const indiceBusca = new Map(Object.entries(MUNICIPIOS).map(([cd, m]) => [`${m[1]} - ${m[0]}`.toUpperCase(), cd]));
$('buscaMun').onchange = e => {
  const cd = indiceBusca.get(e.target.value.trim().toUpperCase());
  if (cd) { irPara(MUNICIPIOS[cd][0], cd); e.target.value = ''; e.target.blur(); }
};

// ---------------------------------------------------------------- tour (modos TV e live): passa pelas capitais
let tour = null, tourI = 0;
function iniciarTour() {
  tour = setInterval(() => {
    const caps = (resumo?.capitais || []).filter(c => c.cands?.[0]?.votos);
    if (!caps.length) return;
    if (tourI % (caps.length + 1) === caps.length) irPara(null, null, { manual: false });
    else { const c = caps[tourI % (caps.length + 1)]; irPara(c.uf, c.cd, { manual: false }); }
    tourI++;
  }, 12000);
}
function pararTour() { if (tour) { clearInterval(tour); tour = null; } }

// ---------------------------------------------------------------- atualização, som, presença e versão
function avisar(texto) {
  $('ndLista').innerHTML = `<div class="nd-mais">${texto}</div>`;
  const el = $('novosDados');
  el.classList.remove('mostrar'); void el.offsetWidth; el.classList.add('mostrar');
}
async function atualizar() {
  const ok = await carregarResumo();
  if (!ok) { $('ultimaAtual').textContent = 'Aguardando a coleta do TSE…'; return; }
  const versao = resumo.gerado;
  if (versao === ultimaVersaoResumo) return;
  ultimaVersaoResumo = versao;
  const sec = resumo.totais.secRec;
  if (ultimoSec !== null && sec > ultimoSec) {
    const muns = resumo.totais.comVotos;
    if (Som.tocar()) $('btnSom').classList.remove('piscar');
    avisar(`+${fmt(sec - ultimoSec)} seções apuradas · ${fmt(muns)} municípios com votos`);
  }
  ultimoSec = sec;
  if (ufSel) await carregarUF(ufSel, true);
  render();
  renderTicker();
}

let somLigado = localStorage.getItem('mun-som') !== '0';
Som.definir(somLigado);
$('btnSom').textContent = somLigado ? '🔊' : '🔇';
$('btnSom').onclick = () => { somLigado = !somLigado; Som.definir(somLigado); localStorage.setItem('mun-som', somLigado ? '1' : '0'); $('btnSom').textContent = somLigado ? '🔊' : '🔇'; };

function iniciarPresenca() {
  let id = localStorage.getItem('id-visitante');
  if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now()).replace(/[^a-z0-9]/g, '').slice(0, 24);
    localStorage.setItem('id-visitante', id);
  }
  const sinal = async () => {
    try {
      const { online } = await (await fetch(`presenca?c=${id}`, { cache: 'no-store' })).json();
      $('online').classList.remove('oculto');
      $('online').textContent = `👥 ${fmt(online)} online`;
    } catch { /* sem contador */ }
  };
  setTimeout(sinal, 1500);
  setInterval(sinal, 30000);
}
// depois de um deploy ou quando começa uma eleição nova, a página recarrega sozinha (mantendo o lugar pelo endereço)
function vigiarVersao() {
  const minha = window.VERSAO_APP;
  if (!minha) return;
  setInterval(async () => {
    try {
      const { versao } = await (await fetch('versao', { cache: 'no-store' })).json();
      if (versao && versao !== minha) { avisar('Nova versão do painel. Atualizando…'); setTimeout(() => location.reload(), 2500); }
    } catch { /* tenta de novo */ }
  }, 5 * 60 * 1000);
}

(async () => {
  // endereço: #<turno>/<UF>/<município>
  const [t, uf, cd] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (turnosDisp.includes(t)) { turno = t; turnoEscolhido = true; }
  await atualizar();
  if (!resumo) render();
  if (uf && UF_NOMES[uf]) await irPara(uf, cd && MUNICIPIOS[cd] ? cd : null, { manual: false });
  if (modo === 'tv' || modo === 'live') iniciarTour();
  setInterval(atualizar, 30000);
  iniciarPresenca();
  vigiarVersao();
})();
