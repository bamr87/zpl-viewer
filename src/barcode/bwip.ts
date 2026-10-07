/**
 * Maps an IR barcode op onto bwip-js encoder options.
 *
 * Kept separate from any one output target because the same mapping has to
 * serve every renderer — the preview canvas, PNG/PDF export and the SVG
 * exporter — and a barcode that encodes differently per output would be worse
 * than useless: it would scan in the preview and fail on the label.
 */

import { BarcodeOp } from '../renderer/ir';
import { findSymbology } from './symbologies';
import { completeBarcodeData } from './validate';

export function bwipOptions(op: BarcodeOp): Record<string, unknown> {
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
    options.scale = Math.max(1, op.magnification ?? 4);
    if (op.errorCorrection) {
      if (spec.id === 'qrcode') {
        options.eclevel = op.errorCorrection;
      } else if (spec.id === 'pdf417' || spec.id === 'micropdf417') {
        const level = parseInt(op.errorCorrection, 10);
        if (Number.isFinite(level)) {
          options.eclevel = level;
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

  return options;
}
