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

// card de um cargo do 1º turno (já totalizado)
function cardCargo1T(cargo, uf) {
  const l = cargo.locais.find(x => x.uf === uf && !x.mun);
  if (!l) return '';
  const titulo = `${esc(cargo.nome)} <small>1º turno</small>`;
  if (!cargo.proporcional) {
    const lista = l.cands.slice(0, cargo.cd === 5 ? 4 : 3).map(c => ({ ...c, cor: corPartidoOC(c.partido) }));
    return `<div class="oc-card"><div class="oc-topo"><b>${titulo}</b>${linkHistorico(cargo.cd, uf)}</div>${lista.map(candidatoComFoto).join('')}</div>`;
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
    ${r.lista.map(candidatoComFoto).join('')}
    <div class="oc-sub">${fmt(d?.secRec)}/${fmt(d?.secTot)} seções (${pct(r.pctSec)})${difCurta(r.lista)}</div></button>`;
}

// linha compacta de candidato: foto (ou iniciais, quando não há foto), nome, partido, situação, % e barra
function candidatoComFoto(c) {
  const foto = c.sq ? imgFoto(c) : `<span class="foto" data-ini="${esc(iniciais(c.nome))}"></span>`;
  return `<div class="oc-cand" style="--cor:${c.cor}">${foto}
    <div class="oc-cand-info"><div class="oc-linha"><span class="oc-nome">${esc(c.nome)}</span><b>${pct(c.pct)}</b></div>
      <div class="gm-trilho"><div style="width:${c.pct}%;background:${c.cor}"></div></div>
      <div class="oc-votos">${c.n ? esc(c.n) + ' · ' : ''}${esc(c.partido)} · ${fmt(c.votos)} votos${badgeOC(c)}</div></div></div>`;
}

// presidente no estado (aparece no modo Governador)
function cardPresidente(uf) {
  if (!cands.length) return '';
  const dm = sel.tipo === 'municipio' ? dadosMun(sel.id) : null;
  const d = dm && dm.secRec ? dm : dadosUF(uf);
  const r = resumo(d);
  return `<button class="oc-card oc-clicavel" onclick="abrirPresidente('${uf}')">
    <div class="oc-topo"><b>Presidente <small>${T.nome} · ${d === dm ? 'no município' : 'no estado'}</small></b><span class="oc-link">ver no mapa ›</span></div>
    ${r.lista.slice(0, 2).map(candidatoComFoto).join('')}
    <div class="oc-sub">${fmt(d.secRec)}/${fmt(d.secTot)} seções (${pct(r.pctSec)})${difCurta(r.lista)}</div></button>`;
}

// ---------------------------------------------------------------- eleições suplementares do dia (prefeitos)
let suplementares = []; // dados/sup-hoje.json, carregado em atualizar()

const PALETA_OC = ['#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#0ea5e9'];
function resumoSup(s) {
  const usadas = new Set();
  const cl = s.candidatos.map((c, i) => {
    let cor = corPartidoOC(c.partido);
    if (usadas.has(cor) || cor === '#94a3b8') cor = PALETA_OC[i % PALETA_OC.length];
    usadas.add(cor);
    return { ...c, cor };
  });
  const votos = s.total.votos || {};
  const validos = cl.reduce((a, c) => a + (votos[c.n] || 0), 0);
  const lista = cl.map(c => ({ ...c, votos: votos[c.n] || 0, pct: validos ? 100 * (votos[c.n] || 0) / validos : 0 }))
    .sort((a, b) => b.votos - a.votos || a.n - b.n);
  return { lista, validos, pctSec: s.total.secTot ? 100 * s.total.secRec / s.total.secTot : 0 };
}
const nomeSup = s => (s.mun && MUNICIPIOS[s.mun]?.[1]) || s.nome.replace(/^Eleição Suplementar - /, '');

// card completo de uma suplementar (município selecionado)
function cardSuplementar(s) {
  const r = resumoSup(s);
  return `<div class="oc-card oc-sup"><div class="oc-topo"><b>${esc(s.cargoNome)} <small>eleição suplementar · ao vivo</small></b></div>
    ${r.lista.map(candidatoComFoto).join('')}
    <div class="oc-sub">${fmt(s.total.secRec)}/${fmt(s.total.secTot)} seções (${pct(r.pctSec)}) · ${fmt(s.total.comp)} votantes${difCurta(r.lista)}</div></div>`;
}

// lista resumida de suplementares (estado ou Brasil): uma linha por município, clicável
function cardListaSuplementares(lista, titulo) {
  if (!lista.length) return '';
  return `<div class="oc-card oc-sup"><div class="oc-topo"><b>${titulo}</b></div>
    ${lista.map(s => {
      const r = resumoSup(s);
      const l = r.lista[0];
      const alvo = s.mun ? `selecionar({tipo:'municipio',id:'${s.mun}'})` : `selecionar({tipo:'uf',id:'${s.uf}'})`;
      return `<button class="oc-sup-linha" onclick="${alvo}">
        <span class="oc-nome">${seloUF(s.uf)}${esc(nomeSup(s))} <small>${esc(s.cargoNome)}</small></span>
        <span class="oc-sup-lider">${r.validos ? `<span style="color:${l.cor}">${esc(l.nome)} ${pct(l.pct, 0)}</span>` : '<small>aguardando</small>'} <small>${pct(r.pctSec, 0)} apur.</small></span>
      </button>`;
    }).join('')}</div>`;
}

function htmlOutrosCargos() {
  const uf = ufDoContexto();
  if (!uf) {
    if (!['total', 'brasil', 'regiao'].includes(sel.tipo) && sel.tipo !== 'govs') return '';
    const sups = sel.tipo === 'regiao' ? suplementares.filter(s => REGIAO_DA_UF[s.uf] === sel.id) : suplementares;
    const lista = cardListaSuplementares(sups, `Eleições suplementares hoje <small>${sups.length} ${sups.length === 1 ? 'município' : 'municípios'}</small>`);
    return (lista ? `<div class="outros-cargos">${lista}</div>` : '') +
      '<div class="oc-dica">Clique num estado para ver aqui os candidatos a governador, senador e deputado.</div>';
  }
  carregarEstadual1T();
  const blocos = [];
  // prefeito (ou outro cargo) em eleição suplementar hoje: no município, o card completo; no estado, a lista
  const supsUF = suplementares.filter(s => s.uf === uf);
  if (sel.tipo === 'municipio') supsUF.filter(s => s.mun === sel.id).forEach(s => blocos.push(cardSuplementar(s)));
  else blocos.push(cardListaSuplementares(supsUF, 'Prefeitos em disputa hoje <small>eleições suplementares</small>'));
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
  return `<div class="outros-cargos"><div class="oc-titulo">Candidatos em ${seloUF(uf)}${esc(UF_NOMES[uf])}</div>${html}</div>`;
}

function abrirGovernador(uf) {
  trocarCargo('governador');
  selecionar({ tipo: 'uf', id: uf });
}
function abrirPresidente(uf) {
  trocarCargo('presidente');
  selecionar({ tipo: 'uf', id: uf });
}
