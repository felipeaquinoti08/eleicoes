'use strict';
// Importa eleições antigas do Portal de Dados Abertos do TSE (anos que o sistema de resultados não publica mais)
// e grava server/historico-base/<id>.json no mesmo formato do histórico. Roda uma vez, fora do container:
//
//   node tools/importar-dados-abertos.js <pasta-com-os-zips> 2022 2020 2018 ...
//
// Na pasta: votacao_candidato_munzona_<ano>.zip e detalhe_votacao_munzona_<ano>.zip, de
// https://cdn.tse.jus.br/estatistica/sead/odsele/<arquivo>/<arquivo>_<ano>.zip
// Eleições gerais: presidente (país, UFs, exterior) e cargos estaduais por UF. Municipais: prefeito e vereador nas capitais.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const SAIDA = path.join(__dirname, '..', 'server', 'historico-base');
const CARGOS = { 1: 'Presidente', 3: 'Governador', 5: 'Senador', 6: 'Deputado Federal', 7: 'Deputado Estadual', 8: 'Deputado Distrital', 11: 'Prefeito', 13: 'Vereador' };
const PROPORCIONAL = new Set([6, 7, 8, 13]);
// cargos com detalhamento por município (um arquivo por estado em historico-base/mun/<eleição>/<cargo>-<UF>.json)
const MAJORITARIOS = new Set([1, 3, 5, 11]);
const UFS_BR = new Set(['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']);
const CAPITAIS = new Set(['01392', '27855', '02550', '06050', '38490', '13897', '57053', '93734', '09210', '41238', '90514', '90670', '04278',
  '20516', '25313', '12190', '75353', '60011', '17612', '00035', '03018', '88013', '81051', '31054', '71072', '73440']);

// lista e lê arquivos de dentro do zip (tar do Windows/bsdtar; no Linux, unzip)
const TAR = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : null;
function listarZip(zip) {
  return new Promise((ok, falha) => {
    const p = TAR ? spawn(TAR, ['-tf', zip]) : spawn('unzip', ['-Z1', zip]);
    let s = '';
    p.stdout.on('data', d => (s += d));
    p.on('close', c => (c === 0 ? ok(s.split(/\r?\n/).filter(Boolean)) : falha(new Error('falha ao listar ' + zip))));
  });
}
function lerCSV(zip, entrada, aoLer) {
  return new Promise((ok, falha) => {
    const p = TAR ? spawn(TAR, ['-xOf', zip, entrada]) : spawn('unzip', ['-p', zip, entrada]);
    p.stdout.setEncoding('latin1');
    const rl = readline.createInterface({ input: p.stdout, crlfDelay: Infinity });
    let cab = null;
    rl.on('line', linha => {
      const campos = separar(linha);
      if (!cab) { cab = Object.fromEntries(campos.map((c, i) => [c, i])); return; }
      aoLer(nome => campos[cab[nome]]);
    });
    rl.on('close', ok);
    p.on('error', falha);
  });
}
// CSV do TSE: separado por ";" com campos entre aspas
function separar(linha) {
  const out = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"') { if (linha[i + 1] === '"') { atual += '"'; i++; } else aspas = false; }
      else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ';') { out.push(atual); atual = ''; }
    else atual += ch;
  }
  out.push(atual);
  return out;
}

const n = v => +String(v || '0').replace(/\D/g, '') || 0;
const padMun = v => String(v || '').replace(/\D/g, '').padStart(5, '0');
const tituloSituacao = st => ({ 'ELEITO': 'Eleito', 'ELEITO POR QP': 'Eleito por QP', 'ELEITO POR MÉDIA': 'Eleito por média', 'ELEITO POR MEDIA': 'Eleito por média', 'MÉDIA': 'Eleito por média', '2º TURNO': '2º turno', 'NÃO ELEITO': 'Não eleito', 'SUPLENTE': 'Suplente' }[st] || st || '');

