/**
 * PNG decoder.
 *
 * Importing a logo is the most common "get this artwork onto the label" task,
 * and it has to work offline, so rather than adding an image library this
 * decodes PNG directly: any bit depth, greyscale / RGB / palette / alpha, and
 * both scan orders (progressive Adam7 included).
 *
 * Inflation goes through the repository's own DEFLATE implementation rather
 * than Node's `zlib` so that this module stays in the pure layer: the preview
 * webview needs it too, to draw the PNGs that `~DY` downloads into a label.
 */

import { inflate } from '../core/inflate';
import { DecodedImage } from './types';

export type { DecodedImage };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

function unfilter(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number,
  bytesPerRow: number,
): Uint8Array {
  const out = new Uint8Array(height * bytesPerRow);
  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const rowStart = y * bytesPerRow;
    const prevStart = (y - 1) * bytesPerRow;
    for (let x = 0; x < bytesPerRow; x += 1) {
      const value = raw[rawOffset + x];
      const left = x >= bytesPerPixel ? out[rowStart + x - bytesPerPixel] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0;
      let result: number;
      switch (filter) {
        case 0:
          result = value;
          break;
        case 1:
          result = value + left;
          break;
        case 2:
          result = value + up;
          break;
        case 3:
          result = value + ((left + up) >> 1);
          break;
        case 4:
          result = value + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filter} on row ${y}.`);
      }
      out[rowStart + x] = result & 0xff;
    }
    rawOffset += bytesPerRow;
    void width;
  }
  return out;
}

function samplesPerPixel(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1; // greyscale
    case 2:
      return 3; // truecolour
    case 3:
      return 1; // palette index
    case 4:
      return 2; // greyscale + alpha
    case 6:
      return 4; // truecolour + alpha
    default:
      throw new Error(`Unsupported PNG colour type ${colorType}.`);
  }
}

/** Expands a scanline of sub-byte samples (bit depth 1, 2 or 4) to bytes. */
function expandBits(
  row: Uint8Array,
  bitDepth: number,
  count: number,
): Uint8Array {
  const out = new Uint8Array(count);
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let i = 0; i < count; i += 1) {
    const byte = row[Math.floor(i / perByte)];
    const shift = 8 - bitDepth * ((i % perByte) + 1);
    out[i] = (byte >> shift) & mask;
  }
  return out;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  if (!isPng(bytes)) {
    throw new Error('Not a PNG file (bad signature).');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUInt32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const data = bytes.subarray(dataStart, dataStart + length);

    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = new Uint8Array(data);
    } else if (type === 'tRNS') {
      transparency = new Uint8Array(data);
    } else if (type === 'IDAT') {
      idat.push(new Uint8Array(data));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4; // skip CRC
  }

  if (width === 0 || height === 0) {
    throw new Error('PNG has no IHDR chunk.');
  }
  if (idat.length === 0) {
    throw new Error('PNG has no image data.');
  }

  let totalLength = 0;
  for (const chunk of idat) {
    totalLength += chunk.length;
  }
  const compressed = new Uint8Array(totalLength);
  let compressedOffset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }
  const raw = inflate(compressed);

  const channels = samplesPerPixel(colorType);
  const bitsPerPixel = channels * bitDepth;
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));

  const rgba = new Uint8Array(width * height * 4);
  const maxValue = (1 << bitDepth) - 1;

  const passes = interlace === 1
    ? adam7Passes(width, height)
    : [{ xStart: 0, yStart: 0, xStep: 1, yStep: 1, width, height }];

  let rawOffset = 0;
  for (const pass of passes) {
    if (pass.width === 0 || pass.height === 0) {
      continue;
    }
    const passBytesPerRow = Math.ceil((pass.width * bitsPerPixel) / 8);
    const passLength = pass.height * (passBytesPerRow + 1);
    const unfiltered = unfilter(
      raw.subarray(rawOffset, rawOffset + passLength),
      pass.width,
      pass.height,
      bytesPerPixel,
      passBytesPerRow,
    );
    rawOffset += passLength;

  for (let passY = 0; passY < pass.height; passY += 1) {
    const y = pass.yStart + passY * pass.yStep;
    const row = unfiltered.subarray(passY * passBytesPerRow, (passY + 1) * passBytesPerRow);
    const samples =
      bitDepth < 8 ? expandBits(row, bitDepth, pass.width * channels) : row;
    for (let passX = 0; passX < pass.width; passX += 1) {
      const x = pass.xStart + passX * pass.xStep;
      const target = (y * width + x) * 4;
      const read = (channel: number): number => {
        if (bitDepth === 16) {
          return samples[(passX * channels + channel) * 2];
        }
        return samples[passX * channels + channel];
      };
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      switch (colorType) {
        case 0: {
          const value = bitDepth < 8 ? (read(0) * 255) / maxValue : read(0);
          r = g = b = value;
          break;
        }
        case 2:
          r = read(0);
          g = read(1);
          b = read(2);
          break;
        case 3: {
          const index = read(0);
          if (!palette) {
            throw new Error('Palette PNG has no PLTE chunk.');
          }
          r = palette[index * 3];
          g = palette[index * 3 + 1];
          b = palette[index * 3 + 2];
          a = transparency && index < transparency.length ? transparency[index] : 255;
          break;
        }
        case 4: {
          const value = read(0);
          r = g = b = value;
          a = read(1);
          break;
        }
        default:
          r = read(0);
          g = read(1);
          b = read(2);
          a = read(3);
          break;
      }
      rgba[target] = r;
      rgba[target + 1] = g;
      rgba[target + 2] = b;
      rgba[target + 3] = a;
    }
  }
  }

  return { width, height, rgba };
}

interface Adam7Pass {
  xStart: number;
  yStart: number;
  xStep: number;
  yStep: number;
  width: number;
  height: number;
}

/**
 * The seven passes of the Adam7 interlace scheme, sized for this image. Each
 * pass is a complete little sub-image with its own filter bytes, which is why
 * decoding walks passes rather than rows.
 */
function adam7Passes(width: number, height: number): Adam7Pass[] {
  const geometry: Array<[number, number, number, number]> = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2],
  ];
  return geometry.map(([xStart, yStart, xStep, yStep]) => ({
    xStart,
    yStart,
    xStep,
    yStep,
    width: Math.ceil(Math.max(0, width - xStart) / xStep),
    height: Math.ceil(Math.max(0, height - yStart) / yStep),
  }));
}
