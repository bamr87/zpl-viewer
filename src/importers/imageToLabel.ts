/**
 * Artwork import: an image file to a monochrome graphic field a thermal printer
 * can burn (`^GF` in ZPL, `GW` in EPL).
 *
 * Decoding and the one-bit conversion live in the pure `image/` layer, which
 * the preview shares; what belongs here is the label side of the job — turning
 * a finished bitmap into printer commands, and reporting the judgement calls
 * (a downscale, heavy ink coverage) the user should know about.
 */

import { decodeImage, detectImageFormat } from '../image/decode';
import { encodeAsciiHexGraphic } from '../renderer/graphics';
import {
  MonochromeBitmap,
  MonochromeOptions,
  resizeToFit,
  toMonochrome,
} from '../image/bitmap';

export type {
  DitherMode,
  MonochromeBitmap,
  MonochromeOptions,
  Quadrant,
} from '../image/bitmap';
export {
  downscale,
  resizeToFit,
  rotateBitmap,
  toMonochrome,
  trimBitmap,
} from '../image/bitmap';

export interface GraphicFieldOptions {
  x?: number;
  y?: number;
  /** Wrap the field in `^XA`/`^XZ` (ZPL) or `N`/`P1` (EPL). */
  standalone?: boolean;
  /**
   * Compress the hex payload with Zebra's ACS scheme. On by default: logos are
   * mostly blank, and the compressed form is routinely an order of magnitude
   * smaller, which matters on a serial link.
   */
  compress?: boolean;
}

/** ZPL `^GF` field, ASCII-hex encoded (`^GFA`). */
export function bitmapToZplGraphicField(
  bitmap: MonochromeBitmap,
  options: GraphicFieldOptions = {},
): string {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const total = bitmap.data.length;
  const payload =
    options.compress === false
      ? toHex(bitmap.data)
      : encodeAsciiHexGraphic(bitmap.data, bitmap.bytesPerRow);
  const field = `^FO${x},${y}^GFA,${total},${total},${bitmap.bytesPerRow},${payload}^FS`;
  return options.standalone ? `^XA\n${field}\n^XZ\n` : field;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

/**
 * EPL `GW` command. The payload is raw binary: keep it as a byte string and
 * write it to the printer without re-encoding.
 */
export function bitmapToEplGraphicWrite(
  bitmap: MonochromeBitmap,
  options: GraphicFieldOptions = {},
): string {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  let raw = '';
  for (const byte of bitmap.data) {
    // EPL prints a dot for a 0 bit, the inverse of ZPL's convention.
    raw += String.fromCharCode(~byte & 0xff);
  }
  const command = `GW${x},${y},${bitmap.bytesPerRow},${bitmap.height},${raw}`;
  return options.standalone ? `N\n${command}\nP1\n` : command;
}

export interface ImportImageResult {
  bitmap: MonochromeBitmap;
  /** Original pixel size before any downscale. */
  sourceWidth: number;
  sourceHeight: number;
  /** Format the bytes were decoded as, for reporting back to the user. */
  format: string;
  warnings: string[];
}

/** Decodes supported image bytes and converts them to a printable bitmap. */
export function importImage(
  bytes: Uint8Array,
  options: MonochromeOptions = {},
): ImportImageResult {
  const format = detectImageFormat(bytes);
  if (!format) {
    throw new Error(
      'Unsupported image format. Save the artwork as a PNG or BMP and import that.',
    );
  }
  const decoded = decodeImage(bytes);
  // Resize up front rather than inside the conversion so that the report can
  // tell a downscale apart from a trim or a rotation, which also change the
  // finished dimensions.
  const resized = resizeToFit(decoded, options.maxWidth ?? 0, options.maxHeight ?? 0);
  const bitmap = toMonochrome(resized, { ...options, maxWidth: 0, maxHeight: 0 });

  const warnings: string[] = [];
  if (resized !== decoded) {
    warnings.push(
      `Image scaled from ${decoded.width}x${decoded.height} to ${resized.width}x${resized.height} dots.`,
    );
  }
  if (options.trim && (bitmap.width !== resized.width || bitmap.height !== resized.height)) {
    warnings.push(
      `Blank margins trimmed; the artwork is ${bitmap.width}x${bitmap.height} dots.`,
    );
  }
  if (bitmap.coverage > 0.6) {
    warnings.push(
      `Artwork covers ${Math.round(bitmap.coverage * 100)}% of its area in ink; consider inverting or raising the threshold.`,
    );
  }
  return {
    bitmap,
    sourceWidth: decoded.width,
    sourceHeight: decoded.height,
    format: format.label,
    warnings,
  };
}
