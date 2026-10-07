import { expect } from 'chai';
import { parseLabel } from '../../core/pipeline';
import { drawPage } from '../../renderer/draw';
import {
  RecordingContext,
  StubBarcodeRenderer,
  renderFixture,
} from '../helpers/recordingContext';

describe('renderer.drawPage geometry', () => {
  it('draws EPL boxes, lines and barcodes at the right coordinates', () => {
    const { ctx, barcodes } = renderFixture('epl-geometry.epl');

    // X10,10,3,396,193 — a 3-dot box, stroked inset by half its thickness.
    const box = ctx
      .of('strokeRect')
      .find((call) => call.at[0] === 10 && call.at[1] === 10);
    expect(box, 'box at (10,10)').to.not.equal(undefined);
    expect(box?.args).to.deep.equal([1.5, 1.5, 383, 180]);
    expect(box?.lineWidth).to.equal(3);

    // LO20,40,360,4 — a filled black bar, not an outline.
    const bar = ctx
      .of('fillRect')
      .find((call) => call.at[0] === 20 && call.at[1] === 40);
    expect(bar, 'line at (20,40)').to.not.equal(undefined);
    expect(bar?.args).to.deep.equal([0, 0, 360, 4]);
    expect(bar?.style).to.equal('#000000');

    // B30,60,… and b280,130,… composite their encoder output.
    expect(ctx.of('drawImage').map((call) => call.at)).to.deep.equal([
      [30, 60],
      [280, 130],
    ]);
    expect(barcodes.rendered.map((op) => op.symbology)).to.deep.equal([
      'code128',
      'qrcode',
    ]);
    expect(barcodes.rendered[0].data).to.equal('LABELSTUDIO');
    expect(barcodes.rendered[1].magnification).to.equal(3);
  });

  it('draws ZPL text, graphics and barcodes at the right coordinates', () => {
    const { ctx, barcodes } = renderFixture('product.zpl');

    const origins = ctx.of('fillText').map((call) => call.at);
    expect(origins).to.deep.include([20, 15]);
    expect(origins).to.deep.include([140, 10]);

    expect(ctx.of('drawImage').map((call) => call.at)).to.deep.equal([
      [20, 140],
      [500, 20],
    ]);
    expect(barcodes.rendered.map((op) => op.symbology)).to.deep.equal([
      'code128',
      'qrcode',
    ]);
  });

  it('paints the label background before anything else', () => {
    const { ctx } = renderFixture('epl-geometry.epl');
    const first = ctx.calls[0];
    expect(first.op).to.equal('fillRect');
    expect(first.style).to.equal('#ffffff');
    expect(first.args).to.deep.equal([0, 0, 406, 203]);
  });

  it('rotates a field according to its orientation', () => {
    const parsed = parseLabel('N\nq400\nQ200,24\nA10,10,1,3,1,1,N,"R"\nP1', {
      format: 'epl',
    });
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      parsed.pages[0],
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    const rotation = ctx.of('rotate')[0];
    expect(rotation?.args[0]).to.equal(Number((Math.PI / 2).toFixed(4)));
  });

  it('draws a graphic field through the transform, at the field origin', () => {
    // Row 0 is 0xFF (eight dots), row 1 is 0x00 (blank).
    const parsed = parseLabel('^XA^FO5,6^GFA,2,2,1,FF00^FS^XZ', { format: 'zpl' });
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      parsed.pages[0],
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    // One run of eight dots on the first row and nothing on the second. The
    // run must be recorded under the field translation: an image drawn with
    // putImageData would ignore it and land at the canvas origin.
    const runs = ctx.of('fillRect').filter((call) => call.at[0] === 5 && call.at[1] === 6);
    expect(runs).to.have.length(1);
    expect(runs[0].args).to.deep.equal([0, 0, 8, 1]);
    expect(runs[0].style).to.equal('#000000');
  });

  it('magnifies a recalled graphic with ^XG', () => {
    const parsed = parseLabel(
      '^XA~DGR:LOGO.GRF,2,1,FF00^FO10,20^XGR:LOGO.GRF,3,2^FS^XZ',
      { format: 'zpl' },
    );
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      parsed.pages[0],
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    const runs = ctx.of('fillRect').filter((call) => call.at[0] === 10 && call.at[1] === 20);
    expect(runs).to.have.length(1);
    // Eight dots wide at 3x, one row tall at 2x.
    expect(runs[0].args).to.deep.equal([0, 0, 24, 2]);
  });

  it('reverses a graphic field under ^FR', () => {
    const parsed = parseLabel('^XA^FO0,0^FR^GFA,2,2,1,FF00^FS^XZ', { format: 'zpl' });
    const ctx = new RecordingContext();
    drawPage(
      ctx as unknown as CanvasRenderingContext2D,
      parsed.pages[0],
      new StubBarcodeRenderer(),
      { scale: 1 },
    );
    // The first fillRect paints the page background; the graphic follows.
    const runs = ctx.of('fillRect').slice(1);
    // A black backdrop over the whole graphic, then the set bits in white.
    expect(runs[0].args).to.deep.equal([0, 0, 8, 2]);
    expect(runs[0].style).to.equal('#000000');
    expect(runs[1].args).to.deep.equal([0, 0, 8, 1]);
    expect(runs[1].style).to.equal('#ffffff');
  });
});
