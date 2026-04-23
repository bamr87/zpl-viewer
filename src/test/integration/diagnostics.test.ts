import { expect } from 'chai';
import { openWorkspaceFixture, waitForDiagnostics } from '../helpers/vscode';

describe('integration: diagnostics', () => {
  it('reports unknown command diagnostics', async () => {
    const editor = await openWorkspaceFixture('invalid', 'unknown-command.zpl');
    const diagnostics = await waitForDiagnostics(editor.document.uri);
    expect(
      diagnostics.some((d) => d.message.includes('Unknown ZPL command')),
    ).to.equal(true);
  });
});
