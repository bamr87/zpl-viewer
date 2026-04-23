import { expect } from 'chai';
import * as vscode from 'vscode';
import { openWorkspaceFixture } from '../helpers/vscode';

describe('integration: folding provider', () => {
  it('returns folding ranges for label boundaries', async () => {
    const editor = await openWorkspaceFixture('valid', 'shipping.zpl');
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[]>(
      'vscode.executeFoldingRangeProvider',
      editor.document.uri,
    );
    expect((ranges ?? []).length).to.be.greaterThan(0);
  });
});
