import { expect } from 'chai';
import { validateZpl } from '../../validation';

describe('diagnostics.validateZpl', () => {
  it('reports unknown commands', () => {
    const diagnostics = validateZpl('^XA^ZZ1,2,3^XZ');
    expect(diagnostics.some((d) => d.message.includes('Unknown ZPL command'))).to.equal(
      true,
    );
  });

  it('reports missing ^XZ', () => {
    const diagnostics = validateZpl('^XA^FO20,20^FDHello^FS');
    expect(diagnostics.some((d) => d.message.includes('not closed'))).to.equal(true);
  });

  it('reports unterminated ^FD field', () => {
    const diagnostics = validateZpl('^XA^FO20,20^FDOops^XZ');
    expect(
      diagnostics.some((d) => d.message.includes('not terminated with `^FS`')),
    ).to.equal(true);
  });
});
