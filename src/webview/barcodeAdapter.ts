/**
 * Adapter that renders IR barcode ops via bwip-js onto an offscreen canvas.
 * The resulting canvas is later composited into the main label canvas by
 * draw.ts.
 *
 * The encoder options themselves come from `barcode/bwip.ts`, shared with the
 * SVG exporter so that every output encodes a given field identically.
 */

import bwipjs from 'bwip-js';
import { BarcodeOp } from '../renderer/ir';
import { BarcodeRenderer } from '../renderer/draw';
import { bwipOptions } from '../barcode/bwip';

export class BwipBarcodeRenderer implements BarcodeRenderer {
  render(op: BarcodeOp): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    bwipjs.toCanvas(canvas, bwipOptions(op) as never);
    return canvas;
  }
}
