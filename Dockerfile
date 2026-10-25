FROM node:22-alpine

ENV NODE_ENV=production \
    PORTA=8080 \
    DIR_DADOS=/app/dados \
    SYNC_INTERVALO_MIN=5 \
    TURNOS=2,1 \
    CACHE_DADOS_S=30

WORKDIR /app
COPY public ./public
COPY server ./server
RUN mkdir -p /app/dados && chown -R node:node /app/dados

USER node
EXPOSE 8080
VOLUME ["/app/dados"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/saude || exit 1

CMD ["node", "server/server.js"]
