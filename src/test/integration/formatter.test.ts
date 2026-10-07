import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture, waitForCondition } from '../helpers/vscode';

const COMPACT = '^XA^FO1,1^FDx^FS^XZ';
const LAID_OUT = '^XA\n  ^FO1,1\n  ^FDx\n  ^FS\n^XZ\n';

async function replaceAll(
  editor: vscode.TextEditor,
  text: string,
): Promise<void> {
  await editor.edit((builder) => {
    const full = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length),
    );
    builder.replace(full, text);
  });
}

describe('integration: formatter command', () => {
  it('formats compact ZPL into one command per line', async () => {
    const editor = await openWorkspaceFixture('valid', 'hello.zpl');
    await replaceAll(editor, COMPACT);

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

    expect(editor.document.getText()).to.equal(LAID_OUT);
  });

  it('formats the label the command was handed, not whatever has focus', async () => {
    const editor = await openWorkspaceFixture('valid', 'hello.zpl');
    await replaceAll(editor, COMPACT);
    // Put a webview between the command and the document: with the preview
    // focused there is no code editor for the workbench format command to act
    // on, so `labelStudio.formatDocument` has to apply its own edits.
    await vscode.commands.executeCommand('zplViewer.previewToSide');

    await vscode.commands.executeCommand(
      'labelStudio.formatDocument',
      editor.document.uri,
    );
    await waitForCondition(() => editor.document.getText() === LAID_OUT);
    expect(editor.document.getText()).to.equal(LAID_OUT);
  });
});
