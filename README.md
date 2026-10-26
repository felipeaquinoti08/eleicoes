# Apuração de Eleições

Painel ao vivo da apuração das Eleições 2026 com dados públicos do TSE: Brasil (estado e município) e exterior (continente, país, cidade e seção) num mesmo mapa clicável, com projeção do resultado final, filtros e sinal sonoro quando chegam dados novos. Funciona no navegador, no celular e na TV, e tem um modo para transmissão ao vivo.

## Acesse sem instalar nada

**👉 https://eleicoes.felipeaquino.eti.br**

Se você só quer acompanhar a apuração ou consultar o histórico, não precisa fazer deploy: o painel está no ar nesse endereço, com os mesmos recursos deste repositório (mapa, filtros, histórico das últimas eleições, modos TV e live). O restante deste README é para quem quer rodar a própria instalação.

| Endereço | O que abre |
|---|---|
| https://eleicoes.felipeaquino.eti.br | Painel (modo completo) |
| https://eleicoes.felipeaquino.eti.br/?modo=tv | Modo TV, com tour automático |
| https://eleicoes.felipeaquino.eti.br/?modo=live | Modo live, vertical 9:16 |
| https://eleicoes.felipeaquino.eti.br/historico.html | Histórico das eleições |

> **Repositório público.** Este código é aberto e qualquer pessoa pode ler, copiar e rodar o painel: https://github.com/felipeaquinoti08/eleicoes
> Os dados exibidos são públicos (TSE e IBGE). O repositório não guarda credenciais: configurações do seu servidor ficam no arquivo `.env` e os dados coletados no volume `dados`, e **nenhum dos dois vai para o git** (estão no `.gitignore`). Não faça commit de senhas, tokens, certificados ou do `.env`.

## O que tem

- **Mapa único, Brasil + exterior.** Clique num estado para ver os municípios dele, num país para ver as cidades, numa cidade do exterior para ver seção por seção. O placar, as estatísticas e o ranking mostram sempre a seleção atual. Municípios em cinza ainda não têm votos publicados pelo TSE.
- **Placar**: à esquerda fica sempre quem está na frente, e logo abaixo a diferença de votos e de pontos entre os dois primeiros. A diferença também aparece nos cards e em cada linha do ranking ("dif.").
- **Prefeitos (eleições suplementares do dia)**: lidas da configuração do TSE. No Total, a coluna da direita lista as eleições de hoje com quem lidera; no estado, os municípios com disputa; no município, o card do prefeito ao vivo com fotos.
- **Navegação**: `Total › Brasil › Região › Estado › Município` e `Total › Exterior › Continente › País › Cidade › Seção`.
- **Filtros**: turno, fonte dos dados do exterior, "ir para" (região, estado, continente, país), busca de município ou cidade, cor do mapa (quem lidera ou % de um candidato), ordenação do ranking, só locais com votos.
- **Governador no 2º turno**: pelo card do Governador na coluna da direita (ao selecionar o estado), os estados com 2º turno para governador (em 2026: AC, AM, DF, ES, RN e TO, lidos da configuração do TSE), cada um com os próprios candidatos, mapa por município, ranking e letreiro.
- **Candidatos do estado**: ao selecionar um estado ou município, a coluna da direita mostra os candidatos dos demais cargos daquele estado, um embaixo do outro, com foto (ou iniciais), e a lista de municípios logo abaixo. Governador (ao vivo no 2º turno, quando o estado tem 2º turno; senão o resultado do 1º turno), Senador e Deputados Federal e Estadual/Distrital (resultado do 1º turno, com eleitos, bancada por partido e mais votados). No modo Governador, o card do Presidente no estado aparece no lugar. Cada card leva ao mapa do cargo ou à lista completa no Histórico (`historico.html#<eleição>/<cargo>/<UF>`).
- **Projeção do resultado final** (2º turno, experimental): veja abaixo.
- **Aviso de novos dados**: a cada avanço da apuração, toca um bipe no estilo da urna e aparece um aviso dizendo onde entraram votos (estados e países do exterior), quantos e o placar em cada lugar. O navegador só libera som depois de um clique na página, então o botão 🔊 pisca até isso acontecer.

## Atualização automática do painel

A cada 5 minutos cada página aberta pergunta ao servidor (`/versao`) qual versão do painel está no ar. Se você fez um deploy com mudanças, a página avisa "Nova versão do painel" e recarrega sozinha, voltando para o mesmo lugar: filtros e configurações (salvos no navegador), local selecionado, aba do ranking, cargo e tour. Sem deploy novo, nada é recarregado: os resultados já se atualizam a cada 30 s sem recarregar a página, e assim o som continua liberado e o mapa não pisca.

## Pessoas online

Cada navegador com o painel aberto manda um sinal anônimo para `/presenca` a cada 30 s (um id aleatório guardado no próprio navegador, sem dados pessoais). O servidor conta quem deu sinal nos últimos 90 s e mostra o número no cabeçalho (👥 N online) e no `/saude`, com o pico do dia. Várias abas do mesmo navegador contam como uma pessoa. `/presenca` responde com `no-store` e não entra na regra de cache do Cloudflare (que só pega `/dados/`). A contagem fica na memória e recomeça do zero quando o container reinicia.