async function importarAno(dir, ano) {
  const zipCand = path.join(dir, `votacao_candidato_munzona_${ano}.zip`);
  const zipDet = path.join(dir, `detalhe_votacao_munzona_${ano}.zip`);
  const geral = ano % 4 === 2; // 2010, 2014, 2018, 2022…; municipais: 2008, 2012, 2016, 2020…
  // acc[turno][cargo][local] = { cands: Map, aptos, comp, brancos, nulos, secoes }
  const acc = {};
  const meta = {}; // turno -> { data, ele por abrangência }
  // accMun[turno][cargo][uf][mun] = { v: Map(sq -> votos), meta: Map(sq -> candidato), aptos, comp, brancos, nulos, secoes }
  const accMun = {};
  const destinoMun = (t, cargo, uf, mun) => ((((accMun[t] ||= {})[cargo] ||= {})[uf] ||= {})[mun] ||= { v: new Map(), meta: new Map(), aptos: 0, comp: 0, brancos: 0, nulos: 0, secoes: 0 });
  const destino = (t, cargo, local) => (((acc[t] ||= {})[cargo] ||= {})[local] ||= { cands: new Map(), aptos: 0, comp: 0, brancos: 0, nulos: 0, secoes: 0 });

  // locais de um registro: presidente vai para a UF (ou ZZ) e para BR; estaduais para a UF; municipais só nas capitais
  function locais(get, cargo) {
    const uf = get('SG_UF');
    if (cargo === 1) return [uf, 'BR'];
    if (cargo === 11 || cargo === 13) { const mun = padMun(get('CD_MUNICIPIO')); return CAPITAIS.has(mun) ? [`${uf}-${mun}`] : []; }
    return [uf];
  }

  const entradas = (await listarZip(zipCand)).filter(e => /\.csv$/i.test(e) && !/_BRASIL\.csv$/i.test(e));
  for (const e of entradas) {
    process.stdout.write(`  ${ano} candidatos ${e}\n`);
    await lerCSV(zipCand, e, get => {
      const cargo = n(get('CD_CARGO'));
      if (!CARGOS[cargo]) return;
      const t = n(get('NR_TURNO'));
      (meta[t] ||= { data: get('DT_ELEICAO'), ele: {} }).ele[get('TP_ABRANGENCIA')] = get('CD_ELEICAO');
      const temValidos = get('QT_VOTOS_NOMINAIS_VALIDOS') !== undefined;
      if (!temValidos && /INAPTO|INDEFERIDO|CASSADO/i.test(get('DS_SITUACAO_CANDIDATURA') || '')) return; // votos anulados
      const votos = temValidos ? n(get('QT_VOTOS_NOMINAIS_VALIDOS')) : n(get('QT_VOTOS_NOMINAIS'));
      const sq = get('SQ_CANDIDATO');
      for (const local of locais(get, cargo)) {
        const d = destino(t, cargo, local);
        let c = d.cands.get(sq);
        if (!c) d.cands.set(sq, (c = { n: get('NR_CANDIDATO'), nome: get('NM_URNA_CANDIDATO'), partido: get('SG_PARTIDO'), votos: 0, st: tituloSituacao(get('DS_SIT_TOT_TURNO')) }));
        c.votos += votos;
      }
      const uf = get('SG_UF');
      if (MAJORITARIOS.has(cargo) && UFS_BR.has(uf)) {
        const dm = destinoMun(t, cargo, uf, padMun(get('CD_MUNICIPIO')));
        dm.v.set(sq, (dm.v.get(sq) || 0) + votos);
        if (!dm.meta.has(sq)) dm.meta.set(sq, { n: get('NR_CANDIDATO'), nome: get('NM_URNA_CANDIDATO'), partido: get('SG_PARTIDO'), st: tituloSituacao(get('DS_SIT_TOT_TURNO')) });
      }
    });
  }
  const entradasDet = (await listarZip(zipDet)).filter(e => /\.csv$/i.test(e) && !/_BRASIL\.csv$/i.test(e));
  for (const e of entradasDet) {
    process.stdout.write(`  ${ano} detalhe ${e}\n`);
    await lerCSV(zipDet, e, get => {
      const cargo = n(get('CD_CARGO'));
      if (!CARGOS[cargo]) return;
      const t = n(get('NR_TURNO'));
      for (const local of locais(get, cargo)) {
        const d = acc[t]?.[cargo]?.[local];
        if (!d) continue;
        d.aptos += n(get('QT_APTOS'));
        d.comp += n(get('QT_COMPARECIMENTO'));
        d.brancos += n(get('QT_VOTOS_BRANCOS'));
        d.nulos += n(get('QT_TOTAL_VOTOS_NULOS') ?? get('QT_VOTOS_NULOS'));
        d.secoes += n(get('QT_TOTAL_SECOES'));
      }
      const uf = get('SG_UF');
      const dm = MAJORITARIOS.has(cargo) && UFS_BR.has(uf) ? accMun[t]?.[cargo]?.[uf]?.[padMun(get('CD_MUNICIPIO'))] : null;
      if (dm) {
        dm.aptos += n(get('QT_APTOS')); dm.comp += n(get('QT_COMPARECIMENTO')); dm.brancos += n(get('QT_VOTOS_BRANCOS'));
        dm.nulos += n(get('QT_TOTAL_VOTOS_NULOS') ?? get('QT_VOTOS_NULOS')); dm.secoes += n(get('QT_TOTAL_SECOES'));
      }
    });
  }

  // monta os documentos no formato do histórico
  const docs = [];
  for (const [t, porCargo] of Object.entries(acc)) {
    const data = (meta[t]?.data || '').split('/').reverse().join('-');
    const grupos = geral
      ? [['federal', [1], 'Federal', meta[t]?.ele.F], ['estadual', [3, 5, 6, 7, 8], 'Estadual', meta[t]?.ele.E]]
      : [['municipal', [11, 13], null, meta[t]?.ele.M]];
    for (const [sufixo, cargosDoc, rotulo, ele] of grupos) {
      const cargos = [];
      for (const cd of cargosDoc) {
        const porLocal = porCargo[cd];
        if (!porLocal) continue;
        const locaisDoc = Object.entries(porLocal).map(([local, d]) => {
          const [uf, mun] = local.split('-');
          const validos = [...d.cands.values()].reduce((a, c) => a + c.votos, 0);
          let cands = [...d.cands.values()].sort((a, b) => b.votos - a.votos)
            .map(c => ({ n: c.n, nome: c.nome, partido: c.partido, votos: c.votos, pct: validos ? +(100 * c.votos / validos).toFixed(2) : 0, eleito: /^eleito/i.test(c.st), st: c.st }));
          // alguns anos (ex.: 2010) vêm com a situação "#NULO#": nos cargos de um eleito por local ela é deduzida dos votos
          if ([1, 3, 11].includes(cd) && cands.length && cands.every(c => !c.st || c.st.startsWith('#'))) {
            const decidido = +t === 2 || cands[0].pct > 50;
            cands.forEach((c, i) => { c.st = decidido ? (i === 0 ? 'Eleito' : 'Não eleito') : (i < 2 ? '2º turno' : 'Não eleito'); c.eleito = decidido && i === 0; });
          }
          for (const c of cands) if (c.st.startsWith('#')) c.st = '';
          const partidos = {};
          if (PROPORCIONAL.has(cd)) { for (const c of cands) partidos[c.partido] = (partidos[c.partido] || 0) + c.votos; cands = cands.filter((c, i) => i < 40 || c.eleito); }
          return {
            uf: uf === 'BR' ? 'BR' : uf, mun: mun || null, tipo: uf === 'BR' ? 'br' : uf === 'ZZ' ? 'zz' : mun ? 'mun' : 'uf', nome: null,
            secTot: d.secoes, secRec: d.secoes, aptos: d.aptos, comp: d.comp, brancos: d.brancos, nulos: d.nulos, validos, cands,
            partidos: PROPORCIONAL.has(cd) ? Object.entries(partidos).sort((a, b) => b[1] - a[1]).map(([sg, votos]) => ({ sg, votos })) : undefined,
          };
        }).filter(l => l.validos > 0);
        if (locaisDoc.length) cargos.push({ cd, nome: CARGOS[cd], proporcional: PROPORCIONAL.has(cd), locais: locaisDoc });
      }
      if (!cargos.length) continue;
      const id = `${ano}-${t}t-${sufixo}`;
      const nome = geral ? `Eleição Geral ${ano} · ${t}º turno · ${rotulo}` : `Eleições Municipais ${ano} · ${t}º turno (capitais)`;
      docs.push({ id, ciclo: `ele${ano}`, ele: +ele || null, nome, data, turno: +t, cargos, completo: true, fonte: 'Portal de Dados Abertos do TSE', baixado: new Date().toISOString() });
    }
  }
  fs.mkdirSync(SAIDA, { recursive: true });
  for (const d of docs) gravarMunicipios(d, accMun[d.turno]);
  for (const d of docs) {
    fs.writeFileSync(path.join(SAIDA, `${d.id}.json`), JSON.stringify(d));
    console.log(`${d.id}: ${d.cargos.map(c => `${c.nome} (${c.locais.length})`).join(', ')}`);
  }
}

