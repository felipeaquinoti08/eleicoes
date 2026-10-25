# Imagem multiarquitetura: node:22-alpine é publicada para amd64 (x86), arm64 e arm/v7.
# O app é JavaScript puro, sem dependências nativas, então o mesmo Dockerfile serve para x86 e ARM.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORTA=8080 \
    DIR_DADOS=/app/dados \
    SYNC_INTERVALO_MIN=5 \
    TURNOS=2,1 \
    CACHE_DADOS_S=15

WORKDIR /app
COPY public ./public
COPY server ./server
RUN mkdir -p /app/dados && chown -R node:node /app/dados

# começa como root só para acertar o dono da pasta de dados montada do servidor (./dados);
# o server.js passa a rodar como o usuário "node" logo em seguida
EXPOSE 8080

# usa o próprio Node (sem depender de wget/curl, que variam entre imagens base)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8080/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
