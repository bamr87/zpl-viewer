/**
 * Adapter that renders IR barcode ops via bwip-js onto an offscreen canvas.
 * The resulting canvas is later composited into the main label canvas by
 * draw.ts.
 *
 * Encoder ids and 2-D/linear classification come from the shared symbology
 * catalog, so adding a symbology in one place lights it up in the parser,
 * validator, emitters and this renderer at once.
 */

import bwipjs from 'bwip-js';
import { BarcodeOp } from '../renderer/ir';
import { BarcodeRenderer } from '../renderer/draw';
import { findSymbology } from '../barcode/symbologies';
import { completeBarcodeData } from '../barcode/validate';

export class BwipBarcodeRenderer implements BarcodeRenderer {
  render(op: BarcodeOp): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const spec = findSymbology(op.symbology);
    if (!spec) {
      throw new Error(`Unsupported barcode symbology: ${op.symbology}`);
    }

    const options: Record<string, unknown> = {
      bcid: spec.bwipId,
      text: completeBarcodeData(spec.id, op.data),
      includetext: op.interpretation,
      textxalign: 'center',
      backgroundcolor: 'FFFFFF',
      barcolor: '000000',
    };

    if (spec.kind === '2d') {
      const scale = Math.max(1, op.magnification ?? 4);
      options.scale = scale;
      if (op.errorCorrection) {
        if (spec.id === 'qrcode') {
          options.eclevel = op.errorCorrection;
        } else if (spec.id === 'pdf417' || spec.id === 'micropdf417') {
          const n = parseInt(op.errorCorrection, 10);
          if (Number.isFinite(n)) {
            options.eclevel = n;
          }
        }
      }
      if (op.columns && spec.id === 'datamatrix') {
        options.columns = op.columns;
      }
      if (op.rows && spec.id === 'datamatrix') {
        options.rows = op.rows;
      }
    } else {
      options.scaleX = Math.max(1, op.moduleWidth);
      options.height = Math.max(2, op.height) / 8; // bwipp expects mm-like height
      options.textxheight = Math.max(5, op.height / 4);
      if (op.interpretationAbove) {
        options.textyoffset = -(op.height + 6);
      }
    }

    bwipjs.toCanvas(canvas, options as never);
    return canvas;
  }
}
