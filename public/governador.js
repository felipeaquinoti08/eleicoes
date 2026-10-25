'use strict';
// Modo Governador (2º turno): cada estado com 2º turno tem os próprios candidatos, então este modo tem
// placar, mapa, ranking e letreiro próprios. Os dados vêm de dados/gov-2.json (server/governador.js).
// Usa as funções e o estado globais de app.js (carregado depois deste arquivo).

const CORES_PARTIDO_GOV = {
  PT: '#e5242f', PL: '#2563eb', 'UNIÃO': '#0ea5e9', PSD: '#16a34a', MDB: '#22c55e', PSDB: '#60a5fa', REPUBLICANOS: '#1e40af',
  PP: '#38bdf8', PSB: '#f59e0b', PDT: '#ef4444', PSOL: '#facc15', NOVO: '#f97316', PODE: '#84cc16', AVANTE: '#06b6d4',
  'PC do B': '#b91c1c', PV: '#10b981', SOLIDARIEDADE: '#fb923c', CIDADANIA: '#ec4899', REDE: '#14b8a6', PRD: '#6366f1',
};
const PALETA_GOV = ['#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#0ea5e9'];

let gov = null; // { ufs: { UF: { candidatos, total, municipios } } }

const govAtivo = () => cfg.cargo === 'governador' && cfg.turno === '2' && !!gov && Object.keys(gov.ufs || {}).length > 0;
const govUFs = () => Object.keys(gov?.ufs || {}).sort((a, b) => UF_NOMES[a].localeCompare(UF_NOMES[b], 'pt-BR'));
const govTemUF = uf => !!gov?.ufs?.[uf];

// candidatos da UF com cor pelo partido (e cores diferentes se os dois partidos caírem na mesma cor)
const coresGovCache = {};
function govCands(uf) {
  if (coresGovCache[uf]) return coresGovCache[uf];
  const lista = (gov.ufs[uf]?.candidatos || []).map((c, i) => ({ ...c, cor: CORES_PARTIDO_GOV[c.partido] || PALETA_GOV[i % PALETA_GOV.length] }));
  if (lista.length === 2 && lista[0].cor === lista[1].cor) lista[1].cor = '#f59e0b';
  return (coresGovCache[uf] = lista);
}

function govDadosUF(uf) { return gov.ufs[uf]?.total || null; }
function govDadosMun(cd) { const uf = MUNICIPIOS[cd]?.[0]; return gov.ufs[uf]?.municipios?.[cd] || null; }

function govResumo(d, cl) {
  const votos = d?.votos || {};
  const validos = cl.reduce((a, c) => a + (votos[c.n] || 0), 0);
  const lista = cl.map(c => ({ ...c, votos: votos[c.n] || 0, pct: validos ? 100 * (votos[c.n] || 0) / validos : 0 }))
    .sort((a, b) => b.votos - a.votos || a.n - b.n);
  const lider = validos ? lista[0] : null;
  const margem = validos && lista[1] ? lista[0].pct - lista[1].pct : 0;
  return { validos, lista, lider, margem, pctSec: d?.secTot ? 100 * d.secRec / d.secTot : 0 };
}

function govSomaTodos() {
  const acc = { secTot: 0, secRec: 0, comp: 0, aptos: 0, brancos: 0, nulos: 0 };
  for (const uf of govUFs()) { const d = govDadosUF(uf); if (d) for (const k in acc) acc[k] += d[k] || 0; }
  return acc;
}

const govUFSel = () => sel.tipo === 'uf' ? sel.id : sel.tipo === 'municipio' ? MUNICIPIOS[sel.id][0] : null;

function govNormalizarSel() {
  const uf = govUFSel();
  if (!(sel.tipo === 'govs' || (uf && govTemUF(uf)))) sel = { tipo: 'govs' };
}

