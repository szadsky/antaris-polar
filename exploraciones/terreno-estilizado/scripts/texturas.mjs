#!/usr/bin/env node
/**
 * Texturas de roca y nieve en KTX2 (build, una sola vez).
 *
 * Fuentes (CC0):
 *   - Roca (Poly Haven, CC0): "Marble Cliff 04" (Amal Kumar), 1k JPG: color y normal (OpenGL).
 *     Pared de acantilado con bloques y fracturas grandes; tamaño real publicado: 12,66 × 12,66 m.
 *     (Se descartó ambientCG Rock030: grano fino con vetas, se vuelve ruido desde 170–600 m.)
 *   - Nieve: ambientCG "Snow007A", 1K-JPG: solo la normal (OpenGL). La nieve es casi blanca: el
 *     color lo da el material; de la textura solo se usa el microrelieve. ambientCG no publica el
 *     tamaño real de este material: se asume 2 × 2 m (supuesto, documentado en el README).
 *
 * Proceso: descarga a una caché fuera del repositorio → System.Drawing (Windows PowerShell, sin
 * instalar nada) reduce a 512 px con bordes repetibles → Node renormaliza las normales →
 * ktx2-encoder (devDependency, MIT; Basis Universal en wasm) codifica ETC1S con mipmaps:
 * color con transferencia sRGB, normales con el modo de mapa de normales de Basis.
 *
 * Salida: src/assets/roca-color.ktx2, roca-normal.ktx2, nieve-normal.ktx2 + texturas.json (procedencia).
 * Uso: node scripts/texturas.mjs [--size 512]
 */
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeToKTX2 } from "ktx2-encoder";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "src", "assets");
const cache = path.join(tmpdir(), "antaris-texturas");
const args = process.argv.slice(2);
const N = Number(args.includes("--size") ? args[args.indexOf("--size") + 1] : 512);
await mkdir(outDir, { recursive: true });
await mkdir(cache, { recursive: true });

const download = async (url, name) => {
  const p = path.join(cache, name);
  if (!existsSync(p)) await writeFile(p, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return p;
};

// ─── Fuentes ───
async function acg(id) {
  const zip = await download(`https://ambientcg.com/get?file=${id}_1K-JPG.zip`, `${id}_1K-JPG.zip`);
  const dir = path.join(cache, id);
  if (!existsSync(dir)) execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${dir}'`]);
  const files = await readdir(dir);
  const pick = (re) => path.join(dir, files.find((x) => re.test(x)));
  return { color: pick(/_Color.jpg$/i), normal: pick(/NormalGL.jpg$/i) };
}
const PH = "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_cliff_04/marble_cliff_04";
const rock = {
  color: await download(`${PH}_diff_1k.jpg`, "marble_cliff_04_diff_1k.jpg"),
  normal: await download(`${PH}_nor_gl_1k.jpg`, "marble_cliff_04_nor_gl_1k.jpg"),
};
const snowZip = await download("https://ambientcg.com/get?file=Snow007A_1K-JPG.zip", "Snow007A_1K-JPG.zip");
const snowDir = path.join(cache, "Snow007A");
if (!existsSync(snowDir)) execFileSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${snowZip}' -DestinationPath '${snowDir}'`]);
const snowNormal = path.join(snowDir, (await readdir(snowDir)).find((f) => /NormalGL\.jpg$/i.test(f)));

// ─── Reducción a N px con System.Drawing → RGBA crudo ───
function resizeRaw(src) {
  const out = path.join(cache, `${path.basename(src)}.${N}.rgba`);
  const ps = `
Add-Type -AssemblyName System.Drawing
$N = ${N}
$img = [System.Drawing.Image]::FromFile($env:SRC)
$dst = New-Object System.Drawing.Bitmap $N, $N, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$attr = New-Object System.Drawing.Imaging.ImageAttributes
$attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::Tile)   # bordes repetibles: el filtro lee del otro lado
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $N, $N), 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
$rect = New-Object System.Drawing.Rectangle 0, 0, $N, $N
$bd = $dst.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($N * $N * 4)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
$dst.UnlockBits($bd)
[System.IO.File]::WriteAllBytes($env:OUT, $bytes)
$g.Dispose(); $dst.Dispose(); $img.Dispose()
`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { env: { ...process.env, SRC: src, OUT: out } });
  return out;
}
async function loadRgba(src, normal) {
  const bgra = await readFile(resizeRaw(src));
  const rgba = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    let r = bgra[i * 4 + 2], g = bgra[i * 4 + 1], b = bgra[i * 4];
    if (normal) {
      // el reescalado acorta los vectores: renormalizar
      let x = r / 127.5 - 1, y = g / 127.5 - 1, z = b / 127.5 - 1;
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      r = Math.round((x * 0.5 + 0.5) * 255); g = Math.round((y * 0.5 + 0.5) * 255); b = Math.round((z * 0.5 + 0.5) * 255);
    }
    rgba.set([r, g, b, 255], i * 4);
  }
  return rgba;
}

