import * as fs from 'fs';
import * as path from 'path';
import bwipjs from 'bwip-js';
import { createCanvas } from '@napi-rs/canvas';
import { expect } from 'chai';
import { BarcodeOp } from '../../../renderer/ir';
import { BarcodeRenderer, drawPage } from '../../../renderer/draw';
import { parseZpl } from '../../../renderer/parser';
import { comparePngBuffers, writePng } from '../../helpers/canvas';
import { PNG } from 'pngjs';

class NodeBarcodeRenderer implements BarcodeRenderer {
  render(op: BarcodeOp) {
    const canvas = createCanvas(1, 1);
    (bwipjs as unknown as { toCanvas: (c: unknown, o: unknown) => void }).toCanvas(canvas as never, {
      bcid: op.symbology === 'qrcode' ? 'qrcode' : 'code128',
      text: op.data || 'TEST',
      includetext: false,
      scale: Math.max(1, op.moduleWidth || 2),
      height: Math.max(8, op.height || 30) / 8,
    });
    return canvas as unknown as HTMLCanvasElement;
  }
}

const renderer = new NodeBarcodeRenderer();

export function assertFixtureMatchesGolden(
  fixtureName: string,
  goldenName: string,
): void {
  const fixturesRoot = path.join(
    process.cwd(),
    'src',
    'test',
    'fixtures',
    'valid',
  );
  const goldenPath = path.join(
    process.cwd(),
    'src',
    'test',
    'renderer',
    'visual',
    'golden',
    goldenName,
  );
  const actualPath = path.join(
    process.cwd(),
    'test-results',
    'visual',
    `${goldenName}.actual.png`,
  );
  const diffPath = path.join(
    process.cwd(),
    'test-results',
    'visual',
    `${goldenName}.diff.png`,
  );

  const source = fs.readFileSync(path.join(fixturesRoot, fixtureName), 'utf8');
  const parsed = parseZpl(source);
  expect(parsed.pages.length).to.be.greaterThan(0);
  const page = parsed.pages[0];
  const canvas = createCanvas(page.width, page.height);
  const ctx = canvas.getContext('2d');
  drawPage(
    ctx as unknown as CanvasRenderingContext2D,
    page,
    renderer,
    { scale: 1 },
  );
  const actualBuffer = canvas.toBuffer('image/png');

  if (process.env.UPDATE_GOLDENS === '1' || !fs.existsSync(goldenPath)) {
    fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
    fs.writeFileSync(goldenPath, actualBuffer);
    return;
  }

  const expectedBuffer = fs.readFileSync(goldenPath);
  const { mismatchedPixels, diff } = comparePngBuffers(actualBuffer, expectedBuffer);
  if (mismatchedPixels > 0) {
    fs.mkdirSync(path.dirname(actualPath), { recursive: true });
    fs.writeFileSync(actualPath, actualBuffer);
    writePng(diffPath, diff as PNG);
  }
  expect(mismatchedPixels, `Visual mismatch in ${fixtureName}`).to.equal(0);
}
