import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { openWorkspaceFixture } from '../helpers/vscode';

describe('integration: export commands', () => {
  let saveDialogStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let openExternalStub: sinon.SinonStub;

  beforeEach(() => {
    infoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
    openExternalStub = sinon.stub(vscode.env, 'openExternal').resolves(true);
  });

  afterEach(() => {
    saveDialogStub?.restore();
    infoStub.restore();
    openExternalStub.restore();
  });

  it('exports PNG and PDF files', async () => {
    await openWorkspaceFixture('valid', 'hello.zpl');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-viewer-test-'));
    const pngUri = vscode.Uri.file(path.join(dir, 'out.png'));
    const pdfUri = vscode.Uri.file(path.join(dir, 'out.pdf'));

    saveDialogStub = sinon.stub(vscode.window, 'showSaveDialog');
    saveDialogStub.onFirstCall().resolves(pngUri);
    saveDialogStub.onSecondCall().resolves(pdfUri);

    await vscode.commands.executeCommand('zplViewer.exportPng');
    await vscode.commands.executeCommand('zplViewer.exportPdf');

    const png = fs.readFileSync(pngUri.fsPath);
    const pdf = fs.readFileSync(pdfUri.fsPath);
    expect(png.subarray(0, 4).toString('hex')).to.equal('89504e47');
    expect(pdf.subarray(0, 4).toString()).to.equal('%PDF');
  });

  it('exports SVG without a preview panel being open', async () => {
    // The point of the SVG exporter is that it renders in the extension host:
    // no webview, no canvas, nothing to rasterize.
    //
    // The label is written here rather than taken from the shared fixture
    // workspace, whose buffers earlier tests have already edited.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-viewer-test-'));
    const labelPath = path.join(dir, 'svg-export.zpl');
    fs.writeFileSync(
      labelPath,
      '^XA\n^CF0,40\n^FO50,50^FDSVG EXPORT^FS\n^FO50,120^BY3^BCN,100,Y,N,N^FD9876543210^FS\n^XZ\n',
    );
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(labelPath));
    await vscode.window.showTextDocument(document);

    const svgUri = vscode.Uri.file(path.join(dir, 'out.svg'));
    saveDialogStub = sinon.stub(vscode.window, 'showSaveDialog').resolves(svgUri);

    await vscode.commands.executeCommand('labelStudio.exportSvg');

    const svg = fs.readFileSync(svgUri.fsPath, 'utf8');
    expect(svg).to.contain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).to.contain('SVG EXPORT');
    // The barcode is encoded as vector paths, not a raster fallback.
    expect(svg).to.contain('<path');
    expect(svg).to.not.contain('barcode error');
  });
});
