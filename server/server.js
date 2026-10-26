'use strict';
// Servidor do painel: entrega o site estático (public/) e os snapshots (dados/turno-N.json)
// gerados pelo job de sincronização, que roda no mesmo processo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const sync = require('./sync');
const historico = require('./historico');
const armazenamento = require('./armazenamento');
const eleicao = require('./eleicao-atual');

const PORTA = +process.env.PORTA || 8080;
const DIR_PUBLIC = path.join(__dirname, '..', 'public');
const DIR_DADOS = process.env.DIR_DADOS || path.join(__dirname, '..', 'dados');
const CACHE_DADOS_S = +process.env.CACHE_DADOS_S || 15;
// endereço público dos dados (CDN na frente do Azure Blob, por exemplo); vazio = o próprio servidor entrega em /dados/
const DADOS_URL = (process.env.DADOS_URL_PUBLICA || '').trim().replace(/\/*$/, '/').replace(/^\/$/, '');

// A pasta de dados pode ser uma pasta do servidor montada no container (./dados), criada pelo Docker como root.
// Se o processo começa como root, acerta o dono da pasta e passa a rodar como o usuário "node" (uid 1000).
function prepararPastaDados() {
  if (armazenamento.MODO === 'local') fs.mkdirSync(DIR_DADOS, { recursive: true }); // no Azure nada é gravado no container
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const UID = +process.env.APP_UID || 1000, GID = +process.env.APP_GID || 1000;
  const acertar = p => {
    try { fs.lchownSync(p, UID, GID); } catch { /* segue */ }
    if (fs.lstatSync(p).isDirectory()) for (const n of fs.readdirSync(p)) acertar(path.join(p, n));
  };
  if (armazenamento.MODO === 'local') acertar(DIR_DADOS);
  process.setgid(GID);
  process.setuid(UID);
}
prepararPastaDados();

