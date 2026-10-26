// Cloudflare Worker: alternativa às regras do Cloudflare (Origin Rule + Transform Rule) para servir os dados do
// container privado do Azure Blob. O SAS só de leitura fica num secret do Worker (AZURE_SAS), nunca no código.
//
// Variáveis do Worker (Settings > Variables):
//   AZURE_STORAGE_ACCOUNT  nome da storage account
//   AZURE_CONTAINER        container público (padrão: eleicoes)
//   AZURE_SAS              secret: o SAS gerado por azure/configurar.sh (sem o "?")
//   ORIGEM_PERMITIDA       endereço do painel, ex.: https://eleicoes.seu-dominio (CORS)
// Rota: dados.seu-dominio/*   ·   No .env do servidor: DADOS_URL_PUBLICA=https://dados.seu-dominio/
const NOME_VALIDO = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.(json|jpeg)$/i;

export default {
  async fetch(req, env, ctx) {
    const cors = { 'Access-Control-Allow-Origin': env.ORIGEM_PERMITIDA || '*', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: cors });
    const url = new URL(req.url);
    const nome = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!NOME_VALIDO.test(nome)) return new Response('não encontrado', { status: 404, headers: cors });

    // cache do Cloudflare, com chave sem query string (parâmetros inventados não furam o cache)
    const chave = new Request(`https://${url.host}/${nome}`, { method: 'GET' });
    const cache = caches.default;
    let resp = await cache.match(chave);
    if (!resp) {
      const conta = env.AZURE_STORAGE_ACCOUNT, container = env.AZURE_CONTAINER || 'eleicoes';
      const origem = await fetch(`https://${conta}.blob.core.windows.net/${container}/${nome}?${env.AZURE_SAS}`);
      if (origem.status === 404) {
        resp = new Response('não encontrado', { status: 404, headers: { 'Cache-Control': 'public, max-age=15' } });
      } else if (!origem.ok) {
        return new Response('indisponível', { status: 502, headers: { ...cors, 'Cache-Control': 'no-store' } });
      } else {
        // repassa só os cabeçalhos úteis (nada de x-ms-*); o Cache-Control é o que o servidor gravou no blob
        const h = new Headers();
        for (const k of ['content-type', 'cache-control', 'etag', 'last-modified']) if (origem.headers.get(k)) h.set(k, origem.headers.get(k));
        resp = new Response(origem.body, { status: 200, headers: h });
      }
      ctx.waitUntil(cache.put(chave, resp.clone()));
    }
    resp = new Response(req.method === 'HEAD' ? null : resp.body, resp);
    for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
    return resp;
  },
};
