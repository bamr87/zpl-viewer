/**
 * Artwork import: RGBA bitmap to a monochrome graphic field a thermal printer
 * can burn (`^GF` in ZPL, `GW` in EPL).
 *
 * Thermal heads are one bit per dot, so the interesting work is the
 * conversion: optional downscale to fit the label, then either a hard
 * threshold (crisp for logos and line art) or Floyd-Steinberg dithering
 * (better for photos).
 */

import { DecodedImage, decodePng, isPng } from './png';

export type DitherMode = 'none' | 'floyd-steinberg';

export interface MonochromeOptions {
  /** Luminance below this (0-255) becomes a printed dot. Default 128. */
  threshold?: number;
  dither?: DitherMode;
  /** Swap black and white. */
  invert?: boolean;
  /** Scale down so the image is at most this many dots wide. */
  maxWidth?: number;
}

export interface MonochromeBitmap {
  width: number;
  height: number;
  bytesPerRow: number;
  /** 1 bit per pixel, MSB first; a set bit prints a dot. */
  data: Uint8Array;
  /** Fraction of dots that are printed, 0-1. */
  coverage: number;
}

function luminance(r: number, g: number, b: number, a: number): number {
  // Composite over white: an unprinted label is white, so transparency should
  // read as background rather than black.
  const alpha = a / 255;
  const rr = r * alpha + 255 * (1 - alpha);
  const gg = g * alpha + 255 * (1 - alpha);
  const bb = b * alpha + 255 * (1 - alpha);
  return 0.299 * rr + 0.587 * gg + 0.114 * bb;
}

/** Box-average downscale; returns the input unchanged when it already fits. */
export function downscale(
  image: DecodedImage,
  maxWidth: number,
): DecodedImage {
  if (maxWidth <= 0 || image.width <= maxWidth) {
    return image;
  }
  const factor = image.width / maxWidth;
  const width = Math.max(1, Math.round(image.width / factor));
  const height = Math.max(1, Math.round(image.height / factor));
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const srcY0 = Math.floor(y * factor);
    const srcY1 = Math.min(image.height, Math.max(srcY0 + 1, Math.floor((y + 1) * factor)));
    for (let x = 0; x < width; x += 1) {
      const srcX0 = Math.floor(x * factor);
      const srcX1 = Math.min(image.width, Math.max(srcX0 + 1, Math.floor((x + 1) * factor)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = srcY0; sy < srcY1; sy += 1) {
        for (let sx = srcX0; sx < srcX1; sx += 1) {
          const index = (sy * image.width + sx) * 4;
          r += image.rgba[index];
          g += image.rgba[index + 1];
          b += image.rgba[index + 2];
          a += image.rgba[index + 3];
          count += 1;
        }
      }
      const target = (y * width + x) * 4;
      rgba[target] = Math.round(r / count);
      rgba[target + 1] = Math.round(g / count);
      rgba[target + 2] = Math.round(b / count);
      rgba[target + 3] = Math.round(a / count);
    }
  }
  return { width, height, rgba };
}

export function toMonochrome(
  input: DecodedImage,
  options: MonochromeOptions = {},
): MonochromeBitmap {
  const image = options.maxWidth ? downscale(input, options.maxWidth) : input;
  const threshold = options.threshold ?? 128;
  const dither = options.dither ?? 'none';
  const { width, height } = image;
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);

  const grey = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    grey[i] = luminance(
      image.rgba[i * 4],
      image.rgba[i * 4 + 1],
      image.rgba[i * 4 + 2],
      image.rgba[i * 4 + 3],
    );
  }

  let printed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = grey[index];
      const black = value < threshold;
      const dot = options.invert ? !black : black;
      if (dot) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
        printed += 1;
      }
      if (dither === 'floyd-steinberg') {
        // Diffuse the quantization error of the *luminance* decision; the
        // invert flag only changes which bits are written.
        const error = value - (black ? 0 : 255);
        const spread = (dx: number, dy: number, weight: number): void => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny >= height) {
            return;
          }
          grey[ny * width + nx] += (error * weight) / 16;
        };
        spread(1, 0, 7);
        spread(-1, 1, 3);
        spread(0, 1, 5);
        spread(1, 1, 1);
      }
    }
  }

  return {
    width,
    height,
    bytesPerRow,
    data,
    coverage: width * height === 0 ? 0 : printed / (width * height),
  };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export interface GraphicFieldOptions {
  x?: number;
  y?: number;
  /** Wrap the field in `^XA`/`^XZ` (ZPL) or `N`/`P1` (EPL). */
  standalone?: boolean;
}

/** ZPL `^GF` field, ASCII-hex encoded (`^GFA`). */
export function bitmapToZplGraphicField(
  bitmap: MonochromeBitmap,
  options: GraphicFieldOptions = {},
): string {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const total = bitmap.data.length;
  const field = `^FO${x},${y}^GFA,${total},${total},${bitmap.bytesPerRow},${toHex(bitmap.data)}^FS`;
  return options.standalone ? `^XA\n${field}\n^XZ\n` : field;
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
  warnings: string[];
}

/** Decodes supported image bytes and converts them to a printable bitmap. */
export function importImage(
  bytes: Uint8Array,
  options: MonochromeOptions = {},
): ImportImageResult {
  if (!isPng(bytes)) {
    throw new Error(
      'Unsupported image format. Save the artwork as a PNG and import that.',
    );
  }
  const decoded = decodePng(bytes);
  const bitmap = toMonochrome(decoded, options);
  const warnings: string[] = [];
  if (bitmap.width !== decoded.width) {
    warnings.push(
      `Image scaled from ${decoded.width}x${decoded.height} to ${bitmap.width}x${bitmap.height} dots.`,
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
    warnings,
  };
}