// ---------------------------------------------------------------- render
function renderGov() {
  govNormalizarSel();
  const uf = govUFSel();
  const cl = uf ? govCands(uf) : [];
  const d = sel.tipo === 'municipio' ? govDadosMun(sel.id) : uf ? govDadosUF(uf) : govSomaTodos();
  const r = uf ? govResumo(d, cl) : { pctSec: d.secTot ? 100 * d.secRec / d.secTot : 0 };
  const nome = sel.tipo === 'municipio' ? `${MUNICIPIOS[sel.id][1]} (${uf})` : uf ? UF_NOMES[uf] : 'Estados com 2º turno';

  $('subtitulo').innerHTML = `Governador · 2º turno · ${uf ? seloUF(uf) : ''}${esc(nome)}`;
  const pctSec = r.pctSec || 0;
  $('pctSecoes').textContent = pct(pctSec, 2);
  $('barraSecoes').style.width = pctSec + '%';
  const hora = ultimaAtualizacao ? ultimaAtualizacao.toLocaleTimeString('pt-BR') : '–';
  $('ultimaAtual').textContent = `${fmt(d?.secRec)} de ${fmt(d?.secTot)} seções${uf ? '' : ' nos ' + govUFs().length + ' estados'} · atualizado ${hora}`;

  // trilha
  // sem seletor de cargo: a trilha começa com o caminho de volta para o Presidente (no mesmo estado, se houver)
  const voltar = { acao: () => (uf ? abrirPresidente(uf) : trocarCargo('presidente')), nome: '← Presidente' };
  const partes = [voltar, { s: { tipo: 'govs' }, nome: 'Governadores' }];
  if (uf) partes.push({ s: { tipo: 'uf', id: uf }, nome: seloUF(uf) + esc(UF_NOMES[uf]) });
  if (sel.tipo === 'municipio') partes.push({ s: sel, nome: esc(MUNICIPIOS[sel.id][1]) });
  $('trilha').innerHTML = partes.map((p, i) => `<button data-i="${i}" class="${i === partes.length - 1 ? 'atual' : ''}">${p.nome}</button>`).join('<span>›</span>');
  $('trilha').querySelectorAll('button').forEach(b => b.onclick = () => { const p = partes[+b.dataset.i]; p.acao ? p.acao() : selecionar(p.s); });

  // chips: todos + cada estado
  const chips = [[{ tipo: 'govs' }, 'Todos os estados'], ...govUFs().map(u => [{ tipo: 'uf', id: u }, UF_NOMES[u]])];
  $('continentes').dataset.h = '';
  $('continentes').innerHTML = chips.map(([s, n], i) => `<button data-i="${i}" class="${(s.tipo === 'govs' && !uf) || s.id === uf ? 'ativa' : ''}">${esc(n)}</button>`).join('');
  $('continentes').querySelectorAll('button').forEach(b => b.onclick = () => selecionar(chips[+b.dataset.i][0]));

  renderPlacarGov(uf, d, r);
  renderEstatisticasGov(d, r);
  renderMapaGov();
  renderRankingGov(uf);
  $('cargosUF').innerHTML = htmlOutrosCargos();
  renderTickerGov();
  renderLegendaGov(uf);
  $('selo').innerHTML = `<div>${uf ? seloUF(uf) : ''}${esc(nome)}</div><small>${d?.comp ? fmt(d.comp) + ' votantes · ' + pct(pctSec) + ' das seções' : 'sem votos apurados'}</small>`;
  renderCargos();
}

function dueloHTML(r) {
  const [a, b] = r.lista;
  if (!a || !b) return '<p class="vazio-hist">Sem candidatos.</p>';
  const lado = (c, cls) => `
    <div class="duelo-cand ${cls} ${r.lider && r.lider.n === c.n ? 'lider' : ''}" style="--cor:${c.cor}">
      ${imgFoto(c)}
      <div class="info"><div class="nome">${esc(c.nome)}</div><div class="partido">${esc(c.n)} · ${esc(c.partido)}</div>
        <div class="pct">${pct(c.pct, 2)}</div><div class="votos">${fmt(c.votos)} votos</div></div>
    </div>`;
  // à esquerda sempre quem está na frente (r.lista já vem ordenada por votos)
  const [e, dir] = [a, b];
  const tot = e.votos + dir.votos, pe = tot ? 100 * e.votos / tot : 50;
  return `<div class="duelo-lados">${lado(e, 'esq')}<div class="vs">×</div>${lado(dir, 'dir')}</div>
    <div class="duelo-barra"><div style="width:${pe}%;background:${e.cor}"></div><div style="width:${100 - pe}%;background:${dir.cor}"></div><i></i></div>`;
}