## Modos de exibição

| Modo | Para quê | Como abrir |
|---|---|---|
| **Completo** (padrão) | Navegador e celular. Layout horizontal no computador, empilhado com rolagem no celular. | `https://SEU-DOMINIO/` |
| **TV** | Modo completo, com o tour automático ligado e os botões escondidos. Em telas grandes (TVs 4K, monitores acima de 2200 px) os textos ficam maiores. | `https://SEU-DOMINIO/?modo=tv` |
| **Live** | Transmissão (TikTok, OBS): vertical 9:16, tour automático, blocos compactos para sobrar espaço ao mapa. | `https://SEU-DOMINIO/?modo=live` |

Também dá para trocar em ⚙ → *Modo de exibição*, ou com a tecla **L**.

## Projeção (experimental)

No 2º turno, o placar mostra uma **projeção do resultado final** para o Total, o Brasil e cada estado, com uma faixa provável e um veredito.

- **Modelo**: cada local apurado no 2º turno é comparado com ele mesmo no 1º turno. No Brasil a comparação é município a município, porque o TSE publica o Brasil por município. No exterior é seção a seção, pelos boletins de urna dos dois turnos. Por estado, separando capital e interior, o modelo mede quanto cada candidato variou em relação ao 1º turno (o que já inclui a transferência dos votos dos outros candidatos e a mudança de comparecimento) e aplica essa variação à parte que falta apurar. Onde há pouca coisa apurada, usa a variação do estado, da região ou do país.
- **Faixa provável**: reamostragem dos locais apurados (intervalo de 90%), mais uma margem mínima de segurança: 3 pontos com nada apurado, diminuindo até zero com tudo apurado.
- **Veredito**: só indica vencedor quando a faixa inteira fica de um lado dos 50%. A projeção só aparece depois de 2% do eleitorado apurado.
- **Limitação**: não foi validada com apurações anteriores, porque 2014 a 2022 não estão mais no sistema do TSE. Num teste simulado com apuração fora de ordem, o erro foi de cerca de 1 ponto com 10% apurado e quase zero a partir de 20%, mas simulações tendem a ser otimistas.
- O cálculo roda no servidor (`server/projecao.js`) a cada passada da coleta e é publicado em `dados/projecao-2.json`. Precisa da base municipal do 1º turno, que o job baixa na primeira hora depois de subir o container. Desligue em ⚙ → *Projeção*.

## Histórico: as últimas 10 eleições

A página **📜 Histórico** (`/historico.html`) é organizada **por eleição**. Cada item da lista é uma eleição inteira, com abas de turno e de cargo:

| Eleição | Cargos | Fonte |
|---|---|---|
| Eleições Gerais 2026, 2022, 2018, 2014, 2010 | Presidente (Brasil, estados e exterior), Governador, Senador, Deputado Federal, Estadual e Distrital (por estado) | Portal de Dados Abertos do TSE · 2º turno de 2026: coleta ao vivo do painel |
| Eleições Municipais 2024, 2020, 2016, 2012, 2008 | Prefeito (todos os municípios) e Vereador (capitais) | Portal de Dados Abertos do TSE |
| Eleições suplementares | As 20 mais recentes (prefeitos, vereadores, governador), num grupo à parte | sistema de resultados do TSE |

Em cada uma: mapa do Brasil pelo partido mais votado, filtro por local, candidatos com a situação (eleito, 2º turno) e, nos cargos proporcionais, os 40 mais votados, todos os eleitos e os votos nominais por partido.

**Detalhamento por município**, igual ao do painel ao vivo: em Presidente, Governador, Senador e Prefeito, clicar num estado abre o mapa dos municípios (cor do partido mais votado, mais forte quanto maior a vantagem, com os 3 primeiros ao passar o mouse) e, na coluna da direita, a lista de municípios do estado. Clicar num município mostra o resultado completo dele, e o botão **←** volta ao estado. Em Prefeito, o filtro de local tem **Todos os municípios do estado** além das capitais. Os arquivos ficam em `server/historico-base/mun/<eleição>/<cargo>-<UF>.json` (cerca de 17 MB no total) e só são baixados pelo navegador quando o estado é aberto. Deputados e vereadores continuam por estado/capital (são centenas de candidatos por município). Quando uma eleição nova termina, o servidor gera esse detalhamento a partir do que o painel coletou ao vivo.

**Eleições novas entram sozinhas.** A cada 6 horas o servidor confere a configuração do TSE: quando aparece uma eleição ordinária nova (gerais ou municipais), ela é baixada e passa a fazer parte do histórico quando a apuração termina, sem mudar o código. O card **📜 Histórico** do `/saude` mostra quantas eleições há, a última conferência, as que entraram nela e as que ainda estão com a apuração em andamento.

