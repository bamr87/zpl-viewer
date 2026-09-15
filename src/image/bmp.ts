/**
 * Windows BMP decoder.
 *
 * BMP earns its place next to PNG because it is the lingua franca of printer
 * tooling: Zebra's own designers, label templates from the 90s and most
 * "export for printer" buttons still produce it, and it is exactly the kind of
 * file someone has on hand when they want a logo on a label.
 *
 * Covers the forms those tools emit — 1/4/8-bit palette (uncompressed and RLE),
 * 16-bit, 24-bit and 32-bit, in either scan direction.
 */

import { DecodedImage } from './types';

export function isBmp(bytes: Uint8Array): boolean {
  return bytes.length > 14 && bytes[0] === 0x42 && bytes[1] === 0x4d; // "BM"
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function readInt32(bytes: Uint8Array, offset: number): number {
  return readUInt32(bytes, offset) | 0;
}

/** Number of trailing zero bits, used to turn a channel mask into a shift. */
function maskShift(mask: number): number {
  if (mask === 0) {
    return 0;
  }
  let shift = 0;
  let value = mask;
  while ((value & 1) === 0) {
    value >>>= 1;
    shift += 1;
  }
  return shift;
}

/** Scales a channel of `bits` width up to a full 8-bit sample. */
function scaleChannel(value: number, bits: number): number {
  if (bits === 0) {
    return 0;
  }
  if (bits === 8) {
    return value & 0xff;
  }
  const max = (1 << bits) - 1;
  return Math.round((value / max) * 255);
}

function bitCount(mask: number): number {
  let count = 0;
  let value = mask;
  while (value) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

export function decodeBmp(bytes: Uint8Array): DecodedImage {
  if (!isBmp(bytes)) {
    throw new Error('Not a BMP file (bad signature).');
  }

  const pixelOffset = readUInt32(bytes, 10);
  const headerSize = readUInt32(bytes, 14);
  if (headerSize < 12) {
    throw new Error('BMP has a truncated info header.');
  }

  let width: number;
  let height: number;
  let bitsPerPixel: number;
  let compression = 0;
  let paletteEntries = 0;
  let paletteEntrySize = 4;

  if (headerSize === 12) {
    // BITMAPCOREHEADER
    width = readUInt16(bytes, 18);
    height = readUInt16(bytes, 20);
    bitsPerPixel = readUInt16(bytes, 24);
    paletteEntrySize = 3;
  } else {
    width = readInt32(bytes, 18);
    height = readInt32(bytes, 22);
    bitsPerPixel = readUInt16(bytes, 28);
    compression = readUInt32(bytes, 30);
    paletteEntries = readUInt32(bytes, 46);
  }

  const topDown = height < 0;
  height = Math.abs(height);
  if (width <= 0 || height <= 0) {
    throw new Error('BMP declares an empty image.');
  }

  // Channel masks: BI_BITFIELDS supplies them, the packed formats have defaults.
  let redMask = 0;
  let greenMask = 0;
  let blueMask = 0;
  let alphaMask = 0;
  if (compression === 3 || compression === 6) {
    const masksAt = headerSize >= 52 ? 14 + 40 : pixelOffset - 12;
    redMask = readUInt32(bytes, masksAt);
    greenMask = readUInt32(bytes, masksAt + 4);
    blueMask = readUInt32(bytes, masksAt + 8);
    if (headerSize >= 56 || compression === 6) {
      alphaMask = readUInt32(bytes, masksAt + 12);
    }
  } else if (bitsPerPixel === 16) {
    redMask = 0x7c00;
    greenMask = 0x03e0;
    blueMask = 0x001f;
  } else if (bitsPerPixel === 32) {
    redMask = 0x00ff0000;
    greenMask = 0x0000ff00;
    blueMask = 0x000000ff;
  }

  const paletteStart = 14 + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
  const usesPalette = bitsPerPixel <= 8;
  const paletteCount =
    paletteEntries > 0 ? paletteEntries : usesPalette ? 1 << bitsPerPixel : 0;

  const palette = new Uint8Array(Math.max(0, paletteCount) * 3);
  for (let i = 0; i < paletteCount; i += 1) {
    const at = paletteStart + i * paletteEntrySize;
    // Palette entries are stored BGR(A).
    palette[i * 3] = bytes[at + 2] ?? 0;
    palette[i * 3 + 1] = bytes[at + 1] ?? 0;
    palette[i * 3 + 2] = bytes[at] ?? 0;
  }

  const rgba = new Uint8Array(width * height * 4);
  const put = (x: number, y: number, r: number, g: number, b: number, a: number): void => {
    if (x < 0 || x >= width || y < 0 || y >= height) {
      return;
    }
    const target = (y * width + x) * 4;
    rgba[target] = r;
    rgba[target + 1] = g;
    rgba[target + 2] = b;
    rgba[target + 3] = a;
  };
  const rowFor = (y: number): number => (topDown ? y : height - 1 - y);
  const putPaletteIndex = (x: number, y: number, index: number): void => {
    put(
      x,
      y,
      palette[index * 3] ?? 0,
      palette[index * 3 + 1] ?? 0,
      palette[index * 3 + 2] ?? 0,
      255,
    );
  };

  if (compression === 1 || compression === 2) {
    decodeRle(bytes, pixelOffset, width, height, bitsPerPixel, rowFor, putPaletteIndex);
    return { width, height, rgba };
  }

  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 32) * 4;
  const redBits = bitCount(redMask);
  const greenBits = bitCount(greenMask);
  const blueBits = bitCount(blueMask);
  const alphaBits = bitCount(alphaMask);

  for (let y = 0; y < height; y += 1) {
    const rowStart = pixelOffset + y * bytesPerRow;
    const targetY = rowFor(y);
    for (let x = 0; x < width; x += 1) {
      switch (bitsPerPixel) {
        case 1:
        case 2:
        case 4:
        case 8: {
          const bitPosition = x * bitsPerPixel;
          const byte = bytes[rowStart + (bitPosition >> 3)] ?? 0;
          const shift = 8 - bitsPerPixel - (bitPosition & 7);
          const index = (byte >> shift) & ((1 << bitsPerPixel) - 1);
          putPaletteIndex(x, targetY, index);
          break;
        }
        case 16: {
          const value = readUInt16(bytes, rowStart + x * 2);
          put(
            x,
            targetY,
            scaleChannel((value & redMask) >>> maskShift(redMask), redBits),
            scaleChannel((value & greenMask) >>> maskShift(greenMask), greenBits),
            scaleChannel((value & blueMask) >>> maskShift(blueMask), blueBits),
            alphaMask
              ? scaleChannel((value & alphaMask) >>> maskShift(alphaMask), alphaBits)
              : 255,
          );
          break;
        }
        case 24: {
          const at = rowStart + x * 3;
          put(x, targetY, bytes[at + 2] ?? 0, bytes[at + 1] ?? 0, bytes[at] ?? 0, 255);
          break;
        }
        case 32: {
          const value = readUInt32(bytes, rowStart + x * 4);
          put(
            x,
            targetY,
            scaleChannel((value & redMask) >>> maskShift(redMask), redBits),
            scaleChannel((value & greenMask) >>> maskShift(greenMask), greenBits),
            scaleChannel((value & blueMask) >>> maskShift(blueMask), blueBits),
            // A zero alpha channel means "no alpha recorded", not "invisible":
            // plenty of writers leave the fourth byte at zero.
            alphaMask ? scaleChannel((value & alphaMask) >>> maskShift(alphaMask), alphaBits) : 255,
          );
          break;
        }
        default:
          throw new Error(`Unsupported BMP colour depth ${bitsPerPixel}.`);
      }
    }
  }

  if (bitsPerPixel === 32 && alphaMask !== 0) {
    let anyOpaque = false;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] !== 0) {
        anyOpaque = true;
        break;
      }
    }
    if (!anyOpaque) {
      for (let i = 3; i < rgba.length; i += 4) {
        rgba[i] = 255;
      }
    }
  }

  return { width, height, rgba };
}

