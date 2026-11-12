/**
 * Pisada en nieve sintetizada (sin archivos de audio). Modelo: al apoyar el pie, la nieve se comprime y
 * se rompen muchos cristales chicos; eso suena como una nube de chasquidos cortos (granos de ruido de
 * 0,3–1,4 ms) cuya densidad sigue la presión del pie, más un soplido suave de nieve compactándose y un
 * golpe grave muy leve. El crujido se filtra en ~350 Hz – 4 kHz para que sea suave (sin agudos ásperos
 * ni retumbo). Módulo puro: devuelve muestras; se mide en Node (check-step-sound.mjs).
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pico de cada pisada sintetizada: sin saturación (la muestra anterior llegaba a 0,91). */
export const STEP_PEAK = 0.5;

/** Una pisada mono, normalizada a STEP_PEAK. Determinista por semilla (variante). `weight` > 1: más pesada. */
export function synthSnowStep(seed: number, sampleRate: number, weight = 1) {
  const random = mulberry32(seed * 7919 + 13);
  const duration = 0.2 + 0.08 * random() * weight, n = Math.round(duration * sampleRate);
  // Presión del pie: sube en ~10 ms, cae en 60–95 ms; un segundo apoyo más chico (rodar del pie) a 45–80 ms.
  // Ataque suave (12–20 ms) y caída más larga (85–130 ms): a la cadencia rápida de la marcha los pasos se
  // funden en un crujido en vez de sonar como golpecitos secos.
  const rise = 0.012 + 0.008 * random(), fall = 0.085 + 0.045 * random() * weight;
  const roll = 0.045 + 0.035 * random(), rollAmp = 0.25 + 0.3 * random();
  const pressure = (t: number) => (1 - Math.exp(-t / rise)) * Math.exp(-t / fall)
    + (t > roll ? rollAmp * (1 - Math.exp(-(t - roll) / rise)) * Math.exp(-(t - roll) / (fall * 0.8)) : 0);

  // 1) Crujido: granos de ruido con tasa proporcional a la presión (proceso de Poisson) y amplitud de cola
  //    larga (muchos chasquidos chicos, algunos más marcados).
  const crunch = new Float32Array(n), grainRate = 480 + 320 * random();
  for (let t = 0; ;) {
    t += -Math.log(1 - random()) / (grainRate * Math.max(0.02, pressure(t)) + 1);
    if (t >= duration) break;
    const start = Math.floor(t * sampleRate), len = Math.max(2, Math.floor((0.0003 + 0.0011 * random()) * sampleRate)), amp = 0.15 + 0.85 * random() ** 2.5;
    for (let k = 0; k < len && start + k < n; k++) crunch[start + k] += (random() * 2 - 1) * amp * Math.exp(-k / (len * 0.35));
  }
  // 2) Soplido: ruido continuo bajo la presión. Crujido + soplido pasan por un pasa altos de 1 polo
  //    (~350 Hz) y un pasa bajos de 3 polos (2,3–3,1 kHz, −18 dB/octava): suave, sin agudos ásperos.
  const hpK = Math.exp((-2 * Math.PI * 350) / sampleRate), lpK = 1 - Math.exp((-2 * Math.PI * (2300 + 800 * random())) / sampleRate);
  // 3) Golpe grave leve: ruido filtrado a ~150 Hz en los primeros ~40 ms (peso del cuerpo), sin pasa altos.
  const thumpK = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  const out = new Float32Array(n), thump = new Float32Array(n);
  let hpIn = 0, hpOut = 0, lp1 = 0, lp2 = 0, lp3 = 0, th1 = 0, th2 = 0, crunchE = 0, thumpE = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate, p = pressure(t);
    const x = crunch[i] * p * 1.6 + (random() * 2 - 1) * p * 0.07;
    const hp = hpK * (hpOut + x - hpIn); hpIn = x; hpOut = hp;
    lp1 += (hp - lp1) * lpK; lp2 += (lp1 - lp2) * lpK; lp3 += (lp2 - lp3) * lpK;
    th1 += ((random() * 2 - 1) - th1) * thumpK; th2 += (th1 - th2) * thumpK;
    out[i] = lp3; thump[i] = th2 * Math.exp(-t / 0.035) * (1 - Math.exp(-t / 0.004));
    crunchE += lp3 * lp3; thumpE += thump[i] * thump[i];
  }
  // El golpe grave es siempre ~10 % de la energía (×weight al aterrizar): presente pero sin retumbo,
  // aunque cada variante tenga una cantidad distinta de chasquidos.
  const share = Math.min(0.3, 0.1 * weight), thumpGain = thumpE > 0 ? Math.sqrt((share / (1 - share)) * crunchE / thumpE) : 0;
  for (let i = 0; i < n; i++) out[i] += thump[i] * thumpGain;
  // Bordes suaves (2 ms de entrada, 25 ms de salida) y normalización: sin clics ni saturación.
  const fadeIn = Math.floor(0.002 * sampleRate), fadeOut = Math.floor(0.025 * sampleRate);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (i < fadeIn) out[i] *= i / fadeIn;
    if (i > n - fadeOut) out[i] *= (n - i) / fadeOut;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= STEP_PEAK / peak;
  return out;
}