function renderPlacarGov(uf, d, r) {
  const el = $('placar');
  if (uf) { el.className = 'duelo'; el.innerHTML = dueloHTML(r); return; }
  // visão geral: um mini placar por estado
  el.className = 'gov-grade';
  el.innerHTML = govUFs().map(u => {
    const ru = govResumo(govDadosUF(u), govCands(u));
    const [a, b] = ru.lista;
    return `<button class="gov-mini" data-uf="${u}">
      <div class="gm-topo">${seloUF(u)}<b>${esc(UF_NOMES[u])}</b><small>${pct(ru.pctSec, 0)} apurado</small></div>
      ${[a, b].filter(Boolean).map(c => `<div class="gm-linha" style="--cor:${c.cor}"><span>${esc(c.nome)} <small>${esc(c.partido)}</small></span><b>${pct(c.pct)}</b></div>
        <div class="gm-trilho"><div style="width:${c.pct}%;background:${c.cor}"></div></div>`).join('')}
    </button>`;
  }).join('');
  el.querySelectorAll('.gov-mini').forEach(b => b.onclick = () => selecionar({ tipo: 'uf', id: b.dataset.uf }));
}

function renderEstatisticasGov(d, r) {
  const itens = [
    ['Seções apuradas', `${fmt(d?.secRec)}/${fmt(d?.secTot)} <small>${pct(r.pctSec)}</small>`],
    ['Votantes', fmt(d?.comp) + (d?.aptos ? ` <small>${pct(100 * d.comp / d.aptos)} dos aptos</small>` : '')],
  ];
  if (r.validos != null) itens.push(['Válidos', fmt(r.validos)]);
  itens.push(['Brancos', fmt(d?.brancos)], ['Nulos', fmt(d?.nulos)]);
  $('estatisticas').innerHTML = itens.map(([k, v]) => `<div class="est"><span>${k}</span><b>${v}</b></div>`).join('');
}

function corGov(r) {
  if (!r.validos) return null;
  return { cor: r.lider.cor, op: 0.3 + 0.6 * Math.min(1, r.margem / 40) };
}

function estilizarUFGov(layer) {
  const uf = layer.feature.properties.uf;
  const foco = govUFSel();
  if (!govTemUF(uf)) {
    layer.setStyle({ weight: 0.6, color: '#0b1020', fillColor: '#1f2937', fillOpacity: 0.15 });
  } else {
    const c = corGov(govResumo(govDadosUF(uf), govCands(uf)));
    layer.setStyle({
      weight: foco === uf ? 3 : 1.5, color: foco === uf ? '#facc15' : '#e2e8f0',
      fillColor: c ? c.cor : '#334155', fillOpacity: foco === uf ? 0 : (c ? c.op : 0.35),
    });
  }
  const el = layer.getElement();
  if (el) el.style.pointerEvents = foco === uf || !govTemUF(uf) ? 'none' : '';
}

function estilizarMunGov(layer) {
  const cd = IBGE_PARA_TSE[layer.feature.properties.ibge];
  const uf = MUNICIPIOS[cd]?.[0];
  const r = govResumo(cd ? govDadosMun(cd) : null, govCands(uf));
  const c = corGov(r);
  const atual = sel.tipo === 'municipio' && sel.id === cd;
  layer.setStyle({ weight: atual ? 3 : 0.4, color: atual ? '#facc15' : '#0b1020', fillColor: c ? c.cor : '#334155', fillOpacity: c ? c.op : 0.3 });
  if (atual) layer.bringToFront();
}

