import { expect } from 'chai';
import {
  detectFormat,
  formatForFileName,
  labelFileExtensions,
  sniffFormat,
} from '../../core/formats';
import {
  dotsToInches,
  dotsToMm,
  inchesToDots,
  parseDensity,
  describeDensity,
} from '../../core/units';
import {
  convertLabel,
  emitLabel,
  formatLabel,
  parseLabel,
} from '../../core/pipeline';
import { validateLabelSource, validateSyntax } from '../../core/validate';
import { chooseEplFont } from '../../emit/epl';
import { zplBarcodeCommand } from '../../emit/zpl';
import {
  LABEL_TEMPLATES,
  fillTemplateSample,
  findTemplate,
  templatesForFormat,
} from '../../core/templates';
import { validateBarcodeData } from '../../barcode/validate';
import { templateFields } from '../../data/template';

const ZPL = '^XA^PW812^LL406^FO20,20^A0N,40,40^FDHello^FS^FO20,120^BY2,3,80^BCN,80,Y,N,N^FD1234567890^FS^XZ';
const EPL = 'N\nq812\nQ406,24\nA20,20,0,4,1,1,N,"Hello"\nB20,120,0,3,2,6,80,B,"1234567890"\nP1';

describe('core.units', () => {
  it('converts between dots, inches and millimetres', () => {
    expect(inchesToDots(4, 8)).to.equal(813);
    expect(dotsToInches(812, 8)).to.be.closeTo(4, 0.01);
    expect(dotsToMm(80, 8)).to.equal(10);
  });

  it('normalizes densities', () => {
    expect(parseDensity('8dpmm')).to.equal(8);
    expect(parseDensity(12)).to.equal(12);
    expect(parseDensity('nonsense')).to.equal(8);
    expect(describeDensity(12)).to.equal('12 dpmm (305 dpi)');
  });
});

describe('core.formats', () => {
  it('claims extensions', () => {
    expect(formatForFileName('/tmp/a.zpl')).to.equal('zpl');
    expect(formatForFileName('a.epl2')).to.equal('epl');
    expect(formatForFileName('a.prn')).to.equal(undefined);
    expect(labelFileExtensions()).to.include.members(['.zpl', '.epl', '.prn']);
  });

  it('sniffs the language from content', () => {
    expect(sniffFormat(ZPL)).to.equal('zpl');
    expect(sniffFormat(EPL)).to.equal('epl');
    expect(sniffFormat('nothing to see here')).to.equal(undefined);
  });

  it('prefers an unambiguous extension over content', () => {
    expect(detectFormat(EPL, 'capture.epl')).to.equal('epl');
    expect(detectFormat(EPL, 'capture.prn')).to.equal('epl');
    expect(detectFormat('random text', 'capture.prn')).to.equal('zpl');
  });
});

describe('core.pipeline', () => {
  it('parses either language into the same IR', () => {
    const zpl = parseLabel(ZPL);
    const epl = parseLabel(EPL);
    expect(zpl.format).to.equal('zpl');
    expect(epl.format).to.equal('epl');
    for (const parsed of [zpl, epl]) {
      expect(parsed.pages).to.have.length(1);
      expect(parsed.pages[0].width).to.equal(812);
      expect(parsed.pages[0].ops.map((op) => op.type)).to.deep.equal([
        'text',
        'barcode',
      ]);
    }
  });

  it('formats each language with its own rules', () => {
    expect(formatLabel('^xa^fo1,1^fdhi^fs^xz', 'zpl')).to.contain('^XA');
    // EPL command case is significant, so it is preserved.
    expect(formatLabel('  q812\n  P1\n', 'epl')).to.equal('q812\nP1\n');
  });

  it('emits ZPL that parses back to the same geometry', () => {
    const parsed = parseLabel(ZPL);
    const emitted = emitLabel(parsed, 'zpl');
    const reparsed = parseLabel(emitted.text, { format: 'zpl' });
    expect(reparsed.pages[0].width).to.equal(parsed.pages[0].width);
    expect(reparsed.pages[0].ops.map((op) => op.type)).to.deep.equal(
      parsed.pages[0].ops.map((op) => op.type),
    );
    const original = parsed.pages[0].ops[1];
    const round = reparsed.pages[0].ops[1];
    if (original.type === 'barcode' && round.type === 'barcode') {
      expect(round.symbology).to.equal(original.symbology);
      expect(round.data).to.equal(original.data);
      expect(round.height).to.equal(original.height);
    }
  });

  it('converts ZPL to EPL and back', () => {
    const toEpl = convertLabel(ZPL, 'epl');
    expect(toEpl.from).to.equal('zpl');
    expect(toEpl.to).to.equal('epl');
    expect(toEpl.text).to.contain('B20,120,0,3,');
    expect(toEpl.text).to.contain('"1234567890"');

    const backToZpl = convertLabel(toEpl.text, 'zpl');
    const parsed = parseLabel(backToZpl.text, { format: 'zpl' });
    const barcode = parsed.pages[0].ops.find((op) => op.type === 'barcode');
    expect(barcode?.type).to.equal('barcode');
    if (barcode?.type === 'barcode') {
      expect(barcode.data).to.equal('1234567890');
    }
  });

  it('reports what a conversion could not represent', () => {
    const converted = convertLabel(
      '^XA^FO10,10^GC80,3,B^FS^FO50,50^GD100,100,3,B,R^FS^XZ',
      'epl',
    );
    expect(converted.warnings.join(' ')).to.contain('circle');
    expect(converted.warnings.join(' ')).to.contain('diagonal');
  });

  it('picks the closest EPL font for a requested glyph size', () => {
    const exact = chooseEplFont(20, 12);
    expect(exact.font).to.equal('3');
    expect(exact.hMult).to.equal(1);
    expect(exact.vMult).to.equal(1);
    expect(exact.exact).to.equal(true);

    const doubled = chooseEplFont(40, 24);
    expect(doubled.vMult).to.equal(2);
    expect(doubled.hMult).to.equal(2);
  });

  it('builds the right ZPL command per symbology', () => {
    const base = {
      type: 'barcode' as const,
      data: '123',
      moduleWidth: 2,
      ratio: 3,
      height: 80,
      interpretation: true,
      interpretationAbove: false,
      x: 0,
      y: 0,
      rotation: 'N' as const,
      reverse: false,
    };
    expect(zplBarcodeCommand({ ...base, symbology: 'code128' })).to.equal(
      '^BCN,80,Y,N,N',
    );
    expect(zplBarcodeCommand({ ...base, symbology: 'code39' })).to.equal(
      '^B3N,N,80,Y,N',
    );
    expect(
      zplBarcodeCommand({ ...base, symbology: 'qrcode', magnification: 5 }),
    ).to.contain('^BQN,2,5');
  });
});

