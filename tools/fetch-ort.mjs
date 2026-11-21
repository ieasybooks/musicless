// Landing builds need the pinned WASM runtime, but do not build or bundle weights.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import pins from './dependencies.json' with { type: 'json' };

export async function copyOrt(destination, { preferLocal = true } = {}) {
  const files = Object.keys(pins.ort_files);
  const local = new URL('../extension/vendor/', import.meta.url);
  const available = await Promise.all(files.map(async file => {
    if (!preferLocal) return false;
    try {
      return createHash('sha256').update(await readFile(new URL(file, local))).digest('hex') === pins.ort_files[file];
    } catch { return false; }
  }));
  await mkdir(destination, { recursive: true });
  if (available.every(Boolean)) {
    for (const file of files) await cp(new URL(file, local), join(destination, file));
    return;
  }
  const work = await mkdtemp(join(tmpdir(), 'musicless-ort-'));
  try {
    const response = await fetch(`https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${pins.ort_version}.tgz`);
    if (!response.ok) throw new Error(`ORT download failed: ${response.status}`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== pins.ort_sha256) throw new Error('ORT checksum mismatch');
    await writeFile(join(work, 'ort.tgz'), archive);
    execFileSync('tar', ['-xzf', join(work, 'ort.tgz'), '-C', work, ...files.map(file => 'package/dist/' + file)]);
    for (const file of files) await writeFile(join(destination, file), await readFile(join(work, 'package/dist', file)));
  } finally { await rm(work, { recursive: true, force: true }); }
}
