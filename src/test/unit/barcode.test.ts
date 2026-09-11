import { expect } from 'chai';
import {
  SYMBOLOGIES,
  bwipIdFor,
  describeSymbology,
  findSymbology,
  symbologyForZplCommand,
} from '../../barcode/symbologies';
import {
  completeBarcodeData,
  hasBlockingIssue,
  mod10CheckDigit,
  mod43CheckCharacter,
  validateBarcodeData,
} from '../../barcode/validate';

describe('barcode.symbologies', () => {
  it('maps ZPL commands to the right symbology', () => {
    expect(symbologyForZplCommand('^BC')?.id).to.equal('code128');
    expect(symbologyForZplCommand('^B3')?.id).to.equal('code39');
    // ^B9 is UPC-E and ^BK is Codabar; they are easy to confuse.
    expect(symbologyForZplCommand('^B9')?.id).to.equal('upce');
    expect(symbologyForZplCommand('^BK')?.id).to.equal('codabar');
    expect(symbologyForZplCommand('^ZZ')).to.equal(undefined);
  });

  it('gives every symbology a bwip-js encoder id and an example', () => {
    for (const spec of SYMBOLOGIES) {
      expect(spec.bwipId, `${spec.id} bwipId`).to.have.length.greaterThan(0);
      expect(bwipIdFor(spec.id)).to.equal(spec.bwipId);
      expect(spec.example, `${spec.id} example`).to.have.length.greaterThan(0);
    }
  });

  it('validates its own examples', () => {
    for (const spec of SYMBOLOGIES) {
      const issues = validateBarcodeData(spec.id, spec.example).filter(
        (issue) => issue.severity === 'error',
      );
      expect(issues, `${spec.id}: ${issues.map((i) => i.message).join('; ')}`).to.have.length(0);
    }
  });

  it('describes a symbology in markdown', () => {
    const spec = findSymbology('ean13');
    expect(spec).to.not.equal(undefined);
    const markdown = describeSymbology(spec!);
    expect(markdown).to.contain('EAN-13');
    expect(markdown).to.contain('Length: 12 or 13');
    expect(markdown).to.contain('^BE');
  });
});

describe('barcode.validate', () => {
  it('computes UPC/EAN check digits', () => {
    expect(mod10CheckDigit('590123412345')).to.equal('7');
    expect(mod10CheckDigit('03600029145')).to.equal('2');
  });

  it('computes Code 39 mod-43 check characters', () => {
    expect(mod43CheckCharacter('CODE39')).to.equal('W');
    expect(mod43CheckCharacter('!!!')).to.equal('');
  });

  it('rejects a wrong EAN-13 check digit and names the right one', () => {
    const issues = validateBarcodeData('ean13', '5901234123458');
    const checkDigit = issues.find((issue) => issue.code === 'check-digit');
    expect(checkDigit?.severity).to.equal('error');
    expect(checkDigit?.message).to.contain('expected 7');
  });

  it('accepts the short form and reports the digit the printer will add', () => {
    const issues = validateBarcodeData('ean13', '590123412345');
    expect(hasBlockingIssue(issues)).to.equal(false);
    expect(issues[0].code).to.equal('check-digit');
    expect(issues[0].severity).to.equal('info');
    expect(completeBarcodeData('ean13', '590123412345')).to.equal('5901234123457');
  });

  it('flags characters a symbology cannot encode', () => {
    const issues = validateBarcodeData('code39', 'lower case!');
    expect(issues.some((issue) => issue.code === 'charset')).to.equal(true);
  });

  it('flags the wrong length', () => {
    const issues = validateBarcodeData('upca', '123');
    expect(issues.some((issue) => issue.code === 'length')).to.equal(true);
  });

  it('warns about an odd interleaved 2 of 5 payload', () => {
    const issues = validateBarcodeData('interleaved2of5', '12345');
    expect(issues.some((issue) => issue.code === 'odd-length')).to.equal(true);
  });

  it('reports empty data and unknown symbologies', () => {
    expect(validateBarcodeData('code128', '')[0].code).to.equal('empty-data');
    expect(validateBarcodeData('not-a-symbology', 'x')[0].code).to.equal(
      'unknown-symbology',
    );
  });

  it('checks GS1 application identifier syntax', () => {
    const issues = validateBarcodeData('gs1-128', '(01)09501101020917(10');
    expect(issues.some((issue) => issue.code === 'gs1-syntax')).to.equal(true);
  });

  it('validates Codabar start and stop characters', () => {
    expect(hasBlockingIssue(validateBarcodeData('codabar', 'A12345B'))).to.equal(false);
    expect(hasBlockingIssue(validateBarcodeData('codabar', '12345'))).to.equal(true);
  });

  it('leaves data alone when no check digit applies', () => {
    expect(completeBarcodeData('code128', 'ABC')).to.equal('ABC');
    expect(completeBarcodeData('ean13', '5901234123457')).to.equal('5901234123457');
  });
});
