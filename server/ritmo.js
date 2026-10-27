'use strict';
// Ritmo das consultas ao TSE. Perto de uma votação a coleta roda no ritmo configurado (30 s, 5 min...); fora dela
// o TSE não publica nada novo, então cada coleta roda só a cada SYNC_FORA_ELEICAO_H (12 h, duas vezes ao dia).
// A data de cada turno vem da eleição acompanhada (eleicao-atual.js); as suplementares têm a sua (suplementares.js).
const eleicao = require('./eleicao-atual');

const JANELA_ANTES = +(process.env.SYNC_JANELA_ANTES_DIAS ?? 1);   // dias antes da votação em que já fica ativa
const JANELA_DEPOIS = +(process.env.SYNC_JANELA_DEPOIS_DIAS ?? 3); // dias depois (apuração, recontagens, ajustes)
const FORA_MIN = (+process.env.SYNC_FORA_ELEICAO_H || 12) * 60;
const TIQUE_MS = 60 * 1000; // de quanto em quanto tempo confere se já está na hora (sem consultar o TSE)

const hojeBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const diasDesde = iso => Math.round((Date.parse(hojeBrasilia()) - Date.parse(iso)) / 86400000);
const naJanela = iso => { const d = diasDesde(iso); return d >= -JANELA_ANTES && d <= JANELA_DEPOIS; };

// true quando algum turno da eleição acompanhada está na janela da votação
function eleicaoAtiva() {
  const e = eleicao.obter();
  const datas = [e.turnos, e.estadual].flatMap(o => Object.values(o || {}).map(t => t.data));
  return datas.some(d => d && naJanela(d));
}

// intervalo efetivo (min): o pedido quando a eleição está ativa; senão, o de fora de eleição
const intervalo = (minutos, ativa = eleicaoAtiva) => (ativa() ? minutos : Math.max(minutos, FORA_MIN));

// espera até a próxima passada; acorda antes se a eleição ficar ativa no meio da espera
async function esperarProxima(desde, minutos, ativa = eleicaoAtiva) {
  for (;;) {
    const falta = desde + intervalo(minutos, ativa) * 60 * 1000 - Date.now();
    if (falta <= 0) return;
    await new Promise(r => setTimeout(r, Math.min(TIQUE_MS, falta)));
  }
}

function status() {
  return { eleicaoAtiva: eleicaoAtiva(), janelaDias: { antes: JANELA_ANTES, depois: JANELA_DEPOIS }, foraDeEleicaoH: FORA_MIN / 60 };
}

module.exports = { eleicaoAtiva, intervalo, esperarProxima, status };
