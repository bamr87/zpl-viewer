import { expect } from 'chai';
import { renderFixture } from '../helpers/recordingContext';

/**
 * End-to-end rendering cover for the sample labels, asserted as draw calls.
 *
 * These three fixtures used to be checked against committed PNGs. Pixel
 * goldens turned out to be a poor net: they are bound to the host's fonts and
 * to the exact Skia build behind the canvas, so they could only be regenerated
 * on the machine that produced them — and the environment noise they tolerated
 * hid a real bug for the whole time they existed, since the barcode encoder was
 * failing and the rendered error message was simply baked into every golden.
 *
 * Recording the Canvas 2D calls instead pins the same geometry with no
 * environment dependence, and a barcode that fails to encode now fails a test
 * rather than being quietly frozen into an expected image.
 */
describe('renderer: sample labels', () => {
  it('renders hello.zpl: two text lines, a rule, and a Code 128', () => {
    const { ctx, barcodes } = renderFixture('hello.zpl');

    const headline = ctx.of('fillText').find((call) => call.at[1] === 50);
    expect(headline, 'headline at y=50').to.not.equal(undefined);
    expect(headline?.at[0]).to.equal(50);

    const subhead = ctx.of('fillText').find((call) => call.at[1] === 130);
    expect(subhead, 'subhead at y=130').to.not.equal(undefined);

    // ^FO50,180^GB700,3,3 is a horizontal rule: a filled bar, not an outline.
    const rule = ctx
      .of('fillRect')
      .find((call) => call.at[0] === 50 && call.at[1] === 180);
    expect(rule, 'rule at (50,180)').to.not.equal(undefined);
    expect(rule?.args).to.deep.equal([0, 0, 700, 3]);
    expect(rule?.style).to.equal('#000000');

    expect(barcodes.rendered).to.have.length(1);
    expect(barcodes.rendered[0].symbology).to.equal('code128');
    expect(barcodes.rendered[0].data).to.equal('1234567890');
    expect(barcodes.rendered[0].moduleWidth).to.equal(3);
    expect(barcodes.rendered[0].height).to.equal(120);
    // And it is composited at the field origin.
    const drawn = ctx.of('drawImage')[0];
    expect(drawn.at).to.deep.equal([50, 210]);
  });

  it('renders product.zpl: a linear barcode and a QR at their own origins', () => {
    const { ctx, barcodes } = renderFixture('product.zpl');

    expect(barcodes.rendered.map((op) => op.symbology)).to.deep.equal([
      'code128',
      'qrcode',
    ]);
    const [code128, qr] = barcodes.rendered;
    expect(code128.data).to.equal('WD001RED');
    expect(code128.moduleWidth).to.equal(2);
    expect(qr.data).to.contain('https://example.com/p/WD001RED');
    expect(qr.magnification).to.equal(5);

    const origins = ctx.of('drawImage').map((call) => call.at);
    expect(origins).to.deep.equal([
      [20, 140],
      [500, 20],
    ]);

    // ^CF0,40 sets the headline size; the price line is ^CF0,22.
    expect(ctx.of('fillText').map((call) => call.at)).to.deep.include.members([
      [20, 15],
      [140, 10],
      [20, 70],
      [20, 100],
    ]);
  });

  it('renders shipping.zpl: both address blocks, the rule, and two symbols', () => {
    const { ctx, barcodes } = renderFixture('shipping.zpl');

    const textOrigins = ctx.of('fillText').map((call) => call.at);
    // Sender block, then recipient block.
    expect(textOrigins).to.deep.include.members([
      [30, 30],
      [30, 80],
      [30, 120],
      [30, 160],
      [30, 240],
      [30, 290],
      [30, 330],
      [30, 370],
    ]);

    const rule = ctx
      .of('fillRect')
      .find((call) => call.at[0] === 30 && call.at[1] === 440);
    expect(rule?.args).to.deep.equal([0, 0, 750, 3]);

    expect(barcodes.rendered.map((op) => op.symbology)).to.deep.equal([
      'code128',
      'qrcode',
    ]);
    expect(barcodes.rendered[0].data).to.equal('1Z999AA10123456784');
    expect(ctx.of('drawImage').map((call) => call.at)).to.deep.equal([
      [30, 470],
      [600, 700],
    ]);
  });

  it('draws scalable-font text at the face\'s own proportions', () => {
    // `^CF0,60` asks for 60-dot-tall text from a proportional font, not text
    // squeezed into a 60-dot square: the renderer must not scale it sideways.
    const { ctx } = renderFixture('hello.zpl');
    const scales = ctx.of('scale').map((call) => call.args[0]);
    for (const scale of scales) {
      expect(scale, 'horizontal glyph scale').to.equal(1);
    }
  });
});