// detalhamento por município: um arquivo por cargo e estado. Para presidente, governador e senador os candidatos
// são os mesmos no estado (lista única + votos alinhados); para prefeito cada município tem os seus.
function gravarMunicipios(doc, porCargo) {
  if (!porCargo) return;
  for (const cargo of doc.cargos) {
    if (!MAJORITARIOS.has(cargo.cd) || !porCargo[cargo.cd]) continue;
    const dir = path.join(SAIDA, 'mun', doc.id);
    fs.mkdirSync(dir, { recursive: true });
    let arquivos = 0;
    for (const [uf, muns] of Object.entries(porCargo[cargo.cd])) {
      let saida;
      if (cargo.cd === 11) {
        const mun = {};
        for (const [cd, d] of Object.entries(muns)) {
          const r = [...d.v.entries()].map(([sq, v]) => { const m = d.meta.get(sq); return [m.n, m.nome, m.partido, v, m.st && !m.st.startsWith('#') ? m.st : '']; }).sort((a, b) => b[3] - a[3]);
          if (r.some(x => x[3] > 0)) mun[cd] = { r, c: d.comp, a: d.aptos, b: d.brancos, nu: d.nulos, s: d.secoes };
        }
        saida = { cargo: cargo.cd, uf, mun };
      } else {
        const meta = new Map();
        for (const d of Object.values(muns)) for (const [sq, m] of d.meta) if (!meta.has(sq)) meta.set(sq, m);
        const total = new Map();
        for (const d of Object.values(muns)) for (const [sq, v] of d.v) total.set(sq, (total.get(sq) || 0) + v);
        const ordem = [...meta.keys()].filter(sq => total.get(sq) > 0).sort((a, b) => total.get(b) - total.get(a));
        const mun = {};
        for (const [cd, d] of Object.entries(muns)) mun[cd] = { v: ordem.map(sq => d.v.get(sq) || 0), c: d.comp, a: d.aptos, b: d.brancos, nu: d.nulos, s: d.secoes };
        saida = { cargo: cargo.cd, uf, cands: ordem.map(sq => { const m = meta.get(sq); return { n: m.n, nome: m.nome, partido: m.partido }; }), mun };
      }
      fs.writeFileSync(path.join(dir, `${cargo.cd}-${uf}.json`), JSON.stringify(saida));
      arquivos++;
    }
    cargo.detalheMunicipal = arquivos > 0;
  }
}

(async () => {
  const [dir, ...anos] = process.argv.slice(2);
  if (!dir || !anos.length) { console.error('uso: node tools/importar-dados-abertos.js <pasta-dos-zips> <ano> [ano…]'); process.exit(1); }
  for (const a of anos) await importarAno(dir, +a);
})().catch(e => { console.error(e); process.exit(1); });
