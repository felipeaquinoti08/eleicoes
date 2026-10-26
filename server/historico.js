'use strict';
// Histórico: baixa uma vez os resultados das últimas eleições (gerais por UF, municipais nas capitais
// e as suplementares mais recentes) e grava dados/historico/<id>.json num formato único.
const fs = require('fs');
const path = require('path');
const armazenamento = require('./armazenamento');

const RAIZ = 'https://resultados.tse.jus.br/oficial';
// tudo o que é baixado ou gerado fica em historico/ (pasta local ou Azure Blob, via server/armazenamento.js)
const P = 'historico/';
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
  { id: '2026-2t-federal', ciclo: 'ele2026', ele: 6258, nome: 'Eleição Geral 2026 · 2º turno · Federal', data: '2026-10-25', turno: 2, cargos: [1], locais: 'br+ufs+zz' },
  { id: '2026-2t-estadual', ciclo: 'ele2026', ele: 6260, nome: 'Eleição Geral 2026 · 2º turno · Estadual', data: '2026-10-25', turno: 2, cargos: [3], locais: 'ufs' },
  { id: '2026-1t-federal', ciclo: 'ele2026', ele: 6257, nome: 'Eleição Geral 2026 · 1º turno · Federal', data: '2026-10-04', turno: 1, cargos: [1], locais: 'br+ufs+zz' },
  { id: '2026-1t-estadual', ciclo: 'ele2026', ele: 6259, nome: 'Eleição Geral 2026 · 1º turno · Estadual', data: '2026-10-04', turno: 1, cargos: [3, 5, 6, 7, 8], locais: 'ufs' },
  { id: '2024-2t-municipal', ciclo: 'ele2024', ele: 620, nome: 'Eleições Municipais 2024 · 2º turno (capitais)', data: '2024-10-27', turno: 2, cargos: [11], locais: 'capitais' },
  { id: '2024-1t-municipal', ciclo: 'ele2024', ele: 619, nome: 'Eleições Municipais 2024 · 1º turno (capitais)', data: '2024-10-06', turno: 1, cargos: [11, 13], locais: 'capitais' },
];
// Anos que resultados.tse.jus.br não publica mais (2022 para trás) vêm do Portal de Dados Abertos do TSE, já
// resumidos em server/historico-base (gerados por tools/importar-dados-abertos.js) e embutidos na imagem.
// Os documentos de lá também servem de ponto de partida: o histórico aparece assim que o servidor sobe.
const BASE_DIR = path.join(__dirname, 'historico-base');

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
    cands.push({ n: c.n, nome: c.nmu, partido: p.sg, sq: c.sqcand, votos: v, eleito: eleitoPor(c.st), st: c.st || '' });
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
  const arq = `${P}${el.id}.json`;
  if ((await armazenamento.lerJSONAsync(arq))?.completo && armazenamento.info(arq)?.origem !== 'base') return 'cache';
  try { if (JSON.parse(fs.readFileSync(path.join(BASE_DIR, `${el.id}.json`), 'utf8')).completo) return 'base'; } catch { /* baixa */ }
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
  // só fica "completo" (e deixa de ser baixado de novo) com a apuração encerrada em todos os locais
  const encerrada = cargos.every(c => c.locais.every(l => l.secTot > 0 && l.secRec >= l.secTot));
  const doc = { ...el, municipios: undefined, completo: falhas === 0 && encerrada, baixado: new Date().toISOString(), cargos };
  armazenamento.gravarJSON(arq, doc);
  return falhas ? 'parcial' : 'ok';
}

// eleições ordinárias publicadas na configuração do TSE (federal, estadual e municipal, de cada turno). A cada eleição
// nova o TSE acrescenta a dela ali, e ela passa a ser baixada sem mudar o código; a lista fixa acima continua valendo.
const TIPO_ORDINARIA = { 8: 'federal', 1: 'estadual', 3: 'municipal' };
async function ordinariasDaConfiguracao() {
  const cfg = await baixarJSON(`${RAIZ}/comum/config/ele-c.json`);
  const hoje = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const p of cfg?.pl || []) {
    const data = p.dt.split('/').reverse().join('-');
    if (data > hoje) continue; // eleição futura: ainda não há resultado
    for (const e of p.e || []) {
      const tipo = TIPO_ORDINARIA[e.tp];
      if (!tipo || !/Ordinária/i.test(e.nm || '')) continue;
      const cargos = [...new Set((e.abr || []).flatMap(a => (a.cp || []).map(c => +c.cd)))].filter(c => CARGOS[c]);
      if (!cargos.length) continue;
      const ano = data.slice(0, 4);
      const nomeTipo = { federal: 'Federal', estadual: 'Estadual' }[tipo];
      out.push({
        id: `${ano}-${e.t}t-${tipo}`, ciclo: p.c, ele: +e.cd, data, turno: +e.t, cargos,
        nome: tipo === 'municipal' ? `Eleições Municipais ${ano} · ${e.t}º turno (capitais)` : `Eleição Geral ${ano} · ${e.t}º turno · ${nomeTipo}`,
        locais: tipo === 'federal' ? 'br+ufs+zz' : tipo === 'estadual' ? 'ufs' : 'capitais',
      });
    }
  }
  return out;
}

