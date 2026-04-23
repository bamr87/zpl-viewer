import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture } from '../helpers/vscode';

describe('integration: hover provider', () => {
  it('returns command docs for ^FO', async () => {
    const editor = await openWorkspaceFixture('valid', 'hello.zpl');
    const pos = new vscode.Position(2, 1); // ^FO...
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      editor.document.uri,
      pos,
    );
    expect(hovers && hovers.length > 0).to.equal(true);
    const value = hovers?.[0]?.contents?.[0];
    const text =
      value instanceof vscode.MarkdownString ? value.value : String(value ?? '');
    expect(text).to.contain('Field Origin');
  });
});
