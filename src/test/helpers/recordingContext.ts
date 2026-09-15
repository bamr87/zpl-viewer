/**
 * Records what the renderer *draws*, rather than rasterizing it.
 *
 * The renderer's regression cover is the sequence of Canvas 2D calls it makes:
 * positions, sizes, styles and the transform each call was made under. That is
 * exactly what a parser or renderer change breaks, and unlike a rendered image
 * it does not depend on the host's fonts or on which Skia build the machine
 * happens to have — the reason this repository has no pixel goldens.
 */
import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { parseLabel } from '../../core/pipeline';
import { BarcodeRenderer, drawPage } from '../../renderer/draw';
import { BarcodeOp } from '../../renderer/ir';


export interface RecordedCall {
  op: string;
  /** Accumulated translation in effect when the call was made. */
  at: [number, number];
  args: number[];
  style?: string;
  lineWidth?: number;
}

export class RecordingContext {
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

  /** Every call of one kind, in order. */
  of(op: string): RecordedCall[] {
    return this.calls.filter((call) => call.op === op);
  }
}

export class StubBarcodeRenderer implements BarcodeRenderer {
  readonly rendered: BarcodeOp[] = [];

  render(op: BarcodeOp): HTMLCanvasElement {
    this.rendered.push(op);
    return { width: 100, height: 50 } as unknown as HTMLCanvasElement;
  }
}

export function renderFixture(name: string): {
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
