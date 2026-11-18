import { expect } from 'chai';
import * as zlib from 'zlib';
import { base64Encode } from '../../core/base64';
import { InflateLimitError, inflate, inflateRaw } from '../../core/inflate';
import {
  MAX_GRAPHIC_BYTES,
  MAX_GRAPHIC_BYTES_PER_ROW,
  MAX_GRAPHIC_DOTS,
} from '../../core/limits';
import { parseLabel } from '../../core/pipeline';
import { validateLabelSource } from '../../core/validate';
import { decodeGraphicData } from '../../renderer/graphics';
import { drawPage } from '../../renderer/draw';
import { ImageOp } from '../../renderer/ir';
import { RecordingContext, StubBarcodeRenderer } from '../helpers/recordingContext';

function draw(source: string): RecordingContext {
  const parsed = parseLabel(source, { format: 'zpl' });
  const ctx = new RecordingContext();
  for (const page of parsed.pages) {
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      page,
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
  }
  return ctx;
}

describe('limits: inflate', () => {
  const zeros = new Uint8Array(zlib.deflateRawSync(Buffer.alloc(64 * 1024 * 1024)));

  it('throws the typed error when a high-ratio stream passes maxOutput', () => {
    expect(zeros.length).to.be.lessThan(100 * 1024);
    expect(() => inflateRaw(zeros, { maxOutput: 1024 * 1024 })).to.throw(
      InflateLimitError,
    );
  });

  it('inflates normally under the cap', () => {
    const input = Buffer.from('label '.repeat(500));
    const compressed = new Uint8Array(zlib.deflateSync(input));
    expect(Buffer.from(inflate(compressed, { maxOutput: input.length }))).to.deep.equal(
      input,
    );
    expect(() => inflate(compressed, { maxOutput: input.length - 1 })).to.throw(
      InflateLimitError,
    );
  });
});

describe('limits: decodeGraphicData', () => {
  it('does not allocate what a tiny field declares', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: 'FF',
      bytesPerRow: 1,
      totalBytes: 300_000_000,
    });
    expect(decoded.bytes.length).to.be.at.most(MAX_GRAPHIC_BYTES);
    expect(decoded.rejected).to.equal(true);
    expect(decoded.warnings).to.not.be.empty;
  });

  it('rejects an oversized bytes-per-row', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: 'FF',
      bytesPerRow: 1_000_000,
      totalBytes: 1_000_000,
    });
    expect(decoded.rejected).to.equal(true);
    expect(decoded.bytes.length).to.equal(0);
    expect(decoded.warnings.join(' ')).to.include('bytes per row');
  });

  it('rejects a declared row count over the dot limit', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: 'FF',
      bytesPerRow: 1,
      totalBytes: MAX_GRAPHIC_DOTS + 100,
    });
    expect(decoded.rejected).to.equal(true);
  });

  it('stops a :Z64: decompression bomb at the cap', () => {
    const bomb = zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024));
    const decoded = decodeGraphicData({
      compression: 'A',
      data: `:Z64:${base64Encode(new Uint8Array(bomb))}`,
      bytesPerRow: 64,
      maxBytes: 1024 * 1024,
    });
    expect(decoded.rejected).to.equal(true);
    expect(decoded.bytes.length).to.equal(0);
    expect(decoded.warnings).to.not.be.empty;
  });

  it('stops an ACS row-repeat bomb at the cap', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: `FF${':'.repeat(20_000)}`,
      bytesPerRow: 1024,
      maxBytes: 1024 * 1024,
    });
    expect(decoded.rejected).to.equal(true);
  });

  it('still decodes a normal graphic', () => {
    const decoded = decodeGraphicData({
      compression: 'A',
      data: 'FF00FF00',
      bytesPerRow: 2,
      totalBytes: 4,
    });
    expect(decoded.rejected).to.equal(undefined);
    expect([...decoded.bytes]).to.deep.equal([0xff, 0x00, 0xff, 0x00]);
  });

  it('exposes a per-row limit derived from the dot limit', () => {
    expect(MAX_GRAPHIC_BYTES_PER_ROW * 8).to.equal(MAX_GRAPHIC_DOTS);
  });
});

describe('limits: parser and renderer', () => {
  const huge = '^XA^FO0,0^GFA,1000000000,1000000000,10000,FF^FS^FO10,10^GB100,5,5^FS^XZ';

  it('skips an over-limit ^GF with a warning and keeps the rest of the label', () => {
    const parsed = parseLabel(huge, { format: 'zpl' });
    expect(parsed.warnings.join('\n')).to.include('Graphic skipped');
    const ops = parsed.pages[0].ops;
    expect(ops.some((op) => op.type === 'image')).to.equal(false);
    expect(ops.length, 'the ^GB after it still renders').to.be.greaterThan(0);
  });

  it('records a bounded number of draw calls for a 100,000 x 100,000 dot ^GF', () => {
    const source =
      '^XA^FO0,0^GFA,1250000000,1250000000,12500,FF^FS^FO10,10^GB100,5,5^FS^XZ';
    const ctx = draw(source);
    expect(ctx.calls.length).to.be.lessThan(100);
  });

  it('bounds drawImage even for a hand-built op that declares a vast area', () => {
    const op: ImageOp = {
      type: 'image',
      x: 0,
      y: 0,
      rotation: 'N',
      reverse: false,
      width: 100_000_000,
      height: 100_000_000,
      bitmap: new Uint8Array([0xff, 0xff]),
      bytesPerRow: 1,
    };
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      { width: 800, height: 600, ops: [op], homeX: 0, homeY: 0 },
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    expect(ctx.calls.length).to.be.lessThan(10);
  });

  it('stops ~DG graphics adding up past the store limit', () => {
    // Each graphic is legal (8 MiB), but only four fit in the 32 MiB store.
    const one = (name: string): string =>
      `~DG${name}.GRF,8388608,1024,FF\n`;
    const source = `${['A', 'B', 'C', 'D', 'E', 'F'].map(one).join('')}^XA^FO0,0^XGE.GRF,1,1^FS^XZ`;
    const parsed = parseLabel(source, { format: 'zpl' });
    expect(parsed.warnings.filter((w) => w.includes('Graphic skipped'))).to.have.length(2);
  });
});

describe('limits: diagnostics', () => {
  it('reports an over-limit graphic through validateLabelSource', () => {
    const source = '^XA^FO0,0^GFA,300000000,300000000,100,FF^FS^XZ';
    const diagnostics = validateLabelSource(source, { format: 'zpl' });
    const hit = diagnostics.find((d) => d.message.includes('too large to preview'));
    expect(hit, 'over-limit diagnostic').to.not.equal(undefined);
    expect(hit?.severity).to.equal('warning');
  });

  it('does not flag an ordinary graphic', () => {
    const diagnostics = validateLabelSource('^XA^FO0,0^GFA,4,4,2,FF00FF00^FS^XZ', {
      format: 'zpl',
    });
    expect(diagnostics.filter((d) => d.message.includes('too large'))).to.be.empty;
  });
});
