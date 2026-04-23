import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture } from '../helpers/vscode';

describe('integration: formatter command', () => {
  it('formats compact ZPL into one command per line', async () => {
    const editor = await openWorkspaceFixture('valid', 'hello.zpl');
    await editor.edit((b) => {
      const full = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(editor.document.getText().length),
      );
      b.replace(full, '^XA^FO1,1^FDx^FS^XZ');
    });
    await vscode.commands.executeCommand('editor.action.formatDocument');
    expect(editor.document.getText()).to.equal('^XA\n  ^FO1,1\n  ^FDx\n  ^FS\n^XZ\n');
  });
});
