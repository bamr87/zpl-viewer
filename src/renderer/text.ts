/**
 * Glyph metrics shared by every renderer.
 *
 * ZPL sizes text by the cell a character occupies; CSS sizes it by the em of
 * whatever font the host happens to have. Bridging the two is an approximation
 * either way, but it has to be the *same* approximation in the canvas preview,
 * the PNG/PDF export and the SVG exporter — otherwise a label that fits on
 * screen overflows in the file the user actually sends out.
 */

import { TextOp } from './ir';

/**
 * Roughly the advance width of a sans-serif glyph as a fraction of its em.
 * Used both to correct bitmap-font cells and to estimate text extents where no
 * measuring context is available.
 */
export const NATURAL_GLYPH_ASPECT = 0.55;

/**
 * True for ZPL's scalable fonts: `^A0` (CG Triumvirate) and `^A@`, the
 * downloaded-font selector.
 */
export function isScalableFont(font: string): boolean {
  return font === '0' || font === '@';
}

/**
 * Horizontal scale to apply to glyphs drawn at `font-size: fontHeight`.
 *
 * The two font families mean different things by "width":
 *
 *  - Scalable fonts are proportional. `^CF0,40` (and `^A0N,40,40`, which is
 *    what an omitted width becomes) asks for 40-dot-tall text at the face's own
 *    proportions — not text squeezed into a 40-dot square. Treating the width
 *    as an em gives a scale of 1 in that common case, which is what a printer
 *    produces; the previous cell-based reading stretched every such label by
 *    about 80% and made text appear to overflow labels it fits on.
 *
 *  - Bitmap fonts (A-H) really do have a fixed, non-square cell, so their
 *    width-to-height ratio is meaningful and is mapped onto the host font's.
 */
export function glyphXScale(op: Pick<TextOp, 'font' | 'fontWidth' | 'fontHeight'>): number {
  const height = Math.max(1, op.fontHeight);
  const width = op.fontWidth > 0 ? op.fontWidth : height;
  const ratio = width / height;
  return isScalableFont(op.font) ? ratio : ratio / NATURAL_GLYPH_ASPECT;
}

/** Estimated advance width of one glyph, in dots, as drawn. */
export function estimatedGlyphWidth(
  op: Pick<TextOp, 'font' | 'fontWidth' | 'fontHeight'>,
): number {
  return Math.max(1, op.fontHeight) * NATURAL_GLYPH_ASPECT * glyphXScale(op);
}
