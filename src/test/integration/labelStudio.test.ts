import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
  openWorkspaceFixture,
  waitForCondition,
  waitForDiagnostics,
} from '../helpers/vscode';

describe('integration: Label Studio commands', () => {
  let infoStub: sinon.SinonStub;
  let warnStub: sinon.SinonStub;

  beforeEach(() => {
    infoStub = sinon
      .stub(vscode.window, 'showInformationMessage')
      .resolves(undefined as never);
    warnStub = sinon
      .stub(vscode.window, 'showWarningMessage')
      .resolves(undefined as never);
  });

  afterEach(() => {
    infoStub.restore();
    warnStub.restore();
  });

  it('registers the label commands and the legacy aliases', async () => {
    await openWorkspaceFixture('valid', 'hello.zpl');
    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      'labelStudio.preview',
      'labelStudio.previewToSide',
      'labelStudio.exportPng',
      'labelStudio.exportPdf',
      'labelStudio.formatDocument',
      'labelStudio.validate',
      'labelStudio.analyze',
      'labelStudio.newFromTemplate',
      'labelStudio.convertFormat',
      'labelStudio.openBarcodeStudio',
      'labelStudio.insertBarcode',
      'labelStudio.importImage',
      'labelStudio.importCapture',
      'labelStudio.previewDataSource',
      'labelStudio.mergeData',
      'labelStudio.checkMapping',
      'labelStudio.deploy',
      'labelStudio.deployDryRun',
      'labelStudio.addPrinter',
      'zplViewer.preview',
      'zplViewer.exportPng',
    ]) {
      expect(commands.includes(command), `missing command ${command}`).to.equal(true);
    }
  });

  it('analyzes a label into a markdown report', async () => {
    await openWorkspaceFixture('valid', 'product.zpl');
    await vscode.commands.executeCommand('labelStudio.analyze');
    await waitForCondition(
      () => vscode.window.activeTextEditor?.document.languageId === 'markdown',
    );
    const report = vscode.window.activeTextEditor?.document.getText() ?? '';
    expect(report).to.contain('# Label analysis: product.zpl');
    expect(report).to.contain('Format: **ZPL**');
    expect(report).to.contain('### Barcodes');
  });

  it('previews a data source as a markdown table', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    expect(root, 'workspace folder').to.not.equal(undefined);
    const csv = vscode.Uri.joinPath(root!, 'data', 'products.csv');
    await vscode.commands.executeCommand('labelStudio.previewDataSource', csv);
    await waitForCondition(() =>
      (vscode.window.activeTextEditor?.document.getText() ?? '').includes(
        '# Data source: products.csv',
      ),
    );
    const preview = vscode.window.activeTextEditor?.document.getText() ?? '';
    expect(preview).to.contain('| `sku` |');
    expect(preview).to.contain('Rows: 4');
  });

  it('merges a data source into one label per row', async () => {
    await openWorkspaceFixture('valid', 'product-template.zpl');
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const csv = vscode.Uri.joinPath(root!, 'data', 'products.csv');
    await vscode.commands.executeCommand('labelStudio.mergeData', csv);
    await waitForCondition(() =>
      (vscode.window.activeTextEditor?.document.getText() ?? '').includes(
        'Widget Deluxe Red',
      ),
    );
    const merged = vscode.window.activeTextEditor?.document.getText() ?? '';
    expect(merged.match(/\^XA/g) ?? []).to.have.length(4);
    expect(merged).to.contain('SKU: WD-001-RED');
    expect(merged).to.contain('Location: A-007');
    // The comma in "Sprocket, heavy duty" must survive CSV parsing.
    expect(merged).to.contain('Sprocket, heavy duty');
  });

  it('builds a deploy payload without touching the network on a dry run', async () => {
    await openWorkspaceFixture('valid', 'hello.zpl');
    const configuration = vscode.workspace.getConfiguration('labelStudio');
    await configuration.update(
      'printers',
      [
        {
          name: 'Test EPL printer',
          transport: 'directory',
          path: './out/spool',
          format: 'epl',
          dpmm: 8,
        },
      ],
      vscode.ConfigurationTarget.Workspace,
    );
    try {
      await vscode.commands.executeCommand(
        'labelStudio.deployDryRun',
        'Test EPL printer',
      );
      await waitForCondition(() =>
        (vscode.window.activeTextEditor?.document.getText() ?? '').startsWith('N\n'),
      );
      const payload = vscode.window.activeTextEditor?.document.getText() ?? '';
      // Stock size comes from the label settings, so match the shape rather
      // than a hard-coded dot count.
      expect(payload).to.match(/^N\nq\d+\nQ\d+,24\n/);
      expect(payload).to.contain('A50,50,0,');
      expect(payload.trimEnd().endsWith('P1')).to.equal(true);
    } finally {
      await configuration.update(
        'printers',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });
});

describe('integration: EPL support', () => {
  it('opens .epl files as EPL and outlines their labels', async () => {
    const editor = await openWorkspaceFixture('valid', 'basic.epl');
    expect(editor.document.languageId).to.equal('epl');

    const symbols = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider',
      editor.document.uri,
    )) as vscode.DocumentSymbol[];
    expect(symbols).to.have.length(1);
    expect(symbols[0].name).to.equal('Label 1');
    expect(symbols[0].children.length).to.be.greaterThan(2);
  });

  it('reports EPL formats that never clear the buffer or print', async () => {
    const editor = await openWorkspaceFixture('invalid', 'missing-print.epl');
    const diagnostics = await waitForDiagnostics(editor.document.uri);
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join(' ');
    expect(messages).to.contain('does not start with `N`');
    expect(messages).to.contain('never prints');
  });

  it('documents EPL commands on hover', async () => {
    const editor = await openWorkspaceFixture('valid', 'basic.epl');
    const position = editor.document.positionAt(
      editor.document.getText().indexOf('A20,20'),
    );
    const hovers = (await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      editor.document.uri,
      position,
    )) as vscode.Hover[];
    const text = hovers
      .flatMap((hover) => hover.contents)
      .map((content) =>
        typeof content === 'string' ? content : (content as vscode.MarkdownString).value,
      )
      .join('\n');
    expect(text).to.contain('ASCII Text');
  });
});

describe('integration: barcode diagnostics', () => {
  it('flags a bad check digit and a bar width that will not scan', async () => {
    const editor = await openWorkspaceFixture('invalid', 'bad-barcode.zpl');
    const diagnostics = await waitForDiagnostics(editor.document.uri);
    const codes = diagnostics.map((diagnostic) => String(diagnostic.code));
    expect(codes).to.contain('barcode.length');
    expect(codes).to.contain('barcode.module-width');
  });
});
