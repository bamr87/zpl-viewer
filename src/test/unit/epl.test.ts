import { expect } from 'chai';
import { eplTokenAt, tokenizeEpl } from '../../formats/epl/tokenizer';
import { findEplCommand, renderEplCommandMarkdown } from '../../formats/epl/commands';
import {
  parseEpl,
  symbologyForEpl2dCode,
  symbologyForEplCode,
} from '../../formats/epl/parser';
import { validateEpl } from '../../formats/epl/validation';
import { formatEpl } from '../../formats/epl/formatting';

const SAMPLE = [
  'N',
  'q812',
  'Q406,24',
  'A20,20,0,4,1,1,N,"RECEIVING"',
  'B20,120,0,3,2,6,100,B,"WD-001-RED"',
  'b400,120,Q,m2,s6,"https://example.com"',
  'X10,10,2,800,396',
  'LO20,300,760,3',
  'P1',
].join('\n');

describe('epl.tokenizer', () => {
  it('reads one command per line with quoted data', () => {
    const tokens = tokenizeEpl(SAMPLE);
    expect(tokens.map((token) => token.name)).to.deep.equal([
      'N',
      'q',
      'Q',
      'A',
      'B',
      'b',
      'X',
      'LO',
      'P',
    ]);
    const text = tokens[3];
    expect(text.args.slice(0, 7)).to.deep.equal(['20', '20', '0', '4', '1', '1', 'N']);
    expect(text.data).to.equal('RECEIVING');
  });

  it('keeps command case, which is significant in EPL', () => {
    const tokens = tokenizeEpl('q812\nQ406,24\nB1,1,0,3,2,6,50,B,"X"\nb1,1,Q,s4,"Y"');
    expect(tokens.map((token) => token.name)).to.deep.equal(['q', 'Q', 'B', 'b']);
  });

  it('skips comments and blank lines, and locates a token by offset', () => {
    const source = '; a comment\n\nN\nP1\n';
    const tokens = tokenizeEpl(source);
    expect(tokens.map((token) => token.name)).to.deep.equal(['N', 'P']);
    expect(eplTokenAt(tokens, source.indexOf('P1'))?.name).to.equal('P');
  });

  it('keeps offsets correct with CRLF line endings', () => {
    // A file written on Windows terminates lines with two characters; every
    // token offset has to stay anchored to the source regardless.
    const source = 'N\r\nq812\r\nA20,20,0,4,1,1,N,"X"\r\nP1\r\n';
    const tokens = tokenizeEpl(source);
    expect(tokens.map((token) => token.name)).to.deep.equal(['N', 'q', 'A', 'P']);
    for (const token of tokens) {
      expect(
        source.slice(token.start, token.start + token.name.length),
        `token ${token.name} start offset`,
      ).to.equal(token.name);
    }
    const text = tokens[2];
    expect(text.start).to.equal(source.indexOf('A20,20'));
    expect(text.line).to.equal(2);
    expect(text.data).to.equal('X');
    // The carriage return must not leak into the parameter list either.
    expect(text.args[6]).to.equal('N');
  });

  it('handles a final line with no terminator', () => {
    const tokens = tokenizeEpl('N\nP1');
    expect(tokens.map((token) => token.name)).to.deep.equal(['N', 'P']);
    expect(tokens[1].start).to.equal(2);
  });

  it('handles escaped quotes inside data', () => {
    const tokens = tokenizeEpl('A1,1,0,3,1,1,N,"say \\"hi\\""');
    expect(tokens[0].data).to.equal('say "hi"');
  });
});

describe('epl.commands', () => {
  it('documents the commands used by the parser', () => {
    for (const name of ['N', 'P', 'q', 'Q', 'A', 'B', 'b', 'X', 'LO', 'GW', 'R']) {
      expect(findEplCommand(name), `missing doc for ${name}`).to.not.equal(undefined);
    }
  });

  it('renders markdown with parameters and an example', () => {
    const markdown = renderEplCommandMarkdown(findEplCommand('A')!);
    expect(markdown).to.contain('**`A` — ASCII Text**');
    expect(markdown).to.contain('**Parameters**');
    expect(markdown).to.contain('```epl');
  });
});

