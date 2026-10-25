'use strict';
// 2º turno para Governador (eleição 6260 em 2026): só nos estados que tiveram 2º turno.
// Cada estado tem os próprios candidatos. Publica dados/gov-2.json com o total de cada UF e os municípios.
const fs = require('fs');
const path = require('path');

const RAIZ = 'https://resultados.tse.jus.br/oficial';
const ELE = 6260;
const CARGO = 3;
const UFS_PADRAO = ['AM', 'RN', 'DF', 'ES', 'AC', 'TO'];

function criar({ getJSON, baixar, emParalelo, gravarJSON, log, DIR_DADOS, CONCORRENCIA }) {
  const pad = (v, n) => String(v).padStart(n, '0');
  const base = `${RAIZ}/ele2026/${ELE}/dados`;
  const arqEstado = path.join(DIR_DADOS, 'cache-gov-2.json');
  let estado;
  try { estado = JSON.parse(fs.readFileSync(arqEstado, 'utf8')); } catch { estado = { ufs: {} }; }
  let ufsGov = null;

  async function descobrirUFs() {
    if (ufsGov) return ufsGov;
    try {
      const cfg = await getJSON(`${RAIZ}/comum/config/ele-c.json`);
      for (const p of cfg.pl || []) for (const e of p.e || []) {
        if (+e.cd === ELE) ufsGov = e.abr.map(a => a.cd.toUpperCase());
      }
    } catch (er) { log('aviso governador: configuração do TSE indisponível, usando a lista padrão:', er.message); }
    return (ufsGov ||= UFS_PADRAO);
  }

  const candidatosDe = j => {
    const out = [];
    for (const a of j.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) {
      out.push({ n: c.n, nome: c.nmu, partido: p.sg, sq: c.sqcand, vice: c.vs?.[0]?.nmu || '' });
    }
    return out.sort((a, b) => a.n - b.n);
  };
  const oficialDe = j => {
    const votos = {};
    for (const a of j.carg?.[0]?.agr || []) for (const p of a.par || []) for (const c of p.cand || []) votos[c.n] = +c.vap;
    return {
      secTot: +j.s.ts, secRec: +j.s.st, aptos: +(j.e.est || 0), comp: +(j.e.c || 0), votos,
      brancos: +(j.v.vb || 0), nulos: +(j.v.tvn || j.v.vn || 0), hora: `${j.dg} ${j.hg}`,
    };
  };

  async function baixarFotos(uf, cands) {
    const dir = path.join(DIR_DADOS, 'fotos');
    fs.mkdirSync(dir, { recursive: true });
    for (const c of cands) {
      const arq = path.join(dir, `${c.sq}.jpeg`);
      if (!/^\d+$/.test(c.sq) || fs.existsSync(arq)) continue;
      for (const pasta of [uf.toLowerCase(), 'br']) {
        try { fs.writeFileSync(arq, Buffer.from(await (await baixar(`${RAIZ}/ele2026/${ELE}/fotos/${pasta}/${c.sq}.jpeg`, 4)).arrayBuffer())); break; }
        catch { /* tenta a outra pasta */ }
      }
    }
  }

  function publicar() {
    gravarJSON(path.join(DIR_DADOS, 'gov-2.json'), { gerado: new Date().toISOString(), ele: ELE, cargo: 'Governador', ufs: estado.ufs });
    gravarJSON(arqEstado, estado);
  }

  // uma passada: total de cada UF e, quando ele muda, os municípios que mudaram
  async function sincronizar() {
    const inicio = Date.now();
    const ufs = await descobrirUFs();
    let mudou = false, munBaixados = 0, falhas = 0;
    for (const uf of ufs) {
      const u = uf.toLowerCase();
      let j;
      try { j = await getJSON(`${base}/${u}/${u}-c${pad(CARGO, 4)}-e${pad(ELE, 6)}-u.json`); } catch (er) { falhas++; continue; }
      const e = (estado.ufs[uf] ||= { municipios: {}, versoes: {} });
      const total = oficialDe(j);
      if (e.total && e.total.hora === total.hora && e.candidatos?.length) continue; // nada novo nessa UF
      e.candidatos = candidatosDe(j);
      e.total = total;
      mudou = true;
      baixarFotos(uf, e.candidatos).catch(() => {});
      // municípios: o arquivo agregado da UF diz quais mudaram
      let ab;
      try { ab = await getJSON(`${base}/${u}/${u}-e${pad(ELE, 6)}-ab.json`); } catch { falhas++; continue; }
      const fila = [];
      for (const a of ab.abr || []) {
        if (a.tpabr !== 'mun' || !(+a.s?.st > 0)) continue;
        const v = `${a.s.st}|${a.dt} ${a.ht}|${a.e?.c}`;
        if (e.versoes[a.cdabr] !== v) fila.push([a.cdabr, v]);
      }
      falhas += await emParalelo(fila, CONCORRENCIA, async ([cd, v]) => {
        const m = oficialDe(await getJSON(`${base}/${u}/${u}${cd}-c${pad(CARGO, 4)}-e${pad(ELE, 6)}-u.json`));
        delete m.hora;
        e.municipios[cd] = m;
        e.versoes[cd] = v;
        munBaixados++;
      });
    }
    if (mudou) {
      publicar();
      const sec = ufs.reduce((a, uf) => a + (estado.ufs[uf]?.total?.secRec || 0), 0);
      log(`governador 2º turno: ${ufs.join(', ')} · ${sec} seções · ${munBaixados} municípios atualizados${falhas ? `, ${falhas} falhas` : ''} em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
    } else if (!fs.existsSync(path.join(DIR_DADOS, 'gov-2.json')) && Object.keys(estado.ufs).length) publicar();
    return {
      estados: ufs.join(', '), semNovidade: !mudou, municipiosAtualizados: munBaixados, falhas,
      secoesApuradas: ufs.reduce((a, uf) => a + (estado.ufs[uf]?.total?.secRec || 0), 0),
      secoesTotal: ufs.reduce((a, uf) => a + (estado.ufs[uf]?.total?.secTot || 0), 0),
    };
  }

  return { sincronizar };
}

module.exports = { criar };
