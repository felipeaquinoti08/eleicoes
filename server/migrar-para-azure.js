'use strict';
// Copia para o Azure Blob o que já foi coletado numa pasta de dados local (o volume Docker do modo local).
// Assim, ao trocar para o Azure, o servidor não precisa baixar tudo do TSE de novo (o que gera muitos 429).
//
//   docker compose run --rm --no-deps -v eleicoes_dados:/migrar painel node server/migrar-para-azure.js /migrar
//
// Usa as mesmas variáveis AZURE_* do .env. Por padrão não sobrescreve o que já existe no Blob;
// --sobrescrever envia tudo (para eleições encerradas o conteúdo é o mesmo).
const fs = require('fs');
const path = require('path');

const origem = process.argv[2];
const sobrescrever = process.argv.includes('--sobrescrever');
if (!origem || !fs.existsSync(origem)) {
  console.error('uso: node server/migrar-para-azure.js <pasta-de-dados> [--sobrescrever]');
  process.exit(1);
}
const armazenamento = require('./armazenamento');
if (armazenamento.MODO !== 'azure') {
  console.error('Azure Blob não configurado: preencha AZURE_STORAGE_ACCOUNT, AZURE_TENANT_ID, AZURE_CLIENT_ID e AZURE_CLIENT_SECRET.');
  process.exit(1);
}

// nomes relativos à raiz dos dados, com / como separador (o mesmo formato dos blobs)
function arquivos(dir, rel = '') {
  const saida = [];
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) saida.push(...arquivos(dir, r));
    else if (/\.(json|jpeg)$/.test(d.name)) saida.push(r);
  }
  return saida;
}

(async () => {
  await armazenamento.iniciar();
  let enviados = 0, pulados = 0;
  for (const nome of arquivos(origem)) {
    if (!sobrescrever && armazenamento.existe(nome)) { pulados++; continue; }
    armazenamento.gravar(nome, fs.readFileSync(path.join(origem, nome)));
    enviados++;
  }
  console.log(`enviando ${enviados} arquivos (${pulados} já estavam no Blob)...`);
  const ok = await armazenamento.aguardarEnvios();
  const st = armazenamento.status();
  console.log(ok ? `pronto: ${st.gravados} arquivos gravados no Azure Blob` : `parou com ${st.pendentes} pendentes: ${st.ultimoErro}`);
  process.exit(ok ? 0 : 1);
})();