describe('epl.parser', () => {
  it('resolves barcode selectors, including variants', () => {
    expect(symbologyForEplCode('3')).to.equal('code128');
    expect(symbologyForEplCode('0')).to.equal('code39');
    expect(symbologyForEplCode('0C')).to.equal('code39');
    expect(symbologyForEplCode('8+2')).to.equal('ean13');
    expect(symbologyForEplCode('UA0')).to.equal('upca');
    expect(symbologyForEpl2dCode('Q')).to.equal('qrcode');
    expect(symbologyForEpl2dCode('D')).to.equal('datamatrix');
  });

  it('produces one page per N…P block with the declared stock size', () => {
    const result = parseEpl(SAMPLE);
    expect(result.pages).to.have.length(1);
    const page = result.pages[0];
    expect(page.width).to.equal(812);
    expect(page.height).to.equal(406);
    expect(page.ops.map((op) => op.type)).to.deep.equal([
      'text',
      'barcode',
      'barcode',
      'box',
      'line',
    ]);
  });

  it('maps fonts, rotation and multipliers to glyph sizes', () => {
    const result = parseEpl('N\nA10,20,1,3,2,3,R,"HI"\nP1');
    const op = result.pages[0].ops[0];
    expect(op.type).to.equal('text');
    if (op.type === 'text') {
      expect(op.x).to.equal(10);
      expect(op.y).to.equal(20);
      expect(op.rotation).to.equal('R');
      expect(op.reverse).to.equal(true);
      // Font 3 is a 12x20 dot cell at 203 dpi.
      expect(op.fontWidth).to.equal(24);
      expect(op.fontHeight).to.equal(60);
    }
  });

  it('scales font cells for denser print heads', () => {
    const result = parseEpl('N\nA0,0,0,3,1,1,N,"HI"\nP1', { dpmm: 12 });
    const op = result.pages[0].ops[0];
    if (op.type === 'text') {
      expect(op.fontHeight).to.equal(30);
    }
  });

  it('reads barcode geometry and human-readable flag', () => {
    const result = parseEpl('N\nB5,6,0,3,2,6,100,N,"ABC"\nP1');
    const op = result.pages[0].ops[0];
    expect(op.type).to.equal('barcode');
    if (op.type === 'barcode') {
      expect(op.symbology).to.equal('code128');
      expect(op.moduleWidth).to.equal(2);
      expect(op.height).to.equal(100);
      expect(op.interpretation).to.equal(false);
      expect(op.data).to.equal('ABC');
    }
  });

  it('draws LO as a filled rectangle and LE in white', () => {
    const result = parseEpl('N\nLO1,2,300,4\nLE5,6,10,20\nP1');
    const [black, white] = result.pages[0].ops;
    expect(black.type).to.equal('line');
    if (black.type === 'line') {
      expect(black.length).to.equal(300);
      expect(black.thickness).to.equal(4);
      expect(black.color).to.equal('B');
    }
    if (white.type === 'line') {
      expect(white.color).to.equal('W');
    }
  });

  it('warns about an unknown barcode selector but still renders something', () => {
    const result = parseEpl('N\nB1,1,0,ZZ,2,6,50,B,"X"\nP1');
    expect(result.warnings.join(' ')).to.contain('unknown EPL barcode selector');
    expect(result.pages[0].ops).to.have.length(1);
  });

  it('flushes a buffered label even without a trailing P', () => {
    const result = parseEpl('N\nq400\nQ200,24\nA1,1,0,3,1,1,N,"X"');
    expect(result.pages).to.have.length(1);
  });

  it('records source spans so findings can point at a line', () => {
    const source = 'N\nA10,10,0,3,1,1,N,"X"\nP1';
    const op = parseEpl(source).pages[0].ops[0];
    expect(op.source?.start).to.equal(source.indexOf('A10'));
  });
});

describe('epl.validation', () => {
  it('accepts a well-formed label', () => {
    expect(validateEpl(SAMPLE)).to.have.length(0);
  });

  it('reports a format that never clears the buffer or prints', () => {
    const diagnostics = validateEpl('A20,20,0,4,1,1,N,"X"');
    const rules = diagnostics.map((d) => d.rule);
    expect(rules).to.contain('epl.missing-clear');
    expect(rules).to.contain('epl.missing-print');
  });

  it('reports unknown commands and missing data strings', () => {
    const diagnostics = validateEpl('N\nZZ1,2\nA1,1,0,3,1,1,N\nP1');
    expect(diagnostics.some((d) => d.rule === 'epl.unknown-command')).to.equal(true);
    expect(diagnostics.some((d) => d.rule === 'epl.missing-data')).to.equal(true);
  });

  it('reports an unterminated string', () => {
    const diagnostics = validateEpl('N\nA1,1,0,3,1,1,N,"oops\nP1');
    expect(diagnostics.some((d) => d.rule === 'epl.unterminated-string')).to.equal(
      true,
    );
  });
});

describe('epl.formatting', () => {
  it('strips indentation and trailing whitespace without touching case', () => {
    expect(formatEpl('   N   \n  q812\n\n\n  P1  \n')).to.equal('N\nq812\n\nP1\n');
  });

  it('tightens parameter spacing outside quoted data', () => {
    expect(formatEpl('A1, 2, 0, 3, 1, 1, N, "keep, spaces"\n')).to.equal(
      'A1,2,0,3,1,1,N,"keep, spaces"\n',
    );
  });
});
