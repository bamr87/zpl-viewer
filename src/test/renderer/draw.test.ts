import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import bwipjs from 'bwip-js';
import { createCanvas } from '@napi-rs/canvas';
import { parseZpl } from '../../renderer/parser';
import { drawPage, BarcodeRenderer } from '../../renderer/draw';
import { BarcodeOp } from '../../renderer/ir';

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

describe('renderer.drawPage', () => {
  const fixturesRoot = path.join(
    process.cwd(),
    'src',
    'test',
    'fixtures',
    'valid',
  );
  const barcodeRenderer = new NodeBarcodeRenderer();

  for (const fixture of ['hello.zpl', 'shipping.zpl', 'product.zpl']) {
    it(`renders ${fixture} without throwing`, () => {
      const source = fs.readFileSync(path.join(fixturesRoot, fixture), 'utf8');
      const result = parseZpl(source);
      expect(result.pages.length).to.be.greaterThan(0);

      const page = result.pages[0];
      const canvas = createCanvas(page.width, page.height);
      const ctx = canvas.getContext('2d');
      drawPage(
        ctx as unknown as CanvasRenderingContext2D,
        page,
        barcodeRenderer,
        { scale: 1 },
      );
      const png = canvas.toBuffer('image/png');
      expect(png.length).to.be.greaterThan(1000);
    });
  }
});
