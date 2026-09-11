import { expect } from 'chai';
import * as zlib from 'zlib';
import { decodePng, isPng } from '../../importers/png';
import {
  bitmapToEplGraphicWrite,
  bitmapToZplGraphicField,
  downscale,
  importImage,
  toMonochrome,
} from '../../importers/imageToLabel';
import { importCapture } from '../../importers/capture';
import { parseLabel } from '../../core/pipeline';

/**
 * Builds a real (tiny) PNG so the decoder is tested against the format rather
 * than a fixture we generated with the same code.
 */
function makePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Uint8Array {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
      offset += 4;
    }
  }

  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

describe('importers.png', () => {
  it('recognizes the signature', () => {
    expect(isPng(makePng(1, 1, () => [0, 0, 0, 255]))).to.equal(true);
    expect(isPng(new Uint8Array([1, 2, 3]))).to.equal(false);
  });

  it('decodes an RGBA image', () => {
    const png = makePng(2, 2, (x, y) =>
      x === y ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    const decoded = decodePng(png);
    expect(decoded.width).to.equal(2);
    expect(decoded.height).to.equal(2);
    expect([...decoded.rgba.subarray(0, 4)]).to.deep.equal([0, 0, 0, 255]);
    expect([...decoded.rgba.subarray(4, 8)]).to.deep.equal([255, 255, 255, 255]);
  });

  it('rejects a file that is not a PNG', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).to.throw('Not a PNG');
  });
});

describe('importers.imageToLabel', () => {
  const checkerboard = makePng(8, 8, (x, y) =>
    (x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255],
  );

  it('thresholds to one bit per pixel', () => {
    const bitmap = toMonochrome(decodePng(checkerboard));
    expect(bitmap.width).to.equal(8);
    expect(bitmap.bytesPerRow).to.equal(1);
    expect(bitmap.data).to.have.length(8);
    expect(bitmap.coverage).to.be.closeTo(0.5, 0.01);
    // Row 0 alternates starting with a printed dot: 1010_1010.
    expect(bitmap.data[0]).to.equal(0b10101010);
  });

  it('inverts when asked', () => {
    const bitmap = toMonochrome(decodePng(checkerboard), { invert: true });
    expect(bitmap.data[0]).to.equal(0b01010101);
  });

  it('treats transparency as unprinted background', () => {
    const transparent = makePng(4, 1, () => [0, 0, 0, 0]);
    const bitmap = toMonochrome(decodePng(transparent));
    expect(bitmap.coverage).to.equal(0);
  });

  it('downscales to fit the label', () => {
    const wide = decodePng(makePng(16, 8, () => [0, 0, 0, 255]));
    const scaled = downscale(wide, 8);
    expect(scaled.width).to.equal(8);
    expect(scaled.height).to.equal(4);
    expect(downscale(wide, 32).width).to.equal(16);
  });

  it('emits a ZPL graphic field that parses back to the same bitmap', () => {
    const bitmap = toMonochrome(decodePng(checkerboard));
    const field = bitmapToZplGraphicField(bitmap, { x: 30, y: 40, standalone: true });
    expect(field).to.contain('^GFA,8,8,1,');

    const parsed = parseLabel(field, { format: 'zpl' });
    const image = parsed.pages[0].ops[0];
    expect(image.type).to.equal('image');
    if (image.type === 'image') {
      expect(image.x).to.equal(30);
      expect(image.y).to.equal(40);
      expect(image.bytesPerRow).to.equal(1);
      expect([...image.bitmap]).to.deep.equal([...bitmap.data]);
    }
  });

  it('emits an EPL graphic write with inverted bits', () => {
    const bitmap = toMonochrome(decodePng(checkerboard));
    const command = bitmapToEplGraphicWrite(bitmap, { x: 5, y: 6 });
    expect(command.startsWith('GW5,6,1,8,')).to.equal(true);
    const payload = command.slice('GW5,6,1,8,'.length);
    expect(payload.charCodeAt(0)).to.equal(~bitmap.data[0] & 0xff);
  });

  it('imports an image end to end and reports what it did', () => {
    const big = makePng(40, 10, () => [0, 0, 0, 255]);
    const result = importImage(big, { maxWidth: 20 });
    expect(result.sourceWidth).to.equal(40);
    expect(result.bitmap.width).to.equal(20);
    expect(result.warnings.join(' ')).to.contain('scaled from 40x10');
    expect(result.warnings.join(' ')).to.contain('covers 100%');
  });

  it('refuses formats it cannot decode', () => {
    expect(() => importImage(new Uint8Array([1, 2, 3]))).to.throw('Save the artwork as a PNG');
  });
});

describe('importers.capture', () => {
  it('splits a concatenated ZPL capture into labels', () => {
    const raw =
      '\u0002^XA^FO1,1^FDone^FS^XZ\u0000^XA^FO1,1^FDtwo^FS^XZ\u0003';
    const result = importCapture(raw);
    expect(result.format).to.equal('zpl');
    expect(result.labels).to.have.length(2);
    expect(result.strippedControlCharacters).to.equal(3);
    expect(result.text).to.contain('^FDone');
    expect(result.warnings.join(' ')).to.contain('Removed 3 control character');
  });

  it('reformats each captured label', () => {
    const result = importCapture('^XA^FO1,1^FDone^FS^XZ');
    expect(result.labels[0].split('\n').length).to.be.greaterThan(1);
    expect(importCapture('^XA^FO1,1^FDone^FS^XZ', { reformat: false }).labels[0]).to.equal(
      '^XA^FO1,1^FDone^FS^XZ',
    );
  });

  it('splits an EPL capture on the print command', () => {
    const raw = 'N\r\nA1,1,0,3,1,1,N,"a"\r\nP1\r\nN\r\nA1,1,0,3,1,1,N,"b"\r\nP1\r\n';
    const result = importCapture(raw);
    expect(result.format).to.equal('epl');
    expect(result.labels).to.have.length(2);
  });

  it('keeps unrecognized captures instead of dropping them', () => {
    const result = importCapture('this is not a label', { format: 'zpl' });
    expect(result.labels).to.have.length(1);
    expect(result.warnings.join(' ')).to.contain('No complete');
  });
});
