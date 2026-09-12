import { expect } from 'chai';
import * as zlib from 'zlib';
import { base64Decode, base64Encode } from '../../core/base64';
import { inflate, inflateRaw } from '../../core/inflate';
import {
  decodeAsciiHexGraphic,
  decodeGraphicData,
  encodeAsciiHexGraphic,
  normalizeGraphicName,
} from '../../renderer/graphics';
import { parseLabel } from '../../core/pipeline';
import { ImageOp } from '../../renderer/ir';

/**
 * Node's zlib is the oracle for the hand-written inflate: anything it can
 * compress, we have to be able to read back, because printers and label
 * generators use the real thing on the other end of the wire.
 */
describe('core.inflate', () => {
  const cases: Array<[string, Buffer, zlib.ZlibOptions | undefined]> = [
    ['empty input', Buffer.alloc(0), undefined],
    ['a run of zeros', Buffer.alloc(4096), undefined],
    ['repetitive text', Buffer.from('^GFA,'.repeat(2000)), { level: 9 }],
    ['a stored (uncompressed) block', Buffer.from(randomBytes(2000)), { level: 0 }],
    ['incompressible bytes', Buffer.from(randomBytes(30000)), undefined],
  ];

  for (const [name, input, options] of cases) {
    it(`round-trips ${name}`, () => {
      const compressed = zlib.deflateSync(input, options ?? {});
      expect(Buffer.from(inflate(new Uint8Array(compressed)))).to.deep.equal(input);
    });
  }

  it('reads a raw deflate stream without a zlib header', () => {
    const input = Buffer.from('raw deflate'.repeat(200));
    const compressed = zlib.deflateRawSync(input);
    expect(Buffer.from(inflateRaw(new Uint8Array(compressed)))).to.deep.equal(input);
    // `inflate` sniffs the header, so it handles headerless data too.
    expect(Buffer.from(inflate(new Uint8Array(compressed)))).to.deep.equal(input);
  });

  it('reports truncated data rather than looping or returning garbage', () => {
    const compressed = zlib.deflateSync(Buffer.from('x'.repeat(5000)));
    const truncated = new Uint8Array(compressed).subarray(0, 12);
    expect(() => inflate(truncated)).to.throw();
  });
});

describe('core.base64', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [0, 1, 2, 3, 255, 1000]) {
      const bytes = randomBytes(length);
      expect([...base64Decode(base64Encode(bytes))]).to.deep.equal([...bytes]);
    }
  });

  it('matches Node for encoding and decoding', () => {
    const bytes = randomBytes(300);
    const expected = Buffer.from(bytes).toString('base64');
    expect(base64Encode(bytes)).to.equal(expected);
    expect([...base64Decode(expected)]).to.deep.equal([...bytes]);
  });

  it('ignores the line breaks a printer capture picks up', () => {
    const bytes = randomBytes(200);
    const wrapped = Buffer.from(bytes).toString('base64').replace(/(.{20})/g, '$1\r\n');
    expect([...base64Decode(wrapped)]).to.deep.equal([...bytes]);
  });
});

