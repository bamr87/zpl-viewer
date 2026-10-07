import { expect } from 'chai';
import { embedSvg, pageToSvg, pagesToSvg } from '../../emit/svg';
import { parseLabel } from '../../core/pipeline';
import { LabelPage } from '../../renderer/ir';

function pagesOf(source: string, format: 'zpl' | 'epl' = 'zpl'): LabelPage[] {
  return parseLabel(source, { format, widthInches: 2, heightInches: 1 }).pages;
}

/** A stand-in encoder: the real one is bwip-js, which the host supplies. */
const stubBarcodes = {
  render: (): string => '<svg width="10" height="10"><rect width="10" height="10"/></svg>',
};

describe('emit.svg', () => {
  it('writes a document sized in millimetres with a dot viewBox', () => {
    const [page] = pagesOf('^XA^PW400^LL200^FO0,0^GB10,10,1^FS^XZ');
    const svg = pageToSvg(page, { dpmm: 8 });
    expect(svg).to.match(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).to.contain('viewBox="0 0 400 200"');
    // 400 dots at 8 dots/mm is 50mm.
    expect(svg).to.contain('width="50mm"');
    expect(svg).to.contain('height="25mm"');
    expect(svg.trimEnd().endsWith('</svg>')).to.equal(true);
  });

  it('places each op at its field origin', () => {
    const [page] = pagesOf('^XA^FO30,40^GB20,10,2^FS^XZ');
    const svg = pageToSvg(page);
    expect(svg).to.contain('translate(30 40)');
    expect(svg).to.contain('<rect x="1" y="1" width="18" height="8"');
  });

  it('expresses field rotation as a transform', () => {
    const [page] = pagesOf('^XA^FO10,10^A0R,30,30^FDturned^FS^XZ');
    const svg = pageToSvg(page);
    expect(svg).to.contain('rotate(90)');
  });

  it('escapes text that would otherwise break the document', () => {
    const [page] = pagesOf('^XA^FO0,0^A0N,20,20^FDTom & "Jerry" <b>^FS^XZ');
    const svg = pageToSvg(page);
    expect(svg).to.contain('Tom &amp; &quot;Jerry&quot; &lt;b&gt;');
    expect(svg).to.not.contain('<b>');
  });

  it('draws a graphic as runs of rects rather than an embedded raster', () => {
    // Row 0 is 0xF0 (four dots), row 1 is 0x0F (four dots, offset by four).
    const [page] = pagesOf('^XA^FO5,5^GFA,2,2,1,F00F^FS^XZ');
    const svg = pageToSvg(page);
    expect(svg).to.contain('<rect x="0" y="0" width="4" height="1"');
    expect(svg).to.contain('<rect x="4" y="1" width="4" height="1"');
    expect(svg).to.not.contain('data:image');
  });

  it('scales a magnified graphic', () => {
    const [page] = pagesOf('^XA~DGR:L.GRF,1,1,F0^FO0,0^XGR:L.GRF,2,2^FS^XZ');
    const svg = pageToSvg(page);
    expect(svg).to.contain('width="8" height="2"');
  });

  it('embeds a barcode from the injected encoder', () => {
    const [page] = pagesOf('^XA^FO10,10^BY2^BCN,50,Y,N,N^FD12345^FS^XZ');
    const svg = pageToSvg(page, { barcodes: stubBarcodes });
    expect(svg).to.contain('translate(10 10)');
    expect(svg).to.contain('<svg width="10" height="10">');
  });

  describe('embedding an encoder document', () => {
    it('pins a viewBox-only <svg> to its own dimensions', () => {
      // Without explicit width/height a nested <svg> fills the parent viewport,
      // which would stretch the barcode across the whole label.
      const embedded = embedSvg('<svg viewBox="0 0 237 173" xmlns="http://www.w3.org/2000/svg"><path/></svg>');
      expect(embedded).to.contain('width="237"');
      expect(embedded).to.contain('height="173"');
      expect(embedded).to.contain('x="0"');
      expect(embedded).to.contain('<path/>');
    });

    it('replaces percentage sizes that would resolve against the label', () => {
      const embedded = embedSvg('<svg width="100%" height="100%" viewBox="0 0 40 20"></svg>');
      expect(embedded).to.contain('width="40"');
      expect(embedded).to.contain('height="20"');
      expect(embedded).to.not.contain('100%');
    });

    it('leaves markup it does not recognise alone', () => {
      expect(embedSvg('<g><rect/></g>')).to.equal('<g><rect/></g>');
      expect(embedSvg('<svg><rect/></svg>')).to.equal('<svg><rect/></svg>');
    });

    it('sizes a real encoder document so the symbol keeps its own dots', () => {
      const [page] = pagesOf('^XA^FO10,10^BY2^BCN,50,Y,N,N^FD12345^FS^XZ');
      const svg = pageToSvg(page, {
        barcodes: {
          render: () => '<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
        },
      });
      expect(svg).to.contain('width="120" height="60"');
    });
  });

  it('notes a missing encoder in a comment instead of failing the export', () => {
    const [page] = pagesOf('^XA^FO10,10^BCN,50,Y,N,N^FD12345^FS^XZ');
    const svg = pageToSvg(page);
    expect(svg).to.contain('barcode code128 omitted');
  });

  it('reports an encoder failure inside the document', () => {
    const [page] = pagesOf('^XA^FO10,10^BCN,50,Y,N,N^FD12345^FS^XZ');
    const svg = pageToSvg(page, {
      barcodes: {
        render: () => {
          throw new Error('bad data');
        },
      },
    });
    expect(svg).to.contain('barcode error: bad data');
  });

  it('renders one document per label', () => {
    const pages = pagesOf('^XA^FO0,0^GB10,10,1^FS^XZ^XA^FO0,0^GB20,20,1^FS^XZ');
    const documents = pagesToSvg(pages, { title: 'batch' });
    expect(documents).to.have.length(2);
    expect(documents[0]).to.contain('<title>batch (page 1)</title>');
    expect(documents[1]).to.contain('<title>batch (page 2)</title>');
  });

  it('renders EPL labels through the same path', () => {
    const pages = pagesOf('N\nA30,40,0,3,1,1,N,"HELLO"\nP1\n', 'epl');
    const svg = pageToSvg(pages[0]);
    expect(svg).to.contain('HELLO');
    expect(svg).to.contain('translate(30 40)');
  });
});
