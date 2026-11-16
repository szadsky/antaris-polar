import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Exploración aislada del hero: un solo index.html, recursos en public/ (hero/, assets/, basis/, LICENSES/).
// Solo en desarrollo: POST /__captura?nombre=x guarda en capturas/x.png el PNG que manda la página (captura del
// canvas tomada en el navegador de la app; ver window.__heroCapture en src/main.ts).
const captures = () => ({
  name: 'capturas-hero',
  configureServer(server) {
    server.middlewares.use('/__captura', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const name = (new URL(req.url, 'http://x').searchParams.get('nombre') ?? 'captura').replace(/[^a-z0-9-]/gi, '');
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = fileURLToPath(new URL('./capturas/', import.meta.url));
        mkdirSync(dir, { recursive: true });
        const b64 = Buffer.concat(chunks).toString().replace(/^data:image\/png;base64,/, '');
        writeFileSync(dir + name + '.png', Buffer.from(b64, 'base64'));
        res.end('ok');
      });
    });
  },
});
export default () => ({
  plugins: [captures()], server: { port: 3420, host: '127.0.0.1', strictPort: true }, cacheDir: '.vite', assetsInclude: ['**/*.ktx2'],
  // Las fuentes nunca en base64 dentro del CSS: cada subconjunto (latin, cyrillic…) se baja solo si la página lo usa.
  build: { assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) },
});
