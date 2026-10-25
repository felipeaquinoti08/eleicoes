// Sinal sonoro de "novos dados", sintetizado com Web Audio no estilo do bipe de fim da urna eletrônica.
// Navegadores só liberam áudio depois de um clique/tecla do visitante, por isso o contexto é criado no primeiro gesto.
const Som = (() => {
  let ctx = null;
  let ligado = true;

  function garantirContexto() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function bipe(t0, dur, freq, vol = 0.18) {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    ganho.gain.setValueAtTime(0, t0);
    ganho.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    ganho.gain.setValueAtTime(vol, t0 + dur - 0.01);
    ganho.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // sequência de bipes curtos seguida de um bipe longo
  function tocar() {
    if (!ligado || !garantirContexto() || ctx.state !== 'running') return false;
    const t = ctx.currentTime + 0.05;
    const curtos = 5, dc = 0.075, intervalo = 0.11, freq = 1046;
    for (let i = 0; i < curtos; i++) bipe(t + i * intervalo, dc, freq);
    bipe(t + curtos * intervalo, 0.55, freq);
    return true;
  }

  const liberado = () => !!ctx && ctx.state === 'running';
  const ativar = () => { garantirContexto(); };
  const definir = v => { ligado = !!v; };

  for (const ev of ['pointerdown', 'keydown']) {
    window.addEventListener(ev, ativar, { capture: true });
  }
  return { tocar, liberado, ativar, definir };
})();
