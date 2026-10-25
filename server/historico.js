'use strict';
// Histórico: baixa uma vez os resultados das últimas eleições (gerais por UF, municipais nas capitais
// e as suplementares mais recentes) e grava dados/historico/<id>.json num formato único.
const fs = require('fs');
const path = require('path');

const RAIZ = 'https://resultados.tse.jus.br/oficial';
const DIR = path.join(process.env.DIR_DADOS || path.join(__dirname, '..', 'dados'), 'historico');
const TOTAL = +process.env.HISTORICO_QTD || 20;
const CONCORRENCIA = +process.env.HISTORICO_CONCORRENCIA || 2;
const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
// capitais (código TSE do município); Brasília não tem eleição municipal
const CAPITAIS = {
  AC: '01392', AL: '27855', AM: '02550', AP: '06050', BA: '38490', CE: '13897', ES: '57053', GO: '93734', MA: '09210',
  MG: '41238', MS: '90514', MT: '90670', PA: '04278', PB: '20516', PE: '25313', PI: '12190', PR: '75353', RJ: '60011',
  RN: '17612', RO: '00035', RR: '03018', RS: '88013', SC: '81051', SE: '31054', SP: '71072', TO: '73440',
};
const CARGOS = {
  1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: 'Deputado Estadual', 8: 'Deputado Distrital',
  11: 'Prefeito', 13: 'Vereador',
};
const PROPORCIONAL = new Set([6, 7, 8, 13]);

// eleições ordinárias (as mais recentes primeiro); municipais só nas capitais
const ORDINARIAS = [
  { id: '2026-1t-federal', ciclo: 'ele2026', ele: 6257, nome: 'Eleição Geral 2026 · 1º turno · Federal', data: '2026-10-04', turno: 1, cargos: [1], locais: 'br+ufs+zz' },
  { id: '2026-1t-estadual', ciclo: 'ele2026', ele: 6259, nome: 'Eleição Geral 2026 · 1º turno · Estadual', data: '2026-10-04', turno: 1, cargos: [3, 5, 6, 7, 8], locais: 'ufs' },
  { id: '2024-2t-municipal', ciclo: 'ele2024', ele: 620, nome: 'Eleições Municipais 2024 · 2º turno (capitais)', data: '2024-10-27', turno: 2, cargos: [11], locais: 'capitais' },
  { id: '2024-1t-municipal', ciclo: 'ele2024', ele: 619, nome: 'Eleições Municipais 2024 · 1º turno (capitais)', data: '2024-10-06', turno: 1, cargos: [11, 13], locais: 'capitais' },
];
// 2022 e 2020 não são mais publicados em resultados.tse.jus.br (só os ciclos 2024 e 2026);
// esses anos ficam no Portal de Dados Abertos do TSE, em CSV.

const pad = (v, n) => String(v).padStart(n, '0');
const espera = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), '[histórico]', ...a);

async function baixarJSON(url, tentativas = 15) {
  for (let i = 0; ; i++) {
    let r = null;
    try { r = await fetch(url, { headers: { 'User-Agent': 'apuracao-eleicoes/1.0' } }); } catch { /* rede */ }
    if (r && r.ok) return r.json();
    if (r && r.status !== 429 && r.status < 500) return null; // não existe
    if (i >= tentativas - 1) throw new Error((r ? r.status : 'rede') + ' ' + url);
    await espera(Math.min(30000, 1500 * 1.5 ** i) + Math.random() * 1500);
  }
}

async function emParalelo(itens, limite, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const it = itens[i++]; try { await fn(it); } catch (e) { log('aviso:', e.message); } }
  }));
}

// o TSE usa o mesmo sinalizador para eleito e para quem foi ao 2º turno; a situação em texto distingue
const eleitoPor = st => /eleit/i.test(st || '') && !/não eleit/i.test(st || '');
const num = v => +String(v ?? 0).replace(/\./g, '').replace(',', '.') || 0;

