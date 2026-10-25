# Apuração de Eleições

Painel ao vivo da apuração das Eleições 2026 com dados públicos do TSE: Brasil (estado e município) e exterior (continente, país, cidade e seção) num mesmo mapa clicável, com projeção do resultado final, filtros e sinal sonoro quando chegam dados novos. Funciona no navegador, no celular e na TV, e tem um modo para transmissão ao vivo.

## O que tem

- **Mapa único, Brasil + exterior.** Clique num estado para ver os municípios dele, num país para ver as cidades, numa cidade do exterior para ver seção por seção. O placar, as estatísticas e o ranking mostram sempre a seleção atual. Municípios em cinza ainda não têm votos publicados pelo TSE.
- **Navegação**: `Total › Brasil › Região › Estado › Município` e `Total › Exterior › Continente › País › Cidade › Seção`.
- **Filtros**: turno, fonte dos dados do exterior, "ir para" (região, estado, continente, país), busca de município ou cidade, cor do mapa (quem lidera ou % de um candidato), ordenação do ranking, só locais com votos.
- **Projeção do resultado final** (2º turno, experimental): veja abaixo.
- **Sinal sonoro**: bipe no estilo da urna e um aviso "NOVOS DADOS" sempre que a apuração avança. O navegador só libera som depois de um clique na página, então o botão 🔊 pisca até isso acontecer.

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

## Histórico (últimas 20 eleições)

A página **📜 Histórico** (`/historico.html`) mostra as últimas 20 eleições com resultado publicado no sistema do TSE, de qualquer cargo:

- Eleição Geral 2026, 1º turno: Presidente (Brasil, estados e exterior) e Governador, Senador, Deputado Federal, Estadual e Distrital por estado.
- Eleições Municipais 2024, 1º e 2º turno: Prefeito e Vereador nas capitais.
- As eleições suplementares mais recentes (prefeitos, vereadores e o governo de Roraima), lidas da configuração do próprio TSE, então a lista se atualiza sozinha.

Para cada eleição: mapa do Brasil colorido pelo partido mais votado, filtro por cargo e por local, candidatos com a situação (eleito, 2º turno) e, nos cargos proporcionais, os 40 mais votados e todos os eleitos, além dos votos nominais por partido.

O job `server/historico.js` baixa tudo uma vez (cerca de 1 minuto), guarda em `dados/historico/` e confere de novo a cada 6 horas.

**Sobre 2022 e 2020**: o sistema de resultados do TSE (`resultados.tse.jus.br`) só publica hoje os ciclos 2024 e 2026; os arquivos de 2022 e 2020 respondem 404. Esses anos existem no [Portal de Dados Abertos do TSE](https://dadosabertos.tse.jus.br/), em CSVs grandes, e podem ser importados depois.

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

### Dados persistentes entre deploys

Os resultados ficam na pasta **`dados/` ao lado do `docker-compose.yml`**, montada no container. Ela está no `.gitignore`, então `git pull` não mexe nela, e sobrevive a rebuild, `down -v` e troca de nome do projeto. Ao subir, o log mostra o que já está sendo servido:

```
servindo dados já gravados imediatamente: turno-2.json (2026-10-25T20:51:57Z), …, 32 arquivos de municípios
```

O container começa como root só para acertar o dono dessa pasta, e em seguida o servidor passa a rodar como o usuário `node` (uid 1000).

**Vindo de uma versão anterior (volume nomeado)?** Copie os dados do volume antigo para a pasta uma vez, antes do novo `up`:
```bash
docker volume ls | grep dados                       # ex.: eleicoes_dados
mkdir -p dados
docker run --rm -v eleicoes_dados:/de -v "$(pwd)/dados":/para alpine cp -a /de/. /para/
```

| Variável | Padrão | Uso |
|---|---|---|
| `SYNC_INTERVALO_MIN` | `5` | Intervalo da sincronização do turno em andamento |
| `TURNOS` | `2,1` | Turnos sincronizados (o 1º turno, já encerrado, a cada 60 min) |
| `TURNOS_MUN` | `2,1` | Turnos com resultado por município |
| `CACHE_DADOS_S` | `30` | `max-age`/`s-maxage` dos snapshots |
| `CONCORRENCIA` | `4` | Downloads simultâneos ao TSE. Se o `/saude` mostrar muitos 429, baixe para 2 |
| `PORTA` | `8080` | Porta do servidor dentro do container |
| `HISTORICO` | `1` | `0` desliga o download do histórico |
| `HISTORICO_QTD` | `20` | Quantas eleições entram no histórico |

### Como saber se a coleta está funcionando

**1. Endpoint `/saude`**: abra `https://SEU-DOMINIO/saude` (nunca fica em cache). Para cada turno há três coletas: `brasil` (total e UFs), `exterior` (boletins de urna) e `municipios`. Em cada uma:

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
server/historico.js job do histórico (últimas 20 eleições)
server/server.js   servidor HTTP (site + snapshots + /saude)
iniciar.ps1        roda tudo localmente com Node portátil
```

## Observações

- Votos digitados em número inexistente contam como nulos, como na totalização oficial.
- Mapas: IBGE (estados e municípios) e Natural Earth (mundo), ambos de uso livre. Fotos dos candidatos: TSE.
- Os dados são públicos e oficiais, mas este painel não é um produto do TSE. Em caso de divergência, vale o site oficial do TSE.
