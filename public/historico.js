'use strict';
// Página de histórico: lê dados/historico/indice.json e o arquivo de cada eleição (gerados por server/historico.js).

// onde ficam os dados publicados pelo servidor: /dados/ ou uma CDN (window.DADOS_BASE é injetado pelo servidor no HTML)
const DADOS = window.DADOS_BASE || 'dados/';
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
let munSel = null;          // município selecionado (código TSE) no detalhamento municipal
const detalhes = new Map(); // cache dos arquivos de detalhamento municipal

function nomeLocal(l) {
  if (l.mun) return `${MUNICIPIOS[l.mun]?.[1] || l.nome || l.mun} (${l.uf})`;
  return UF_NOMES[l.uf] || l.uf;
}
const chaveLocal = l => l.mun ? `${l.uf}-${l.mun}` : l.uf;

// ---------------------------------------------------------------- detalhamento municipal
// Para presidente, governador, senador e prefeito há um arquivo por estado com o resultado de cada município
// (dados/historico/mun/<eleição>/<cargo>-<UF>.json). Ele é carregado quando o estado é aberto.
const ehUF = k => /^[A-Z]{2}$/.test(k) && !['BR', 'ZZ', 'VT'].includes(k);
function ufDoLocal(k) {
  if (!k) return null;
  if (k.startsWith('mun:')) return k.slice(4);
  if (ehUF(k)) return k;
  const m = /^([A-Z]{2})-\d{5}$/.exec(k);
  return m ? m[1] : null;
}
async function carregarDetalhe(uf) {
  if (!cargo?.temMun || !uf) return null;
  const chave = `${cargo.docId}/${cargo.cd}-${uf}`;
  if (!detalhes.has(chave)) {
    detalhes.set(chave, fetch(`${DADOS}historico/mun/${chave}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return detalhes.get(chave);
}
// resultado de um município no formato dos locais do histórico (cands com pct, comparecimento etc.)
function resultadoMunicipio(det, cd) {
  const m = det?.mun?.[cd];
  if (!m) return null;
  const cands = m.r
    ? m.r.map(([n, nome, partido, votos, st]) => ({ n, nome, partido, votos, st, eleito: /^eleit/i.test(st || '') }))
    : det.cands.map((c, i) => ({ ...c, votos: m.v[i] || 0, st: '', eleito: false }));
  const validos = cands.reduce((a, c) => a + c.votos, 0);
  cands.forEach(c => (c.pct = validos ? 100 * c.votos / validos : 0));
  cands.sort((a, b) => b.votos - a.votos);
  return { uf: det.uf, mun: cd, cands, validos, comp: m.c, aptos: m.a, brancos: m.b, nulos: m.nu, secTot: m.s, secRec: m.s };
}

// ---------------------------------------------------------------- mapa
const mapa = L.map('mapaHist', { zoomControl: false, zoomSnap: 0.25, attributionControl: true }).setView([-14, -52], 4);
mapa.attributionControl.setPrefix(false).addAttribution('Mapas: IBGE · Dados: TSE');
let camadaUFs = null, camadaMun = null;
const prontoUFs = carregarGeo('ufs').then(g => {
  camadaUFs = L.geoJSON(g, {
    onEachFeature: (f, layer) => layer.on('click', () => {
      if (!cargo) return;
      const uf = f.properties.uf;
      const l = cargo.locais.find(x => x.uf === uf && !x.mun);
      if (l) escolherLocal(chaveLocal(l));
      else if (cargo.temMun) escolherLocal(`mun:${uf}`); // prefeito: abre todos os municípios do estado
    }),
  }).addTo(mapa);
});

function vencedor(l) { return l.cands[0] && l.validos ? l.cands[0] : null; }

let ultimoEnquadramento = '';
async function renderMapa() {
  await prontoUFs;
  if (camadaMun) { mapa.removeLayer(camadaMun); camadaMun = null; }
  const porUF = {};
  for (const l of cargo.locais) if (l.uf !== 'BR' && l.uf !== 'ZZ') (porUF[l.uf] ||= []).push(l);
  const ufAberta = ufDoLocal(localSel);
  const det = ufAberta ? await carregarDetalhe(ufAberta) : null;
  const legenda = {};
  camadaUFs.eachLayer(layer => {
    const uf = layer.feature.properties.uf;
    const lista = porUF[uf];
    const l = lista && lista.length === 1 && !lista[0].mun ? lista[0] : (lista?.find(x => !x.mun) || null);
    const v = l && vencedor(l);
    const cor = v ? corPartido(v.partido) : null;
    if (v && !det) legenda[v.partido] = cor;
    const ativo = ufAberta === uf;
    layer.setStyle({
      weight: ativo ? 3 : 1, color: ativo ? '#facc15' : '#0b1020',
      // com o detalhamento municipal aberto, o estado fica só com o contorno
      // e os outros estados ficam apagados para não competir com o mapa municipal
      fillColor: cor || '#334155', fillOpacity: ativo && det ? 0 : det ? 0.12 : cor ? (ativo ? 0.9 : 0.7) : 0.25,
    });
    const el = layer.getElement();
    if (el) el.style.pointerEvents = ativo && det ? 'none' : '';
    layer.unbindTooltip();
    if (l && v) layer.bindTooltip(`<b>${uf}</b><br>${esc(v.nome)} (${esc(v.partido)}) ${pct(v.pct)}`, { sticky: true, className: 'tip' });
    else if (cargo.temMun && !l) layer.bindTooltip(`<b>${uf}</b><br><small>clique para ver os municípios</small>`, { sticky: true, className: 'tip' });
  });

  if (det && ufAberta) {
    // municípios do estado, coloridos pelo partido mais votado
    const g = await carregarGeo(`mun-${ufAberta}`);
    camadaMun = L.geoJSON(g, {
      style: f => {
        const cd = IBGE_PARA_TSE[f.properties.ibge];
        const r = resultadoMunicipio(det, cd);
        const v = r && r.validos ? r.cands[0] : null;
        if (v) legenda[v.partido] = corPartido(v.partido);
        const margem = r && r.cands[1] ? r.cands[0].pct - r.cands[1].pct : 100;
        const atual = munSel === cd;
        return {
          weight: atual ? 3 : 0.4, color: atual ? '#facc15' : '#0b1020',
          fillColor: v ? corPartido(v.partido) : '#334155', fillOpacity: v ? 0.35 + 0.55 * Math.min(1, margem / 40) : 0.3,
        };
      },
      onEachFeature: (f, layer) => {
        const cd = IBGE_PARA_TSE[f.properties.ibge];
        const r = resultadoMunicipio(det, cd);
        layer.on('click', () => escolherMunicipio(cd));
        layer.on('mouseover', () => layer.setStyle({ weight: 2, color: '#fff' }));
        layer.on('mouseout', () => camadaMun.resetStyle(layer));
        let h = `<b>${esc(MUNICIPIOS[cd]?.[1] || cd)}</b>`;
        if (r && r.validos) h += r.cands.slice(0, 3).map(c => `<br><span style="color:${corPartido(c.partido)}">●</span> ${esc(c.nome)} <small>${esc(c.partido)}</small> <b>${pct(c.pct)}</b>`).join('') + `<br><small>${fmt(r.comp)} votantes</small>`;
        else h += '<br><small>sem votos</small>';
        layer.bindTooltip(h, { sticky: true, className: 'tip' });
      },
    }).addTo(mapa);
    if (munSel) camadaMun.eachLayer(l => { if (IBGE_PARA_TSE[l.feature.properties.ibge] === munSel) l.bringToFront(); });
  }
  $('legendaHist').innerHTML = Object.entries(legenda).sort().map(([sg, c]) => `<div><i style="background:${c}"></i>${esc(sg)}</div>`).join('') ||
    '<small>sem dados por estado</small>';

  // enquadramento: município, estado, eleição de um município só (suplementar) ou o Brasil
  const sel = cargo.locais.find(l => chaveLocal(l) === localSel);
  const unicoMun = cargo.locais.length === 1 && cargo.locais[0].mun ? cargo.locais[0] : null;
  const alvo = munSel ? `m:${munSel}` : ufAberta ? `u:${ufAberta}` : unicoMun ? `s:${unicoMun.mun}` : 'br';
  if (alvo === ultimoEnquadramento && !unicoMun) return;
  ultimoEnquadramento = alvo;
  if (unicoMun && !det) {
    const g = await carregarGeo(`mun-${unicoMun.uf}`);
    const ibge = MUNICIPIOS[unicoMun.mun]?.[2];
    const v = vencedor(unicoMun);
    camadaMun = L.geoJSON({ ...g, features: g.features.filter(f => f.properties.ibge === ibge) }, {
      style: { weight: 3, color: '#facc15', fillColor: v ? corPartido(v.partido) : '#334155', fillOpacity: 0.85 },
    }).addTo(mapa);
    mapa.flyToBounds(camadaMun.getBounds(), { padding: [60, 60], maxZoom: 10, duration: 1 });
  } else if (munSel && camadaMun) {
    camadaMun.eachLayer(l => { if (IBGE_PARA_TSE[l.feature.properties.ibge] === munSel) mapa.flyToBounds(l.getBounds(), { padding: [80, 80], maxZoom: 9, duration: 1 }); });
  } else if (ufAberta || (sel && ehUF(sel.uf))) {
    const uf = ufAberta || sel.uf;
    camadaUFs.eachLayer(layer => { if (layer.feature.properties.uf === uf) mapa.flyToBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 8, duration: 1 }); });
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

function blocoResultado(titulo, l, proporcional) {
  const est = [
    ['Seções', `${fmt(l.secRec)}/${fmt(l.secTot)}`], ['Votantes', fmt(l.comp) + (l.aptos ? ` <small>${pct(100 * l.comp / l.aptos)}</small>` : '')],
    ['Válidos (nominais)', fmt(l.validos)], ['Brancos', fmt(l.brancos)], ['Nulos', fmt(l.nulos)], ['Candidatos', fmt(l.cands.length) + (proporcional ? ' <small>mais votados</small>' : '')],
  ];
  let h = `<h3>${titulo}</h3><div class="res-estat">` + est.map(([k, v]) => `<div class="est"><span>${k}</span><b>${v}</b></div>`).join('') + '</div>';
  if (modo === 'part' && l.partidos) {
    const tot = l.partidos.reduce((a, p) => a + p.votos, 0);
    const max = Math.max(...l.partidos.map(p => 100 * p.votos / tot));
    h += l.partidos.map((p, i) => linhaCand({ nome: p.sg, n: '', partido: p.sg, votos: p.votos, pct: 100 * p.votos / tot, eleito: false, st: '' }, i, max)).join('');
  } else {
    const max = Math.max(1, ...l.cands.map(c => c.pct));
    h += l.cands.map((c, i) => linhaCand(c, i, max)).join('');
  }
  return h;
}

// lista dos municípios do estado com quem venceu em cada um (clicável)
function listaMunicipios(det) {
  const itens = Object.keys(det.mun).map(cd => ({ cd, r: resultadoMunicipio(det, cd) })).filter(i => i.r && i.r.validos)
    .sort((a, b) => (b.r.comp || 0) - (a.r.comp || 0));
  return `<h3 class="res-sub">Municípios <small>${fmt(itens.length)} · clique para ver o resultado</small></h3>` + itens.map(({ cd, r }) => {
    const v = r.cands[0], cor = corPartido(v.partido);
    return `<div class="res-linha clicavel" data-mun="${cd}"><span class="pos"></span>
      <div><div class="nome">${esc(MUNICIPIOS[cd]?.[1] || cd)}${MUNICIPIOS[cd]?.[3] ? ' <small>capital</small>' : ''}</div><small style="color:${cor}">${esc(v.nome)} · ${esc(v.partido)}</small></div>
      <div class="num"><b style="color:${cor}">${pct(v.pct)}</b><small>${fmt(r.comp)} votantes</small></div></div>`;
  }).join('');
}

async function renderResultado() {
  const el = $('resultadoHist');
  const uf = ufDoLocal(localSel);
  const det = uf ? await carregarDetalhe(uf) : null;

  if (munSel && det) {
    // município escolhido no detalhamento
    const r = resultadoMunicipio(det, munSel);
    const nome = `${MUNICIPIOS[munSel]?.[1] || munSel} (${uf})`;
    el.innerHTML = `<button class="voltar-uf" id="voltarUF">← ${esc(localSel.startsWith('mun:') ? UF_NOMES[uf] + ' · todos os municípios' : UF_NOMES[uf])}</button>` +
      (r ? blocoResultado(`${esc(nome)} · ${esc(cargo.nome)}`, r, false) : '<p class="vazio-hist">Sem votos neste município.</p>');
    $('voltarUF').onclick = () => escolherMunicipio(null);
    return;
  }

  const l = cargo.locais.find(x => chaveLocal(x) === localSel);
  if (!l && localSel.startsWith('mun:')) {
    el.innerHTML = det ? `<h3>${esc(UF_NOMES[uf])} · ${esc(cargo.nome)}</h3>` + listaMunicipios(det) : '<p class="vazio-hist">Sem detalhamento por município para este estado.</p>';
    el.querySelectorAll('[data-mun]').forEach(d => d.onclick = () => escolherMunicipio(d.dataset.mun));
    return;
  }
  if (!l) {
    // visão geral: quem venceu em cada local
    const itens = cargo.locais.map(x => ({ x, v: vencedor(x) })).filter(i => i.v).sort((a, b) => nomeLocal(a.x).localeCompare(nomeLocal(b.x), 'pt-BR'));
    el.innerHTML = `<h3>Mais votado em cada local</h3>` + (itens.map(({ x, v }) => `
      <div class="res-linha clicavel" data-k="${esc(chaveLocal(x))}" style="cursor:pointer"><span class="pos"></span>
        <div><div class="nome">${esc(nomeLocal(x))}</div><small style="color:${corPartido(v.partido)}">${esc(v.nome)} · ${esc(v.partido)}</small></div>
        <div class="num"><b style="color:${corPartido(v.partido)}">${pct(v.pct)}</b><small>${fmt(v.votos)}</small></div></div>`).join('') || '<p class="vazio-hist">Sem resultados.</p>') +
      (cargo.temMun ? '<p class="dica-hist">Clique num estado no mapa para ver o resultado de cada município.</p>' : '');
    el.querySelectorAll('[data-k]').forEach(d => d.onclick = () => escolherLocal(d.dataset.k));
    return;
  }
  let h = blocoResultado(`${esc(nomeLocal(l))} · ${esc(cargo.nome)}`, l, cargo.proporcional);
  if (det && ehUF(localSel)) h += listaMunicipios(det);
  else if (ehUF(localSel) && !cargo.temMun && !cargo.proporcional) h += '<p class="dica-hist">Esta eleição não tem detalhamento por município.</p>';
  else if (ehUF(localSel) && cargo.proporcional) h += '<p class="dica-hist">Para deputados e vereadores o histórico guarda o resultado no estado (são centenas de candidatos por município).</p>';
  el.innerHTML = h;
  el.querySelectorAll('[data-mun]').forEach(d => d.onclick = () => escolherMunicipio(d.dataset.mun));
}

// ---------------------------------------------------------------- navegação
function escolherLocal(k) {
  localSel = k;
  munSel = /^[A-Z]{2}-\d{5}$/.test(k) && cargo.temMun ? k.slice(3) : null; // capital escolhida na lista
  $('hLocal').value = k;
  renderResultado();
  renderMapa();
  if (typeof atualizarEndereco === 'function') atualizarEndereco();
}

function escolherMunicipio(cd) {
  munSel = cd;
  renderResultado();
  renderMapa();
  $('resultadoHist').scrollTop = 0;
}

function escolherCargo(cd) {
  cargo = eleicao.cargos.find(c => c.cd === cd);
  munSel = null;
  ultimoEnquadramento = '';
  $('cargos').querySelectorAll('button').forEach(b => b.classList.toggle('ativa', +b.dataset.cd === cd));
  const locais = [...cargo.locais].sort((a, b) => (a.uf === 'BR' ? -1 : b.uf === 'BR' ? 1 : nomeLocal(a).localeCompare(nomeLocal(b), 'pt-BR')));
  const geral = locais.length > 1 ? '<option value="">Visão geral (todos os locais)</option>' : '';
  // prefeito: além das capitais, todos os municípios de cada estado
  const temUFs = locais.some(l => ehUF(l.uf) && !l.mun);
  const porEstado = cargo.temMun && !temUFs
    ? '<optgroup label="Todos os municípios do estado">' + Object.keys(UF_NOMES).filter(ehUF).sort((a, b) => UF_NOMES[a].localeCompare(UF_NOMES[b], 'pt-BR'))
      .map(uf => `<option value="mun:${uf}">${esc(UF_NOMES[uf])}</option>`).join('') + '</optgroup>'
    : '';
  $('hLocal').innerHTML = geral + (porEstado ? '<optgroup label="Capitais">' : '') +
    locais.map(l => `<option value="${esc(chaveLocal(l))}">${esc(nomeLocal(l))}</option>`).join('') + (porEstado ? '</optgroup>' + porEstado : '');
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
  const docs = await Promise.all(ids.map(async id => (await fetch(`${DADOS}historico/${id}.json`)).json()));
  return docs;
}

function mostrarEleicao(titulo, subtitulo, docs, cargoInicial, localInicial) {
  // cada cargo guarda de qual documento veio e se tem detalhamento por município (índice do servidor)
  for (const d of docs) {
    const ent = indice.find(e => e.id === d.id);
    for (const c of d.cargos) { c.docId = d.id; c.temMun = !!(c.detalheMunicipal || ent?.municipais?.includes(c.cd)); }
  }
  eleicao = { cargos: docs.flatMap(d => d.cargos).sort((a, b) => a.cd - b.cd), completo: docs.every(d => d.completo) };
  $('cabecalhoEleicao').innerHTML = `<h2>${esc(titulo)}</h2><small>${subtitulo}` + (eleicao.completo ? '' : ' · <b>apuração ainda não encerrada</b>') + '</small>';
  $('cargos').innerHTML = eleicao.cargos.map(c => `<button data-cd="${c.cd}">${esc(c.nome)}</button>`).join('');
  $('cargos').querySelectorAll('button').forEach(b => b.onclick = () => { escolherCargo(+b.dataset.cd); atualizarEndereco(); });
  const c = eleicao.cargos.find(x => x.cd === cargoInicial) || eleicao.cargos[0];
  escolherCargo(c.cd);
  if (localInicial && (c.locais.some(l => chaveLocal(l) === localInicial) || /^mun:[A-Z]{2}$/.test(localInicial))) escolherLocal(localInicial);
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
  const r = await fetch(DADOS + 'historico/indice.json', { cache: 'no-cache' });
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
