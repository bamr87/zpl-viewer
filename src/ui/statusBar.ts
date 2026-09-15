/**
 * The status-bar entry for label documents.
 *
 * It does two jobs that neither the sidebar nor the palette does well. It
 * *reports*: the printer language, the stock size and the print density the
 * preview is currently using are the three settings that silently change what
 * a label looks like, and they were previously invisible unless you went
 * looking in settings. And it *offers*: clicking it opens the full action list,
 * which is the shortest path from "I have a label open" to any command,
 * without knowing what that command is called.
 */

import * as vscode from 'vscode';
import { formatOfDocument, getRenderConfig } from '../config';
import { LABEL_FORMATS } from '../core/formats';
import { isLabelFormatId } from '../core/formats';

export function registerStatusBar(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    'labelStudio.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.name = 'Label Studio';
  item.command = 'labelStudio.showActions';

  const update = (): void => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isLabelFormatId(editor.document.languageId)) {
      item.hide();
      return;
    }

    const format = formatOfDocument(editor.document);
    const render = getRenderConfig();
    item.text = `$(tag) ${LABEL_FORMATS[format].label}`;
    item.tooltip = new vscode.MarkdownString(
      [
        `**Label Studio** — ${LABEL_FORMATS[format].label}`,
        '',
        `- Stock: ${render.widthInches} × ${render.heightInches} in`,
        `- Density: ${render.dpmm} dpmm (${Math.round(render.dpmm * 25.4)} dpi)`,
        '',
        'Click for every label action.',
      ].join('\n'),
    );
    item.show();
  };

  update();

  const disposables = [
    item,
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.workspace.onDidChangeConfiguration(update),
    // A `.prn` or `.lbl` file's language is sniffed from its content, so the
    // label shown has to follow edits, not just the active editor.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document === vscode.window.activeTextEditor?.document) {
        update();
      }
    }),
  ];
  context.subscriptions.push(...disposables);

  return {
    dispose(): void {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}
