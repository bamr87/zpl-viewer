import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture } from '../helpers/vscode';

describe('integration: preview', () => {
  it('opens preview and reaches ready state', async () => {
    const editor = await openWorkspaceFixture('valid', 'hello.zpl');
    await vscode.commands.executeCommand('zplViewer.previewToSide');
    await vscode.commands.executeCommand(
      'zplViewer._test.waitForPreviewReady',
      editor.document.uri,
      10000,
    );
    expect(true).to.equal(true);
  });
});