**Já vem pronto na imagem.** As eleições estão resumidas em `server/historico-base/` (cerca de 3 MB, mais 17 MB do detalhamento por município), que vai junto no repositório e no Docker: o histórico aparece assim que o container sobe, sem depender do TSE. O job `server/historico.js` só baixa o que ainda não está na base (eleições novas e suplementares) e guarda em `dados/historico/`.

**Atualizar a base com os Dados Abertos** (fora do container, quando sair um ano novo):
```bash
# baixe os zips de https://cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/ e .../detalhe_votacao_munzona/
node tools/importar-dados-abertos.js <pasta-com-os-zips> 2022 2020 2018
```
O sistema de resultados do TSE só publica os ciclos 2024 e 2026; por isso o histórico vem dos Dados Abertos, que também trazem o resultado por município. Os totais conferem com os resultados oficiais (ex.: 2022, Lula 50,90% no 2º turno; 2018, Bolsonaro 55,13%; 2014, Dilma 51,64%).

## Ao vivo ou resultados

O servidor decide sozinho, pela data da eleição na configuração do TSE e pelo andamento da apuração:
- **Ao vivo**: no dia da votação e, depois dele (até 3 dias), enquanto a apuração não chega a 100%. O selo mostra **AO VIVO**, e há projeção, aviso de novos dados com bipe e alerta quando o TSE para de publicar.
- **Resultados**: fora disso. O selo vira **RESULTADO FINAL**, o vencedor ganha **✓ ELEITO** e saem a projeção e os avisos de apuração.

Num deploy do zero (volume vazio), se a eleição do painel já está no histórico embutido, o servidor começa por ela: o resultado aparece na hora, mesmo que o TSE esteja limitando requisições, e a coleta completa por cima depois.

## Fontes de dados (TSE)

Tudo vem de `https://resultados.tse.jus.br/oficial/ele2026/`, os mesmos arquivos públicos usados pelo app Resultados do TSE.

| Dado | Arquivo | Quando sai |
|---|---|---|
| Total do país | `<eleição>/dados/br/br-c0001-e<eleição>-u.json` | após as 17h de Brasília |
| Por estado | `<eleição>/dados/<uf>/<uf>-c0001-e<eleição>-u.json` | após as 17h |
| Estatística de todos os municípios de um estado | `<eleição>/dados/<uf>/<uf>-e<eleição>-ab.json` | após as 17h |
| Por município | `<eleição>/dados/<uf>/<uf><município>-c0001-e<eleição>-u.json` | após as 17h |
| Boletim de urna (BU) de cada seção do exterior | `arquivo-urna/<pleito>/dados/zz/<cidade>/<zona>/<seção>/...` | assim que a seção transmite |

Códigos de 2026: 1º turno = eleição 6257 / pleito 3220; 2º turno = eleição 6258 / pleito 3221. O exterior usa a "UF" `zz`.

**Fonte dos dados do exterior** (opção nos filtros):
- *Boletins de urna*: o BU é o arquivo assinado que cada urna gera ao fechar a votação. O painel decodifica o formato binário (ASN.1) e soma os votos seção por seção, então o exterior aparece antes da divulgação oficial.
- *Totalização oficial*: os totais do TSE por cidade do exterior.
- *Automático* (padrão): em cada cidade, usa a fonte com mais seções apuradas.

No Brasil a fonte é sempre a totalização oficial, já que baixar os cerca de 470 mil BUs não é viável.

## Arquitetura

```
TSE ──► server/sync.js (job) ──► dados/*.json ──► server/server.js ──► Nginx Proxy Manager ──► Cloudflare ──► navegadores
```