// Ao subir, os resultados já gravados são servidos na hora; o ciclo de coleta só atualiza por cima.
function resumoDadosExistentes() {
  const itens = [];
  for (const nome of ['turno-2.json', 'turno-1.json', 'projecao-2.json', 'historico/indice.json']) {
    const em = armazenamento.quando(nome);
    if (em) itens.push(`${nome} (${em})`);
  }
  const mun = armazenamento.listar('turno-').filter(n => /^turno-\d-mun-/.test(n)).length;
  return itens.length
    ? `servindo dados já gravados imediatamente: ${itens.join(', ')}, ${mun} arquivos de municípios`
    : 'pasta de dados vazia: os resultados aparecem após o primeiro ciclo de coleta';
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// Versão do site = hash do conteúdo de public/. O HTML sai com ?v=<versão> em cada .js/.css local, então
// uma atualização nunca mistura HTML novo com JavaScript antigo vindo do cache do navegador ou do Cloudflare.
function calcularVersao() {
  const h = crypto.createHash('sha1');
  const andar = dir => {
    for (const nome of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, nome);
      if (fs.statSync(p).isDirectory()) andar(p);
      else if (/\.(js|css|html)$/.test(nome)) h.update(nome).update(fs.readFileSync(p));
    }
  };
  andar(DIR_PUBLIC);
  return h.digest('hex').slice(0, 10);
}
const VERSAO = calcularVersao();
function versionarHTML(html) {
  return html
    .replace(/(<(?:script|link)\b[^>]*\b(?:src|href)=")(?!https?:|\/\/)([^"?#]+\.(?:js|css))"/g, `$1$2?v=${VERSAO}"`)
    .replace('<head>', `<head>\n  <script>window.VERSAO_APP = '${versaoPublica()}'; window.DADOS_BASE = ${JSON.stringify(DADOS_URL || 'dados/')}; ` +
      `window.ELEICAO = ${JSON.stringify(eleicao.obter()).replace(/</g, '\\u003c')};</script>`);
}
// versão vista pelas páginas abertas: muda com um deploy ou quando começa uma eleição nova (elas recarregam sozinhas)
function versaoPublica() {
  return `${VERSAO}-${eleicao.obter().id}`;
}

const INICIO = new Date().toISOString();

// visitantes online: id anônimo por navegador -> último sinal
const presenca = new Map();
const JANELA_ONLINE_MS = 90 * 1000;
const picoOnline = { valor: 0, em: null, dia: '' };
let contagem = { em: 0, n: 0 };
function contarOnline() {
  if (Date.now() - contagem.em < 5000) return contagem.n; // recalcula no máximo a cada 5 s
  const limite = Date.now() - JANELA_ONLINE_MS;
  for (const [id, t] of presenca) if (t < limite) presenca.delete(id);
  const n = presenca.size;
  const hoje = new Date().toISOString().slice(0, 10);
  if (picoOnline.dia !== hoje) Object.assign(picoOnline, { valor: 0, em: null, dia: hoje });
  if (n > picoOnline.valor) Object.assign(picoOnline, { valor: n, em: new Date().toISOString() });
  contagem = { em: Date.now(), n };
  return n;
}
setInterval(contarOnline, 30 * 1000).unref();

function resolver(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  if (/^\/dados\/(turno-[12](-mun-[A-Z]{2})?|projecao-2|gov-2|sup-hoje)\.json$/.test(p)) return { arq: path.join(DIR_DADOS, path.basename(p)), dados: true };
  // detalhamento municipal do histórico: /dados/historico/mun/<eleição>/<cargo>-<UF>.json (embutido na imagem)
  const mHist = /^\/dados\/historico\/mun\/([a-z0-9-]+)\/(\d+-[A-Z]{2})\.json$/.exec(p);
  if (mHist) {
    const baixado = path.join(DIR_DADOS, 'historico', 'mun', mHist[1], `${mHist[2]}.json`);
    const embutido = path.join(__dirname, 'historico-base', 'mun', mHist[1], `${mHist[2]}.json`);
    return { arq: fs.existsSync(baixado) ? baixado : embutido, dados: false };
  }
  if (/^\/dados\/historico\/[a-z0-9-]+\.json$/.test(p)) {
    // o que foi baixado fica em dados/historico; as eleições antigas vêm embutidas em server/historico-base
    const baixado = path.join(DIR_DADOS, 'historico', path.basename(p));
    const embutido = path.join(__dirname, 'historico-base', path.basename(p));
    return { arq: fs.existsSync(baixado) ? baixado : embutido, dados: false };
  }
  if (/^\/dados\/fotos\/\d+\.jpeg$/.test(p)) return { arq: path.join(DIR_DADOS, 'fotos', path.basename(p)), dados: false };
  // numa eleição municipal, a página inicial é o painel municipal (prefeitos)
  const inicial = eleicao.obter().tipo === 'municipal' && fs.existsSync(path.join(DIR_PUBLIC, 'municipal.html')) ? 'municipal.html' : 'index.html';
  const rel = p === '/' ? inicial : p.slice(1);
  const arq = path.resolve(DIR_PUBLIC, rel);
  if (!arq.startsWith(DIR_PUBLIC + path.sep)) return null; // bloqueia path traversal
  return { arq, dados: false };
}

const servidor = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  const caminhoUrl = req.url.split('?')[0];

  // versão do site em execução: as páginas abertas comparam com a delas e recarregam após um deploy
  if (caminhoUrl === '/versao') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ versao: versaoPublica() }));
  }

  // presença: cada aba aberta manda um sinal a cada 30 s; conta quem deu sinal recentemente
  if (caminhoUrl === '/presenca') {
    const id = new URL(req.url, 'http://x').searchParams.get('c') || '';
    if (/^[a-z0-9]{8,32}$/.test(id) && (presenca.has(id) || presenca.size < 500000)) presenca.set(id, Date.now());
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ online: contarOnline() }));
  }

  // /saude: página legível no navegador; JSON para o app, o healthcheck e scripts (ou /saude.json)
  if (caminhoUrl === '/saude' || caminhoUrl === '/saude.json') {
    const querHTML = caminhoUrl === '/saude' && /text\/html/.test(req.headers.accept || '');
    if (querHTML) {
      return fs.readFile(path.join(DIR_PUBLIC, 'saude.html'), (err, html) => {
        res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(err ? 'erro' : versionarHTML(html.toString('utf8')));
      });
    }
    // ok continua true mesmo com coleta atrasada: o painel usa esse campo só para saber que há servidor
    const snapshots = {};
    for (const t of [1, 2]) snapshots['turno' + t] = armazenamento.quando(`turno-${t}.json`);
    const hist = armazenamento.quando('historico/indice.json');
    const online = contarOnline();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      ok: true, agora: new Date().toISOString(), versao: VERSAO, iniciadoEm: INICIO, eleicao: eleicao.status(),
      visitantes: { online, picoHoje: picoOnline.valor, picoEm: picoOnline.em },
      snapshots, historico: hist, historicoStatus: historico.status(), coletas: sync.status(),
      armazenamento: { ...armazenamento.status(), dadosLidosEm: DADOS_URL || '/dados/ (este servidor)' },
    }, null, 2));
  }

  // Azure Blob: os dados não estão no container. Com CDN configurada, redireciona para ela (páginas antigas em cache
  // ainda pedem /dados/); sem CDN, o servidor repassa o arquivo do container público.
  if (armazenamento.MODO === 'azure' && caminhoUrl.startsWith('/dados/')) return servirDoBlob(req, res, caminhoUrl);

  const r = resolver(req.url);
  if (!r) { res.writeHead(400); return res.end(); }
  fs.readFile(r.arq, (err, corpo) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('não encontrado'); }
    const ext = path.extname(r.arq).toLowerCase();
    const versionado = /[?&]v=/.test(req.url);
    let cache;
    if (r.dados) cache = `public, max-age=${CACHE_DADOS_S}, s-maxage=${CACHE_DADOS_S}`; // snapshots: cache curto
    else if (ext === '.html') cache = 'no-cache';                                      // HTML sempre revalida
    else if (versionado) cache = 'public, max-age=31536000, immutable';                 // ?v= muda a cada versão
    else cache = 'public, max-age=300';
    if (ext === '.html') corpo = Buffer.from(versionarHTML(corpo.toString('utf8')));
    const cab = {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      'Cache-Control': cache,
      'Vary': 'Accept-Encoding',
    };
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && corpo.length > 1024 && ext !== '.png' && ext !== '.jpeg') {
      cab['Content-Encoding'] = 'gzip';
      corpo = zlib.gzipSync(corpo);
    }
    cab['Content-Length'] = corpo.length;
    res.writeHead(200, cab);
    res.end(req.method === 'HEAD' ? undefined : corpo);
  });
});

