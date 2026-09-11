import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { parseLabel } from '../../core/pipeline';
import { BarcodeRenderer, drawPage } from '../../renderer/draw';
import { BarcodeOp } from '../../renderer/ir';

/**
 * Asserts what the renderer *draws*, rather than what it rasterizes.
 *
 * Pixel goldens (`src/test/renderer/visual`) are bound to the machine that
 * produced them — system fonts differ per OS, and the Skia build behind
 * `@napi-rs/canvas` differs per platform *and* per runner image, which moves
 * even barcode and box edges. Recording the Canvas 2D calls instead gives the
 * geometry the same regression cover with no environment dependence at all,
 * which is what a parser change can actually break.
 */
interface RecordedCall {
  op: string;
  /** Accumulated translation in effect when the call was made. */
  at: [number, number];
  args: number[];
  style?: string;
  lineWidth?: number;
}

class RecordingContext {
  readonly calls: RecordedCall[] = [];

  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  font = '';
  textBaseline = '';

  private tx = 0;
  private ty = 0;
  private readonly stack: Array<{
    tx: number;
    ty: number;
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
  }> = [];

  private record(op: string, args: number[], stroke = false): void {
    this.calls.push({
      op,
      at: [this.tx, this.ty],
      args,
      style: stroke ? this.strokeStyle : this.fillStyle,
      lineWidth: this.lineWidth,
    });
  }

  save(): void {
    this.stack.push({
      tx: this.tx,
      ty: this.ty,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
    });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (!previous) {
      return;
    }
    this.tx = previous.tx;
    this.ty = previous.ty;
    this.fillStyle = previous.fillStyle;
    this.strokeStyle = previous.strokeStyle;
    this.lineWidth = previous.lineWidth;
  }

  setTransform(): void {
    this.tx = 0;
    this.ty = 0;
  }

  translate(x: number, y: number): void {
    this.tx += x;
    this.ty += y;
  }

  rotate(angle: number): void {
    this.record('rotate', [Number(angle.toFixed(4))]);
  }

  scale(x: number, y: number): void {
    this.record('scale', [x, y]);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.record('fillRect', [x, y, width, height]);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.record('strokeRect', [x, y, width, height], true);
  }

  beginPath(): void {
    this.record('beginPath', []);
  }

  moveTo(x: number, y: number): void {
    this.record('moveTo', [x, y]);
  }

  lineTo(x: number, y: number): void {
    this.record('lineTo', [x, y]);
  }

  stroke(): void {
    this.record('stroke', [], true);
  }

  fill(): void {
    this.record('fill', []);
  }

  arc(x: number, y: number, radius: number): void {
    this.record('arc', [x, y, radius], true);
  }

  ellipse(x: number, y: number, radiusX: number, radiusY: number): void {
    this.record('ellipse', [x, y, radiusX, radiusY], true);
  }

  drawImage(_image: unknown, x: number, y: number): void {
    this.record('drawImage', [x, y]);
  }

  fillText(_text: string, x: number, y: number): void {
    this.record('fillText', [x, y]);
  }

  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }

  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  }

  putImageData(_data: unknown, x: number, y: number): void {
    this.record('putImageData', [x, y]);
  }

  /** Every call of one kind, in order. */
  of(op: string): RecordedCall[] {
    return this.calls.filter((call) => call.op === op);
  }
}

class StubBarcodeRenderer implements BarcodeRenderer {
  readonly rendered: BarcodeOp[] = [];

  render(op: BarcodeOp): HTMLCanvasElement {
    this.rendered.push(op);
    return { width: 100, height: 50 } as unknown as HTMLCanvasElement;
  }
}

function renderFixture(name: string): {
  ctx: RecordingContext;
  barcodes: StubBarcodeRenderer;
} {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'test', 'fixtures', 'valid', name),
    'utf8',
  );
  const parsed = parseLabel(source, { fileName: name });
  expect(parsed.pages.length, `${name} produced no page`).to.be.greaterThan(0);
  const ctx = new RecordingContext();
  const barcodes = new StubBarcodeRenderer();
  drawPage(
    ctx as unknown as CanvasRenderingContext2D,
    parsed.pages[0],
    barcodes,
    { scale: 1 },
  );
  return { ctx, barcodes };
}

describe('renderer.drawPage geometry', () => {
  it('draws EPL boxes, lines and barcodes at the right coordinates', () => {
    const { ctx, barcodes } = renderFixture('epl-geometry.epl');

    // X10,10,3,396,193 — a 3-dot box, stroked inset by half its thickness.
    const box = ctx
      .of('strokeRect')
      .find((call) => call.at[0] === 10 && call.at[1] === 10);
    expect(box, 'box at (10,10)').to.not.equal(undefined);
    expect(box?.args).to.deep.equal([1.5, 1.5, 383, 180]);
    expect(box?.lineWidth).to.equal(3);

    // LO20,40,360,4 — a filled black bar, not an outline.
    const bar = ctx
      .of('fillRect')
      .find((call) => call.at[0] === 20 && call.at[1] === 40);
    expect(bar, 'line at (20,40)').to.not.equal(undefined);
    expect(bar?.args).to.deep.equal([0, 0, 360, 4]);
    expect(bar?.style).to.equal('#000000');

    // B30,60,… and b280,130,… composite their encoder output.
    expect(ctx.of('drawImage').map((call) => call.at)).to.deep.equal([
      [30, 60],
      [280, 130],
    ]);
    expect(barcodes.rendered.map((op) => op.symbology)).to.deep.equal([
      'code128',
      'qrcode',
    ]);
    expect(barcodes.rendered[0].data).to.equal('LABELSTUDIO');
    expect(barcodes.rendered[1].magnification).to.equal(3);
  });

  it('draws ZPL text, graphics and barcodes at the right coordinates', () => {
    const { ctx, barcodes } = renderFixture('product.zpl');

    const origins = ctx.of('fillText').map((call) => call.at);
    expect(origins).to.deep.include([20, 15]);
    expect(origins).to.deep.include([140, 10]);

    expect(ctx.of('drawImage').map((call) => call.at)).to.deep.equal([
      [20, 140],
      [500, 20],
    ]);
    expect(barcodes.rendered.map((op) => op.symbology)).to.deep.equal([
      'code128',
      'qrcode',
    ]);
  });

  it('paints the label background before anything else', () => {
    const { ctx } = renderFixture('epl-geometry.epl');
    const first = ctx.calls[0];
    expect(first.op).to.equal('fillRect');
    expect(first.style).to.equal('#ffffff');
    expect(first.args).to.deep.equal([0, 0, 406, 203]);
  });

  it('rotates a field according to its orientation', () => {
    const parsed = parseLabel('N\nq400\nQ200,24\nA10,10,1,3,1,1,N,"R"\nP1', {
      format: 'epl',
    });
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      parsed.pages[0],
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    const rotation = ctx.of('rotate')[0];
    expect(rotation?.args[0]).to.equal(Number((Math.PI / 2).toFixed(4)));
  });

  it('renders a graphic field as image data', () => {
    const parsed = parseLabel('^XA^FO5,6^GFA,2,2,1,FF00^FS^XZ', { format: 'zpl' });
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      parsed.pages[0],
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    const put = ctx.of('putImageData')[0];
    expect(put, 'putImageData call').to.not.equal(undefined);
    expect(put.at).to.deep.equal([5, 6]);
  });
});
