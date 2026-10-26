'use strict';
// Página de histórico: lê dados/historico/indice.json e o arquivo de cada eleição (gerados por server/historico.js).

const UF_NOMES = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso',
  PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins',
  BR: 'Brasil', ZZ: 'Exterior', VT: 'Voto em trânsito',
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
function corPartido(sg) {
  if (CORES_PARTIDO[sg]) return CORES_PARTIDO[sg];
  return corExtra[sg] ||= PALETA[Object.keys(corExtra).length % PALETA.length];
}

const $ = id => document.getElementById(id);
const fmt = n => (n || 0).toLocaleString('pt-BR');
const pct = (x, c = 1) => (isFinite(x) ? x : 0).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }) + '%';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataBR = d => d.split('-').reverse().join('/');
const IBGE_PARA_TSE = Object.fromEntries(Object.entries(MUNICIPIOS).map(([cd, m]) => [m[2], cd]));

let indice = [], eleicao = null, cargo = null, localSel = '', modo = 'cand';

function nomeLocal(l) {
  if (l.mun) return `${MUNICIPIOS[l.mun]?.[1] || l.nome || l.mun} (${l.uf})`;
  return UF_NOMES[l.uf] || l.uf;
}
const chaveLocal = l => l.mun ? `${l.uf}-${l.mun}` : l.uf;

// ---------------------------------------------------------------- mapa
const mapa = L.map('mapaHist', { zoomControl: false, zoomSnap: 0.25, attributionControl: true }).setView([-14, -52], 4);
mapa.attributionControl.setPrefix(false).addAttribution('Mapas: IBGE · Dados: TSE');
let camadaUFs = null, camadaMun = null;
const prontoUFs = carregarGeo('ufs').then(g => {
  camadaUFs = L.geoJSON(g, {
    onEachFeature: (f, layer) => layer.on('click', () => {
      if (!cargo) return;
      const l = cargo.locais.find(x => x.uf === f.properties.uf && (cargo.locais.length > 1 || true));
      if (l) escolherLocal(chaveLocal(l));
    }),
  }).addTo(mapa);
});

function vencedor(l) { return l.cands[0] && l.validos ? l.cands[0] : null; }

async function renderMapa() {
  await prontoUFs;
  if (camadaMun) { mapa.removeLayer(camadaMun); camadaMun = null; }
  const porUF = {};
  for (const l of cargo.locais) if (l.uf !== 'BR' && l.uf !== 'ZZ') (porUF[l.uf] ||= []).push(l);
  const sel = cargo.locais.find(l => chaveLocal(l) === localSel);
  const legenda = {};
  camadaUFs.eachLayer(layer => {
    const uf = layer.feature.properties.uf;
    const lista = porUF[uf];
    const l = lista && lista.length === 1 ? lista[0] : null;
    const v = l && vencedor(l);
    const cor = v ? corPartido(v.partido) : null;
    if (v) legenda[v.partido] = cor;
    const ativo = sel && sel.uf === uf;
    layer.setStyle({
      weight: ativo ? 3 : 1, color: ativo ? '#facc15' : '#0b1020',
      fillColor: cor || '#334155', fillOpacity: cor ? (ativo ? 0.9 : 0.7) : 0.25,
    });
    layer.unbindTooltip();
    if (l && v) {
      const rot = l.mun ? `${esc(MUNICIPIOS[l.mun]?.[1] || '')}` : uf;
      layer.bindTooltip(`<b>${rot}</b><br>${esc(v.nome)} (${esc(v.partido)}) ${pct(v.pct)}`, { sticky: true, className: 'tip' });
    }
  });
  $('legendaHist').innerHTML = Object.entries(legenda).sort().map(([sg, c]) => `<div><i style="background:${c}"></i>${esc(sg)}</div>`).join('') ||
    '<small>sem dados por estado</small>';

  // eleição em um só município (suplementar): mostra o contorno do município
  const unicoMun = cargo.locais.length === 1 && cargo.locais[0].mun ? cargo.locais[0] : (sel && sel.mun ? sel : null);
  if (unicoMun) {
    const uf = unicoMun.uf;
    const g = await carregarGeo(`mun-${uf}`);
    const ibge = MUNICIPIOS[unicoMun.mun]?.[2];
    const v = vencedor(unicoMun);
    camadaMun = L.geoJSON({ ...g, features: g.features.filter(f => f.properties.ibge === ibge) }, {
      style: { weight: 3, color: '#facc15', fillColor: v ? corPartido(v.partido) : '#334155', fillOpacity: 0.85 },
    }).addTo(mapa);
    mapa.flyToBounds(camadaMun.getBounds(), { padding: [60, 60], maxZoom: 10, duration: 1 });
    return;
  }
  if (sel && sel.uf !== 'BR' && sel.uf !== 'ZZ') {
    camadaUFs.eachLayer(layer => { if (layer.feature.properties.uf === sel.uf) mapa.flyToBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 7, duration: 1 }); });
  } else {
    mapa.flyTo([-14, -52], 4, { duration: 1 });
  }
}

