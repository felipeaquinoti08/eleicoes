'use strict';
// Onde os dados ficam guardados. Dois modos:
//  - local (padrão): pasta dados/ do servidor, servida pelo próprio servidor, como sempre foi;
//  - Azure Blob (quando AZURE_STORAGE_ACCOUNT e o service principal estão no .env): nada fica no container.
//    O que o navegador lê vai para o container público (lido pelo Cloudflare/CDN), e o estado interno da coleta
//    (cache-*.json) vai para um container separado que nunca é exposto.
// A API é síncrona para quem grava: a gravação no Blob entra numa fila com retentativa e não trava a coleta.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DIR_DADOS = process.env.DIR_DADOS || path.join(__dirname, '..', 'dados');
const CACHE_DADOS_S = +process.env.CACHE_DADOS_S || 15;
const AZ = {
  conta: process.env.AZURE_STORAGE_ACCOUNT || '',
  publico: process.env.AZURE_CONTAINER_PUBLICO || 'eleicoes',
  interno: process.env.AZURE_CONTAINER_INTERNO || 'eleicoes-interno',
  tenant: process.env.AZURE_TENANT_ID || '',
  cliente: process.env.AZURE_CLIENT_ID || '',
  segredo: process.env.AZURE_CLIENT_SECRET || '',
  endpoint: (process.env.AZURE_BLOB_ENDPOINT || '').replace(/\/$/, ''),          // só para testes/nuvens soberanas
  autoridade: (process.env.AZURE_AUTHORITY || 'https://login.microsoftonline.com').replace(/\/$/, ''),
  expira: process.env.AZURE_CLIENT_SECRET_EXPIRA || '',                            // AAAA-MM-DD, opcional
};
const MODO = AZ.conta && AZ.tenant && AZ.cliente && AZ.segredo ? 'azure' : 'local';
const VERSAO_API = '2023-11-03';

// ---------------------------------------------------------------- regras por arquivo
const ehInterno = nome => /^cache-/.test(nome);
const tipoDe = nome => (nome.endsWith('.jpeg') ? 'image/jpeg' : 'application/json; charset=utf-8');
// Cache-Control gravado junto com o arquivo: o Cloudflare (ou outra CDN) respeita esse cabeçalho
function cacheDe(nome) {
  if (ehInterno(nome)) return 'no-store';
  if (nome.startsWith('fotos/')) return 'public, max-age=86400, s-maxage=604800';
  if (nome === 'historico/indice.json') return 'public, max-age=60, s-maxage=60';
  if (nome.startsWith('historico/mun/')) return 'public, max-age=3600, s-maxage=86400';
  if (nome.startsWith('historico/')) return 'public, max-age=300, s-maxage=3600';
  return `public, max-age=${CACHE_DADOS_S}, s-maxage=${CACHE_DADOS_S}`; // snapshots da apuração
}
const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

// ---------------------------------------------------------------- estado
// índice dos arquivos existentes (nome -> { md5, em }) e conteúdo do estado lido na partida
const indice = new Map();
const precarregado = new Map();
const fila = new Map(); // nome -> { buf, md5 } (só a versão mais nova de cada arquivo)
const st = { modo: MODO, gravados: 0, falhas: 0, ultimaGravacao: null, ultimoErro: null, ultimoErroEm: null, iniciado: false };