describe('core.validate', () => {
  it('runs the right syntax checker per language', () => {
    expect(validateSyntax('^XA^ZZ^XZ', 'zpl').some((d) => d.message.includes('Unknown'))).to.equal(true);
    expect(validateSyntax('ZZ1,2', 'epl').some((d) => d.message.includes('Unknown'))).to.equal(true);
  });

  it('adds semantic findings on top of syntax checks', () => {
    const findings = validateLabelSource(
      '^XA^PW406^LL203^FO10,10^BY1^BEN,20,Y,N^FD12345^FS^XZ',
      { format: 'zpl' },
    );
    const rules = findings.map((finding) => finding.rule);
    expect(rules).to.contain('barcode.length');
    expect(rules).to.contain('barcode.module-width');
  });

  it('can run syntax checks alone', () => {
    const findings = validateLabelSource('^XA^FO10,10^BEN,20,Y,N^FD12345^FS^XZ', {
      format: 'zpl',
      lint: false,
    });
    expect(findings.every((finding) => !finding.rule?.startsWith('barcode.'))).to.equal(
      true,
    );
  });
});

describe('core.templates', () => {
  it('every template parses into at least one label', () => {
    for (const template of LABEL_TEMPLATES) {
      const parsed = parseLabel(fillTemplateSample(template), {
        format: template.format,
        dpmm: template.dpmm,
      });
      expect(parsed.pages, `${template.id} produced no page`).to.have.length.greaterThan(0);
      expect(parsed.pages[0].ops.length, `${template.id} is empty`).to.be.greaterThan(0);
    }
  });

  it('declares the placeholders it actually uses', () => {
    for (const template of LABEL_TEMPLATES) {
      const used = templateFields(template.source);
      for (const field of used) {
        expect(
          template.placeholders,
          `${template.id} does not declare {{${field}}}`,
        ).to.contain(field);
      }
    }
  });

  it('fills every placeholder with sample data', () => {
    for (const template of LABEL_TEMPLATES) {
      expect(
        fillTemplateSample(template),
        `${template.id} has an unfilled placeholder`,
      ).to.not.match(/\{\{/);
    }
  });

  it('sample barcode data is valid for its symbology', () => {
    for (const template of LABEL_TEMPLATES) {
      const parsed = parseLabel(fillTemplateSample(template), {
        format: template.format,
        dpmm: template.dpmm,
      });
      for (const page of parsed.pages) {
        for (const op of page.ops) {
          if (op.type !== 'barcode') {
            continue;
          }
          const errors = validateBarcodeData(op.symbology, op.data).filter(
            (issue) => issue.severity === 'error',
          );
          expect(
            errors,
            `${template.id}: ${op.symbology} "${op.data}" — ${errors
              .map((e) => e.message)
              .join('; ')}`,
          ).to.have.length(0);
        }
      }
    }
  });

  it('finds templates by id and format', () => {
    expect(findTemplate('zpl-product-4x2')?.format).to.equal('zpl');
    expect(findTemplate('nope')).to.equal(undefined);
    expect(templatesForFormat('epl').length).to.be.greaterThan(0);
  });
});
