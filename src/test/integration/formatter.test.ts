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

    // Ask VS Code for the edits our provider produces, then apply them.
    //
    // Driving `editor.action.formatDocument` instead makes the assertion
    // depend on the workbench having editor focus: with none, it formats
    // nothing and still resolves, so the test fails with the document
    // unchanged and no hint as to why. That is exactly what it did on the
    // macOS runner the first time this suite was able to run there.
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      editor.document.uri,
      { tabSize: 2, insertSpaces: true },
    );
    expect(edits, 'no formatting provider answered for a .zpl document').to.not.equal(
      undefined,
    );

    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(editor.document.uri, edits ?? []);
    expect(await vscode.workspace.applyEdit(workspaceEdit), 'edits applied').to.equal(
      true,
    );

    expect(editor.document.getText()).to.equal('^XA\n  ^FO1,1\n  ^FDx\n  ^FS\n^XZ\n');
  });
});