async function servirDoBlob(req, res, caminhoUrl) {
  let nome;
  try { nome = decodeURIComponent(caminhoUrl.slice('/dados/'.length)); } catch { nome = ''; }
  if (!/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.(json|jpeg)$/i.test(nome) || /^cache-/.test(nome)) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
  if (DADOS_URL) { res.writeHead(302, { Location: DADOS_URL + nome, 'Cache-Control': 'public, max-age=300' }); return res.end(); }
  try {
    let a = await armazenamento.abrirPublico(nome);
    // envio da base embutida ainda na fila: entrega a cópia da imagem
    if (!a && nome.startsWith('historico/')) {
      const arq = path.join(__dirname, 'historico-base', nome.slice('historico/'.length));
      if (arq.startsWith(path.join(__dirname, 'historico-base') + path.sep) && fs.existsSync(arq)) a = { corpo: fs.readFileSync(arq), tipo: TIPOS['.json'], cache: armazenamento.cacheDe(nome) };
    }
    if (!a) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
    const cab = { 'Content-Type': a.tipo, 'Cache-Control': a.cache, 'Vary': 'Accept-Encoding' };
    let corpo = a.corpo;
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && !nome.endsWith('.jpeg') && corpo.length > 1024) { cab['Content-Encoding'] = 'gzip'; corpo = zlib.gzipSync(corpo); }
    cab['Content-Length'] = corpo.length;
    res.writeHead(200, cab);
    res.end(req.method === 'HEAD' ? undefined : corpo);
  } catch (e) {
    console.error('[armazenamento] leitura:', e.message);
    res.writeHead(502, { 'Cache-Control': 'no-store' }); res.end();
  }
}

servidor.listen(PORTA, async () => {
  console.log(`painel em http://0.0.0.0:${PORTA}/ (dados: ${armazenamento.MODO === 'azure' ? 'Azure Blob' : DIR_DADOS}${DADOS_URL ? `, lidos pelo navegador em ${DADOS_URL}` : ''})`);
  await armazenamento.iniciar();
  console.log(resumoDadosExistentes());
  await eleicao.atualizar();
  const e = eleicao.obter();
  console.log(`eleição acompanhada: ${e.id} (${e.tipo}, ${e.origem}), turnos ${Object.entries(e.turnos).map(([t, v]) => `${t}º = ${v.ele} em ${v.data}`).join(', ')}`);
  if (process.env.SYNC !== '0') sync.iniciar();
  if (process.env.HISTORICO !== '0') historico.iniciarHistorico();
  // A cada 6 h confere a configuração do TSE. Quando começa uma eleição nova, o processo reinicia (o Docker sobe de
  // novo sozinho) para a coleta começar limpa com os códigos novos; as páginas abertas recarregam pela /versao.
  setInterval(async () => {
    const { mudou } = await eleicao.atualizar();
    if (!mudou) return;
    console.log(`nova eleição na configuração do TSE: ${eleicao.obter().id}. Reiniciando para acompanhá-la.`);
    await armazenamento.aguardarEnvios(60000);
    process.exit(0);
  }, 6 * 60 * 60 * 1000).unref();
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => servidor.close(() => process.exit(0)));
