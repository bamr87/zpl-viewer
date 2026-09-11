/**
 * Unit conversions shared by every label format. Printers think in *dots*;
 * humans think in inches or millimetres; densities are quoted in dots per
 * millimetre (dpmm). Everything in this module is pure and isomorphic so the
 * webview bundle can use it too.
 */

export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;

/** Densities Zebra-class printers ship with, in dots per millimetre. */
export const SUPPORTED_DENSITIES = [6, 8, 12, 24] as const;

export type Density = (typeof SUPPORTED_DENSITIES)[number];

/** Dots per inch for a given dpmm (203, 300, 600 dpi and friends). */
export function dotsPerInch(dpmm: number): number {
  return dpmm * MM_PER_INCH;
}

export function inchesToDots(inches: number, dpmm: number): number {
  return Math.round(inches * dpmm * MM_PER_INCH);
}

export function mmToDots(mm: number, dpmm: number): number {
  return Math.round(mm * dpmm);
}

export function dotsToInches(dots: number, dpmm: number): number {
  return dots / (dpmm * MM_PER_INCH);
}

export function dotsToMm(dots: number, dpmm: number): number {
  return dots / dpmm;
}

export function dotsToPoints(dots: number, dpmm: number): number {
  return dotsToInches(dots, dpmm) * POINTS_PER_INCH;
}

/**
 * Normalizes a density written as `8`, `"8"`, or `"8dpmm"` to a supported
 * density, falling back to 8 dpmm (203 dpi) — by far the most common printer.
 */
export function parseDensity(value: string | number | undefined): Density {
  const n =
    typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  const match = SUPPORTED_DENSITIES.find((d) => d === n);
  return match ?? 8;
}

/** Human label for a density, e.g. `8 dpmm (203 dpi)`. */
export function describeDensity(dpmm: number): string {
  return `${dpmm} dpmm (${Math.round(dotsPerInch(dpmm))} dpi)`;
}
