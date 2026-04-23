import { expect } from 'chai';
import { parseZpl } from '../../renderer/parser';

describe('renderer.parseZpl', () => {
  it('parses one label page with text, barcode, and box ops', () => {
    const zpl = '^XA^FO10,20^FDHello^FS^FO20,60^BY2,3,50^BCN,50,Y,N,N^FD123^FS^FO5,5^GB100,20,2^FS^XZ';
    const result = parseZpl(zpl, { dpmm: 8, widthInches: 4, heightInches: 6 });

    expect(result.pages).to.have.length(1);
    const page = result.pages[0];
    expect(page.ops.some((op) => op.type === 'text')).to.equal(true);
    expect(page.ops.some((op) => op.type === 'barcode')).to.equal(true);
    expect(page.ops.some((op) => op.type === 'box' || op.type === 'line')).to.equal(
      true,
    );
  });

  it('applies label sizing commands and tracks warnings', () => {
    const zpl = '^XA^PW500^LL300^FO20,20^FDUnclosed field^XZ';
    const result = parseZpl(zpl);

    expect(result.pages).to.have.length(1);
    expect(result.pages[0].width).to.equal(500);
    expect(result.pages[0].height).to.equal(300);
    expect(result.warnings.some((w) => w.includes('unterminated'))).to.equal(true);
  });

  it('decodes ^FH hex-encoded field data', () => {
    const zpl = '^XA^FO10,10^FH^FDHello_20World^FS^XZ';
    const result = parseZpl(zpl);
    const text = result.pages[0].ops.find((op) => op.type === 'text');
    expect(text).to.not.equal(undefined);
    if (text && text.type === 'text') {
      expect(text.data).to.equal('Hello World');
    }
  });
});
