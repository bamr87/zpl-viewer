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
});
