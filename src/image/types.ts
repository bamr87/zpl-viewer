/** A decoded raster image, straight RGBA with no premultiplication. */
export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
}
