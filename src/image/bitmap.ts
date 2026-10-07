/**
 * RGBA → 1-bit-per-dot conversion, the step that decides what a thermal head
 * actually burns.
 *
 * Thermal printing has no greys: every pixel is either a dot or nothing, so the
 * conversion carries the quality. Downscale first (box average, because
 * point-sampling a logo eats hairlines), then either hard-threshold — crisp,
 * correct for line art and text — or dither, which trades edge fidelity for
 * apparent tone on photographs.
 */

import { DecodedImage } from './types';

export type DitherMode = 'none' | 'floyd-steinberg';

export type Quadrant = 0 | 90 | 180 | 270;

export interface MonochromeOptions {
  /** Luminance below this (0-255) becomes a printed dot. Default 128. */
  threshold?: number;
  dither?: DitherMode;
  /** Swap black and white. */
  invert?: boolean;
  /** Scale down so the image is at most this many dots wide. */
  maxWidth?: number;
  /** Scale down so the image is at most this many dots tall. */
  maxHeight?: number;
  /** Crop blank margins after thresholding. */
  trim?: boolean;
  /** Rotate the finished bitmap clockwise by this many degrees. */
  rotate?: Quadrant;
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
export function downscale(image: DecodedImage, maxWidth: number): DecodedImage {
  return resizeToFit(image, maxWidth, 0);
}

/**
 * Box-average downscale to fit within a width and/or height limit. Aspect ratio
 * is preserved and images that already fit are returned untouched.
 */
export function resizeToFit(
  image: DecodedImage,
  maxWidth: number,
  maxHeight: number,
): DecodedImage {
  const widthFactor = maxWidth > 0 && image.width > maxWidth ? image.width / maxWidth : 1;
  const heightFactor =
    maxHeight > 0 && image.height > maxHeight ? image.height / maxHeight : 1;
  const factor = Math.max(widthFactor, heightFactor);
  if (factor <= 1) {
    return image;
  }

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

function getDot(bitmap: MonochromeBitmap, x: number, y: number): boolean {
  const byte = bitmap.data[y * bitmap.bytesPerRow + (x >> 3)] ?? 0;
  return ((byte >> (7 - (x & 7))) & 1) === 1;
}

function packDots(
  width: number,
  height: number,
  isSet: (x: number, y: number) => boolean,
): MonochromeBitmap {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  let printed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isSet(x, y)) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
        printed += 1;
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

/**
 * Crops blank rows and columns from the edges. Artwork exported from a design
 * tool almost always carries a transparent or white margin, and on a label that
 * margin is wasted stock — worse, it makes `^FO` coordinates lie about where
 * the ink starts.
 */
export function trimBitmap(bitmap: MonochromeBitmap): MonochromeBitmap {
  let top = 0;
  let bottom = bitmap.height - 1;
  let left = 0;
  let right = bitmap.width - 1;

  const rowHasInk = (y: number): boolean => {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (getDot(bitmap, x, y)) {
        return true;
      }
    }
    return false;
  };
  const columnHasInk = (x: number): boolean => {
    for (let y = top; y <= bottom; y += 1) {
      if (getDot(bitmap, x, y)) {
        return true;
      }
    }
    return false;
  };

  while (top <= bottom && !rowHasInk(top)) {
    top += 1;
  }
  if (top > bottom) {
    return bitmap; // entirely blank: nothing meaningful to crop to
  }
  while (bottom > top && !rowHasInk(bottom)) {
    bottom -= 1;
  }
  while (left < right && !columnHasInk(left)) {
    left += 1;
  }
  while (right > left && !columnHasInk(right)) {
    right -= 1;
  }

  if (top === 0 && left === 0 && bottom === bitmap.height - 1 && right === bitmap.width - 1) {
    return bitmap;
  }
  return packDots(right - left + 1, bottom - top + 1, (x, y) =>
    getDot(bitmap, x + left, y + top),
  );
}

/** Rotates a bitmap clockwise in quarter turns. */
export function rotateBitmap(
  bitmap: MonochromeBitmap,
  degrees: Quadrant,
): MonochromeBitmap {
  switch (degrees) {
    case 90:
      return packDots(bitmap.height, bitmap.width, (x, y) =>
        getDot(bitmap, y, bitmap.height - 1 - x),
      );
    case 180:
      return packDots(bitmap.width, bitmap.height, (x, y) =>
        getDot(bitmap, bitmap.width - 1 - x, bitmap.height - 1 - y),
      );
    case 270:
      return packDots(bitmap.height, bitmap.width, (x, y) =>
        getDot(bitmap, bitmap.width - 1 - y, x),
      );
    default:
      return bitmap;
  }
}

export function toMonochrome(
  input: DecodedImage,
  options: MonochromeOptions = {},
): MonochromeBitmap {
  const image = resizeToFit(input, options.maxWidth ?? 0, options.maxHeight ?? 0);
  const threshold = options.threshold ?? 128;
  const dither = options.dither ?? 'none';
  const { width, height } = image;

  const grey = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    grey[i] = luminance(
      image.rgba[i * 4],
      image.rgba[i * 4 + 1],
      image.rgba[i * 4 + 2],
      image.rgba[i * 4 + 3],
    );
  }

  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
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

  let bitmap: MonochromeBitmap = {
    width,
    height,
    bytesPerRow,
    data,
    coverage: width * height === 0 ? 0 : printed / (width * height),
  };

  if (options.trim) {
    bitmap = trimBitmap(bitmap);
  }
  if (options.rotate) {
    bitmap = rotateBitmap(bitmap, options.rotate);
  }
  return bitmap;
}

export type { DecodedImage };
