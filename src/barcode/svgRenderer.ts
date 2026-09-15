/**
 * bwip-js-backed barcode renderer for the SVG exporter.
 *
 * bwip-js hands back a complete `<svg>` element; SVG nests, so the exporter can
 * drop it straight into the label's own coordinate system inside a positioned
 * group. That keeps the barcode vector — the bars stay exact edges rather than
 * a resampled image — which is the whole point of exporting SVG.
 */

import bwipjs from 'bwip-js';
import { BarcodeOp } from '../renderer/ir';
import { bwipOptions } from './bwip';
import { BarcodeSvgRenderer } from '../emit/svg';

export class BwipSvgRenderer implements BarcodeSvgRenderer {
  render(op: BarcodeOp): string {
    return bwipjs.toSVG(bwipOptions(op) as never);
  }
}
