import { expect } from 'chai';
import { formatZpl } from '../../formatting';

describe('providers.formatZpl', () => {
  it('formats one command per line with indentation', () => {
    const input = '^XA^FO20,20^FDHello^FS^XZ';
    const output = formatZpl(input, {
      uppercase: true,
      oneCommandPerLine: true,
    });
    expect(output).to.equal('^XA\n  ^FO20,20\n  ^FDHello\n  ^FS\n^XZ\n');
  });

  it('keeps compact form when oneCommandPerLine is disabled', () => {
    const input = '^XA^fo20,20^fdHi^fs^xz';
    const output = formatZpl(input, {
      uppercase: true,
      oneCommandPerLine: false,
    });
    expect(output).to.equal('^XA^FO20,20^FDHi^FS^XZ');
  });
});