// ─── KTX2 (ETC1S + mipmaps) ───
const jobs = [
  { name: "roca-color", src: rock.color, normal: false, fuente: "Poly Haven · Marble Cliff 04 (Amal Kumar) · diff 1k", url: "https://polyhaven.com/a/marble_cliff_04", tamanoM: 12.66 },
  { name: "roca-normal", src: rock.normal, normal: true, fuente: "Poly Haven · Marble Cliff 04 (Amal Kumar) · nor_gl 1k", url: "https://polyhaven.com/a/marble_cliff_04", tamanoM: 12.66 },
  { name: "nieve-normal", src: snowNormal, normal: true, fuente: "ambientCG · Snow007A · NormalGL 1K", url: "https://ambientcg.com/view?id=Snow007A", tamanoM: 2, tamanoSupuesto: true },
];
const info = [];
for (const j of jobs) {
  const rgba = await loadRgba(j.src, j.normal);
  let lum = null;
  if (!j.normal) {
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) L[i] = 0.2126 * lin(rgba[i * 4]) + 0.7152 * lin(rgba[i * 4 + 1]) + 0.0722 * lin(rgba[i * 4 + 2]);
    const sorted = Float32Array.from(L).sort();
    lum = { p05: +sorted[Math.floor(N * N * 0.05)].toFixed(4), p50: +sorted[Math.floor(N * N * 0.5)].toFixed(4), p95: +sorted[Math.floor(N * N * 0.95)].toFixed(4) };
    const m = [0, 0, 0];
    for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) m[c] += lin(rgba[i * 4 + c]);
    lum.media = m.map((v) => +(v / (N * N)).toFixed(4));
  }
  const ktx = await encodeToKTX2(new Uint8Array(1), {
    imageDecoder: async () => ({ width: N, height: N, data: rgba }),
    isUASTC: false,
    generateMipmap: true,
    qualityLevel: j.normal ? 200 : 160,
    compressionLevel: 2,
    isNormalMap: j.normal,
    isPerceptual: !j.normal,
    isSetKTX2SRGBTransferFunc: !j.normal,
  });
  await writeFile(path.join(outDir, `${j.name}.ktx2`), ktx);
  info.push({
    archivo: `${j.name}.ktx2`, fuente: j.fuente, url: j.url, licencia: "CC0 1.0",
    tamanoRealM: j.tamanoM, ...(j.tamanoSupuesto ? { nota: "tamaño real no publicado por la fuente: supuesto" } : {}),
    ...(lum ? { luminanciaLineal: { p05: lum.p05, p50: lum.p50, p95: lum.p95 }, colorMedioLineal: lum.media } : {}),
    px: N, formato: "KTX2 · Basis ETC1S · mipmaps" + (j.normal ? " · modo normal map" : " · sRGB"),
    bytes: ktx.length, sha256: createHash("sha256").update(ktx).digest("hex"),
  });
  console.log(`${j.name}.ktx2 ${(ktx.length / 1024).toFixed(1)} KB`);
}
await writeFile(path.join(outDir, "texturas.json"), JSON.stringify(info, null, 2));
