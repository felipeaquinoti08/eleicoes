'use strict';
// Eleições suplementares do dia (prefeito, vereador ou governador fora de época), lidas da configuração do TSE.
// Publica dados/sup-hoje.json com os candidatos e o resultado de cada uma, atualizado a cada passada.
const fs = require('fs');
const path = require('path');

const RAIZ = 'https://resultados.tse.jus.br/oficial';
const NOME_CARGO = { 3: 'Governador', 11: 'Prefeito', 13: 'Vereador' };

function criar({ getJSON, baixar, gravarJSON, log, DIR_DADOS }) {
  const pad = (v, n) => String(v).padStart(n, '0');
  let lista = null, listaDia = '';
  const estado = {}; // chave -> { hora, ... }

  // hoje no fuso de Brasília (aaaa-mm-dd); entram as suplementares dos últimos DIAS dias (as de hoje, ao vivo)
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
      if (dias < 0 || dias > DIAS) continue;
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
    const dir = path.join(DIR_DADOS, 'fotos');
    fs.mkdirSync(dir, { recursive: true });
    for (const c of cands) {
      const arq = path.join(dir, `${c.sq}.jpeg`);
      if (!/^\d+$/.test(c.sq) || fs.existsSync(arq)) continue;
      for (const pasta of [s.uf.toLowerCase(), 'br']) {
        try { fs.writeFileSync(arq, Buffer.from(await (await baixar(`${RAIZ}/${s.ciclo}/${s.ele}/fotos/${pasta}/${c.sq}.jpeg`, 3)).arrayBuffer())); break; }
        catch { /* tenta a outra pasta */ }
      }
    }
  }

  async function sincronizar() {
    const sups = await descobrir();
    if (!sups.length) {
      if (!fs.existsSync(path.join(DIR_DADOS, 'sup-hoje.json'))) gravarJSON(path.join(DIR_DADOS, 'sup-hoje.json'), { gerado: new Date().toISOString(), eleicoes: [] });
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
    if (mudou || !fs.existsSync(path.join(DIR_DADOS, 'sup-hoje.json'))) {
      gravarJSON(path.join(DIR_DADOS, 'sup-hoje.json'), { gerado: new Date().toISOString(), eleicoes: Object.values(estado) });
    }
    return { eleicoesHoje: sups.length, semNovidade: !mudou, falhas };
  }

  return { sincronizar };
}

module.exports = { criar };
