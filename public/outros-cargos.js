'use strict';
// "Outros cargos no estado": ao selecionar um estado (ou município), mostra abaixo do placar principal os demais
// cargos daquele estado, um embaixo do outro. Governador do 2º turno vem ao vivo (dados/gov-2.json); Senador,
// Deputados e o Governador do 1º turno vêm do 1º turno já totalizado (dados/historico/2026-1t-estadual.json).
// Usa funções e estado globais de app.js e governador.js.

const ID_ESTADUAL_1T = '2026-1t-estadual';
let estadual1T = null, estadual1TCarregando = null, estadual1TFalhouEm = 0;

function carregarEstadual1T() {
  if (estadual1T || estadual1TCarregando || !modoServidor) return;
  if (Date.now() - estadual1TFalhouEm < 5 * 60 * 1000) return;
  estadual1TCarregando = fetch(`dados/historico/${ID_ESTADUAL_1T}.json`, { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(j => { estadual1T = j; render(); })
    .catch(() => { estadual1TFalhouEm = Date.now(); })
    .finally(() => { estadual1TCarregando = null; });
}

const CORES_PARTIDO_OC = {
  PT: '#e5242f', PL: '#2563eb', 'UNIÃO': '#0ea5e9', PSD: '#16a34a', MDB: '#22c55e', PSDB: '#60a5fa', REPUBLICANOS: '#1e40af',
  PP: '#38bdf8', PSB: '#f59e0b', PDT: '#ef4444', PSOL: '#facc15', NOVO: '#f97316', PODE: '#84cc16', AVANTE: '#06b6d4',
  'PC do B': '#b91c1c', PV: '#10b981', SOLIDARIEDADE: '#fb923c', CIDADANIA: '#ec4899', REDE: '#14b8a6', PRD: '#6366f1',
};
const corPartidoOC = sg => CORES_PARTIDO_OC[sg] || '#94a3b8';

const ufDoContexto = () => sel.tipo === 'uf' ? sel.id : sel.tipo === 'municipio' ? MUNICIPIOS[sel.id]?.[0] : null;

function linkHistorico(cd, uf) {
  return `<a class="oc-link" href="historico.html#${ID_ESTADUAL_1T}/${cd}/${uf}" target="_blank" rel="noopener">ver todos ›</a>`;
}

function badgeOC(c) {
  if (c.eleito) return '<span class="badge eleito">ELEITO</span>';
  if (/2º turno/i.test(c.st || '')) return '<span class="badge turno2">2º TURNO</span>';
  return '';
}

function linhasOC(cands, n) {
  return cands.slice(0, n).map(c => `<div class="oc-linha">
      <span class="oc-nome"><i style="background:${corPartidoOC(c.partido)}"></i>${esc(c.nome)} <small>${esc(c.partido)}</small>${badgeOC(c)}</span>
      <b>${pct(c.pct)}</b></div>`).join('');
}

// card de um cargo do 1º turno (já totalizado)
function cardCargo1T(cargo, uf) {
  const l = cargo.locais.find(x => x.uf === uf && !x.mun);
  if (!l) return '';
  const titulo = `${esc(cargo.nome)} <small>1º turno</small>`;
  if (!cargo.proporcional) {
    return `<div class="oc-card"><div class="oc-topo"><b>${titulo}</b>${linkHistorico(cargo.cd, uf)}</div>${linhasOC(l.cands, cargo.cd === 5 ? 4 : 3)}</div>`;
  }
  const eleitos = l.cands.filter(c => c.eleito);
  const partidos = (l.partidos || []).slice(0, 4);
  const totPart = (l.partidos || []).reduce((a, p) => a + p.votos, 0);
  const porPartido = {};
  for (const c of eleitos) porPartido[c.partido] = (porPartido[c.partido] || 0) + 1;
  const bancada = Object.entries(porPartido).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([sg, n]) => `<span class="oc-chip" style="--cor:${corPartidoOC(sg)}">${esc(sg)} ${n}</span>`).join('');
  return `<div class="oc-card"><div class="oc-topo"><b>${titulo}</b>${linkHistorico(cargo.cd, uf)}</div>
    <div class="oc-sub">${fmt(eleitos.length)} eleitos${bancada ? ' · por partido:' : ''}</div>
    ${bancada ? `<div class="oc-chips">${bancada}</div>` : ''}
    <div class="oc-sub">Mais votados</div>
    ${l.cands.slice(0, 3).map(c => `<div class="oc-linha"><span class="oc-nome"><i style="background:${corPartidoOC(c.partido)}"></i>${esc(c.nome)} <small>${esc(c.partido)}</small>${badgeOC(c)}</span><b>${fmt(c.votos)}</b></div>`).join('')}
    ${partidos.length ? `<div class="oc-sub">Votos nominais por partido: ${partidos.map(p => `<span style="color:${corPartidoOC(p.sg)}">${esc(p.sg)} ${pct(100 * p.votos / totPart, 0)}</span>`).join(' · ')}</div>` : ''}
  </div>`;
}

// governador do 2º turno, ao vivo
function cardGov2T(uf) {
  const cl = govCands(uf);
  const dm = sel.tipo === 'municipio' ? govDadosMun(sel.id) : null;
  const d = dm || govDadosUF(uf);
  const r = govResumo(d, cl);
  const onde = dm ? `em ${esc(MUNICIPIOS[sel.id][1])}` : 'no estado';
  return `<button class="oc-card oc-clicavel" onclick="abrirGovernador('${uf}')">
    <div class="oc-topo"><b>Governador <small>2º turno · ao vivo · ${onde}</small></b><span class="oc-link">ver no mapa ›</span></div>
    ${r.lista.map(c => `<div class="oc-linha"><span class="oc-nome"><i style="background:${c.cor}"></i>${esc(c.nome)} <small>${esc(c.partido)}</small></span><b>${pct(c.pct)}</b></div>
      <div class="gm-trilho"><div style="width:${c.pct}%;background:${c.cor}"></div></div>`).join('')}
    <div class="oc-sub">${fmt(d?.secRec)}/${fmt(d?.secTot)} seções (${pct(r.pctSec)})</div></button>`;
}

// presidente no estado (aparece no modo Governador)
function cardPresidente(uf) {
  if (!cands.length) return '';
  const dm = sel.tipo === 'municipio' ? dadosMun(sel.id) : null;
  const d = dm && dm.secRec ? dm : dadosUF(uf);
  const r = resumo(d);
  return `<button class="oc-card oc-clicavel" onclick="abrirPresidente('${uf}')">
    <div class="oc-topo"><b>Presidente <small>${T.nome} · ${d === dm ? 'no município' : 'no estado'}</small></b><span class="oc-link">ver no mapa ›</span></div>
    ${r.lista.slice(0, 2).map(c => `<div class="oc-linha"><span class="oc-nome"><i style="background:${c.cor}"></i>${esc(c.nome)}</span><b>${pct(c.pct)}</b></div>
      <div class="gm-trilho"><div style="width:${c.pct}%;background:${c.cor}"></div></div>`).join('')}
    <div class="oc-sub">${fmt(d.secRec)}/${fmt(d.secTot)} seções (${pct(r.pctSec)})</div></button>`;
}

function htmlOutrosCargos() {
  const uf = ufDoContexto();
  if (!uf) {
    return ['total', 'brasil', 'regiao'].includes(sel.tipo) || sel.tipo === 'govs'
      ? '<div class="oc-dica">Clique num estado para ver também governador, senador e deputados.</div>' : '';
  }
  carregarEstadual1T();
  const blocos = [];
  const noModoGov = typeof govAtivo === 'function' && govAtivo();
  if (noModoGov) blocos.push(cardPresidente(uf));
  else if (cfg.turno === '2' && typeof govTemUF === 'function' && govTemUF(uf)) blocos.push(cardGov2T(uf));
  if (estadual1T) {
    for (const cargo of estadual1T.cargos) {
      if (cargo.cd === 3 && (noModoGov || (cfg.turno === '2' && govTemUF(uf)))) continue; // governador já mostrado ao vivo
      blocos.push(cardCargo1T(cargo, uf));
    }
  } else if (modoServidor) {
    blocos.push('<div class="oc-dica">Carregando senador e deputados…</div>');
  }
  const html = blocos.filter(Boolean).join('');
  if (!html) return '';
  return `<div class="outros-cargos"><div class="oc-titulo">Outros cargos em ${seloUF(uf)}${esc(UF_NOMES[uf])}</div>${html}</div>`;
}

function abrirGovernador(uf) {
  trocarCargo('governador');
  selecionar({ tipo: 'uf', id: uf });
}
function abrirPresidente(uf) {
  trocarCargo('presidente');
  selecionar({ tipo: 'uf', id: uf });
}