function tipGov(titulo, d, r) {
  let h = `<div class="tip-titulo">${titulo}</div>`;
  if (!r.validos) return h + '<div class="tip-sem">Ainda sem apuração</div>';
  for (const c of r.lista) h += `<div class="tip-linha"><i style="background:${c.cor}"></i>${esc(c.nome)} <b>${pct(c.pct)}</b> <small>${fmt(c.votos)}</small></div>`;
  return h + `<div class="tip-sem">${fmt(d.comp)} votantes · ${fmt(d.secRec)}/${fmt(d.secTot)} seções (${pct(r.pctSec)})</div>`;
}

function renderMapaGov() {
  // exterior não participa: esconde países e cidades
  camadaPaises.eachLayer(l => { l.setStyle({ fillOpacity: 0, weight: 0.4, color: '#2a3550' }); l.unbindTooltip(); });
  camadaCidades.clearLayers();
  if (camadaUFs) camadaUFs.eachLayer(l => {
    estilizarUFGov(l);
    const uf = l.feature.properties.uf;
    l.unbindTooltip();
    if (!govTemUF(uf)) return;
    const d = govDadosUF(uf), r = govResumo(d, govCands(uf));
    if (cfg.rotulos && sel.tipo === 'govs') {
      l.bindTooltip(r.validos ? `<b>${uf}</b> <span style="color:${r.lider.cor}">${esc(r.lider.nome)} ${pct(r.lider.pct, 0)}</span>` : `<b>${uf}</b>`,
        { permanent: true, direction: 'center', className: 'rotulo rotulo-uf' });
    } else l.bindTooltip(tipGov(seloUF(uf) + esc(UF_NOMES[uf]), d, r), { sticky: true, className: 'tip' });
  });
  if (camadaMun) camadaMun.eachLayer(l => {
    estilizarMunGov(l);
    const cd = IBGE_PARA_TSE[l.feature.properties.ibge];
    if (!cd) return;
    const d = govDadosMun(cd), r = govResumo(d, govCands(MUNICIPIOS[cd][0]));
    l.unbindTooltip();
    l.bindTooltip(tipGov(`${esc(MUNICIPIOS[cd][1])}${MUNICIPIOS[cd][3] ? ' <small>capital</small>' : ''}`, d || {}, r), { sticky: true, className: 'tip' });
  });
}

function renderRankingGov(uf) {
  $('abas').innerHTML = `<button class="ativa">${uf ? 'Municípios' : 'Estados'}</button>`;
  $('rankingTitulo').textContent = uf ? `Em ${UF_NOMES[uf]}` : 'Governadores · 2º turno';
  let itens;
  if (uf) {
    itens = Object.entries(MUNICIPIOS).filter(([, m]) => m[0] === uf).map(([cd, m]) => {
      const d = govDadosMun(cd);
      return { s: { tipo: 'municipio', id: cd }, nome: esc(m[1]) + (m[3] ? ' <small>capital</small>' : ''), icone: '', d: d || {}, r: govResumo(d, govCands(uf)), chave: cd };
    });
  } else {
    itens = govUFs().map(u => { const d = govDadosUF(u); return { s: { tipo: 'uf', id: u }, nome: esc(UF_NOMES[u]), icone: seloUF(u), d: d || {}, r: govResumo(d, govCands(u)), chave: u }; });
  }
  if (cfg.soComVotos) itens = itens.filter(i => i.r.validos > 0);
  itens.sort((a, b) => cfg.ordem === 'nome' ? a.nome.localeCompare(b.nome, 'pt-BR') : cfg.ordem === 'margem' ? b.r.margem - a.r.margem : (b.d.comp || 0) - (a.d.comp || 0));
  const ol = $('rankingLista');
  if (!itens.length) { ol.innerHTML = '<li class="vazio">Nenhum voto apurado ainda nesta seleção.</li>'; return; }
  const atual = sel.tipo === 'municipio' ? sel.id : null;
  ol.innerHTML = itens.map((i, idx) => {
    const barras = i.r.validos ? i.r.lista.map(c => `<div style="width:${c.pct}%;background:${c.cor}"></div>`).join('') : '';
    const lider = i.r.lider ? `<span class="rk-lider" style="color:${i.r.lider.cor}">${esc(i.r.lider.nome)} ${pct(i.r.lider.pct)}</span>` : '<span class="rk-lider sem">aguardando</span>';
    const tops = i.r.validos ? i.r.lista.map(c => `<span style="color:${c.cor}">${fmt(c.votos)}</span>`).join(' · ') : '';
    return `<li data-idx="${idx}" class="clicavel ${i.chave === atual ? 'atual' : ''}"><div class="rk-pos">${idx + 1}</div><div class="rk-corpo">
      <div class="rk-linha1">${i.icone}<span class="rk-nome">${i.nome}</span>${lider}</div><div class="rk-barra">${barras}</div>
      <div class="rk-linha2"><span>${tops}</span><span>${fmt(i.d.comp)} votantes · ${pct(i.r.pctSec, 0)} seç.</span></div></div></li>`;
  }).join('');
  ol.querySelectorAll('li.clicavel').forEach(li => li.onclick = () => selecionar(itens[+li.dataset.idx].s));
}

