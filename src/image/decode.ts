/**
 * Format detection and dispatch for the image decoders.
 *
 * Callers should not care whether artwork arrived as a PNG, a BMP or a raw
 * printer bitmap — they want pixels. Adding a format means adding a decoder
 * beside this file and one entry in the table below.
 */

import { decodeBmp, isBmp } from './bmp';
import { decodePng, isPng } from './png';
import { DecodedImage } from './types';

export type ImageFormat = 'png' | 'bmp';

export interface ImageFormatInfo {
  id: ImageFormat;
  label: string;
  /** Extensions accepted for this format, without the leading dot. */
  extensions: string[];
  matches(bytes: Uint8Array): boolean;
  decode(bytes: Uint8Array): DecodedImage;
}

export const IMAGE_FORMATS: ImageFormatInfo[] = [
  {
    id: 'png',
    label: 'PNG',
    extensions: ['png'],
    matches: isPng,
    decode: decodePng,
  },
  {
    id: 'bmp',
    label: 'BMP',
    extensions: ['bmp', 'dib'],
    matches: isBmp,
    decode: decodeBmp,
  },
];

/** Every extension the importer accepts, for file-dialog filters. */
export function supportedImageExtensions(): string[] {
  return IMAGE_FORMATS.flatMap((format) => format.extensions);
}

/** Identifies an image by its magic bytes; extensions are not trusted. */
export function detectImageFormat(bytes: Uint8Array): ImageFormatInfo | undefined {
  return IMAGE_FORMATS.find((format) => format.matches(bytes));
}

export function isSupportedImage(bytes: Uint8Array): boolean {
  return detectImageFormat(bytes) !== undefined;
}

export function decodeImage(bytes: Uint8Array): DecodedImage {
  const format = detectImageFormat(bytes);
  if (!format) {
    const names = IMAGE_FORMATS.map((f) => f.label).join(' or ');
    throw new Error(
      `Unsupported image format. Save the artwork as ${names} and import that.`,
    );
  }
  return format.decode(bytes);
}

export type { DecodedImage };
