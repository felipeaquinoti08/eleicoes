'use strict';
// Servidor do painel: entrega o site estático (public/) e os snapshots (dados/turno-N.json)
// gerados pelo job de sincronização, que roda no mesmo processo.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sync = require('./sync');
const historico = require('./historico');

const PORTA = +process.env.PORTA || 8080;
const DIR_PUBLIC = path.join(__dirname, '..', 'public');
const DIR_DADOS = process.env.DIR_DADOS || path.join(__dirname, '..', 'dados');
const CACHE_DADOS_S = +process.env.CACHE_DADOS_S || 30;

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function resolver(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  if (/^\/dados\/turno-[12](-mun-[A-Z]{2})?\.json$/.test(p)) return { arq: path.join(DIR_DADOS, path.basename(p)), dados: true };
  if (/^\/dados\/historico\/[a-z0-9-]+\.json$/.test(p)) return { arq: path.join(DIR_DADOS, 'historico', path.basename(p)), dados: false };
  if (/^\/dados\/fotos\/\d+\.jpeg$/.test(p)) return { arq: path.join(DIR_DADOS, 'fotos', path.basename(p)), dados: false };
  const rel = p === '/' ? 'index.html' : p.slice(1);
  const arq = path.resolve(DIR_PUBLIC, rel);
  if (!arq.startsWith(DIR_PUBLIC + path.sep)) return null; // bloqueia path traversal
  return { arq, dados: false };
}

const servidor = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  if (req.url === '/saude') {
    // ok continua true mesmo com coleta atrasada: o painel usa esse campo só para saber que há servidor
    const snapshots = {};
    for (const t of [1, 2]) {
      try { snapshots['turno' + t] = fs.statSync(path.join(DIR_DADOS, `turno-${t}.json`)).mtime; } catch { snapshots['turno' + t] = null; }
    }
    let hist = null;
    try { hist = fs.statSync(path.join(DIR_DADOS, 'historico', 'indice.json')).mtime; } catch { /* ainda não baixou */ }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, agora: new Date().toISOString(), snapshots, historico: hist, coletas: sync.status() }, null, 2));
  }

  const r = resolver(req.url);
  if (!r) { res.writeHead(400); return res.end(); }
  fs.readFile(r.arq, (err, corpo) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('não encontrado'); }
    const ext = path.extname(r.arq).toLowerCase();
    const cab = {
      'Content-Type': TIPOS[ext] || 'application/octet-stream',
      // snapshots: cache curto na borda do Cloudflare; site: cache moderado
      'Cache-Control': r.dados ? `public, max-age=${CACHE_DADOS_S}, s-maxage=${CACHE_DADOS_S}` : 'public, max-age=300',
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

servidor.listen(PORTA, () => {
  console.log(`painel em http://0.0.0.0:${PORTA}/`);
  if (process.env.SYNC !== '0') sync.iniciar();
  if (process.env.HISTORICO !== '0') historico.iniciarHistorico();
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => servidor.close(() => process.exit(0)));
