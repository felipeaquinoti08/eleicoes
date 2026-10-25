'use strict';
// Projeção do 2º turno a partir do 1º turno.
//
// Unidades: municípios do Brasil (o TSE não publica o Brasil por seção) e seções do exterior (BU dos dois turnos).
// Cada unidade apurada no 2º turno é comparada com ela mesma no 1º turno. Para cada estrato
// (UF × capital/interior, e o exterior) calcula-se, por candidato, a razão
//     votos no 2º turno / votos do mesmo candidato no 1º turno, na parte já apurada,
// o que captura de uma vez para onde foram os votos dos outros candidatos e a mudança de comparecimento.
// A parte que falta de cada unidade é projetada com o 1º turno dela multiplicado pela razão do seu estrato.
// Estratos com pouca base usam a razão da UF, depois da região, depois do país.
//
// Faixa: reamostragem (bootstrap) das unidades apuradas dentro de cada estrato, somada a uma margem
// mínima conservadora que encolhe conforme a apuração avança. O modelo não foi testado com apurações
// passadas (2014-2022 não estão mais no sistema do TSE), por isso é apresentado como experimental.

const REGIAO = {
  AC: 'N', AM: 'N', AP: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N', AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE',
  PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE', DF: 'CO', GO: 'CO', MS: 'CO', MT: 'CO', ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
  PR: 'S', RS: 'S', SC: 'S', ZZ: 'ZZ',
};
const BASE_MINIMA = 3000;   // votos válidos do 1º turno (na parte apurada) para o estrato usar a própria razão
const REPLICAS = 300;
const PESO_MINIMO = 0.02;   // só projeta com ao menos 2% do eleitorado (peso do 1º turno) apurado
const MARGEM_MAX = 3;       // margem mínima (pontos) com 0% apurado; cai linearmente até 0 com 100%

const soma = (o, ks) => ks.reduce((a, k) => a + (o[k] || 0), 0);

// unidades: [{ estrato, uf, f (fração apurada), v1: {cand: votos}, v2: {cand: votos} }]
function montarUnidades({ mun1, mun2, municipios, bu1, bu2 }) {
  const unidades = [];
  for (const [cd, [uf, , , capital]] of Object.entries(municipios)) {
    const a = mun1[uf]?.[cd], b = mun2[uf]?.[cd];
    if (!a && !b) continue;
    const f = b && b.secTot ? Math.min(1, b.secRec / b.secTot) : 0;
    unidades.push({ estrato: `${uf}-${capital ? 'cap' : 'int'}`, uf, f, v1: a?.votos || {}, v2: b?.votos || {} });
  }
  // exterior: seção a seção, então a fração é 0 ou 1
  for (const [chave, e1] of Object.entries(bu1)) {
    if (!e1?.r) continue;
    const e2 = bu2[chave];
    unidades.push({ estrato: 'ZZ', uf: 'ZZ', f: e2?.r ? 1 : 0, v1: e1.r.votos, v2: e2?.r?.votos || {} });
  }
  for (const [chave, e2] of Object.entries(bu2)) { // seções sem BU no 1º turno: entram só com o que foi apurado
    if (e2?.r && !bu1[chave]?.r) unidades.push({ estrato: 'ZZ', uf: 'ZZ', f: 1, v1: {}, v2: e2.r.votos });
  }
  return unidades;
}

function razoes(apuradas, cands, todosCands1) {
  // acumula numerador/denominador por nível: estrato, UF, região, país
  const ac = {};
  const add = (nivel, u) => {
    const r = (ac[nivel] ||= { base: 0, num: {}, den: {} });
    r.base += u.f * soma(u.v1, todosCands1);
    for (const c of cands) { r.num[c] = (r.num[c] || 0) + (u.v2[c] || 0); r.den[c] = (r.den[c] || 0) + u.f * (u.v1[c] || 0); }
  };
  for (const u of apuradas) { add('e:' + u.estrato, u); add('u:' + u.uf, u); add('r:' + REGIAO[u.uf], u); if (u.uf !== 'ZZ') add('br', u); }
  return (u) => {
    for (const nivel of ['e:' + u.estrato, 'u:' + u.uf, 'r:' + REGIAO[u.uf], 'br']) {
      const r = ac[nivel];
      if (r && r.base >= BASE_MINIMA && cands.every(c => r.den[c] > 0)) return Object.fromEntries(cands.map(c => [c, r.num[c] / r.den[c]]));
    }
    return null;
  };
}