/** BI_RLE8 (compression 1) and BI_RLE4 (compression 2). */
function decodeRle(
  bytes: Uint8Array,
  start: number,
  width: number,
  height: number,
  bitsPerPixel: number,
  rowFor: (y: number) => number,
  putPaletteIndex: (x: number, y: number, index: number) => void,
): void {
  let offset = start;
  let x = 0;
  let y = 0;

  while (offset + 1 < bytes.length && y < height) {
    const count = bytes[offset];
    const value = bytes[offset + 1];
    offset += 2;

    if (count > 0) {
      for (let i = 0; i < count && x < width; i += 1) {
        const index =
          bitsPerPixel === 8 ? value : i % 2 === 0 ? value >> 4 : value & 0x0f;
        putPaletteIndex(x, rowFor(y), index);
        x += 1;
      }
      continue;
    }

    if (value === 0) {
      x = 0;
      y += 1;
    } else if (value === 1) {
      return; // end of bitmap
    } else if (value === 2) {
      x += bytes[offset] ?? 0;
      y += bytes[offset + 1] ?? 0;
      offset += 2;
    } else {
      // Absolute mode: `value` literal pixels, padded to a word boundary.
      const literals = value;
      if (bitsPerPixel === 8) {
        for (let i = 0; i < literals; i += 1) {
          if (x < width) {
            putPaletteIndex(x, rowFor(y), bytes[offset + i] ?? 0);
            x += 1;
          }
        }
        offset += literals + (literals % 2);
      } else {
        for (let i = 0; i < literals; i += 1) {
          const byte = bytes[offset + (i >> 1)] ?? 0;
          const index = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
          if (x < width) {
            putPaletteIndex(x, rowFor(y), index);
            x += 1;
          }
        }
        const consumed = Math.ceil(literals / 2);
        offset += consumed + (consumed % 2);
      }
    }
  }
}