// ---------------------------------------------------------------- Azure: token do Entra ID e REST do Blob
let token = { valor: '', expira: 0 };
async function obterToken() {
  if (token.valor && Date.now() < token.expira - 5 * 60 * 1000) return token.valor;
  const r = await fetch(`${AZ.autoridade}/${encodeURIComponent(AZ.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: AZ.cliente, client_secret: AZ.segredo, scope: 'https://storage.azure.com/.default' }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  // nunca registra o corpo da resposta inteiro: só o código de erro do Entra ID
  if (!r.ok || !j.access_token) throw new Error(`Entra ID recusou o login do service principal (HTTP ${r.status}${j.error ? `, ${j.error}` : ''})`);
  token = { valor: j.access_token, expira: Date.now() + (+j.expires_in || 3600) * 1000 };
  return token.valor;
}
const baseBlob = () => AZ.endpoint || `https://${AZ.conta}.blob.core.windows.net`;
const urlBlob = (container, nome) => `${baseBlob()}/${container}/${nome.split('/').map(encodeURIComponent).join('/')}`;
const containerDe = nome => (ehInterno(nome) ? AZ.interno : AZ.publico);
async function cabecalhos(extra = {}) {
  return { Authorization: `Bearer ${await obterToken()}`, 'x-ms-version': VERSAO_API, 'x-ms-date': new Date().toUTCString(), ...extra };
}

async function enviarBlob(nome, buf, hash, origem) {
  const json = !nome.endsWith('.jpeg');
  const corpo = json ? zlib.gzipSync(buf) : buf; // JSON comprimido: menos armazenamento e menos tráfego de saída
  const h = await cabecalhos({
    'x-ms-blob-type': 'BlockBlob',
    'x-ms-blob-content-type': tipoDe(nome),
    'x-ms-blob-cache-control': cacheDe(nome),
    'x-ms-meta-md5': hash,
    ...(origem ? { 'x-ms-meta-origem': origem } : {}),
    ...(json ? { 'x-ms-blob-content-encoding': 'gzip' } : {}),
  });
  const r = await fetch(urlBlob(containerDe(nome), nome), { method: 'PUT', headers: h, body: corpo, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Blob recusou a gravação de ${nome} (HTTP ${r.status} ${r.headers.get('x-ms-error-code') || ''})`.trim());
}

async function baixarBlob(nome) {
  const r = await fetch(urlBlob(containerDe(nome), nome), { headers: await cabecalhos(), signal: AbortSignal.timeout(60000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Blob recusou a leitura de ${nome} (HTTP ${r.status} ${r.headers.get('x-ms-error-code') || ''})`.trim());
  return r; // o fetch do Node já descomprime o gzip
}

async function listarContainer(container, prefixo = '') {
  const itens = [];
  let marcador = '';
  do {
    const q = new URLSearchParams({ restype: 'container', comp: 'list', include: 'metadata', maxresults: '5000', ...(prefixo ? { prefix: prefixo } : {}), ...(marcador ? { marker: marcador } : {}) });
    const r = await fetch(`${baseBlob()}/${container}?${q}`, { headers: await cabecalhos(), signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Blob recusou a listagem de ${container} (HTTP ${r.status} ${r.headers.get('x-ms-error-code') || ''})`.trim());
    const xml = await r.text();
    for (const b of xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
      const nome = (/<Name>([\s\S]*?)<\/Name>/.exec(b[1]) || [])[1];
      if (!nome) continue;
      itens.push({
        nome: nome.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
        md5: (/<md5>([0-9a-f]{32})<\/md5>/i.exec(b[1]) || [])[1] || '',
        origem: (/<origem>([a-z]+)<\/origem>/i.exec(b[1]) || [])[1] || '',
        em: new Date((/<Last-Modified>([^<]+)<\/Last-Modified>/.exec(b[1]) || [])[1] || 0).toISOString(),
      });
    }
    marcador = (/<NextMarker>([^<]*)<\/NextMarker>/.exec(xml) || [])[1] || '';
  } while (marcador);
  return itens;
}

// fila de envio: só a versão mais recente de cada arquivo; falhas voltam para a fila com espera crescente
let enviando = false, espera = 0;
async function esvaziarFila() {
  if (enviando) return;
  enviando = true;
  try {
    while (fila.size) {
      const lote = [...fila.entries()].slice(0, 6);
      for (const [nome] of lote) fila.delete(nome);
      await Promise.all(lote.map(async ([nome, item]) => {
        try {
          await enviarBlob(nome, item.buf, item.md5, item.origem);
          st.gravados++; st.ultimaGravacao = new Date().toISOString(); espera = 0;
        } catch (e) {
          st.falhas++; st.ultimoErro = e.message; st.ultimoErroEm = new Date().toISOString();
          if (!fila.has(nome)) fila.set(nome, item); // devolve, se não chegou versão mais nova
          espera = Math.min(60000, (espera || 1000) * 2);
        }
      }));
      if (espera) await new Promise(r => setTimeout(r, espera));
    }
  } finally { enviando = false; }
}

// ---------------------------------------------------------------- API
// Carrega o índice e o estado da coleta. Chamado uma vez, antes de a coleta começar.
async function iniciar() {
  if (MODO === 'local') { fs.mkdirSync(DIR_DADOS, { recursive: true }); st.iniciado = true; return; }
  for (let tentativa = 1; ; tentativa++) {
    try {
      for (const c of [AZ.publico, AZ.interno]) for (const b of await listarContainer(c)) indice.set(b.nome, { md5: b.md5, em: b.em, origem: b.origem });
      // estado da coleta e snapshots da raiz (os arquivos do histórico e as fotos são lidos sob demanda)
      const raiz = [...indice.keys()].filter(n => !n.includes('/') && n.endsWith('.json'));
      await Promise.all(raiz.map(async n => {
        const r = await baixarBlob(n);
        if (r) precarregado.set(n, await r.text());
      }));
      st.iniciado = true;
      console.log(`[armazenamento] Azure Blob (${AZ.conta}): ${indice.size} arquivos, estado da coleta carregado (${raiz.length} arquivos)`);
      return;
    } catch (e) {
      st.ultimoErro = e.message; st.ultimoErroEm = new Date().toISOString();
      console.error(`[armazenamento] Azure Blob indisponível (${e.message}); nova tentativa em ${Math.min(60, 5 * tentativa)} s`);
      await new Promise(r => setTimeout(r, Math.min(60, 5 * tentativa) * 1000));
    }
  }
}

// grava um arquivo (Buffer ou texto). No Blob, entra na fila; arquivo idêntico ao último não é reenviado.
// origem 'base' marca os arquivos que vieram do histórico embutido na imagem
function gravar(nome, conteudo, origem = '') {
  const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo);
  if (MODO === 'local') {
    const arq = path.join(DIR_DADOS, nome);
    fs.mkdirSync(path.dirname(arq), { recursive: true }); // recria a pasta se ela tiver sido apagada por fora
    fs.writeFileSync(arq + '.tmp', buf);
    fs.renameSync(arq + '.tmp', arq);                       // troca atômica: nunca entrega arquivo pela metade
    return;
  }
  const hash = md5(buf);
  const ant = indice.get(nome);
  if (!nome.includes('/') && nome.endsWith('.json')) precarregado.set(nome, buf.toString('utf8'));
  if (ant && ant.md5 === hash && !fila.has(nome)) return;
  indice.set(nome, { md5: hash, em: new Date().toISOString(), origem });
  fila.set(nome, { buf, md5: hash, origem });
  setImmediate(esvaziarFila);
}
const gravarJSON = (nome, obj) => gravar(nome, JSON.stringify(obj));

// leitura síncrona do estado da coleta (arquivos da raiz, carregados na partida)
function lerJSON(nome) {
  try {
    if (MODO === 'local') return JSON.parse(fs.readFileSync(path.join(DIR_DADOS, nome), 'utf8'));
    const t = precarregado.get(nome);
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

// leitura sob demanda (histórico): null se não existir
async function lerJSONAsync(nome) {
  try {
    if (MODO === 'local') return JSON.parse(await fs.promises.readFile(path.join(DIR_DADOS, nome), 'utf8'));
    if (fila.has(nome)) return JSON.parse(fila.get(nome).buf.toString('utf8'));
    if (precarregado.has(nome)) return JSON.parse(precarregado.get(nome));
    if (!indice.has(nome)) return null;
    const r = await baixarBlob(nome);
    return r ? await r.json() : null;
  } catch { return null; }
}

function existe(nome) {
  return MODO === 'local' ? fs.existsSync(path.join(DIR_DADOS, nome)) : indice.has(nome);
}

// data da última gravação (ou null)
function quando(nome) {
  if (MODO === 'local') { try { return fs.statSync(path.join(DIR_DADOS, nome)).mtime.toISOString(); } catch { return null; } }
  return indice.get(nome)?.em || null;
}

// nomes que começam com o prefixo (recursivo), relativos à raiz dos dados
function listar(prefixo) {
  if (MODO !== 'local') return [...indice.keys()].filter(n => n.startsWith(prefixo));
  const saida = [];
  const andar = (rel) => {
    let nomes;
    try { nomes = fs.readdirSync(path.join(DIR_DADOS, rel), { withFileTypes: true }); } catch { return; }
    for (const d of nomes) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) andar(r);
      else if (!d.name.endsWith('.tmp')) saida.push(r);
    }
  };
  const dir = prefixo.includes('/') ? prefixo.slice(0, prefixo.lastIndexOf('/')) : '';
  andar(dir);
  return saida.filter(n => n.startsWith(prefixo));
}

// o que se sabe de um arquivo no Blob (md5 e origem), para enviar só o que mudou
const info = nome => indice.get(nome) || null;

// proxy de leitura do container público, para quem usa Azure sem CDN na frente (DADOS_URL_PUBLICA vazio)
async function abrirPublico(nome) {
  if (ehInterno(nome)) return null;
  const r = await baixarBlob(nome);
  if (!r) return null;
  return { corpo: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') || tipoDe(nome), cache: r.headers.get('cache-control') || cacheDe(nome) };
}

function status() {
  const s = { modo: MODO, iniciado: st.iniciado };
  if (MODO === 'local') return s;
  let segredoExpiraEmDias = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(AZ.expira)) segredoExpiraEmDias = Math.floor((new Date(AZ.expira + 'T00:00:00Z') - Date.now()) / 86400000);
  // nada de segredo, token ou URL assinada aqui: este status aparece no /saude, que é público
  return {
    ...s, conta: AZ.conta, containerPublico: AZ.publico, containerInterno: AZ.interno, arquivos: indice.size,
    pendentes: fila.size, gravados: st.gravados, falhas: st.falhas, ultimaGravacao: st.ultimaGravacao,
    ultimoErro: st.ultimoErro, ultimoErroEm: st.ultimoErroEm, segredoExpiraEmDias,
  };
}

module.exports = { MODO, DIR_DADOS, iniciar, gravar, gravarJSON, lerJSON, lerJSONAsync, existe, quando, listar, md5, info, abrirPublico, status, cacheDe };
