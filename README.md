# Apuração de Eleições

Painel ao vivo com os votos para Presidente nas urnas do exterior: mapa-múndi clicável (país → cidade → seção), comparativo mundial, filtros e layout vertical 9:16 para transmitir no TikTok.

## Fontes de dados (públicas, do TSE)

| Fonte | O que é | Quando fica disponível |
|---|---|---|
| **Boletins de urna (BU)** `resultados.tse.jus.br/oficial/ele2026/arquivo-urna/<pleito>/...` | Arquivo assinado de cada seção, decodificado aqui (ASN.1) | Assim que a seção transmite |
| **Totalização oficial** `resultados.tse.jus.br/oficial/ele2026/<eleição>/dados/zz/...-u.json` | Totais oficiais por cidade do exterior | Após a liberação do TSE (17h de Brasília) |

Códigos: 1º turno = eleição 6257 / pleito 3220 · 2º turno = eleição 6258 / pleito 3221. Para o exterior a "UF" é `zz`.

## Arquitetura

```
TSE ──(job a cada 5 min)──► server/sync.js ──► dados/turno-N.json ──► Cloudflare ──► navegadores
```

O job (`server/sync.js`) é o único cliente que fala com o TSE: baixa só os BUs novos (os já decodificados ficam em cache em `dados/cache-bu-*.json`), grava um snapshot por turno e publica parciais a cada 20 s durante a primeira carga. O painel lê só o snapshot, então o número de espectadores não aumenta a carga no TSE (que devolve muitos HTTP 429 em dia de eleição).

Sem o servidor (por exemplo, abrindo com `servidor.ps1`), o painel detecta a ausência de `/saude` e consulta o TSE direto do navegador.

## Rodar com Docker

```bash
docker compose up -d --build
# painel em http://localhost:8080  ·  saúde em http://localhost:8080/saude
docker compose logs -f painel     # acompanha a sincronização
```

Variáveis (em `docker-compose.yml`):

| Variável | Padrão | Uso |
|---|---|---|
| `SYNC_INTERVALO_MIN` | 5 | Intervalo da sincronização do 2º turno |
| `TURNOS` | `2,1` | Turnos sincronizados (o 1º turno, já encerrado, só a cada 60 min) |
| `CACHE_DADOS_S` | 30 | `max-age`/`s-maxage` dos snapshots |
| `CONCORRENCIA` | 6 | Downloads simultâneos ao TSE |

## Publicar atrás do Cloudflare

**Opção A: Cloudflare Tunnel (recomendada, sem abrir portas)**
1. Zero Trust → Networks → Tunnels → *Create tunnel* → copie o token.
2. Em *Public hostname*, aponte seu domínio para `http://painel:8080`.
3. `TUNNEL_TOKEN=<token> docker compose --profile tunel up -d`
4. Remova o bloco `ports:` do serviço `painel` se não quiser acesso direto.

**Opção B: proxy DNS (nuvem laranja)** apontando para o IP do servidor, porta 80/443 → 8080 (via proxy reverso ou regra de origem).

**Cache (importante):** o Cloudflare não faz cache de `.json` por padrão. Crie uma *Cache Rule*:
- Se *URI Path* começa com `/dados/` → **Eligible for cache**, *Edge TTL: use cache-control header* (30 s).

Assim cada ponto de presença do Cloudflare busca o snapshot no máximo 2 vezes por minuto, não importa quantas pessoas estejam assistindo. `/saude` responde com `no-store`.

## Rodar localmente sem Docker (Windows)

Clique duas vezes em `INICIAR.bat` (ou `powershell -ExecutionPolicy Bypass -File servidor.ps1`). Abre em http://localhost:8080 consultando o TSE direto.

## Usar na live

- **F**: filtros (turno, fonte, continente, país, cidade, cor do mapa, ordenação…)
- **V**: layout vertical 9:16; capture a janela no TikTok Live Studio/OBS
- **T**: tour automático pelos países com mais votos
- **Esc**: volta para o mundo · **Backspace**: sobe um nível
- Clique em um país ou cidade (no mapa ou no ranking) para ver os votos daquela seleção; em uma cidade, o ranking mostra seção por seção.

## Observações

- O BU é o dado da urna; o resultado oficial é a totalização do TSE. No modo *Automático*, cada cidade usa a fonte com mais seções apuradas.
- Votos digitados em número inexistente contam como nulos (igual à totalização oficial).
- Mapa: Natural Earth (domínio público). Fotos dos candidatos: TSE.