// formato "u" (2024 em diante): carg[].agr[].par[].cand[]
function normalizarU(j) {
  const cands = [], partidos = {};
  for (const a of j.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
    const v = num(c.vap);
    cands.push({ n: c.n, nome: c.nmu, partido: p.sg, votos: v, eleito: eleitoPor(c.st), st: c.st || '' });
    partidos[p.sg] = (partidos[p.sg] || 0) + v;
  }
  return { cands, partidos, s: j.s || {}, e: j.e || {}, v: j.v || {} };
}
// formato "r" simplificado (2020/2022): cand[] na raiz
function normalizarR(j) {
  const cands = [], partidos = {};
  for (const c of j.cand || []) {
    const partido = String(c.cc || '').split(/\s+-\s+|\s*\(/)[0].trim();
    const v = num(c.vap);
    cands.push({ n: c.n, nome: c.nm, partido, votos: v, eleito: eleitoPor(c.st), st: c.st || '' });
    partidos[partido] = (partidos[partido] || 0) + v;
  }
  return {
    cands, partidos, s: { ts: j.s, st: j.st }, e: { te: j.e, c: j.c },
    v: { vb: j.vb, tvn: j.tvn ?? j.vn },
  };
}

function resumir(n, cargo, prop) {
  const validos = n.cands.reduce((a, c) => a + c.votos, 0);
  let cands = n.cands.sort((a, b) => b.votos - a.votos)
    .map(c => ({ ...c, pct: validos ? +(100 * c.votos / validos).toFixed(2) : 0 }));
  // proporcionais têm centenas de candidatos: guarda os 40 mais votados e todos os eleitos
  if (prop) cands = cands.filter((c, i) => i < 40 || c.eleito);
  return {
    secTot: num(n.s.ts), secRec: num(n.s.st), aptos: num(n.e.te), comp: num(n.e.c),
    brancos: num(n.v.vb), nulos: num(n.v.tvn ?? n.v.vn), validos, cands,
    partidos: prop ? Object.entries(n.partidos).sort((a, b) => b[1] - a[1]).map(([sg, votos]) => ({ sg, votos })) : undefined,
  };
}

async function baixarLocal(el, cargo, abr, arquivoBase) {
  const base = `${RAIZ}/${el.ciclo}/${el.ele}`;
  const sufixo = `c${pad(cargo, 4)}-e${pad(el.ele, 6)}`;
  const pasta = abr.slice(0, 2);
  let j = await baixarJSON(`${base}/dados/${pasta}/${arquivoBase}-${sufixo}-u.json`);
  if (j) return resumir(normalizarU(j), cargo, PROPORCIONAL.has(cargo));
  j = await baixarJSON(`${base}/dados-simplificados/${pasta}/${arquivoBase}-${sufixo}-r.json`);
  if (j) return resumir(normalizarR(j), cargo, PROPORCIONAL.has(cargo));
  return null;
}

function locaisDe(el) {
  if (el.locais === 'capitais') return Object.entries(CAPITAIS).map(([uf, cd]) => ({ abr: uf.toLowerCase(), arq: uf.toLowerCase() + cd, uf, mun: cd, tipo: 'mun' }));
  if (el.locais === 'mun') return el.municipios.map(m => ({ abr: m.uf.toLowerCase(), arq: m.uf.toLowerCase() + m.cd, uf: m.uf, mun: m.cd, tipo: 'mun', nome: m.nome }));
  const l = (el.soUF ? [el.soUF] : UFS).map(uf => ({ abr: uf.toLowerCase(), arq: uf.toLowerCase(), uf, tipo: 'uf' }));
  if (el.locais.includes('br')) l.unshift({ abr: 'br', arq: 'br', uf: 'BR', tipo: 'br' });
  if (el.locais.includes('zz')) l.push({ abr: 'zz', arq: 'zz', uf: 'ZZ', tipo: 'zz' });
  return l;
}

async function baixarEleicao(el) {
  const arq = path.join(DIR, `${el.id}.json`);
  try { if (JSON.parse(fs.readFileSync(arq, 'utf8')).completo) return 'cache'; } catch { /* baixa */ }
  const locais = locaisDe(el);
  const cargos = [];
  let falhas = 0;
  for (const cd of el.cargos) {
    const resultados = [];
    await emParalelo(locais, CONCORRENCIA, async l => {
      // cargos estaduais não existem no DF (deputado estadual) nem nos demais para distrital
      if ((cd === 7 && l.uf === 'DF') || (cd === 8 && l.uf !== 'DF')) return;
      try {
        const r = await baixarLocal(el, cd, l.abr, l.arq);
        if (r) resultados.push({ uf: l.uf, mun: l.mun || null, tipo: l.tipo, nome: l.nome || null, ...r });
      } catch (e) { falhas++; throw e; }
    });
    if (resultados.length) cargos.push({ cd, nome: CARGOS[cd] || `Cargo ${cd}`, proporcional: PROPORCIONAL.has(cd), locais: resultados });
  }
  if (!cargos.length) return falhas ? 'falha' : 'indisponivel';
  const doc = { ...el, municipios: undefined, completo: falhas === 0, baixado: new Date().toISOString(), cargos };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(arq + '.tmp', JSON.stringify(doc));
  fs.renameSync(arq + '.tmp', arq);
  return falhas ? 'parcial' : 'ok';
}

// suplementares mais recentes, a partir da configuração geral do TSE
async function suplementares() {
  const cfg = await baixarJSON(`${RAIZ}/comum/config/ele-c.json`);
  const hoje = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const p of cfg?.pl || []) {
    const [d, m, a] = p.dt.split('/');
    const data = `${a}-${m}-${d}`;
    if (data >= hoje) continue;
    for (const e of p.e) {
      if (e.tp !== '4' && e.tp !== '2') continue; // 4 = suplementar municipal, 2 = suplementar estadual
      const abr = e.abr[0];
      const cargos = (abr.cp || []).map(c => +c.cd).filter(c => CARGOS[c]);
      if (!cargos.length) continue;
      const base = { id: `${data}-sup-${e.cd}`, ciclo: p.c, ele: +e.cd, nome: e.nm, data, turno: +e.t, cargos, suplementar: true };
      if (abr.mu?.length) out.push({ ...base, locais: 'mun', municipios: abr.mu.map(m => ({ uf: abr.cd.toUpperCase(), cd: m.cd })) });
      else out.push({ ...base, locais: 'ufs-uma', uf: abr.cd.toUpperCase() });
    }
  }
  return out.sort((a, b) => b.data.localeCompare(a.data) || b.ele - a.ele);
}

