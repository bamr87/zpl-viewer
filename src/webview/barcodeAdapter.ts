/**
 * Adapter that renders ZPL barcodes via bwip-js onto an offscreen canvas. The
 * resulting canvas is later composited into the main label canvas by draw.ts.
 *
 * bwip-js is included as a CDN-less dependency; we import the browser bundle.
 */

import bwipjs from 'bwip-js';
import { BarcodeOp, BarcodeSymbology } from '../renderer/ir';
import { BarcodeRenderer } from '../renderer/draw';

const BWIPP_MAP: Record<BarcodeSymbology, string> = {
  code128: 'code128',
  code39: 'code39',
  ean13: 'ean13',
  ean8: 'ean8',
  upca: 'upca',
  upce: 'upce',
  itf14: 'itf14',
  qrcode: 'qrcode',
  datamatrix: 'datamatrix',
  pdf417: 'pdf417',
  aztec: 'azteccode',
  codabar: 'rationalizedCodabar',
  code93: 'code93',
};

const TWO_D_CODES = new Set<BarcodeSymbology>([
  'qrcode',
  'datamatrix',
  'pdf417',
  'aztec',
]);

export class BwipBarcodeRenderer implements BarcodeRenderer {
  render(op: BarcodeOp): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const bcid = BWIPP_MAP[op.symbology];
    if (!bcid) {
      throw new Error(`Unsupported barcode symbology: ${op.symbology}`);
    }

    const options: Record<string, unknown> = {
      bcid,
      text: op.data,
      includetext: op.interpretation,
      textxalign: 'center',
      backgroundcolor: 'FFFFFF',
      barcolor: '000000',
    };

    if (TWO_D_CODES.has(op.symbology)) {
      const scale = Math.max(1, op.magnification ?? 4);
      options.scale = scale;
      if (op.errorCorrection) {
        if (op.symbology === 'qrcode') {
          options.eclevel = op.errorCorrection;
        } else if (op.symbology === 'pdf417') {
          const n = parseInt(op.errorCorrection, 10);
          if (Number.isFinite(n)) {
            options.eclevel = n;
          }
        }
      }
      if (op.columns && op.symbology === 'datamatrix') {
        options.columns = op.columns;
      }
      if (op.rows && op.symbology === 'datamatrix') {
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