// ---------------------------------------------------------------- resultado
function linhaCand(c, i, max) {
  const cor = corPartido(c.partido);
  const badge = c.eleito ? '<span class="badge eleito">ELEITO</span>' : /2º turno/i.test(c.st) ? '<span class="badge turno2">2º TURNO</span>' : '';
  return `<div class="res-linha"><span class="pos">${i + 1}</span>
    <div><div class="nome">${esc(c.nome)} <small>${esc(c.n)} · ${esc(c.partido)}</small>${badge}</div>
      <div class="trilho"><div style="width:${100 * c.pct / max}%;background:${cor}"></div></div></div>
    <div class="num"><b style="color:${cor}">${pct(c.pct, 2)}</b><small>${fmt(c.votos)}</small></div></div>`;
}

function renderResultado() {
  const el = $('resultadoHist');
  const l = cargo.locais.find(x => chaveLocal(x) === localSel);
  if (!l) {
    // visão geral: quem venceu em cada local
    const itens = cargo.locais.map(x => ({ x, v: vencedor(x) })).filter(i => i.v).sort((a, b) => nomeLocal(a.x).localeCompare(nomeLocal(b.x), 'pt-BR'));
    el.innerHTML = `<h3>Mais votado em cada local</h3>` + (itens.map(({ x, v }) => `
      <div class="res-linha clicavel" data-k="${esc(chaveLocal(x))}" style="cursor:pointer"><span class="pos"></span>
        <div><div class="nome">${esc(nomeLocal(x))}</div><small style="color:${corPartido(v.partido)}">${esc(v.nome)} · ${esc(v.partido)}</small></div>
        <div class="num"><b style="color:${corPartido(v.partido)}">${pct(v.pct)}</b><small>${fmt(v.votos)}</small></div></div>`).join('') || '<p class="vazio-hist">Sem resultados.</p>');
    el.querySelectorAll('[data-k]').forEach(d => d.onclick = () => escolherLocal(d.dataset.k));
    return;
  }
  const est = [
    ['Seções', `${fmt(l.secRec)}/${fmt(l.secTot)}`], ['Votantes', fmt(l.comp) + (l.aptos ? ` <small>${pct(100 * l.comp / l.aptos)}</small>` : '')],
    ['Válidos (nominais)', fmt(l.validos)], ['Brancos', fmt(l.brancos)], ['Nulos', fmt(l.nulos)], ['Candidatos', fmt(l.cands.length) + (cargo.proporcional ? ' <small>mais votados</small>' : '')],
  ];
  let h = `<h3>${esc(nomeLocal(l))} · ${esc(cargo.nome)}</h3><div class="res-estat">` + est.map(([k, v]) => `<div class="est"><span>${k}</span><b>${v}</b></div>`).join('') + '</div>';
  if (modo === 'part' && l.partidos) {
    const tot = l.partidos.reduce((a, p) => a + p.votos, 0);
    const max = Math.max(...l.partidos.map(p => 100 * p.votos / tot));
    h += l.partidos.map((p, i) => linhaCand({ nome: p.sg, n: '', partido: p.sg, votos: p.votos, pct: 100 * p.votos / tot, eleito: false, st: '' }, i, max)).join('');
  } else {
    const max = Math.max(1, ...l.cands.map(c => c.pct));
    h += l.cands.map((c, i) => linhaCand(c, i, max)).join('');
  }
  el.innerHTML = h;
}

// ---------------------------------------------------------------- navegação
function escolherLocal(k) {
  localSel = k;
  $('hLocal').value = k;
  renderResultado();
  renderMapa();
}

