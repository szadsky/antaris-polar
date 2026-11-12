import { synthSnowStep } from './snow-step-synth';

/**
 * Pisadas disparadas por el contacto de cada pie (no por un temporizador).
 * Por defecto: crujido de nieve sintetizado (src/snow-step-synth.ts), 12 variantes de paso y 4 de
 * aterrizaje generadas al habilitar el audio; nunca se repite la anterior, el tono y el volumen varían un
 * poco. Suenan como mucho cada 0,24 s caminando / 0,2 s corriendo (la marcha apoya ~7 pies por segundo).
 * `?pisadas=muestra` usa la grabación anterior (Kenney, CC0).
 */
export class FootstepAudio {
 private context?: AudioContext;
 private sample?: AudioBuffer;
 private steps: AudioBuffer[] = [];
 private landings: AudioBuffer[] = [];
 private loading?: Promise<void>;
 private voices = new Set<AudioBufferSourceNode>();
 private last = -Infinity;
 private lastIndex = -1;
 private disposed = false;
 enabled = true;
 constructor(private url: string, private mode: 'nieve' | 'muestra' = 'nieve') {}
 unlock() {
  if (this.disposed || !this.enabled) return;
  try {
   this.context ??= new AudioContext();
   if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
   if (!this.loading) this.loading = this.load();
  } catch { /* Audio unavailable: movement still works. */ }
 }
 private async load() {
  const ctx = this.context!;
  if (this.mode === 'nieve') {
   // ~0,25 s por variante: unos pocos milisegundos de CPU en total, una sola vez.
   const make = (seed: number, weight: number) => { const data = synthSnowStep(seed, ctx.sampleRate, weight), buffer = ctx.createBuffer(1, data.length, ctx.sampleRate); buffer.copyToChannel(data, 0); return buffer; };
   this.steps = Array.from({ length: 12 }, (_, i) => make(i, 1));
   this.landings = Array.from({ length: 4 }, (_, i) => make(100 + i, 1.5));
   return;
  }
  try {
   const response = await fetch(this.url);
   if (!response.ok) throw Error('Footstep audio: ' + response.status);
   const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
   if (!this.disposed) this.sample = buffer;
  } catch (error) { console.warn('No se pudo cargar el sonido de pasos', error); }
 }
 /** `side`: −1 pie izquierdo, 1 derecho (paneo leve), 0 centro. */
 play(running: boolean, landing: boolean, side = 0) {
  const ctx = this.context;
  if (this.disposed || !this.enabled || !ctx || ctx.state !== 'running') return;
  // Ritmo: la marcha rápida apoya un pie ~7 veces por segundo (9–10 corriendo); que suenen todos se oía
  // como un repiqueteo. Separación mínima de 0,24 s caminando y 0,2 s corriendo (~3,5 pasos/s, parejo
  // porque los contactos son regulares); el aterrizaje de un salto suena siempre.
  const gap = landing ? .06 : running ? .2 : .24;
  if (ctx.currentTime - this.last < gap || this.voices.size >= 3) return;
  let buffer: AudioBuffer | undefined, volume: number;
  if (this.mode === 'nieve') {
   const pool = landing ? this.landings : this.steps;
   if (!pool.length) return;
   let index = Math.floor(Math.random() * pool.length);
   if (pool.length > 1 && index === this.lastIndex) index = (index + 1) % pool.length;
   this.lastIndex = index; buffer = pool[index];
   // Pico de la variante 0,5: ~0,07 caminando, la mitad que la versión anterior (era muy fuerte).
   volume = (landing ? .2 : running ? .16 : .13) * (.9 + Math.random() * .2);
  } else {
   buffer = this.sample;
   volume = .7 * (landing ? .42 : running ? .32 : .25);
  }
  if (!buffer) return;
  this.last = ctx.currentTime;
  const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
  source.buffer = buffer;
  source.playbackRate.value = this.mode === 'nieve' ? .86 + Math.random() * .1 : .97 + Math.random() * .06;
  gain.gain.value = volume;
  // Paneo leve: por pie en la muestra; al azar en la nieve (suena uno de cada dos contactos y quedaría
  // siempre del mismo lado).
  pan.pan.value = this.mode === 'nieve' ? (Math.random() * 2 - 1) * .08 : side * .12;
  source.connect(gain); gain.connect(pan); pan.connect(ctx.destination);
  this.voices.add(source);
  source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
  source.start();
 }
 stop() { for (const source of this.voices) source.stop(); this.voices.clear(); }
 setEnabled(value: boolean) { this.enabled = value; if (value) this.unlock(); else this.stop(); }
 dispose() { this.disposed = true; this.stop(); this.sample = undefined; this.steps = []; this.landings = []; void this.context?.close().catch(() => {}); }
}
