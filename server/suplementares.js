'use strict';
// Eleições suplementares do dia (prefeito, vereador ou governador fora de época), lidas da configuração do TSE.
// Publica dados/sup-hoje.json com os candidatos e o resultado de cada uma, atualizado a cada passada.

const RAIZ = 'https://resultados.tse.jus.br/oficial';
const NOME_CARGO = { 3: 'Governador', 11: 'Prefeito', 13: 'Vereador' };

function criar({ getJSON, baixar, gravarJSON, log, armazenamento }) {
  const pad = (v, n) => String(v).padStart(n, '0');
  let lista = null, listaDia = '';
  const estado = {}; // chave -> { hora, ... }

  // hoje no fuso de Brasília (aaaa-mm-dd); entram as suplementares dos últimos DIAS dias (as de hoje, ao vivo) e as de
  // amanhã, para a coleta já entrar no ritmo de eleição na véspera (fora de eleição ela roda só 2 vezes ao dia)
  const DIAS = +process.env.SUPLEMENTARES_DIAS || 7;
  const hojeISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const hojeBR = hojeISO;
  const iso = dt => dt.split('/').reverse().join('-');

  async function descobrir() {
    const hoje = hojeBR();
    if (lista && listaDia === hoje) return lista;
    const cfg = await getJSON(`${RAIZ}/comum/config/ele-c.json`);
    const out = [];
    for (const p of cfg.pl || []) {
      const dias = Math.round((Date.parse(hoje) - Date.parse(iso(p.dt))) / 86400000);
      if (dias < -1 || dias > DIAS) continue;
      for (const e of p.e || []) {
        if (e.tp !== '4' && e.tp !== '2') continue; // 4 = suplementar municipal, 2 = suplementar estadual
        for (const a of e.abr || []) for (const cp of a.cp || []) {
          if (!NOME_CARGO[+cp.cd]) continue;
          const uf = a.cd.toUpperCase();
          const muns = (a.mu || []).map(m => m.cd);
          for (const mun of muns.length ? muns : [null]) {
            out.push({ ciclo: p.c, ele: +e.cd, nome: e.nm, uf, mun, cargo: +cp.cd, cargoNome: NOME_CARGO[+cp.cd], data: iso(p.dt), hoje: dias === 0 });
          }
        }
      }
    }
    lista = out; listaDia = hoje;
    if (out.length) log(`suplementares recentes: ${out.map(x => `${x.cargoNome} ${x.nome.replace('Eleição Suplementar - ', '')} (${x.uf})`).join(', ')}`);
    return out;
  }

  const candidatosDe = j => {
    const out = [];
    for (const a of j.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
      out.push({ n: c.n, nome: c.nmu, partido: p.sg, sq: c.sqcand, vap: +c.vap, st: c.st || '', eleito: /eleit/i.test(c.st || '') && !/não eleit/i.test(c.st || '') });
    }
    return out;
  };

  async function baixarFotos(s, cands) {
    for (const c of cands) {
      const arq = `fotos/${c.sq}.jpeg`;
      if (!/^\d+$/.test(c.sq) || armazenamento.existe(arq)) continue;
      for (const pasta of [s.uf.toLowerCase(), 'br']) {
        try { armazenamento.gravar(arq, Buffer.from(await (await baixar(`${RAIZ}/${s.ciclo}/${s.ele}/fotos/${pasta}/${c.sq}.jpeg`, 3)).arrayBuffer())); break; }
        catch { /* tenta a outra pasta */ }
      }
    }
  }

  async function sincronizar() {
    const hoje = hojeBR();
    const sups = (await descobrir()).filter(s => s.data <= hoje); // as de amanhã ainda não têm resultado
    if (!sups.length) {
      if (!armazenamento.existe('sup-hoje.json')) gravarJSON('sup-hoje.json', { gerado: new Date().toISOString(), eleicoes: [] });
      return { eleicoesHoje: 0, semNovidade: true };
    }
    let mudou = false, falhas = 0;
    for (const s of sups) {
      const u = s.uf.toLowerCase();
      const arq = s.mun ? `${u}${s.mun}` : u;
      const chave = `${s.ele}-${arq}-${s.cargo}`;
      let j;
      try { j = await getJSON(`${RAIZ}/${s.ciclo}/${s.ele}/dados/${u}/${arq}-c${pad(s.cargo, 4)}-e${pad(s.ele, 6)}-u.json`); }
      catch { falhas++; continue; }
      const hora = `${j.dg} ${j.hg}`;
      if (estado[chave]?.hora === hora) continue;
      const cands = candidatosDe(j);
      const votos = Object.fromEntries(cands.map(c => [c.n, c.vap]));
      estado[chave] = {
        ...s, chave, hora,
        candidatos: cands.map(({ vap, ...c }) => c),
        total: {
          secTot: +j.s.ts, secRec: +j.s.st, aptos: +(j.e.est || 0), comp: +(j.e.c || 0), votos,
          brancos: +(j.v.vb || 0), nulos: +(j.v.tvn || j.v.vn || 0),
        },
      };
      mudou = true;
      baixarFotos(s, cands).catch(() => {});
    }
    if (mudou || !armazenamento.existe('sup-hoje.json')) {
      gravarJSON('sup-hoje.json', { gerado: new Date().toISOString(), eleicoes: Object.values(estado) });
    }
    return { eleicoesHoje: sups.length, semNovidade: !mudou, falhas };
  }

  // há suplementar ontem, hoje ou amanhã: a coleta fica no ritmo de eleição
  const ativa = () => !!lista && lista.some(s => Math.abs(Math.round((Date.parse(hojeBR()) - Date.parse(s.data)) / 86400000)) <= 1);

  return { sincronizar, ativa };
}

module.exports = { criar };
