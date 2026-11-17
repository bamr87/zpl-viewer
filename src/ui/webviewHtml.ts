import * as fs from 'fs';
import * as vscode from 'vscode';
import { generateNonce } from './webviewGuards';

export { generateNonce };

/**
 * Loads a bundled webview page and substitutes the `{{scriptUri}}`,
 * `{{cspSource}}` and `{{nonce}}` placeholders.
 */
export function renderWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  htmlFile: string,
  scriptFile: string,
): string {
  const htmlPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview', htmlFile);
  let html: string;
  try {
    html = fs.readFileSync(htmlPath.fsPath, 'utf8');
  } catch {
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:16px">
      <h3>Webview assets not found</h3>
      <p>Expected <code>${htmlPath.fsPath}</code>.<br/>
      Run <code>npm run compile</code> and reload the window.</p>
      </body></html>`;
  }
  const scriptUri = webview
    .asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview', scriptFile),
    )
    .toString();
  const nonce = generateNonce();
  return html
    .replace(/\{\{scriptUri\}\}/g, () => scriptUri)
    .replace(/\{\{cspSource\}\}/g, () => webview.cspSource)
    .replace(/\{\{nonce\}\}/g, () => nonce);
}