describe('renderer.graphics ASCII hex', () => {
  it('reads plain hex', () => {
    const { bytes } = decodeAsciiHexGraphic('FF00FF00', 2);
    expect([...bytes]).to.deep.equal([0xff, 0x00, 0xff, 0x00]);
  });

  it('expands ACS repeat counts', () => {
    // G=1 … Y=19 repeats of the following nibble; `gG` is 20 + 1.
    // `J` is four Fs, which fills a two-byte row exactly.
    expect([...decodeAsciiHexGraphic('JF', 2).bytes]).to.deep.equal([0xff, 0xff]);
    expect([...decodeAsciiHexGraphic('IF0', 2).bytes]).to.deep.equal([0xff, 0xf0]);
    expect([...decodeAsciiHexGraphic('gGF', 11).bytes.slice(0, 10)]).to.deep.equal(
      new Array(10).fill(0xff),
    );
  });

  it('fills the rest of a row with `,` and `!`', () => {
    expect([...decodeAsciiHexGraphic('FF,', 3).bytes]).to.deep.equal([0xff, 0x00, 0x00]);
    expect([...decodeAsciiHexGraphic('00!', 3).bytes]).to.deep.equal([0x00, 0xff, 0xff]);
  });

  it('repeats the previous row with `:`', () => {
    const { bytes, rows } = decodeAsciiHexGraphic('FF00,:', 2);
    expect(rows).to.equal(2);
    expect([...bytes]).to.deep.equal([0xff, 0x00, 0xff, 0x00]);
  });

  it('does not invent a blank row when a full row is also comma-terminated', () => {
    // Rows that both fill their width and carry a separator are common in
    // generated ZPL; counting the separator again would double the height.
    const { rows } = decodeAsciiHexGraphic('FFFF,0000,', 2);
    expect(rows).to.equal(2);
  });

  it('round-trips through the ACS encoder', () => {
    const bytes = new Uint8Array([
      0xff, 0xff, 0x00, 0x00, 0x81, 0x18, 0xff, 0xff, 0x00, 0x00, 0x81, 0x18,
    ]);
    const encoded = encodeAsciiHexGraphic(bytes, 3);
    const decoded = decodeAsciiHexGraphic(encoded, 3);
    expect([...decoded.bytes]).to.deep.equal([...bytes]);
  });

  it('compresses a mostly-blank bitmap far below plain hex', () => {
    const bytes = new Uint8Array(100 * 40); // 40 rows of 100 blank bytes
    const encoded = encodeAsciiHexGraphic(bytes, 100);
    expect(encoded.length).to.be.lessThan(bytes.length * 2 * 0.1);
    expect([...decodeAsciiHexGraphic(encoded, 100).bytes]).to.deep.equal([...bytes]);
  });
});

describe('renderer.graphics envelopes', () => {
  const bitmap = new Uint8Array([0xff, 0x81, 0x81, 0xff]);

  it('decodes a :B64: payload', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: `:B64:${base64Encode(bitmap)}`,
      bytesPerRow: 1,
      totalBytes: 4,
    });
    expect([...decoded.bytes]).to.deep.equal([...bitmap]);
    expect(decoded.rows).to.equal(4);
    expect(decoded.warnings).to.deep.equal([]);
  });

  it('decodes a :Z64: payload produced by real zlib', () => {
    const payload = base64Encode(new Uint8Array(zlib.deflateSync(Buffer.from(bitmap))));
    const decoded = decodeGraphicData({
      compression: 'A',
      data: `:Z64:${payload}`,
      bytesPerRow: 2,
      totalBytes: 4,
    });
    expect([...decoded.bytes]).to.deep.equal([...bitmap]);
    expect(decoded.rows).to.equal(2);
  });

  it('warns but still decodes when the declared CRC does not match', () => {
    const payload = base64Encode(bitmap);
    const decoded = decodeGraphicData({
      compression: 'A',
      data: `:B64:${payload}:0000`,
      bytesPerRow: 1,
      totalBytes: 4,
    });
    expect([...decoded.bytes]).to.deep.equal([...bitmap]);
    expect(decoded.warnings.join(' ')).to.match(/CRC/);
  });

  it('pads a graphic that declares more rows than it delivers', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: 'FFFF',
      bytesPerRow: 2,
      totalBytes: 8,
    });
    expect(decoded.rows).to.equal(4);
    expect(decoded.bytes.length).to.equal(8);
    expect(decoded.warnings.join(' ')).to.match(/only 1 were decoded/);
  });

  it('reads raw binary payloads', () => {
    const decoded = decodeGraphicData({
      compression: 'B',
      data: String.fromCharCode(0xff, 0x81),
      bytesPerRow: 1,
      totalBytes: 2,
    });
    expect([...decoded.bytes]).to.deep.equal([0xff, 0x81]);
  });
});

