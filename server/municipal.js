'use strict';
// Eleição municipal ao vivo (prefeitos): ativada sozinha quando a eleição atual do TSE é municipal (2028, 2032...).
// Mesma estratégia da coleta do presidente: o agregado <uf>-e<ele>-ab.json de cada estado diz quais municípios
// mudaram, e só esses são baixados (um arquivo por município). Publica:
//   prefeitos-<t>.json        resumo nacional: totais, prefeituras por partido, estados, capitais e 2º turno
//   prefeitos-<t>-<UF>.json   resultado de cada município do estado
// e guarda o estado da coleta em cache-prefeitos-<t>.json (container interno).
const fs = require('fs');
const path = require('path');

const CARGO = 11; // prefeito
const ORDEM = ['SP', 'MG', 'RJ', 'BA', 'PR', 'RS', 'PE', 'CE', 'PA', 'SC', 'GO', 'MA', 'AM', 'ES', 'PB', 'RN', 'MT', 'AL', 'PI', 'MS', 'SE', 'RO', 'TO', 'AC', 'AP', 'RR']; // DF não tem eleição municipal
const UFS_TESTE = (process.env.MUNICIPAL_UFS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean); // só para testes
const ELEITORADO_FOTOS = +process.env.MUNICIPAL_FOTOS_ELEITORADO || 100000; // fotos só de capitais e cidades grandes

// municípios: código TSE -> [UF, nome, código IBGE, capital]
let MUNICIPIOS = null;
function municipios() {
  if (!MUNICIPIOS) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'municipios.js'), 'utf8');
    MUNICIPIOS = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  }
  return MUNICIPIOS;
}

