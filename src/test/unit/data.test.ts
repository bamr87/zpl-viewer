import { expect } from 'chai';
import { parseCsv, sniffDelimiter, toCsv } from '../../data/csv';
import {
  datasetToMarkdown,
  detectDatasetKind,
  loadDataset,
  resolveField,
} from '../../data/dataset';
import {
  applyFilters,
  escapeEplData,
  escapeZplData,
  findPlaceholders,
  renderTemplate,
  templateFields,
} from '../../data/template';
import { analyzeMapping, mappingToMarkdown, mergeDataset } from '../../data/merge';

describe('data.csv', () => {
  it('parses quoted fields, embedded delimiters and escaped quotes', () => {
    const table = parseCsv('a,b\n"one,two","say ""hi"""\n');
    expect(table.header).to.deep.equal(['a', 'b']);
    expect(table.rows).to.deep.equal([['one,two', 'say "hi"']]);
  });

  it('handles CRLF, a BOM and blank lines', () => {
    const table = parseCsv('﻿sku,qty\r\nA1,2\r\n\r\nB2,3\r\n');
    expect(table.header).to.deep.equal(['sku', 'qty']);
    expect(table.rows).to.deep.equal([
      ['A1', '2'],
      ['B2', '3'],
    ]);
  });

  it('pads ragged rows and says so', () => {
    const table = parseCsv('a,b,c\n1,2\n');
    expect(table.rows[0]).to.deep.equal(['1', '2', '']);
    expect(table.warnings.join(' ')).to.contain('do not have 3 columns');
  });

  it('sniffs the delimiter', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).to.equal(';');
    expect(sniffDelimiter('a\tb\n1\t2')).to.equal('\t');
    expect(sniffDelimiter('a,b\n1,2')).to.equal(',');
  });

  it('round-trips through toCsv', () => {
    const original = parseCsv('a,b\n"x,y",z\n');
    const reparsed = parseCsv(toCsv(original.header, original.rows));
    expect(reparsed.rows).to.deep.equal(original.rows);
  });
});

describe('data.dataset', () => {
  it('detects the source kind', () => {
    expect(detectDatasetKind('a,b\n1,2', 'x.csv')).to.equal('csv');
    expect(detectDatasetKind('a\tb\n1\t2', 'x.tsv')).to.equal('tsv');
    expect(detectDatasetKind('[{"a":1}]', 'x.json')).to.equal('json');
    expect(detectDatasetKind('{"a":1}\n{"a":2}', 'x.jsonl')).to.equal('jsonl');
    expect(detectDatasetKind('[{"a":1}]')).to.equal('json');
  });

  it('loads a CSV into rows keyed by field name', () => {
    const dataset = loadDataset('sku,qty\nA1,2\nB2,\n', 'stock.csv');
    expect(dataset.kind).to.equal('csv');
    expect(dataset.rows).to.deep.equal([
      { sku: 'A1', qty: '2' },
      { sku: 'B2', qty: '' },
    ]);
    const qty = dataset.fields.find((field) => field.name === 'qty');
    expect(qty?.missing).to.equal(1);
    expect(qty?.type).to.equal('number');
  });

  it('flattens nested JSON objects into dotted fields', () => {
    const dataset = loadDataset(
      '[{"sku":"A1","location":{"aisle":"B","bin":3}}]',
      'items.json',
    );
    expect(dataset.rows[0]['location.aisle']).to.equal('B');
    expect(dataset.rows[0]['location.bin']).to.equal('3');
  });

  it('reads JSON lines and reports bad lines', () => {
    const dataset = loadDataset('{"a":1}\nnot json\n{"a":2}', 'x.jsonl');
    expect(dataset.rows).to.have.length(2);
    expect(dataset.warnings.join(' ')).to.contain('Line 2');
  });

  it('unwraps a rows/data envelope', () => {
    const dataset = loadDataset('{"rows":[{"a":"1"},{"a":"2"}]}', 'x.json');
    expect(dataset.rows).to.have.length(2);
  });

  it('resolves field names leniently', () => {
    const row = { 'Product Name': 'Widget' };
    expect(resolveField(row, 'Product Name')).to.equal('Widget');
    expect(resolveField(row, 'product name')).to.equal('Widget');
    expect(resolveField(row, 'productname')).to.equal('Widget');
    expect(resolveField(row, 'nope')).to.equal(undefined);
  });

  it('renders a markdown preview', () => {
    const markdown = datasetToMarkdown(loadDataset('sku,qty\nA1,2\n', 'stock.csv'));
    expect(markdown).to.contain('# Data source: stock.csv');
    expect(markdown).to.contain('| `sku` |');
    expect(markdown).to.contain('Rows: 1');
  });
});

