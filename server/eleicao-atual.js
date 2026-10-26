'use strict';
// Qual é a eleição "atual" do painel ao vivo, descoberta na configuração pública do TSE (comum/config/ele-c.json).
// A cada eleição o TSE acrescenta ali o ciclo novo (ele2028, ele2030...) com os códigos de cada turno; o painel passa
// a acompanhá-lo sozinho, sem mudar o código. Entre uma eleição e outra continua mostrando a última.
//
// Tipos de eleição na configuração: 8 = ordinária federal (presidente), 1 = ordinária estadual (governador, senador,
// deputados), 3 = ordinária municipal (prefeito, vereador); 2 e 4 = suplementares (tratadas em suplementares.js).
const armazenamento = require('./armazenamento');

const RAIZ = 'https://resultados.tse.jus.br/oficial';
// o ciclo novo vira o atual alguns dias antes do 1º turno (o TSE publica a configuração antes da votação)
const ANTECEDENCIA_DIAS = +process.env.ELEICAO_ANTECEDENCIA_DIAS || 3;
const FORCAR = (process.env.ELEICAO_CICLO || '').trim(); // ex.: ele2024, para testes

// usada só se o TSE estiver fora do ar na primeira subida e nada tiver sido gravado antes
const PADRAO = {
  id: 'ele2026', ciclo: 'ele2026', ano: 2026, tipo: 'geral', base: `${RAIZ}/ele2026`,
  turnos: { 1: { ele: 6257, pleito: 3220, data: '2026-10-04' }, 2: { ele: 6258, pleito: 3221, data: '2026-10-25' } },
  estadual: { 1: { ele: 6259, pleito: 3220, data: '2026-10-04' }, 2: { ele: 6260, pleito: 3221, data: '2026-10-25', ufs: ['AM', 'RN', 'DF', 'ES', 'AC', 'TO'] } },
  municipal: null, origem: 'padrão',
};

const dataISO = dmy => { const [d, m, a] = dmy.split('/'); return `${a}-${m}-${d}`; };

// monta a descrição de um ciclo a partir da configuração do TSE
function descreverCiclo(cfg, ciclo) {
  const turnos = {}, estadual = {}, municipal = {};
  for (const p of cfg.pl || []) {
    if (p.c !== ciclo) continue;
    for (const e of p.e || []) {
      const t = +e.t, base = { ele: +e.cd, pleito: +p.cd, data: dataISO(p.dt) };
      const ufs = (e.abr || []).map(a => a.cd.toUpperCase()).filter(u => u !== 'BR');
      if (e.tp === '8') turnos[t] = base;
      else if (e.tp === '1') estadual[t] = { ...base, ufs };
      else if (e.tp === '3' && /Ordin/i.test(e.nm || '')) {
        // no 2º turno municipal, a abrangência traz os municípios que têm 2º turno
        const muns = (e.abr || []).flatMap(a => (a.mu || []).map(m => ({ uf: a.cd.toUpperCase(), cd: m.cd })));
        municipal[t] = { ...base, cargos: [...new Set((e.abr || []).flatMap(a => (a.cp || []).map(c => +c.cd)))], ...(t === 2 ? { municipios: muns } : {}) };
      }
    }
  }
  const tipo = Object.keys(turnos).length ? 'geral' : Object.keys(municipal).length ? 'municipal' : null;
  if (!tipo) return null;
  return {
    id: ciclo, ciclo, ano: +ciclo.replace(/\D/g, ''), tipo, base: `${RAIZ}/${ciclo}`,
    turnos: tipo === 'geral' ? turnos : municipal,
    estadual: tipo === 'geral' && Object.keys(estadual).length ? estadual : null,
    municipal: tipo === 'municipal' ? municipal : null,
  };
}

// escolhe o ciclo ordinário mais recente cujo 1º turno já chegou (ou está a poucos dias)
function escolher(cfg, hoje = new Date()) {
  const limite = new Date(hoje.getTime() + ANTECEDENCIA_DIAS * 86400000).toISOString().slice(0, 10);
  const ciclos = new Map(); // ciclo -> data do 1º turno da eleição ordinária
  for (const p of cfg.pl || []) {
    for (const e of p.e || []) {
      if (!['8', '1', '3'].includes(e.tp) || e.t !== '1' || (e.tp === '3' && !/Ordin/i.test(e.nm || ''))) continue;
      const d = dataISO(p.dt);
      if (!ciclos.has(p.c) || d < ciclos.get(p.c)) ciclos.set(p.c, d);
    }
  }
  const candidatos = [...ciclos.entries()].filter(([c, d]) => (FORCAR ? c === FORCAR : d <= limite)).sort((a, b) => b[1].localeCompare(a[1]));
  for (const [c] of candidatos) {
    const desc = descreverCiclo(cfg, c);
    if (desc) return desc;
  }
  return null;
}

let atual = null;
let verificadoEm = null, erro = null;

// lê a configuração do TSE; em falha, fica com o que já sabia (gravado) ou com o padrão
async function atualizar() {
  try {
    const r = await fetch(`${RAIZ}/comum/config/ele-c.json`, { signal: AbortSignal.timeout(30000), headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const desc = escolher(await r.json());
    if (!desc) throw new Error('nenhuma eleição ordinária na configuração do TSE');
    const mudou = atual && atual.id !== desc.id;
    atual = { ...desc, origem: 'TSE' };
    verificadoEm = new Date().toISOString(); erro = null;
    armazenamento.gravarJSON('eleicao.json', atual);
    return { mudou };
  } catch (e) {
    erro = e.message;
    if (!atual) atual = armazenamento.lerJSON('eleicao.json') || PADRAO;
    return { mudou: false };
  }
}

const obter = () => atual || armazenamento.lerJSON('eleicao.json') || PADRAO;
const status = () => ({ id: obter().id, tipo: obter().tipo, origem: obter().origem, verificadoEm, erro, forcado: FORCAR || null });

module.exports = { atualizar, obter, status, escolher, descreverCiclo, PADRAO };