async function sincronizarHistorico() {
  fs.mkdirSync(DIR, { recursive: true });
  const indice = [];
  const tentar = async el => {
    const st = await baixarEleicao(el);
    if (st === 'indisponivel') { log(`${el.nome}: não disponível no TSE`); return false; }
    if (st !== 'cache') log(`${el.nome}: ${st}`);
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(DIR, `${el.id}.json`), 'utf8'));
      indice.push({ id: el.id, nome: doc.nome, data: doc.data, turno: doc.turno, suplementar: !!doc.suplementar, completo: doc.completo, cargos: doc.cargos.map(c => ({ cd: c.cd, nome: c.nome })) });
      return true;
    } catch { return false; }
  };
  for (const el of ORDINARIAS) await tentar(el);
  let sup = [];
  try { sup = await suplementares(); } catch (e) { log('aviso suplementares:', e.message); }
  for (const el of sup) {
    if (indice.length >= TOTAL) break;
    if (el.locais === 'ufs-uma') { el.locais = 'ufs'; el.soUF = el.uf; }
    await tentar(el);
  }
  indice.sort((a, b) => b.data.localeCompare(a.data));
  const arq = path.join(DIR, 'indice.json');
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(arq + '.tmp', JSON.stringify({ gerado: new Date().toISOString(), eleicoes: indice.slice(0, TOTAL) }));
  fs.renameSync(arq + '.tmp', arq);
  log(`índice com ${Math.min(TOTAL, indice.length)} eleições`);
}

function iniciarHistorico() {
  const rodar = () => sincronizarHistorico().catch(e => log('erro:', e.message));
  setTimeout(rodar, 5 * 60 * 1000); // começa depois que a apuração ao vivo já fez as primeiras passadas
  setInterval(rodar, 6 * 60 * 60 * 1000); // completa o que faltou a cada 6 h
}

module.exports = { iniciarHistorico, sincronizarHistorico };
if (require.main === module) sincronizarHistorico();