function criar({ getLote, baixar, emParalelo, gravarJSON, log, armazenamento, lerEstado, CONCORRENCIA, eleicao }) {
  const pad = (v, n) => String(v).padStart(n, '0');
  const estados = {}; // turno -> { UF: { cd: resultado } }
  const estadoDe = t => (estados[t] ||= lerEstado(`cache-prefeitos-${t}.json`) || {});
  const naLista2t = new Set((eleicao.turnos[2]?.municipios || []).map(m => m.cd));

  const resultadoDe = j => {
    const cands = [];
    for (const a of j.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
      const st = c.st || '';
      cands.push({ n: c.n, nome: c.nmu, partido: p.sg, sq: c.sqcand, votos: +c.vap || 0, st, eleito: /eleit/i.test(st) && !/não eleit/i.test(st), turno2: /2º turno/i.test(st) });
    }
    cands.sort((a, b) => b.votos - a.votos);
    return {
      secTot: +j.s.ts, secRec: +j.s.st, aptos: +(j.e.est || 0), comp: +(j.e.c || 0),
      brancos: +(j.v.vb || 0), nulos: +(j.v.tvn || j.v.vn || 0), hora: `${j.dg} ${j.hg}`, cands,
    };
  };

  async function baixarFotos(t, uf, r) {
    const ele = eleicao.turnos[t].ele;
    for (const c of r.cands.slice(0, 3)) {
      const arq = `fotos/${c.sq}.jpeg`;
      if (!/^\d+$/.test(c.sq) || armazenamento.existe(arq)) continue;
      try { armazenamento.gravar(arq, Buffer.from(await (await baixar(`${eleicao.base}/${ele}/fotos/${uf.toLowerCase()}/${c.sq}.jpeg`, 3, 'lote')).arrayBuffer())); }
      catch { /* sem foto: o painel mostra as iniciais */ }
    }
  }

  // ao vivo no dia da votação e até 3 dias depois, enquanto a apuração não termina
  function situacao(t, totais) {
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    const data = eleicao.turnos[t].data;
    const dias = Math.round((Date.parse(hoje) - Date.parse(data)) / 86400000);
    const completa = totais.secTot > 0 && totais.secRec >= totais.secTot;
    return { aoVivo: dias >= 0 && dias <= 3 && !completa, finalizada: completa || dias > 3, dataEleicao: data, verificadoEm: new Date().toISOString() };
  }

  function publicarResumo(t, est) {
    const M = municipios();
    const totais = { secTot: 0, secRec: 0, aptos: 0, comp: 0, municipios: 0, comVotos: 0, apurados: 0, definidos: 0, segundoTurno: 0 };
    const partidos = {}, ufs = {}, capitais = [], segundoTurno = [];
    for (const [uf, muns] of Object.entries(est)) {
      const u = (ufs[uf] = { municipios: 0, comVotos: 0, apurados: 0, secTot: 0, secRec: 0, partidos: {} });
      for (const [cd, r] of Object.entries(muns)) {
        for (const k of ['secTot', 'secRec', 'aptos', 'comp']) totais[k] += r[k] || 0;
        u.secTot += r.secTot || 0; u.secRec += r.secRec || 0;
        totais.municipios++; u.municipios++;
        const lider = r.cands[0];
        if (!lider || !lider.votos) continue;
        totais.comVotos++; u.comVotos++;
        if (r.secTot && r.secRec >= r.secTot) { totais.apurados++; u.apurados++; }
        const eleito = r.cands.find(c => c.eleito);
        const p = (partidos[(eleito || lider).partido] ||= { sg: (eleito || lider).partido, eleitos: 0, lidera: 0 });
        const pu = (u.partidos[(eleito || lider).partido] ||= { eleitos: 0, lidera: 0 });
        if (eleito) { p.eleitos++; pu.eleitos++; totais.definidos++; } else { p.lidera++; pu.lidera++; }
        const v2 = r.cands.filter(c => c.turno2);
        if (v2.length) { totais.segundoTurno++; segundoTurno.push({ uf, cd, nome: M[cd]?.[1] || cd, aptos: r.aptos, cands: v2.map(c => ({ n: c.n, nome: c.nome, partido: c.partido, votos: c.votos })) }); }
        if (M[cd]?.[3]) {
          const validos = r.cands.reduce((a, c) => a + c.votos, 0);
          capitais.push({ uf, cd, nome: M[cd][1], secTot: r.secTot, secRec: r.secRec, validos, cands: r.cands.slice(0, 3).map(({ st, turno2, ...c }) => ({ ...c, turno2 })) });
        }
      }
    }
    totais.situacao = situacao(t, totais);
    // prefeituras por partido na eleição toda: eleitos no 1º turno + resultado do 2º turno onde houve
    const geral = {};
    const e1 = estadoDe('1'), e2 = eleicao.turnos[2] ? estadoDe('2') : {};
    for (const [uf, muns] of Object.entries(e1)) for (const [cd, r1] of Object.entries(muns)) {
      const r = e2[uf]?.[cd]?.cands?.[0]?.votos ? e2[uf][cd] : r1;
      const v = r.cands.find(c => c.eleito) || (r.cands[0]?.votos ? r.cands[0] : null);
      if (!v || (r === r1 && r1.cands.some(c => c.turno2) && !v.eleito)) continue; // vai ao 2º turno e ele ainda não começou
      const g = (geral[v.partido] ||= { sg: v.partido, eleitos: 0, lidera: 0 });
      if (v.eleito) g.eleitos++; else g.lidera++;
    }
    gravarJSON(`prefeitos-${t}.json`, {
      gerado: new Date().toISOString(), ciclo: eleicao.ciclo, ano: eleicao.ano, turno: t, ele: eleicao.turnos[t].ele, data: eleicao.turnos[t].data,
      totais, situacao: totais.situacao,
      partidos: Object.values(partidos).sort((a, b) => (b.eleitos + b.lidera) - (a.eleitos + a.lidera) || b.eleitos - a.eleitos),
      partidosGeral: Object.values(geral).sort((a, b) => (b.eleitos + b.lidera) - (a.eleitos + a.lidera) || b.eleitos - a.eleitos),
      ufs, capitais: capitais.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      segundoTurno: segundoTurno.sort((a, b) => b.aptos - a.aptos),
    });
    return totais;
  }

  async function sincronizar(t) {
    const T = eleicao.turnos[t];
    if (!T) return { semTurno: true };
    const est = estadoDe(t);
    const inicio = Date.now();
    // no 2º turno, só os municípios que têm 2º turno (lista da configuração do TSE)
    const so2t = t === '2' && T.municipios ? new Set(T.municipios.map(m => m.cd)) : null;
    const ufs = ORDEM.filter(uf => (!UFS_TESTE.length || UFS_TESTE.includes(uf)) && (!so2t || T.municipios.some(m => m.uf === uf)));
    let baixados = 0, erros = 0, velhos = 0;
    for (const uf of ufs) {
      const u = uf.toLowerCase();
      let ab;
      try { ab = await getLote(`${eleicao.base}/${T.ele}/dados/${u}/${u}-e${pad(T.ele, 6)}-ab.json`); } catch { erros++; continue; }
      const mun = (est[uf] ||= {});
      const fila = [];
      for (const a of ab.abr || []) {
        if (a.tpabr !== 'mun' || (so2t && !so2t.has(a.cdabr))) continue;
        const st = +(a.s?.st || 0);
        const versao = `${st}|${a.dt} ${a.ht}|${a.e?.c}`;
        const atual = mun[a.cdabr];
        // entra na fila se mudou, se ainda não temos o município, ou se o que temos está atrás do agregado
        if (!atual || atual.v !== versao || (atual.secRec || 0) < st) fila.push({ cd: a.cdabr, versao, st, eleitorado: +(a.e?.est || a.e?.te || 0) });
      }
      if (!fila.length) continue;
      fila.sort((a, b) => b.eleitorado - a.eleitorado); // cidades maiores primeiro
      erros += await emParalelo(fila, CONCORRENCIA, async it => {
        const url = `${eleicao.base}/${T.ele}/dados/${u}/${u}${it.cd}-c${pad(CARGO, 4)}-e${pad(T.ele, 6)}-u.json`;
        let r = resultadoDe(await getLote(url));
        // cópia antiga no CDN do TSE: pede de novo furando o cache
        if (r.secRec < it.st) r = resultadoDe(await getLote(`${url}?t=${Date.now()}`));
        if (r.secRec < it.st) {
          velhos++;
          if (!mun[it.cd] || mun[it.cd].secRec < r.secRec) mun[it.cd] = { ...r, v: null };
          return;
        }
        // arquivo sem a situação dos candidatos (totalização não finalizada), mas o município está na lista do
        // 2º turno da configuração do TSE: os dois mais votados vão para o 2º turno
        if (t === '1' && naLista2t.has(it.cd) && !r.cands.some(c => c.st)) r.cands.slice(0, 2).forEach(c => { c.turno2 = true; c.st = '2º turno'; });
        mun[it.cd] = { ...r, v: it.versao };
        baixados++;
        if (municipios()[it.cd]?.[3] || r.aptos >= ELEITORADO_FOTOS) baixarFotos(t, uf, r).catch(() => {});
      });
      gravarJSON(`prefeitos-${t}-${uf}.json`, { gerado: new Date().toISOString(), uf, turno: t, municipios: Object.fromEntries(Object.entries(mun).map(([cd, { v, ...r }]) => [cd, r])) });
      gravarJSON(`cache-prefeitos-${t}.json`, est);
    }
    const totais = publicarResumo(t, est);
    if (baixados || erros || velhos) log(`prefeitos ${t}º turno: ${baixados} municípios atualizados, ${velhos} com cópia antiga do TSE, ${erros} falhas em ${((Date.now() - inicio) / 1000).toFixed(0)}s`);
    return {
      municipiosComVotos: totais.comVotos, municipiosApurados: totais.apurados, prefeitosDefinidos: totais.definidos,
      secoesApuradas: totais.secRec, secoesTotal: totais.secTot, atualizadosNestaPassada: baixados, aguardandoCopiaNova: velhos, falhas: erros,
    };
  }

  return { sincronizar };
}

module.exports = { criar };
