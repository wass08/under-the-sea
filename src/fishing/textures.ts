import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three/webgpu';

/** Procedural canvas textures (generated once, tiny): wood grain (albedo + roughness), fabric weave, straw weave. */

let s = 987654321;
const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

function canvas(size: number) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }
function texture(c: HTMLCanvasElement, srgb: boolean) {
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Wood: light neutral albedo (vertex colours tint it) + roughness variation. Grain runs along U (x). */
export function woodTextures() {
  const N = 512, albedo = canvas(N), rough = canvas(N);
  const a = albedo.getContext('2d')!, g = rough.getContext('2d')!;
  a.fillStyle = '#e6cfa8'; a.fillRect(0, 0, N, N);
  g.fillStyle = '#c4c4c4'; g.fillRect(0, 0, N, N);
  // long wavy grain lines, tileable in x via integer sine cycles
  for (let i = 0; i < 260; i++) {
    const y0 = r() * N, amp = 1 + r() * 5, cyc = 1 + Math.floor(r() * 3), ph = r() * 6.28, w = 0.6 + r() * 2.2;
    const dark = r() < 0.75, alpha = 0.04 + r() * 0.2;
    for (const [ctx, col] of [[a, dark ? '110,72,36' : '255,240,210'], [g, dark ? '150,150,150' : '235,235,235']] as const) {
      ctx.strokeStyle = `rgba(${col},${alpha})`; ctx.lineWidth = w; ctx.beginPath();
      for (let x = 0; x <= N; x += 8) { const y = y0 + Math.sin((x / N) * Math.PI * 2 * cyc + ph) * amp; if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }
  // knots
  for (let i = 0; i < 5; i++) {
    const x = r() * N, y = r() * N, rad = 6 + r() * 12;
    for (const [ctx, c0, c1] of [[a, 'rgba(90,55,25,.55)', 'rgba(90,55,25,0)'], [g, 'rgba(120,120,120,.6)', 'rgba(120,120,120,0)']] as const) {
      const gr = ctx.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      ctx.save(); ctx.translate(x, y); ctx.scale(2.6, 1); ctx.translate(-x, -y); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.28); ctx.fill(); ctx.restore();
    }
  }
  // fine pores
  for (let i = 0; i < 2600; i++) { a.fillStyle = `rgba(80,50,25,${r() * 0.16})`; a.fillRect(r() * N, r() * N, 1 + r() * 5, 1); }
  return { map: texture(albedo, true), rough: texture(rough, false) };
}

/** Fine woven fabric detail (near-white, used as a multiplier). */
export function fabricTexture() {
  const N = 256, c = canvas(N), x = c.getContext('2d')!;
  x.fillStyle = '#e8e8e8'; x.fillRect(0, 0, N, N);
  const cell = 4;
  for (let j = 0; j < N / cell; j++) for (let i = 0; i < N / cell; i++) {
    const over = (i + j) % 2 === 0, v = over ? 236 : 208;
    x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i * cell, j * cell, cell - 0.6, cell - 0.6);
  }
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(120,120,120,${r() * 0.1})`; x.fillRect(r() * N, r() * N, 1, 1 + r() * 3); }
  return texture(c, true);
}

/** Woven straw: braided bands, warm yellow. */
export function strawTexture() {
  const N = 256, c = canvas(N), x = c.getContext('2d')!;
  x.fillStyle = '#e2c987'; x.fillRect(0, 0, N, N);
  const band = 16;
  for (let j = 0; j < N / band; j++) for (let i = 0; i < N / band; i++) {
    const over = (i + j) % 2 === 0;
    const l = 0.86 + r() * 0.14 - (over ? 0 : 0.1);
    x.fillStyle = `rgb(${Math.round(232 * l)},${Math.round(205 * l)},${Math.round(140 * l)})`;
    x.fillRect(i * band + 1, j * band + 1, band - 2, band - 2);
    x.strokeStyle = 'rgba(120,85,30,.28)'; x.lineWidth = 1;
    for (let k = 1; k < 4; k++) { x.beginPath(); if (over) { x.moveTo(i * band, j * band + k * 4); x.lineTo(i * band + band, j * band + k * 4); } else { x.moveTo(i * band + k * 4, j * band); x.lineTo(i * band + k * 4, j * band + band); } x.stroke(); }
  }
  return texture(c, true);
}
