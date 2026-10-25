// Carrega as malhas de geo/<nome>.js por <script> (e não por fetch), para funcionar também
// quando a página é aberta direto do disco (file://), onde o navegador bloqueia fetch de arquivos locais.
window.GEO = window.GEO || {};
const geoPendentes = {};
function carregarGeo(nome) {
  if (GEO[nome]) return Promise.resolve(GEO[nome]);
  return geoPendentes[nome] ||= new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = `geo/${nome}.js` + (window.VERSAO_APP ? `?v=${window.VERSAO_APP}` : '');
    s.onload = () => (GEO[nome] ? ok(GEO[nome]) : falha(new Error('malha vazia: ' + nome)));
    s.onerror = () => { delete geoPendentes[nome]; falha(new Error('falha ao carregar geo/' + nome + '.js')); };
    document.head.appendChild(s);
  });
}
