import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture, waitForCondition } from '../helpers/vscode';

describe('integration: symbol provider', () => {
  it('returns label symbols for shipping fixture', async () => {
    const editor = await openWorkspaceFixture('valid', 'shipping.zpl');
    let symbols:
      | vscode.DocumentSymbol[]
      | vscode.SymbolInformation[]
      | undefined;
    await waitForCondition(async () => {
      symbols = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[] | vscode.SymbolInformation[]
      >('vscode.executeDocumentSymbolProvider', editor.document.uri);
      return (symbols?.length ?? 0) > 0;
    });
    const first = symbols?.[0];
    expect(first).to.not.equal(undefined);
    expect(first?.name).to.contain('Label');
  });
});
