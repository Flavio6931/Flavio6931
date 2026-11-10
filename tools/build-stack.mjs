// Construye stack.svg: los íconos de skillicons + un ícono de Antigravity con el mismo estilo.
// Uso: node build-stack.mjs <png-antigravity> <salida.svg> <ids-skillicons>
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const [pngPath, outPath, ids] = process.argv.slice(2);
const TILE = 256;
const STRIDE = 300; // 256 de ícono + 44 de separación, como skillicons
const LOGO_SIZE = 168;

function decodePng(buffer) {
  let offset = 8;
  let width, height, colorType, bitDepth, interlace;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(`PNG no soportado: bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + add) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      out[dst] = line[src];
      out[dst + 1] = line[src + 1];
      out[dst + 2] = line[src + 2];
      out[dst + 3] = channels === 4 ? line[src + 3] : 255;
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Quita el fondo oscuro (gris neutro) y deja solo el arco de colores.
function extractLogo({ width, height, pixels }) {
  const alpha = new Uint8Array(width * height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < width * height; i += 1) {
    const [r, g, b, a] = pixels.subarray(i * 4, i * 4 + 4);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const value = Math.min(1, Math.max(0, (chroma - 25) / 45)) * (a / 255);
    alpha[i] = Math.round(value * 255);
    if (alpha[i] > 40) {
      const x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const src = (minY + y) * width + (minX + x);
      const dst = (y * w + x) * 4;
      // Sin fondo, el color se recupera dividiendo por la opacidad sobre negro aproximado.
      const a = alpha[src] / 255;
      for (let ch = 0; ch < 3; ch += 1) {
        const c = pixels[src * 4 + ch];
        out[dst + ch] = a > 0 ? Math.min(255, Math.round(c / Math.max(a, 0.6))) : 0;
      }
      out[dst + 3] = alpha[src];
    }
  }
  return { width: w, height: h, png: encodePng(w, h, out) };
}

const logo = extractLogo(decodePng(readFileSync(pngPath)));
const scale = LOGO_SIZE / Math.max(logo.width, logo.height);
const lw = logo.width * scale, lh = logo.height * scale;
const tile = `<g transform="translate(%X%, 0)"><svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" fill="none" viewBox="0 0 256 256"><rect width="256" height="256" fill="#242938" rx="60"/><image x="${((TILE - lw) / 2).toFixed(1)}" y="${((TILE - lh) / 2).toFixed(1)}" width="${lw.toFixed(1)}" height="${lh.toFixed(1)}" href="data:image/png;base64,${logo.png.toString('base64')}"/></svg></g>`;

const response = await fetch(`https://skillicons.dev/icons?i=${ids}`);
if (!response.ok) throw new Error(`skillicons respondió ${response.status}`);
let svg = await response.text();
const count = ids.split(',').length;
const total = count + 1;
const viewWidth = total * STRIDE - (STRIDE - TILE);
svg = svg
  .replace(/width="[\d.]+" height="48" viewBox="0 0 \d+ 256"/, `width="${(viewWidth * 48 / 256).toFixed(2)}" height="48" viewBox="0 0 ${viewWidth} 256"`)
  .replace(/<\/svg>\s*$/, `${tile.replace('%X%', String(count * STRIDE))}</svg>`);
writeFileSync(outPath, svg);
console.log(`stack.svg: ${total} íconos, logo ${logo.width}x${logo.height}px, ${svg.length} bytes`);
