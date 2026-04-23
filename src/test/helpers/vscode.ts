import * as vscode from 'vscode';
import * as path from 'path';

export async function openFixture(
  fixturePath: string,
): Promise<vscode.TextEditor> {
  const uri = vscode.Uri.file(fixturePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(doc);
}

export async function openWorkspaceFixture(
  ...parts: string[]
): Promise<vscode.TextEditor> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new Error('No workspace folder available in test host.');
  }
  return openFixture(path.join(root, ...parts));
}

export async function waitForCondition(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 6000,
  pollMs = 50,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms.`);
}

export async function waitForDiagnostics(
  uri: vscode.Uri,
  timeoutMs = 6000,
): Promise<readonly vscode.Diagnostic[]> {
  let result: readonly vscode.Diagnostic[] = [];
  await waitForCondition(() => {
    result = vscode.languages.getDiagnostics(uri);
    return result.length > 0;
  }, timeoutMs);
  return result;
}
