import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture } from '../helpers/vscode';

describe('integration: activation', () => {
  it('activates extension and registers core commands', async () => {
    await openWorkspaceFixture('valid', 'hello.zpl');

    const ext = vscode.extensions.getExtension('zpl-viewer.zpl-viewer');
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    const commands = await vscode.commands.getCommands(true);
    // Both namespaces: the current `labelStudio.*` ids and the `zplViewer.*`
    // aliases kept for existing keybindings and tasks.
    for (const cmd of [
      'labelStudio.preview',
      'labelStudio.previewToSide',
      'labelStudio.exportPng',
      'labelStudio.exportPdf',
      'labelStudio.exportSvg',
      'labelStudio.formatDocument',
      'labelStudio.validate',
      'labelStudio.insertTemplate',
      'zplViewer.preview',
      'zplViewer.previewToSide',
      'zplViewer.exportPng',
      'zplViewer.exportPdf',
      'zplViewer.formatDocument',
      'zplViewer.validate',
      'zplViewer.insertTemplate',
    ]) {
      expect(commands.includes(cmd), `missing command ${cmd}`).to.equal(true);
    }
  });
});