describe('renderer.graphics names', () => {
  it('treats device prefixes and extensions as the same graphic', () => {
    expect(normalizeGraphicName('R:LOGO.GRF')).to.equal('LOGO');
    expect(normalizeGraphicName('logo.grf')).to.equal('LOGO');
    expect(normalizeGraphicName('E:LOGO')).to.equal('LOGO');
  });
});

describe('ZPL graphic commands end to end', () => {
  function firstImage(source: string): ImageOp | undefined {
    const parsed = parseLabel(source, { format: 'zpl' });
    return parsed.pages[0]?.ops.find((op): op is ImageOp => op.type === 'image');
  }

  it('renders a Z64-compressed ^GF the same as its plain-hex twin', () => {
    const bitmap = new Uint8Array([0xf0, 0x0f, 0xff, 0x00]);
    const z64 = base64Encode(new Uint8Array(zlib.deflateSync(Buffer.from(bitmap))));
    const plain = firstImage('^XA^FO0,0^GFA,4,4,2,F00FFF00^FS^XZ');
    const compressed = firstImage(`^XA^FO0,0^GFA,4,4,2,:Z64:${z64}^FS^XZ`);
    expect(plain).to.not.equal(undefined);
    expect([...(compressed?.bitmap ?? [])]).to.deep.equal([...(plain?.bitmap ?? [])]);
  });

  it('recalls a ~DG download with ^XG at the requested magnification', () => {
    const image = firstImage('^XA~DGR:LOGO.GRF,2,1,FF00^FO12,34^XGR:LOGO.GRF,2,3^FS^XZ');
    expect(image).to.not.equal(undefined);
    expect(image?.x).to.equal(12);
    expect(image?.y).to.equal(34);
    expect(image?.scaleX).to.equal(2);
    expect(image?.scaleY).to.equal(3);
    expect(image?.sourceName).to.equal('LOGO');
  });

  it('keeps downloaded graphics across labels, as printer memory does', () => {
    const parsed = parseLabel(
      '~DGR:LOGO.GRF,2,1,FF00^XA^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ^XA^FO5,5^XGR:LOGO.GRF,1,1^FS^XZ',
      { format: 'zpl' },
    );
    expect(parsed.pages).to.have.length(2);
    for (const page of parsed.pages) {
      expect(page.ops.filter((op) => op.type === 'image')).to.have.length(1);
    }
  });

  it('warns when a label recalls a graphic it never downloaded', () => {
    const parsed = parseLabel('^XA^FO0,0^XGR:MISSING.GRF,1,1^FS^XZ', { format: 'zpl' });
    expect(parsed.pages[0].ops).to.have.length(0);
    expect(parsed.warnings.join(' ')).to.match(/never downloaded/);
  });

  it('^IM places a stored graphic without magnifying it', () => {
    const image = firstImage('^XA~DGR:LOGO.GRF,2,1,FF00^FO7,8^IMR:LOGO.GRF^FS^XZ');
    expect(image?.scaleX).to.equal(1);
    expect(image?.scaleY).to.equal(1);
    expect(image?.x).to.equal(7);
  });

  it('^ID forgets a stored graphic', () => {
    const parsed = parseLabel(
      '~DGR:LOGO.GRF,2,1,FF00^XA^IDR:LOGO.GRF^FO0,0^XGR:LOGO.GRF,1,1^FS^XZ',
      { format: 'zpl' },
    );
    expect(parsed.pages[0].ops.filter((op) => op.type === 'image')).to.have.length(0);
  });
});

function randomBytes(length: number): Uint8Array {
  // Deterministic pseudo-random data: reproducible failures beat realistic ones.
  const out = new Uint8Array(length);
  let seed = 0x2545f491;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed >> 16) & 0xff;
  }
  return out;
}
