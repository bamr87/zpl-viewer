import { expect } from 'chai';
import { tokenAt, tokenize } from '../../zplParser';

describe('zplParser.tokenize', () => {
  it('tokenizes commands and args with offsets', () => {
    const input = '^XA^FO10,20^FDHello^FS^XZ';
    const tokens = tokenize(input);

    expect(tokens.map((t) => t.command)).to.deep.equal([
      '^XA',
      '^FO',
      '^FD',
      '^FS',
      '^XZ',
    ]);
    expect(tokens[1].args).to.deep.equal(['10', '20']);
    expect(tokens[2].raw).to.equal('Hello');
    expect(tokens[0].start).to.equal(0);
    expect(tokens[4].end).to.equal(input.length);
  });

  it('supports tilde commands and ignores invalid prefixes', () => {
    const input = '^1oops~HS';
    const tokens = tokenize(input);
    expect(tokens).to.have.length(1);
    expect(tokens[0].command).to.equal('~HS');
  });
});

describe('zplParser.tokenAt', () => {
  it('returns token containing offset', () => {
    const input = '^XA^FO20,30^FDabc^FS^XZ';
    const tokens = tokenize(input);
    const fo = tokenAt(tokens, input.indexOf('^FO') + 1);
    expect(fo?.command).to.equal('^FO');
    expect(tokenAt(tokens, input.length + 5)).to.equal(undefined);
  });
});