function escolherCargo(cd) {
  cargo = eleicao.cargos.find(c => c.cd === cd);
  $('cargos').querySelectorAll('button').forEach(b => b.classList.toggle('ativa', +b.dataset.cd === cd));
  const locais = [...cargo.locais].sort((a, b) => (a.uf === 'BR' ? -1 : b.uf === 'BR' ? 1 : nomeLocal(a).localeCompare(nomeLocal(b), 'pt-BR')));
  const geral = locais.length > 1 ? '<option value="">Visão geral (todos os locais)</option>' : '';
  $('hLocal').innerHTML = geral + locais.map(l => `<option value="${esc(chaveLocal(l))}">${esc(nomeLocal(l))}</option>`).join('');
  $('hModo').disabled = !cargo.proporcional;
  if (!cargo.proporcional) { modo = 'cand'; $('hModo').value = 'cand'; }
  const br = locais.find(l => l.uf === 'BR');
  escolherLocal(br ? 'BR' : locais.length === 1 ? chaveLocal(locais[0]) : '');
}

// ---------------------------------------------------------------- eleições agrupadas
// Cada eleição (ex.: Eleições Gerais 2022) junta os documentos federal e estadual de cada turno; as
// suplementares ficam num grupo à parte, uma por item.
let grupos = [], grupoSel = null, turnoSel = null, idSupSel = null;

function montarGrupos() {
  const mapa = new Map();
  for (const e of indice) {
    if (e.suplementar) continue;
    const chave = e.grupo || e.id;
    if (!mapa.has(chave)) mapa.set(chave, { grupo: chave, nome: e.grupoNome || e.nome, ano: e.ano || +e.data.slice(0, 4), tipo: e.tipo, docs: [] });
    mapa.get(chave).docs.push(e);
  }
  return [...mapa.values()].sort((a, b) => b.ano - a.ano);
}

function renderLista() {
  const supl = indice.filter(e => e.suplementar);
  const linhaGrupo = g => {
    const turnos = [...new Set(g.docs.map(d => d.turno))].sort();
    const cargos = [...new Map(g.docs.flatMap(d => d.cargos).map(c => [c.cd, c.nome])).entries()].sort((a, b) => a[0] - b[0]).map(c => c[1]);
    const fonte = g.docs.some(d => /Dados Abertos/.test(d.fonte || '')) ? 'dados abertos' : '';
    return `<button class="el-item" data-grupo="${esc(g.grupo)}">
      <span class="tipo ord">${g.tipo === 'municipal' ? 'municipal' : 'geral'}</span>
      <b>${esc(g.nome)}</b><small>${turnos.map(t => t + 'º').join(' e ')} turno · ${cargos.map(esc).join(', ')}${fonte ? ' · ' + fonte : ''}</small>
    </button>`;
  };
  $('listaEleicoes').innerHTML = grupos.map(linhaGrupo).join('') +
    (supl.length ? `<div class="el-secao">Eleições suplementares</div>` + supl.map(e => `
      <button class="el-item el-sup" data-id="${esc(e.id)}">
        <b>${esc(e.nome.replace(/^Eleição Suplementar - /, ''))}</b><small>${dataBR(e.data)} · ${e.cargos.map(c => esc(c.nome)).join(', ')}</small>
      </button>`).join('') : '');
  document.querySelectorAll('.el-item[data-grupo]').forEach(b => b.onclick = () => escolherGrupo(b.dataset.grupo));
  document.querySelectorAll('.el-item[data-id]').forEach(b => b.onclick = () => escolherSuplementar(b.dataset.id));
}

async function carregarDocs(ids) {
  const docs = await Promise.all(ids.map(async id => (await fetch(`dados/historico/${id}.json`)).json()));
  return docs;
}

function mostrarEleicao(titulo, subtitulo, docs, cargoInicial, localInicial) {
  eleicao = { cargos: docs.flatMap(d => d.cargos).sort((a, b) => a.cd - b.cd), completo: docs.every(d => d.completo) };
  $('cabecalhoEleicao').innerHTML = `<h2>${esc(titulo)}</h2><small>${subtitulo}` + (eleicao.completo ? '' : ' · <b>apuração ainda não encerrada</b>') + '</small>';
  $('cargos').innerHTML = eleicao.cargos.map(c => `<button data-cd="${c.cd}">${esc(c.nome)}</button>`).join('');
  $('cargos').querySelectorAll('button').forEach(b => b.onclick = () => { escolherCargo(+b.dataset.cd); atualizarEndereco(); });
  const c = eleicao.cargos.find(x => x.cd === cargoInicial) || eleicao.cargos[0];
  escolherCargo(c.cd);
  if (localInicial && c.locais.some(l => chaveLocal(l) === localInicial)) escolherLocal(localInicial);
}