// Detalhamento municipal a partir do que o painel coletou ao vivo (presidente e governador do 2º turno), para
// eleições que já terminaram e ainda não têm o detalhe embutido (os Dados Abertos demoram a publicar).
async function exportarMunicipiosDoAoVivo() {
  const ano = require('./eleicao-atual').obter().ano; // eleição acompanhada ao vivo
  const tarefas = [
    { id: `${ano}-2t-federal`, cd: 1, ler: () => armazenamento.lerJSON('cache-mun-2.json') },
    { id: `${ano}-1t-federal`, cd: 1, ler: () => armazenamento.lerJSON('cache-mun-1.json') },
    { id: `${ano}-2t-estadual`, cd: 3, ler: () => { const g = armazenamento.lerJSON('cache-gov-2.json'); return g && Object.fromEntries(Object.entries(g.ufs || {}).map(([uf, e]) => [uf, e.municipios || {}])); } },
  ];
  let exportados = 0;
  for (const t of tarefas) {
    let doc = await armazenamento.lerJSONAsync(`${P}${t.id}.json`);
    if (!doc) { try { doc = JSON.parse(fs.readFileSync(path.join(BASE_DIR, `${t.id}.json`), 'utf8')); } catch { /* não existe */ } }
    if (!doc || !doc.completo) continue;
    const cargo = doc.cargos.find(c => c.cd === t.cd);
    if (!cargo) continue;
    if (fs.existsSync(path.join(BASE_DIR, 'mun', t.id, `${t.cd}-SP.json`)) || fs.existsSync(path.join(BASE_DIR, 'mun', t.id, `${t.cd}-DF.json`))) continue; // já embutido
    const porUF = t.ler();
    if (!porUF) continue;
    let n = 0;
    for (const [uf, muns] of Object.entries(porUF)) {
      const local = cargo.locais.find(l => l.uf === uf && !l.mun);
      if (!local || !Object.keys(muns).length) continue;
      // municípios totalmente apurados apenas (dado final)
      if (Object.values(muns).some(m => m.secTot && m.secRec < m.secTot)) continue;
      const cands = local.cands.map(c => ({ n: c.n, nome: c.nome, partido: c.partido }));
      const mun = {};
      for (const [cd, m] of Object.entries(muns)) mun[cd] = { v: cands.map(c => m.votos?.[c.n] || 0), c: m.comp, a: m.aptos, b: m.brancos, nu: m.nulos, s: m.secTot };
      armazenamento.gravarJSON(`${P}mun/${t.id}/${t.cd}-${uf}.json`, { cargo: t.cd, uf, cands, mun, fonte: 'coleta ao vivo do painel' });
      n++;
    }
    if (n) exportados += n;
  }
  // eleição municipal: prefeitos de todos os municípios, a partir da coleta de server/municipal.js
  for (const t of ['1', '2']) {
    const id = `${ano}-${t}t-municipal`;
    if (fs.existsSync(path.join(BASE_DIR, 'mun', id))) continue; // já embutido
    const doc = await armazenamento.lerJSONAsync(`${P}${id}.json`);
    const est = armazenamento.lerJSON(`cache-prefeitos-${t}.json`);
    if (!doc?.completo || !est) continue;
    for (const [uf, muns] of Object.entries(est)) {
      if (!Object.keys(muns).length || Object.values(muns).some(m => m.secTot && m.secRec < m.secTot)) continue;
      const mun = {};
      for (const [cd, m] of Object.entries(muns)) {
        mun[cd] = { r: m.cands.map(c => [c.n, c.nome, c.partido, c.votos, c.st]), c: m.comp, a: m.aptos, b: m.brancos, nu: m.nulos, s: m.secTot };
      }
      armazenamento.gravarJSON(`${P}mun/${id}/11-${uf}.json`, { cargo: 11, uf, mun, fonte: 'coleta ao vivo do painel' });
      exportados++;
    }
  }
  return exportados;
}