describe('data.template', () => {
  it('finds placeholders with filters', () => {
    const placeholders = findPlaceholders('^FD{{sku|upper|left:4}}^FS');
    expect(placeholders).to.have.length(1);
    expect(placeholders[0].field).to.equal('sku');
    expect(placeholders[0].filters).to.deep.equal([
      { name: 'upper' },
      { name: 'left', arg: '4' },
    ]);
    expect(templateFields('{{a}} {{b}} {{a}}')).to.deep.equal(['a', 'b']);
  });

  it('applies filters', () => {
    expect(applyFilters('abc', [{ name: 'upper' }])).to.equal('ABC');
    expect(applyFilters('  x ', [{ name: 'trim' }])).to.equal('x');
    expect(applyFilters('a1b2', [{ name: 'digits' }])).to.equal('12');
    expect(applyFilters('7', [{ name: 'pad', arg: '3' }])).to.equal('007');
    expect(applyFilters('abcdef', [{ name: 'left', arg: '3' }])).to.equal('abc');
    expect(applyFilters('abcdef', [{ name: 'right', arg: '2' }])).to.equal('ef');
    expect(applyFilters('', [{ name: 'default', arg: 'n/a' }])).to.equal('n/a');
    expect(applyFilters('x', [{ name: 'nope' }])).to.equal('x');
  });

  it('escapes ZPL control characters and adds ^FH to that field', () => {
    const escaped = escapeZplData('A^B~C');
    expect(escaped.escaped).to.equal(true);
    expect(escaped.value).to.equal('A_5EB_7EC');

    const rendered = renderTemplate('^XA^FO10,10^FD{{name}}^FS^XZ', { name: 'A^B' }, {
      format: 'zpl',
    });
    expect(rendered.text).to.contain('^FH^FD');
    expect(rendered.text).to.contain('A_5EB');
  });

  it('does not add ^FH to fields that need no escaping', () => {
    const rendered = renderTemplate('^XA^FD{{a}}^FS^FD{{b}}^FS^XZ', { a: 'ok', b: 'x^y' }, {
      format: 'zpl',
    });
    expect(rendered.text.match(/\^FH/g)).to.have.length(1);
  });

  it('escapes EPL quotes and newlines', () => {
    expect(escapeEplData('say "hi"\nthere')).to.equal('say \\"hi\\" there');
  });

  it('reports missing fields and can keep the placeholder', () => {
    const empty = renderTemplate('{{a}}-{{b}}', { a: '1' });
    expect(empty.text).to.equal('1-');
    expect(empty.missing).to.deep.equal(['b']);

    const kept = renderTemplate('{{a}}-{{b}}', { a: '1' }, { onMissing: 'keep' });
    expect(kept.text).to.equal('1-{{b}}');
  });
});

describe('data.merge', () => {
  const dataset = loadDataset('sku,name\nA1,Widget\nB2,Gizmo\n', 'items.csv');
  const template = '^XA^FO10,10^FD{{name}} ({{sku}})^FS^XZ';

  it('expands a template over every row', () => {
    const merged = mergeDataset(template, dataset, { format: 'zpl' });
    expect(merged.labelCount).to.equal(2);
    expect(merged.text).to.contain('^FDWidget (A1)^FS');
    expect(merged.text).to.contain('^FDGizmo (B2)^FS');
    expect(merged.warnings).to.have.length(0);
  });

  it('honours maxRows and reports the truncation', () => {
    const merged = mergeDataset(template, dataset, { format: 'zpl', maxRows: 1 });
    expect(merged.labelCount).to.equal(1);
    expect(merged.truncated).to.equal(true);
    expect(merged.warnings.join(' ')).to.contain('first 1');
  });

  it('warns when the template has no placeholders', () => {
    const merged = mergeDataset('^XA^FDstatic^FS^XZ', dataset, { format: 'zpl' });
    expect(merged.warnings.join(' ')).to.contain('no {{placeholders}}');
  });

  it('maps placeholders to columns and finds the unmatched ones', () => {
    const report = analyzeMapping(
      '{{sku}} {{Name}} {{missing}} {{sku|bogus}}',
      dataset,
    );
    expect(report.matched.map((entry) => entry.field).sort()).to.deep.equal([
      'name',
      'sku',
    ]);
    expect(report.unresolved).to.deep.equal(['missing']);
    expect(report.unknownFilters).to.deep.equal(['bogus']);
    expect(report.unusedFields).to.deep.equal([]);
  });

  it('renders the mapping as markdown', () => {
    const markdown = mappingToMarkdown(analyzeMapping(template, dataset), dataset);
    expect(markdown).to.contain('# Merge mapping: items.csv');
    expect(markdown).to.contain('`{{sku}}`');
  });
});