async function escolherGrupo(chave, turno, cargoInicial, localInicial) {
  const g = grupos.find(x => x.grupo === chave);
  if (!g) return;
  grupoSel = g; idSupSel = null;
  const turnos = [...new Set(g.docs.map(d => d.turno))].sort();
  turnoSel = turnos.includes(turno) ? turno : turnos[0];
  document.querySelectorAll('.el-item').forEach(b => b.classList.toggle('ativa', b.dataset.grupo === chave));
  $('turnos').innerHTML = turnos.length > 1 ? turnos.map(t => `<button data-t="${t}" class="${t === turnoSel ? 'ativa' : ''}">${t}º turno</button>`).join('') : '';
  $('turnos').querySelectorAll('button').forEach(b => b.onclick = () => escolherGrupo(chave, +b.dataset.t, cargo?.cd));
  $('resultadoHist').innerHTML = '<p class="vazio-hist">Carregando…</p>';
  const docsT = g.docs.filter(d => d.turno === turnoSel);
  const docs = await carregarDocs(docsT.map(d => d.id));
  const data = docsT[0].data;
  const fonte = docsT[0].fonte || '';
  mostrarEleicao(g.nome, `${turnoSel}º turno · ${dataBR(data)}${fonte ? ' · fonte: ' + esc(fonte) : ''}`, docs, cargoInicial, localInicial);
  atualizarEndereco();
}

async function escolherSuplementar(id, cargoInicial, localInicial) {
  const e = indice.find(x => x.id === id);
  if (!e) return;
  grupoSel = null; idSupSel = id; turnoSel = e.turno;
  document.querySelectorAll('.el-item').forEach(b => b.classList.toggle('ativa', b.dataset.id === id));
  $('turnos').innerHTML = '';
  $('resultadoHist').innerHTML = '<p class="vazio-hist">Carregando…</p>';
  const docs = await carregarDocs([id]);
  mostrarEleicao(e.nome, `${dataBR(e.data)} · eleição suplementar`, docs, cargoInicial, localInicial);
  atualizarEndereco();
}

// endereço: #<grupo>/<turno>/<cargo>/<local> ou #sup/<id>/<cargo>/<local>
function atualizarEndereco() {
  const partes = idSupSel ? ['sup', idSupSel] : grupoSel ? [grupoSel.grupo, turnoSel] : [];
  if (cargo) partes.push(cargo.cd);
  if (localSel) partes.push(localSel);
  history.replaceState(null, '', '#' + partes.join('/'));
}

async function iniciar() {
  const r = await fetch('dados/historico/indice.json', { cache: 'no-cache' });
  if (!r.ok) {
    $('listaEleicoes').innerHTML = '<p class="vazio-hist">O histórico ainda está sendo preparado pelo servidor. Tente de novo em alguns minutos.</p>';
    return;
  }
  indice = (await r.json()).eleicoes;
  grupos = montarGrupos();
  renderLista();
  $('hLocal').onchange = () => { escolherLocal($('hLocal').value); atualizarEndereco(); };
  $('hModo').onchange = () => { modo = $('hModo').value; renderResultado(); };
  const p = decodeURIComponent(location.hash.slice(1)).split('/');
  if (p[0] === 'sup' && p[1]) return escolherSuplementar(p[1], +p[2] || null, p[3] || null);
  if (grupos.some(g => g.grupo === p[0])) return escolherGrupo(p[0], +p[1] || null, +p[2] || null, p[3] || null);
  // formato antigo: #<id do documento>/<cargo>/<local> (links do painel ao vivo)
  const doc = indice.find(e => e.id === p[0]);
  if (doc && doc.suplementar) return escolherSuplementar(doc.id, +p[1] || null, p[2] || null);
  if (doc) return escolherGrupo(doc.grupo, doc.turno, +p[1] || null, p[2] || null);
  if (grupos.length) escolherGrupo(grupos[0].grupo);
}
iniciar();