function projetarCom(unidades, apuradas, cands, todosCands1) {
  const razaoDe = razoes(apuradas, cands, todosCands1);
  const porUF = {};
  for (const u of unidades) {
    const p = (porUF[u.uf] ||= Object.fromEntries(cands.map(c => [c, 0])));
    const rz = u.f < 1 ? razaoDe(u) : null;
    for (const c of cands) p[c] += (u.v2[c] || 0) + (rz ? (1 - u.f) * (u.v1[c] || 0) * rz[c] : 0);
  }
  return porUF;
}

const pcts = (votos, cands) => {
  const t = soma(votos, cands);
  return Object.fromEntries(cands.map(c => [c, t ? 100 * votos[c] / t : 0]));
};
const juntar = (porUF, ufs, cands) => {
  const v = Object.fromEntries(cands.map(c => [c, 0]));
  for (const uf of ufs) if (porUF[uf]) for (const c of cands) v[c] += porUF[uf][c];
  return v;
};

function percentil(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}

function calcular(entrada) {
  const cands = entrada.cands.map(String);          // os dois do 2º turno
  const todosCands1 = entrada.cands1.map(String);   // todos do 1º turno (base de peso)
  const unidades = montarUnidades(entrada);
  const apuradas = unidades.filter(u => u.f > 0);

  const pesoTotal = unidades.reduce((a, u) => a + soma(u.v1, todosCands1), 0);
  const pesoApurado = apuradas.reduce((a, u) => a + u.f * soma(u.v1, todosCands1), 0);
  const w = pesoTotal ? pesoApurado / pesoTotal : 0;
  const base = { gerado: new Date().toISOString(), experimental: true, pesoApurado: +(100 * w).toFixed(2), unidadesApuradas: apuradas.length };
  if (w < PESO_MINIMO) return { ...base, disponivel: false, motivo: `aguardando ao menos ${100 * PESO_MINIMO}% do eleitorado apurado` };

  const ufs = [...new Set(unidades.map(u => u.uf))];
  const escopos = { total: ufs, brasil: ufs.filter(u => u !== 'ZZ'), ...Object.fromEntries(ufs.map(u => [u, [u]])) };

  const central = projetarCom(unidades, apuradas, cands, todosCands1);

  // bootstrap: reamostra as unidades apuradas dentro de cada estrato
  const porEstrato = {};
  for (const u of apuradas) (porEstrato[u.estrato] ||= []).push(u);
  const grupos = Object.values(porEstrato);
  const amostras = Object.fromEntries(Object.keys(escopos).map(k => [k, []]));
  let semente = 12345;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let b = 0; b < REPLICAS; b++) {
    const reamostra = [];
    for (const g of grupos) for (let i = 0; i < g.length; i++) reamostra.push(g[Math.floor(aleatorio() * g.length)]);
    const r = projetarCom(unidades, reamostra, cands, todosCands1);
    for (const [k, lista] of Object.entries(escopos)) amostras[k].push(pcts(juntar(r, lista, cands), cands)[cands[0]]);
  }

  const resultado = {};
  for (const [k, lista] of Object.entries(escopos)) {
    const doEscopo = unidades.filter(u => lista.includes(u.uf));
    const pt = doEscopo.reduce((a, u) => a + soma(u.v1, todosCands1), 0);
    const pa = doEscopo.reduce((a, u) => a + u.f * soma(u.v1, todosCands1), 0);
    const wk = pt ? pa / pt : 0;
    const margemMin = MARGEM_MAX * (1 - wk);
    const votos = juntar(central, lista, cands);
    const p = pcts(votos, cands);
    const a = p[cands[0]];
    // faixa = bootstrap 90%, alargada até a margem mínima conservadora
    let lo = Math.min(percentil(amostras[k], 0.05), a - margemMin);
    let hi = Math.max(percentil(amostras[k], 0.95), a + margemMin);
    lo = Math.max(0, lo); hi = Math.min(100, hi);
    const vencedor = lo > 50 ? cands[0] : hi < 50 ? cands[1] : null;
    resultado[k] = {
      votos: Object.fromEntries(cands.map(c => [c, Math.round(votos[c])])),
      pct: Object.fromEntries(cands.map(c => [c, +p[c].toFixed(2)])),
      // faixa do primeiro candidato; a do segundo é o complemento (100 - hi, 100 - lo)
      faixa: { [cands[0]]: [+lo.toFixed(2), +hi.toFixed(2)], [cands[1]]: [+(100 - hi).toFixed(2), +(100 - lo).toFixed(2)] },
      vencedor,
      pesoApurado: +(100 * wk).toFixed(2),
    };
  }
  return { ...base, disponivel: true, candidatos: cands, escopos: resultado };
}

module.exports = { calcular };