- O **job de sincronização** é o único cliente que fala com o TSE. A cada ciclo (5 min por padrão) baixa o total do país, as 27 UFs, o exterior e os BUs novos. Os municípios rodam num loop separado e incremental: o arquivo agregado de cada UF diz quais municípios mudaram, e só esses são baixados.
- Os resultados ficam em snapshots (`dados/turno-N.json` e `dados/turno-N-mun-<UF>.json`). O painel lê só esses arquivos, então o número de espectadores não aumenta a carga sobre o TSE, que em dia de eleição responde muito HTTP 429. O job tenta de novo com espera crescente e mantém o último dado bom quando algo falha.
- Tudo o que foi coletado (snapshots, BUs decodificados, municípios, projeção, histórico) fica na pasta `dados/` do servidor. Ao subir de novo, o servidor entrega esses arquivos na hora, e o ciclo de coleta só atualiza por cima.
- Opcionalmente, os dados ficam no **Azure Blob** e o navegador os lê direto de lá, pela CDN, sem passar pelo servidor (veja [Armazenamento no Azure Blob](#armazenamento-no-azure-blob-opcional)).
- Sem servidor (abrindo os arquivos de `public/` com `servidor.ps1`), o painel percebe que `/saude` não existe e consulta o TSE direto do navegador.

## Rodar com Docker

O container não publica porta no host: ele entra na rede Docker do Nginx Proxy Manager, e só o NPM o acessa.

```bash
docker network ls                                  # descubra o nome da rede do NPM (ex.: npm_default)
cp .env.example .env                               # e ponha esse nome em NPM_REDE
docker compose up -d --build
docker compose logs -f painel                      # acompanha a sincronização
docker inspect --format "{{.State.Health.Status}}" apuracao-eleicoes   # healthy quando o servidor responde
```

### Variáveis (em `docker-compose.yml`)

| Variável | Padrão | Uso |
|---|---|---|
| `SYNC_BRASIL_S` | `30` | De quantos em quantos segundos conferir se o TSE publicou dados novos do Brasil e do governador. As UFs só são baixadas quando há novidade |
| `SYNC_INTERVALO_MIN` | `5` | Intervalo da coleta dos boletins de urna do exterior |
| `TURNOS` | `2,1` | Turnos sincronizados (o 1º turno, já encerrado, a cada 60 min) |
| `TURNOS_MUN` | `2,1` | Turnos com resultado por município |
| `GOVERNADOR` | `1` | `0` desliga a coleta do 2º turno para governador |
| `SUPLEMENTARES` | `1` | `0` desliga a coleta das eleições suplementares do dia (prefeitos) |
| `CACHE_DADOS_S` | `15` | `max-age`/`s-maxage` dos snapshots (cache do Cloudflare e do navegador) |
| `CONCORRENCIA` | `4` | Downloads simultâneos ao TSE. Se o `/saude` mostrar muitos 429, baixe para 2 |
| `PORTA` | `8080` | Porta do servidor dentro do container |
| `HISTORICO` | `1` | `0` desliga o download do histórico |
| `HISTORICO_QTD` | `20` | Quantas eleições suplementares entram no histórico |
| `SUPLEMENTARES_DIAS` | `7` | Até quantos dias depois as suplementares continuam no painel |

No `.env`: `NPM_REDE` (rede do Nginx Proxy Manager, obrigatória) e `DADOS` (opcional, pasta absoluta para os dados no lugar do volume). As variáveis do Azure Blob (`AZURE_*` e `DADOS_URL_PUBLICA`) também ficam no `.env`; veja a seção [Armazenamento no Azure Blob](#armazenamento-no-azure-blob-opcional).

### Dados persistentes entre deploys

Os resultados coletados ficam no **volume Docker `<projeto>_dados`** (com `-p eleicoes`, o volume `eleicoes_dados`). O volume sobrevive a `git pull`, rebuild e redeploy, e o servidor entrega o que já está nele assim que sobe. Ao iniciar, o log mostra o que está sendo servido:

```
servindo dados já gravados imediatamente: turno-2.json (2026-10-25T20:51:57Z), …, 32 arquivos de municípios
```

Cuidados para não perder os dados:
- use sempre o mesmo nome de projeto (`-p eleicoes`); outro nome cria outro volume, vazio;
- não use `docker compose down -v` (o `-v` apaga o volume);
- para guardar numa pasta do servidor em vez do volume, defina `DADOS=/caminho/absoluto` no `.env`, **fora** da pasta do projeto. Ferramentas de deploy costumam recriar a pasta do projeto e apagariam os dados.

Para conferir o que há no volume:
```bash
docker run --rm -v eleicoes_dados:/d alpine ls -la /d
```

O container começa como root só para acertar o dono da pasta de dados, e em seguida o servidor passa a rodar como o usuário `node` (uid 1000).

### Como saber se a coleta está funcionando

**1. Página `/saude`**: abra `https://SEU-DOMINIO/saude` no navegador (nunca fica em cache). Ela mostra um semáforo geral, pessoas online agora e o pico do dia, se o TSE está limitando (429) e o estado de cada coleta, e se atualiza a cada 10 s. Scripts e o healthcheck recebem o mesmo conteúdo em JSON (ou use `/saude.json`). Para cada turno há as coletas `brasil` (total e UFs), `exterior` (boletins de urna), `municipios` e `projecao`. Em cada uma:

| Campo | O que indica |
|---|---|
| `ok` / `erro` | se a última passada deu certo, e o erro quando não deu |
| `ultimoSucesso` / `proxima` | quando rodou pela última vez e quando roda de novo (UTC) |
| `rodando` | `true` enquanto a passada está em andamento (o exterior pode levar minutos com os 429 do TSE) |
| `secoesApuradas`, `secoesComBU`, `municipiosComDados` | quanto já foi coletado |
| `tseGeradoEm` | horário em que o **TSE** gerou o dado (Brasília) |

Se `ultimoSucesso` avança a cada ciclo, a coleta está funcionando. Se `secoesApuradas` não muda, mas `tseGeradoEm` também não mudou, é o TSE que ainda não publicou dados novos.

**2. Logs**: `docker compose -p eleicoes logs -f painel`. A cada ciclo aparecem linhas como:
```
turno 2: Brasil 214 seções nas UFs em 1.0s
turno 2: exterior 775/1351 seções com BU (0 novos, 0 falhas), oficial 0/1351 em 0.6s
turno 2: municípios 49 atualizados, 0 falhas em 2s
```
Linhas `aviso: 429 …` são normais em dia de eleição: o job tenta de novo sozinho. Preocupe-se só com `erro …` repetido em vários ciclos.

**3. No painel**: o topo mostra "atualizado HH:MM:SS", que é o horário do último snapshot gravado pelo job.

### ARM e x86

A imagem base `node:22-alpine` é publicada para **amd64 (x86)**, **arm64** (Oracle Ampere, AWS Graviton, Raspberry Pi 4/5 com sistema 64 bits) e **arm/v7** (ARM 32 bits). O app é JavaScript puro, sem dependências nativas. Em qualquer um desses servidores, `docker compose up -d --build` gera a imagem da arquitetura da própria máquina, sem nenhuma mudança.

Para gerar num computador uma imagem que rode nas duas arquiteturas (por exemplo, para publicar num registry):

```bash
docker buildx create --use                     # uma vez
docker buildx build --platform linux/amd64,linux/arm64 -t SEU_REGISTRY/apuracao-eleicoes:latest --push .
```

Se a imagem Alpine der problema em alguma placa ARM, dá para trocar a base sem mexer no resto: `docker compose build --build-arg NODE_IMAGE=node:22-bookworm-slim`.

## Armazenamento no Azure Blob (opcional)

Sem configurar nada, tudo funciona como descrito acima: os dados ficam na pasta do servidor e ele mesmo os entrega. Com o Azure Blob, o servidor só **coleta e grava**; quem lê os dados é o **navegador**, direto do Blob, com uma CDN fazendo cache na frente. O tráfego dos visitantes deixa de passar pelo servidor, e nada fica gravado no container.

```
TSE ──► servidor (coleta) ──grava──► Azure Blob (privado) ◄── Cloudflare (cache) ◄── navegador: dados
                                                                                  navegador: páginas ──► NPM ──► servidor
```

### Escolha o seu caminho

| Caminho | Para quem | O que precisa |
|---|---|---|
| **1. Local** (padrão) | Quem não quer Azure | Nada. Volume Docker, como sempre |
| **2. Azure + regras do Cloudflare** (recomendado) | Domínio no Cloudflare, inclusive no plano **Free** | Azure com domínio personalizado + regras gratuitas do Cloudflare. Sem custo de Worker |
| **3. Azure + Cloudflare Worker** | Domínio no Cloudflare, quando não puder usar domínio personalizado no Blob | Azure + o Worker de `cloudflare/worker.js` |
| **4. Azure sem Cloudflare** | Quem não usa Cloudflare ou não pode mexer nele | Azure. O servidor repassa os dados do Blob (dá para pôr cache no Nginx) |

Nos caminhos 2 a 4, o container do Blob é **privado**: ninguém lê direto de `*.blob.core.windows.net`, então o tráfego passa pelo cache e o custo de saída do Azure fica previsível.

### Segurança: o que fica onde

| Credencial | Onde fica | O que permite |
|---|---|---|
| Service principal (`AZURE_CLIENT_SECRET`) | Só no `.env` do servidor | Ler, criar e sobrescrever blobs nos dois containers do projeto. **Não apaga** nada (papel personalizado `Eleicoes Gravador Blob`) |
| SAS de leitura | Só no Cloudflare (regra ou secret do Worker) | Ler blobs do container público. Não lista, não grava, não vê o container interno. Revogável apagando a política `leitura-cdn` |
| Chaves da storage account | Só no Azure | Não são usadas em lugar nenhum. Ficam ativas só porque assinam o SAS |

- O repositório é público: **nenhum valor vai para o Git**. O `.env.example` traz só os nomes das variáveis.
- O servidor nunca escreve o segredo nem o token nos logs ou no `/saude`. Uma falha de login aparece só como `Entra ID recusou o login do service principal (HTTP 401, invalid_client)`.
- São dois containers: `eleicoes` (o que o navegador lê) e `eleicoes-interno` (estado da coleta, `cache-*.json`). O SAS do Cloudflare só alcança o primeiro.
- A lixeira (30 dias) e o versionamento ficam ativos: nada sobrescrito ou apagado se perde. As versões com mais de 7 dias são apagadas pelo próprio Azure (o snapshot da apuração é regravado a cada 30 s).
- O segredo vale 1 ano. Com `AZURE_CLIENT_SECRET_EXPIRA` preenchido, o `/saude` avisa 30 dias antes.

### Passo 1: criar o armazenamento no Azure

No [Azure Cloud Shell](https://shell.azure.com) (Bash), com este repositório clonado:

```bash
CONTA=eleicoesdados123 RG=rg-eleicoes LOCAL=brazilsouth bash azure/configurar.sh
```

O script cria a storage account (privada, só HTTPS e TLS 1.2+), a lixeira, o versionamento, a regra de ciclo de vida, os dois containers, o papel personalizado, o service principal com esse papel nos dois containers e o SAS de leitura. No final, ele mostra **uma vez** as linhas para o `.env` e o SAS para o Cloudflare. Copie e feche o terminal.

<details><summary>Prefere fazer pelo portal?</summary>

1. **Storage account**: StorageV2, redundância LRS. Em *Configuração*: "Permitir acesso anônimo ao Blob" **desativado**, "Transferência segura" ativada, TLS mínimo 1.2.
2. **Proteção de dados**: exclusão temporária de blobs e de contêineres (30 dias) e controle de versão ativados.
3. **Gerenciamento do ciclo de vida**: regra que exclui versões anteriores com mais de 7 dias (`azure/ciclo-de-vida.json`).
4. **Contêineres** `eleicoes` e `eleicoes-interno`, nível de acesso **Privado**.
5. **Papel personalizado** na assinatura, a partir de `azure/papel-gravador.json` (troque `SUBSCRIPTION_ID`).
6. **Registro de aplicativo** no Entra ID → *Certificados e segredos* → novo segredo com validade de 12 meses. Anote o ID do aplicativo, o ID do locatário e o segredo.
7. Em cada contêiner → *Controle de acesso (IAM)*: atribua o papel `Eleicoes Gravador Blob` ao aplicativo.
8. No contêiner `eleicoes` → *Política de acesso*: política `leitura-cdn` com permissão só de **Leitura** e validade de 1 ano. Depois, *Gerar SAS* usando essa política, só HTTPS. Guarde o token, sem o `?`.
</details>

### Passo 2 (caminho 2): regras do Cloudflare

Funciona no plano **Free**. O plano Free não deixa reescrever o Host na Origin Rule, então quem passa a aceitar o seu subdomínio é o Azure, com o **domínio personalizado** da storage account. Exemplo com o subdomínio `dados-eleicoes.seu-dominio` e a conta `eleicoesdados123`:

> **Use um subdomínio de um nível só** (`dados-eleicoes.seu-dominio`, e não `dados.eleicoes.seu-dominio`). O certificado grátis do Cloudflare cobre só `*.seu-dominio`. Com dois níveis, o HTTPS falha no handshake, a menos que você contrate o Advanced Certificate Manager.

1. **DNS no Cloudflare**, dois registros `CNAME`:
   - `asverify.dados-eleicoes` → `asverify.eleicoesdados123.blob.core.windows.net`, **sem proxy** (nuvem cinza). Serve só para o Azure validar o domínio.
   - `dados-eleicoes` → `eleicoesdados123.blob.core.windows.net`, **com proxy** (nuvem laranja).
2. **Domínio personalizado no Azure** (depois que o DNS propagar):
   ```bash
   az storage account update -g rg-eleicoes -n eleicoesdados123 --custom-domain dados-eleicoes.seu-dominio --use-subdomain true
   ```
   Pelo portal: storage account → *Rede* → *Domínio personalizado*, marcando **Usar validação CNAME indireta**.
3. **Rules → Configuration Rules**: quando *Hostname equals* `dados-eleicoes.seu-dominio`, **SSL → Full**. Tem que ser *Full*, não *Full (strict)*: o Azure responde com o certificado `*.blob.core.windows.net`, que não tem o nome do seu subdomínio. A conexão Cloudflare → Azure continua criptografada. Só a conferência do nome no certificado fica de fora, e só para esse subdomínio.
4. **Rules → Transform Rules → Rewrite URL**: mesmo hostname, *Path* sem alteração, **Query → Rewrite to → Static**: cole o SAS (sem o `?`). Assim o SAS nunca chega ao navegador, e parâmetros inventados por visitantes são descartados e não furam o cache.
5. **Rules → Transform Rules → Modify Response Header**: mesmo hostname, **Set** `Access-Control-Allow-Origin` = `https://eleicoes.seu-dominio` (o endereço do painel).
6. **Caching → Cache Rules**: mesmo hostname, **Eligible for cache**. *Edge TTL*: "Use cache-control header if present". *Browser TTL*: "Respect origin". Opcional: TTL de 15 s para o status 404. Por padrão o Cloudflare não faz cache de `.json`, por isso essa regra é necessária.
7. No `.env` do servidor: `DADOS_URL_PUBLICA=https://dados-eleicoes.seu-dominio/eleicoes/` (com o nome do container no fim).

Não é preciso criar nenhuma Origin Rule. Em planos pagos, que permitem reescrever o Host e o SNI, dá para trocar os passos 1 a 3 por uma Origin Rule (Host e SNI = `eleicoesdados123.blob.core.windows.net`) com SSL *Full (strict)*.

Cada arquivo é gravado no Blob com o seu `Cache-Control`, e o Cloudflare respeita esse valor:

| Arquivos | Cache no Cloudflare |
|---|---|
| Apuração (`turno-*.json`, `gov-2.json`, `sup-hoje.json`, `projecao-2.json`) | 15 s (`CACHE_DADOS_S`) |
| Índice do histórico | 60 s |
| Eleições do histórico | 1 h |
| Detalhamento por município do histórico | 1 dia |
| Fotos | 7 dias |

**Conferir:**
```bash
curl -sI https://dados-eleicoes.seu-dominio/eleicoes/turno-2.json | grep -iE "^HTTP|cf-cache-status|cache-control"
# 200; na segunda chamada, cf-cache-status: HIT
curl -sI https://eleicoesdados123.blob.core.windows.net/eleicoes/turno-2.json | head -1
# 404 ou 409: o container não é público, o acesso direto não funciona
```

### Passo 2 (caminho 3): Cloudflare Worker

Se não puder usar domínio personalizado na storage account, ou se quiser SSL *Full (strict)* até o Azure no plano Free, use o Worker de [`cloudflare/worker.js`](cloudflare/worker.js):

1. **Workers & Pages → Create → Worker**: cole o conteúdo do arquivo.
2. **Settings → Variables**: `AZURE_STORAGE_ACCOUNT`, `AZURE_CONTAINER` (`eleicoes`), `ORIGEM_PERMITIDA` (`https://eleicoes.seu-dominio`) e, como **Secret**, `AZURE_SAS` (o SAS, sem o `?`).
3. **Domains & Routes**: adicione o domínio `dados-eleicoes.seu-dominio`.
4. No `.env`: `DADOS_URL_PUBLICA=https://dados-eleicoes.seu-dominio/` (sem o container no fim; o Worker já o acrescenta).

O Worker faz cache no próprio Cloudflare e respeita o `Cache-Control` de cada arquivo. Ele roda em **toda** requisição, mesmo nas que vêm do cache. O plano gratuito permite 100 mil requisições por dia, o que basta fora de eleição. Em dia de apuração, com milhares de pessoas atualizando a cada 15 s, esse limite acaba em poucas horas, então use o plano pago do Workers ou o caminho 2.

### Passo 2 (caminho 4): sem Cloudflare

Deixe `DADOS_URL_PUBLICA` vazio. O navegador continua pedindo `/dados/...` ao servidor, que busca o arquivo no Blob e o repassa com o mesmo `Cache-Control`. Nada fica no container, mas o tráfego passa pelo servidor. Para aliviar, ponha cache no Nginx Proxy Manager:

1. No servidor do NPM, crie `/data/nginx/custom/http_top.conf` com:
   ```nginx
   proxy_cache_path /data/nginx/cache/eleicoes levels=1:2 keys_zone=eleicoes:10m max_size=500m inactive=1h;
   ```
2. No proxy host do painel → **Advanced**:
   ```nginx
   location /dados/ {
     proxy_pass http://apuracao-eleicoes:8080;
     proxy_cache eleicoes;
     proxy_cache_valid 200 15s;
     proxy_cache_valid 404 15s;
     proxy_cache_lock on;
     proxy_cache_use_stale updating error timeout;
     add_header X-Cache $upstream_cache_status;
   }
   ```

Outra CDN também serve, desde que consiga acrescentar uma query string fixa (o SAS) às requisições para a origem e fazer cache respeitando o `Cache-Control`. A configuração segue a mesma lógica do caminho 2. Não recomendo tornar o container público: qualquer pessoa poderia chamar o Blob direto, fora do cache, e a conta de tráfego seria sua.

### Passo 3: ligar no servidor

Preencha no `.env` as linhas mostradas pelo script e o `DADOS_URL_PUBLICA`, e faça o redeploy. Na primeira subida, o servidor envia ao Blob o histórico embutido na imagem (cerca de 880 arquivos, uma vez só) e passa a gravar a apuração lá. No `/saude`, o card **💾 Armazenamento** mostra a conta, de onde o navegador lê, os envios pendentes, a última gravação e quantos dias faltam para o segredo vencer.

- **Se o Azure ficar fora do ar**, a coleta continua, as gravações esperam numa fila com novas tentativas, e o `/saude` mostra os pendentes.
- **Para voltar ao modo local**, apague as variáveis `AZURE_*` do `.env` e faça o redeploy.
- **Para trocar o segredo**, gere um novo no Entra ID, atualize o `.env` e faça o redeploy. Depois apague o segredo antigo.
- **Para revogar o SAS**, apague a política `leitura-cdn` do container e gere outra.

**Testar sem conta no Azure:** `node tools/simular-azure.js 10099` sobe um simulador do Entra ID e do Blob. Rode o servidor com `AZURE_BLOB_ENDPOINT=http://127.0.0.1:10099 AZURE_AUTHORITY=http://127.0.0.1:10099 AZURE_STORAGE_ACCOUNT=teste AZURE_TENANT_ID=t AZURE_CLIENT_ID=c AZURE_CLIENT_SECRET=segredo-de-teste`.

## Publicar com Nginx Proxy Manager

Caminho: visitante → Cloudflare → Nginx Proxy Manager → container.

**No NPM**, crie um *Proxy Host*:
- *Domain Names*: o seu domínio
- *Scheme* `http`, *Forward Hostname* `apuracao-eleicoes`, *Forward Port* `8080`
- **Cache Assets: desligado.** Essa opção força cache longo em `.js`/`.css`, e o navegador do visitante ficaria com a versão antiga do painel. O próprio app já envia os cabeçalhos de cache certos.
- *Block Common Exploits*: pode ligar. *Websockets*: não precisa.
- Na aba *SSL*: o certificado de origem do Cloudflare (ou Let's Encrypt), com *Force SSL*.

**Cache dos resultados**: configure no **painel do Cloudflare**, não no NPM. Em *Caching → Cache Rules → Create rule*:
- *Quando*: `URI Path` começa com `/dados/`
- *Então*: **Qualificado para cache** (*Eligible for cache*)
- *TTL da borda*: **Use o cabeçalho de controle de cache, se presente, e ignore o cache, caso contrário** (deixe o campo de TTL vazio e não adicione TTL por código de status)
- *Navegador TTL*, *Chave do cache*, *Vary* e as demais opções: deixe sem configurar

Para conferir, rode duas vezes `curl -sI https://SEU-DOMINIO/dados/turno-2.json | grep -i cf-cache-status`: deve dar `MISS` e depois `HIT`. Se aparecer `DYNAMIC`, a regra não está valendo.

É preciso porque o Cloudflare não faz cache de `.json` por padrão. O app manda `Cache-Control: max-age=30` nos snapshots, então cada ponto de presença do Cloudflare busca os resultados no NPM no máximo duas vezes por minuto, não importa quantas pessoas estejam assistindo. `/saude` responde com `no-store` e nunca fica em cache.

**Ajuste obrigatório: Browser Cache TTL.** Em *Caching → Configuration → Browser Cache TTL*, escolha **Respect Existing Headers** (*Respeitar cabeçalhos existentes*). O padrão do Cloudflare (4 horas) sobrescreve o `Cache-Control` do app e faz o navegador guardar arquivos velhos por horas. Para conferir, rode `curl -sI https://SEU-DOMINIO/app.js | grep -i cache-control`: deve mostrar `max-age=300`, e não `max-age=14400`.

**Depois de atualizar o app**: o HTML sai sem cache e com `?v=<versão>` em cada `.js`/`.css`, então o navegador sempre pega a versão nova. Se uma atualização antiga ficou presa no cache, faça uma vez *Caching → Configuration → Purge Everything*.

## Rodar na sua máquina, sem Docker (Windows)

Clique duas vezes em **`INICIAR.bat`**. Na primeira vez ele baixa um Node.js portátil para a pasta `runtime\` (nada é instalado no sistema), sobe o servidor com o job de sincronização e abre http://localhost:8080.

Alternativa mais leve: `powershell -ExecutionPolicy Bypass -File servidor.ps1` serve só o site, e o navegador consulta o TSE direto (sem job e sem municípios em lote).

## Atalhos de teclado

| Tecla | Ação |
|---|---|
| `F` | Abre/fecha os filtros |
| `L` | Alterna entre modo completo e modo live (vertical 9:16) |
| `T` | Liga/desliga o tour automático |
| `S` | Liga/desliga o som |
| `R` | Atualiza agora |
| `Esc` / `Backspace` | Volta ao total / sobe um nível |

## Estrutura

```
public/            site estático (index.html, historico.html, app.js, bu.js, som.js, estilos, mapas)
  geo/             malhas do IBGE: estados e municípios por UF
  cidades.js       cidades do exterior com país e coordenadas
  municipios.js    municípios (código TSE -> UF, nome, código IBGE, capital)
server/sync.js     job de sincronização com o TSE
server/projecao.js  projeção do 2º turno a partir do 1º turno
server/governador.js coleta do 2º turno para governador
server/suplementares.js eleições suplementares do dia (prefeitos)
public/outros-cargos.js  cards dos outros cargos ao selecionar um estado
server/historico.js job do histórico (baixa o que falta da base)
server/historico-base/ eleições resumidas, embutidas na imagem
tools/importar-dados-abertos.js gera a base a partir dos Dados Abertos do TSE
server/server.js   servidor HTTP (site + snapshots + /saude)
server/armazenamento.js onde os dados ficam: pasta local ou Azure Blob
azure/             script e papel personalizado para criar o armazenamento no Azure
cloudflare/worker.js alternativa às regras do Cloudflare para ler o Blob privado
tools/simular-azure.js simulador do Azure Blob para testes, sem conta no Azure
iniciar.ps1        roda tudo localmente com Node portátil
```

## Observações

- Votos digitados em número inexistente contam como nulos, como na totalização oficial.
- Mapas: IBGE (estados e municípios) e Natural Earth (mundo), ambos de uso livre. Fotos dos candidatos: TSE.
- Os dados são públicos e oficiais, mas este painel não é um produto do TSE. Em caso de divergência, vale o site oficial do TSE.
