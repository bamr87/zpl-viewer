import { expect } from 'chai';
import { parseLabel } from '../../core/pipeline';
import { analyzeLabel, opExtent, utf8ByteLength } from '../../analysis/metrics';
import { lintLabel } from '../../analysis/lint';
import { renderAnalysisMarkdown } from '../../analysis/report';
import { countBySeverity } from '../../core/diagnostics';

const LABEL =
  '^XA^PW812^LL406^FO20,20^A0N,40,40^FDHello^FS^FO20,120^BY3,3,100^BCN,100,Y,N,N^FD1234567890^FS^FO20,300^GB700,4,4^FS^XZ';

describe('analysis.metrics', () => {
  it('summarizes geometry, inventory and coverage', () => {
    const parsed = parseLabel(LABEL);
    const analysis = analyzeLabel(parsed, LABEL);

    expect(analysis.format).to.equal('zpl');
    expect(analysis.pages).to.have.length(1);
    const page = analysis.pages[0];
    expect(page.widthDots).to.equal(812);
    expect(page.widthInches).to.be.closeTo(4, 0.02);
    expect(page.opCounts.text).to.equal(1);
    expect(page.opCounts.barcode).to.equal(1);
    expect(page.fonts).to.deep.equal(['0']);
    expect(page.inkCoveragePercent).to.be.greaterThan(0);
    expect(page.contentExtent.width).to.be.greaterThan(0);
    expect(analysis.totalBarcodes).to.equal(1);
    expect(analysis.sourceBytes).to.equal(LABEL.length);
  });

  it('inventories barcodes with their validation state', () => {
    const source = '^XA^FO10,10^BEN,80,Y,N^FD5901234123458^FS^XZ';
    const analysis = analyzeLabel(parseLabel(source), source);
    const [barcode] = analysis.pages[0].barcodes;
    expect(barcode.label).to.equal('EAN-13');
    expect(barcode.issues.some((issue) => issue.code === 'check-digit')).to.equal(true);
    expect(analysis.barcodeIssueCount).to.be.greaterThan(0);
  });

  it('estimates op extents', () => {
    expect(
      opExtent({
        type: 'line',
        length: 100,
        thickness: 4,
        direction: 'horizontal',
        color: 'B',
        x: 1,
        y: 2,
        rotation: 'N',
        reverse: false,
      }),
    ).to.deep.equal({ x: 1, y: 2, width: 100, height: 4 });
  });

  it('counts UTF-8 bytes without Buffer', () => {
    expect(utf8ByteLength('abc')).to.equal(3);
    expect(utf8ByteLength('é')).to.equal(2);
    expect(utf8ByteLength('☃')).to.equal(3);
  });
});

describe('analysis.lint', () => {
  it('is quiet on a healthy label', () => {
    const parsed = parseLabel(LABEL);
    const findings = lintLabel(parsed, LABEL);
    expect(
      findings.filter((finding) => finding.severity === 'error'),
    ).to.have.length(0);
  });

  it('reports a field that starts off the label', () => {
    const source = '^XA^PW406^LL203^FO900,10^A0N,20,20^FDoff^FS^XZ';
    const findings = lintLabel(parseLabel(source), source);
    expect(findings.some((finding) => finding.rule === 'layout.out-of-bounds')).to.equal(
      true,
    );
  });

  it('reports a field that runs past the edge', () => {
    const source = '^XA^PW406^LL203^FO380,10^A0N,30,30^FDlong text here^FS^XZ';
    const findings = lintLabel(parseLabel(source), source);
    expect(findings.some((finding) => finding.rule === 'layout.clipped')).to.equal(true);
  });

  it('reports bar widths and quiet zones that will not scan', () => {
    const source = '^XA^PW812^LL406^FO2,10^BY1^BCN,100,Y,N,N^FD12345^FS^XZ';
    const findings = lintLabel(parseLabel(source), source);
    const rules = findings.map((finding) => finding.rule);
    expect(rules).to.contain('barcode.module-width');
    expect(rules).to.contain('barcode.quiet-zone');
  });

  it('reports an invalid barcode payload against the symbology', () => {
    const source = '^XA^FO50,50^B3N,N,80,Y,N^FDlowercase^FS^XZ';
    const findings = lintLabel(parseLabel(source), source);
    expect(findings.some((finding) => finding.rule === 'barcode.charset')).to.equal(true);
  });

  it('points findings at the source range that produced them', () => {
    const source = '^XA^PW812^LL406^FO50,50^B3N,N,80,Y,N^FDlowercase^FS^XZ';
    const finding = lintLabel(parseLabel(source), source).find(
      (entry) => entry.rule === 'barcode.charset',
    );
    expect(finding?.start).to.equal(source.indexOf('^FO50,50'));
  });

  it('lints EPL labels with the same rules', () => {
    const source = 'N\nq406\nQ203,24\nB2,10,0,3,1,3,100,B,"X"\nP1';
    const findings = lintLabel(parseLabel(source, { format: 'epl' }), source);
    expect(findings.some((finding) => finding.rule === 'barcode.module-width')).to.equal(
      true,
    );
  });

  it('says when nothing could be parsed as a label', () => {
    const findings = lintLabel(parseLabel('hello', { format: 'zpl' }), 'hello');
    expect(findings.some((finding) => finding.rule === 'label.no-pages')).to.equal(true);
  });

  it('can switch individual rule groups off', () => {
    const source = '^XA^PW406^LL203^FO2,10^BY1^BCN,100,Y,N,N^FD12345^FS^XZ';
    const findings = lintLabel(parseLabel(source), source, {
      scannability: false,
      bounds: false,
    });
    expect(findings.every((finding) => !finding.rule?.startsWith('layout.'))).to.equal(
      true,
    );
    expect(
      findings.every((finding) => finding.rule !== 'barcode.module-width'),
    ).to.equal(true);
  });
});

describe('analysis.report', () => {
  it('renders a markdown report', () => {
    const parsed = parseLabel(LABEL);
    const analysis = analyzeLabel(parsed, LABEL);
    const findings = lintLabel(parsed, LABEL);
    const markdown = renderAnalysisMarkdown(analysis, findings, 'demo.zpl');

    expect(markdown).to.contain('# Label analysis: demo.zpl');
    expect(markdown).to.contain('Format: **ZPL**');
    expect(markdown).to.contain('8 dpmm (203 dpi)');
    expect(markdown).to.contain('### Barcodes');
    expect(markdown).to.contain('Code 128');
    const counts = countBySeverity(findings);
    expect(markdown).to.contain(`${counts.warning} warning(s)`);
  });

  it('says so when there is nothing to report', () => {
    const source = '^XA^PW812^LL406^FO100,100^A0N,30,30^FDok^FS^XZ';
    const parsed = parseLabel(source);
    const markdown = renderAnalysisMarkdown(
      analyzeLabel(parsed, source),
      lintLabel(parsed, source),
      'clean.zpl',
    );
    expect(markdown).to.contain('No problems found.');
  });
});
