// Simulador mínimo do Entra ID e da REST API do Azure Blob, para testar server/armazenamento.js sem conta no Azure.
// node tools/simular-azure.js 10099   e no servidor: AZURE_BLOB_ENDPOINT=http://127.0.0.1:10099 AZURE_AUTHORITY=http://127.0.0.1:10099
// AZURE_STORAGE_ACCOUNT=teste AZURE_TENANT_ID=t AZURE_CLIENT_ID=c AZURE_CLIENT_SECRET=segredo-de-teste
const http = require('http');
const PORTA = +process.argv[2] || 10099;
const SEGREDO = 'segredo-de-teste';
const TOKEN = 'token-' + Math.random().toString(36).slice(2);
const blobs = new Map(); // "container/nome" -> { corpo, cab, meta, em }
const contagem = { put: 0, get: 0, list: 0, token: 0, negados: 0 };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const partes = [];
  req.on('data', d => partes.push(d)).on('end', () => {
    const corpo = Buffer.concat(partes);
    // token
    if (req.method === 'POST' && /\/oauth2\/v2\.0\/token$/.test(u.pathname)) {
      contagem.token++;
      const p = new URLSearchParams(corpo.toString());
      if (p.get('client_secret') !== SEGREDO || p.get('scope') !== 'https://storage.azure.com/.default') {
        res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_client' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ access_token: TOKEN, expires_in: 3600 }));
    }
    if (u.pathname === '/_estado') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ contagem, blobs: [...blobs.entries()].map(([k, b]) => ({ k, tam: b.corpo.length, ...b.cab, meta: b.meta })) })); }
    if (req.headers.authorization !== `Bearer ${TOKEN}` || !req.headers['x-ms-version']) { contagem.negados++; res.writeHead(403, { 'x-ms-error-code': 'AuthenticationFailed' }); return res.end(); }
    const [, container, ...resto] = u.pathname.split('/');
    const nome = resto.map(decodeURIComponent).join('/');
    if (req.method === 'GET' && u.searchParams.get('comp') === 'list') {
      contagem.list++;
      const pref = u.searchParams.get('prefix') || '';
      const itens = [...blobs.entries()].filter(([k]) => k.startsWith(container + '/' + pref)).map(([k, b]) =>
        `<Blob><Name>${k.slice(container.length + 1).replace(/&/g, '&amp;')}</Name><Properties><Last-Modified>${b.em}</Last-Modified></Properties><Metadata>${Object.entries(b.meta).map(([m, v]) => `<${m}>${v}</${m}>`).join('')}</Metadata></Blob>`);
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><EnumerationResults><Blobs>${itens.join('')}</Blobs><NextMarker/></EnumerationResults>`);
    }
    const k = `${container}/${nome}`;
    if (req.method === 'PUT') {
      contagem.put++;
      if (req.headers['x-ms-blob-type'] !== 'BlockBlob') { res.writeHead(400); return res.end(); }
      const meta = {};
      for (const [h, v] of Object.entries(req.headers)) if (h.startsWith('x-ms-meta-')) meta[h.slice(10)] = v;
      blobs.set(k, {
        corpo, meta, em: new Date().toUTCString(),
        cab: { 'content-type': req.headers['x-ms-blob-content-type'], 'cache-control': req.headers['x-ms-blob-cache-control'], 'content-encoding': req.headers['x-ms-blob-content-encoding'] },
      });
      res.writeHead(201); return res.end();
    }
    if (req.method === 'GET') {
      contagem.get++;
      const b = blobs.get(k);
      if (!b) { res.writeHead(404, { 'x-ms-error-code': 'BlobNotFound' }); return res.end(); }
      const cab = { 'Content-Length': b.corpo.length };
      for (const [h, v] of Object.entries(b.cab)) if (v) cab[h] = v;
      res.writeHead(200, cab); return res.end(b.corpo);
    }
    res.writeHead(405); res.end();
  });
}).listen(PORTA, () => console.log('mock azure em', PORTA));
