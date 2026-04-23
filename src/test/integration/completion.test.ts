import { expect } from 'chai';
import * as vscode from 'vscode';

describe('integration: completion provider', () => {
  it('provides command completions after caret prefix', async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: 'zpl',
      content: '^B',
    });
    await vscode.window.showTextDocument(doc);
    const list = await vscode.commands.executeCommand<
      vscode.CompletionList | vscode.CompletionItem[]
    >('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 2));
    const items = Array.isArray(list) ? list : list?.items ?? [];
    const labels = items.map((i) =>
      typeof i.label === 'string' ? i.label : i.label.label,
    );
    expect(labels.includes('^BC')).to.equal(true);
  });
});