function renderTickerGov() {
  const html = govUFs().map(u => {
    const r = govResumo(govDadosUF(u), govCands(u));
    if (!r.validos) return '';
    return `<span class="tk">${seloUF(u)}<b>GOVERNADOR ${esc(UF_NOMES[u].toUpperCase())}</b> ${r.lista.map(c => `<em style="color:${c.cor}">${esc(c.nome)} ${pct(c.pct)}</em>`).join(' × ')} <small>${pct(r.pctSec, 0)} apurado</small></span>`;
  }).join('');
  const trilho = $('tickerTrilho');
  const novo = html ? html + html : '<span class="tk">Aguardando os primeiros resultados para governador…</span>';
  if (trilho.dataset.h !== novo) { trilho.dataset.h = novo; trilho.innerHTML = novo; trilho.style.animationDuration = Math.max(30, govUFs().length * 8) + 's'; }
}

function renderLegendaGov(uf) {
  const cl = uf ? govCands(uf) : govUFs().flatMap(u => govCands(u));
  const vistos = new Set();
  const itens = cl.filter(c => !vistos.has(c.cor + c.partido) && vistos.add(c.cor + c.partido))
    .map(c => `<span><i style="background:${c.cor}"></i>${uf ? esc(c.nome) : esc(c.partido)}</span>`).join('');
  $('legenda').innerHTML = `<b>${uf ? 'Quem lidera' : 'Partido de quem lidera'}</b>${itens}<small>cor mais forte = vantagem maior</small>`;
}

// ---------------------------------------------------------------- seletor de cargo
function renderCargos() {
  const el = $('cargos');
  if (!el) return;
  // seletor Presidente | Governador desativado: os outros cargos aparecem na coluna da direita ao escolher um estado
  el.classList.add('oculto');
  return;
  const disponivel = cfg.turno === '2' && gov && Object.keys(gov.ufs || {}).length;
  el.classList.toggle('oculto', !disponivel);
  if (!disponivel) return;
  const atual = govAtivo() ? 'governador' : 'presidente';
  const html = ['presidente', 'governador'].map(c => `<button data-c="${c}" class="${c === atual ? 'ativa' : ''}">${c === 'presidente' ? 'Presidente' : 'Governador'}</button>`).join('');
  if (el.dataset.h === html) return;
  el.dataset.h = html;
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(b => b.onclick = () => trocarCargo(b.dataset.c));
}

function trocarCargo(c) {
  if (cfg.tour) pararTour(true);
  cfg.cargo = c;
  salvarCfg();
  $('cargos').dataset.h = '';
  $('continentes').dataset.h = '';
  sel = c === 'governador' ? { tipo: 'govs' } : { tipo: 'total' };
  mostrarMunicipios(null);
  render();
  enquadrar();
}
