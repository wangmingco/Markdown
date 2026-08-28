import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FRONTEND = join(ROOT, 'frontend');
const PUBLIC = join(FRONTEND, 'public');
const BUILD = join(ROOT, 'build');

const SRC = join(PUBLIC, 'favicon.svg');

const jobs = [
  { dir: PUBLIC, name: 'favicon-16x16.png', size: 16 },
  { dir: PUBLIC, name: 'favicon-32x32.png', size: 32 },
  { dir: PUBLIC, name: 'favicon-192x192.png', size: 192 },
  { dir: PUBLIC, name: 'favicon-512x512.png', size: 512 },
  { dir: PUBLIC, name: 'apple-touch-icon.png', size: 180 },
  { dir: BUILD, name: 'appicon.png', size: 512 },
];

async function renderPng(size) {
  return sharp(SRC, { density: 72 }).resize(size, size).png().toBuffer();
}

async function writeIco(file, sizes) {
  const blobs = [];
  for (const size of sizes) blobs.push({ size, data: await renderPng(size) });

  const count = blobs.length;
  let offset = 6 + 16 * count;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  for (const { size, data } of blobs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);   // height
    entry.writeUInt8(0, 2);                        // color count
    entry.writeUInt8(0, 3);                        // reserved
    entry.writeUInt16LE(1, 4);                     // planes
    entry.writeUInt16LE(32, 6);                    // bit count
    entry.writeUInt32LE(data.length, 8);           // bytes in resource
    entry.writeUInt32LE(offset, 12);               // image offset
    offset += data.length;
    entries.push(entry);
  }

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([header, ...entries, ...blobs.map(b => b.data)]));
}

mkdirSync(PUBLIC, { recursive: true });
mkdirSync(BUILD, { recursive: true });
mkdirSync(join(BUILD, 'windows'), { recursive: true });

for (const { dir, name, size } of jobs) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), await renderPng(size));
  console.log('✓', join(dir, name), `${size}x${size}`);
}

// 浏览器 favicon.ico：48 / 32 / 16
await writeIco(join(PUBLIC, 'favicon.ico'), [48, 32, 16]);
console.log('✓', join(PUBLIC, 'favicon.ico'));

// Windows exe 内嵌 icon.ico：256 / 128 / 64 / 48 / 32 / 24 / 16
await writeIco(join(BUILD, 'windows', 'icon.ico'), [256, 128, 64, 48, 32, 24, 16]);
console.log('✓', join(BUILD, 'windows', 'icon.ico'));

// 设计源原样复制（与生成物保持单一来源）
copyFileSync(SRC, join(PUBLIC, 'favicon.svg'));
console.log('✓', join(PUBLIC, 'favicon.svg'), '(source)');

console.log('\nAll icons generated from favicon.svg ✓');