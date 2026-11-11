/** One decoded sample, triggered by foot contact rather than a repeating timer. */
export class FootstepAudio {
 private context?: AudioContext;
 private buffer?: AudioBuffer;
 private loading?: Promise<void>;
 private voices = new Set<AudioBufferSourceNode>();
 private last = -Infinity;
 private disposed = false;
 enabled = true;
 constructor(private url: string) {}
 unlock() {
  if (this.disposed || !this.enabled) return;
  try {
   this.context ??= new AudioContext();
   if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
   if (!this.loading) this.loading = this.load();
  } catch { /* Audio unavailable: movement still works. */ }
 }
 private async load() {
  try {
   const response = await fetch(this.url);
   if (!response.ok) throw Error('Footstep audio: ' + response.status);
   const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
   if (!this.disposed) this.buffer = buffer;
  } catch (error) { console.warn('No se pudo cargar el sonido de pasos', error); }
 }
 play(running: boolean, landing: boolean) {
  const ctx = this.context;
  if (this.disposed || !this.enabled || !this.buffer || !ctx || ctx.state !== 'running') return;
  // Merge simultaneous landing contacts; never queue sounds that arrive late.
  if (ctx.currentTime - this.last < .08 || this.voices.size >= 3) return;
  this.last = ctx.currentTime;
  const source = ctx.createBufferSource(), gain = ctx.createGain();
  source.buffer = this.buffer;
  source.playbackRate.value = .97 + Math.random() * .06;
  gain.gain.value = .7 * (landing ? .42 : running ? .32 : .25);
  source.connect(gain); gain.connect(ctx.destination);
  this.voices.add(source);
  source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
  source.start();
 }
 stop() { for (const source of this.voices) source.stop(); this.voices.clear(); }
 setEnabled(value: boolean) { this.enabled = value; if (value) this.unlock(); else this.stop(); }
 dispose() { this.disposed = true; this.stop(); this.buffer = undefined; void this.context?.close().catch(() => {}); }
}
