import { createCanvas } from '@napi-rs/canvas';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import * as fs from 'fs';
import * as path from 'path';

export function createTestCanvas(width: number, height: number) {
  return createCanvas(width, height);
}

export function readPng(pngPath: string): PNG {
  return PNG.sync.read(fs.readFileSync(pngPath));
}

export function writePng(pngPath: string, png: PNG): void {
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, PNG.sync.write(png));
}

export function comparePngBuffers(
  actual: Buffer,
  expected: Buffer,
  threshold = 0.1,
): { mismatchedPixels: number; diff: PNG } {
  const a = PNG.sync.read(actual);
  const b = PNG.sync.read(expected);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `PNG dimensions differ: actual ${a.width}x${a.height}, expected ${b.width}x${b.height}.`,
    );
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatchedPixels = pixelmatch(
    a.data,
    b.data,
    diff.data,
    a.width,
    a.height,
    { threshold },
  );
  return { mismatchedPixels, diff };
}