// cargos com detalhamento municipal disponível (embutido ou exportado) para um documento
function cargosComMunicipios(id) {
  const cds = new Set();
  let embutidos = [];
  try { embutidos = fs.readdirSync(path.join(BASE_DIR, 'mun', id)); } catch { /* sem detalhe embutido */ }
  const gerados = armazenamento.listar(`${P}mun/${id}/`).map(n => n.slice(n.lastIndexOf('/') + 1));
  for (const n of [...embutidos, ...gerados]) { const m = /^(\d+)-[A-Z]{2}\.json$/.exec(n); if (m) cds.add(+m[1]); }
  return [...cds];
}

// estado do histórico, mostrado no /saude
const statusHistorico = { ultimaPassada: null, proxima: null, novasNaUltimaPassada: [], pendentes: [], erro: null, baseEnviada: null };
let ultimoIndice = null;
function status() {
  const indice = ultimoIndice;
  const lista = indice?.eleicoes || [];
  const ordinarias = lista.filter(e => !e.suplementar);
  const grupos = [...new Set(ordinarias.map(e => e.grupoNome))];
  return {
    ...statusHistorico,
    indiceGerado: indice?.gerado || null,
    eleicoes: grupos.length, documentos: ordinarias.length, suplementares: lista.length - ordinarias.length,
    maisRecente: grupos[0] || null, maisAntiga: grupos[grupos.length - 1] || null,
  };
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

// grupo de uma eleição no histórico: Eleições Gerais <ano>, Eleições Municipais <ano> ou suplementares
function grupoDe(doc) {
  if (doc.suplementar) return { grupo: 'suplementares', grupoNome: 'Eleições suplementares', ano: +doc.data.slice(0, 4), tipo: 'suplementar' };
  const m = /^(\d{4})-(\d)t-(federal|estadual|municipal)$/.exec(doc.id);
  if (!m) return { grupo: doc.id, grupoNome: doc.nome, ano: +doc.data.slice(0, 4), tipo: 'outra' };
  const municipal = m[3] === 'municipal';
  return { grupo: `${municipal ? 'municipal' : 'geral'}-${m[1]}`, grupoNome: `Eleições ${municipal ? 'Municipais' : 'Gerais'} ${m[1]}`, ano: +m[1], tipo: municipal ? 'municipal' : 'geral', abrangencia: m[3] };
}

// índice com tudo o que existe: a base embutida e o que foi baixado (o baixado vence quando os dois existem)
const docsLidos = new Map(); // nome -> { em, doc }: não relê do Blob o que não mudou
async function montarIndice() {
  const docs = new Map();
  for (const n of fs.readdirSync(BASE_DIR).filter(n => n.endsWith('.json'))) {
    try { const d = JSON.parse(fs.readFileSync(path.join(BASE_DIR, n), 'utf8')); docs.set(d.id, d); } catch { /* ignora */ }
  }
  for (const nome of armazenamento.listar(P).filter(n => /^historico\/[^/]+\.json$/.test(n) && n !== `${P}indice.json`)) {
    if (armazenamento.info(nome)?.origem === 'base') continue; // cópia da base, já lida acima
    const em = armazenamento.quando(nome);
    let d = docsLidos.get(nome)?.em === em ? docsLidos.get(nome).doc : null;
    if (!d) { d = await armazenamento.lerJSONAsync(nome); if (d) docsLidos.set(nome, { em, doc: d }); }
    if (d?.id) docs.set(d.id, d);
  }
  let sup = 0;
  const lista = [...docs.values()].sort((a, b) => b.data.localeCompare(a.data) || b.id.localeCompare(a.id))
    .filter(d => !d.suplementar || ++sup <= TOTAL)
    .map(d => ({
      id: d.id, nome: d.nome, data: d.data, turno: d.turno, suplementar: !!d.suplementar, completo: d.completo,
      fonte: d.fonte || 'Sistema de resultados do TSE', cargos: d.cargos.map(c => ({ cd: c.cd, nome: c.nome })), ...grupoDe(d),
      municipais: cargosComMunicipios(d.id), // cargos com detalhamento por município
    }));
  ultimoIndice = { gerado: new Date().toISOString(), eleicoes: lista };
  armazenamento.gravarJSON(`${P}indice.json`, ultimoIndice);
  return lista;
}

// No Azure Blob o navegador lê tudo de lá, então a base embutida na imagem também é enviada. Vai só o que falta ou
// o que mudou numa imagem nova; um documento que o servidor baixou do TSE (sem a marca de origem) não é sobrescrito.
function publicarBase() {
  if (armazenamento.MODO !== 'azure') return 0;
  let n = 0;
  const andar = rel => {
    for (const d of fs.readdirSync(path.join(BASE_DIR, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) { andar(r); continue; }
      if (!d.name.endsWith('.json')) continue;
      const nome = `${P}${r}`, atual = armazenamento.info(nome);
      if (atual && atual.origem !== 'base') continue;
      const buf = fs.readFileSync(path.join(BASE_DIR, r));
      if (atual && atual.md5 === armazenamento.md5(buf)) continue;
      armazenamento.gravar(nome, buf, 'base');
      n++;
    }
  };
  andar('');
  statusHistorico.baseEnviada = { em: new Date().toISOString(), arquivos: n };
  return n;
}

async function sincronizarHistorico() {
  // lista fixa + o que a configuração do TSE tiver de novo
  const ordinarias = new Map(ORDINARIAS.map(el => [el.id, el]));
  try { for (const el of await ordinariasDaConfiguracao()) if (!ordinarias.has(el.id)) ordinarias.set(el.id, el); }
  catch (e) { log('aviso: configuração do TSE indisponível para eleições novas:', e.message); }
  const novas = [], pendentes = [];
  for (const el of ordinarias.values()) {
    const st = await baixarEleicao(el);
    if (st === 'indisponivel') log(`${el.nome}: não disponível no TSE`);
    else if (st !== 'cache' && st !== 'base') { log(`${el.nome}: ${st}`); novas.push(el.nome); }
    const baixado = armazenamento.info(`${P}${el.id}.json`)?.origem === 'base' ? null : await armazenamento.lerJSONAsync(`${P}${el.id}.json`);
    if (baixado && !baixado.completo) pendentes.push(el.nome);
  }
  Object.assign(statusHistorico, { novasNaUltimaPassada: novas, pendentes });
  let sup = [];
  try { sup = await suplementares(); } catch (e) { log('aviso suplementares:', e.message); }
  for (const el of sup.slice(0, TOTAL)) {
    if (el.locais === 'ufs-uma') { el.locais = 'ufs'; el.soUF = el.uf; }
    const st = await baixarEleicao(el);
    if (st !== 'cache' && st !== 'base' && st !== 'indisponivel') log(`${el.nome}: ${st}`);
  }
  try { const n = await exportarMunicipiosDoAoVivo(); if (n) log(`detalhamento municipal exportado da coleta ao vivo: ${n} arquivos`); } catch (e) { log('aviso exportação municipal:', e.message); }
  const lista = await montarIndice();
  log(`índice com ${lista.length} eleições (${lista.filter(e => !e.suplementar).length} ordinárias, ${lista.filter(e => e.suplementar).length} suplementares)`);
}

function iniciarHistorico() {
  // o índice sai na hora com a base embutida e o que já foi baixado; os downloads vêm depois
  try { const n = publicarBase(); if (n) log(`base embutida enviada ao Azure Blob: ${n} arquivos`); } catch (e) { log('erro ao enviar a base:', e.message); }
  montarIndice().then(l => log(`índice inicial com ${l.length} eleições`)).catch(e => log('erro no índice inicial:', e.message));
  const INTERVALO = 6 * 60 * 60 * 1000;
  const rodar = async () => {
    try { await sincronizarHistorico(); statusHistorico.erro = null; }
    catch (e) { statusHistorico.erro = e.message; log('erro:', e.message); }
    statusHistorico.ultimaPassada = new Date().toISOString();
    statusHistorico.proxima = new Date(Date.now() + INTERVALO).toISOString();
  };
  statusHistorico.proxima = new Date(Date.now() + 60 * 1000).toISOString();
  setTimeout(rodar, 60 * 1000); // começa depois que a apuração ao vivo já fez a primeira passada
  setInterval(rodar, INTERVALO); // confere eleições novas e completa o que faltou a cada 6 h
}

module.exports = { iniciarHistorico, sincronizarHistorico, status, exportarMunicipiosDoAoVivo, montarIndice };
if (require.main === module) armazenamento.iniciar().then(sincronizarHistorico);
