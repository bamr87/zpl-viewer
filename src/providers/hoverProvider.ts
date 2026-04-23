import * as vscode from 'vscode';
import { findCommand, renderCommandMarkdown } from '../zplCommands';
import { tokenAt, tokenize } from '../zplParser';

export class ZplHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const text = document.getText();
    const tokens = tokenize(text);
    const offset = document.offsetAt(position);
    const token = tokenAt(tokens, offset);
    if (!token) {
      return undefined;
    }

    const commandEnd = token.start + 1 + token.name.length;
    if (offset >= commandEnd) {
      return undefined;
    }

    const cmd = findCommand(token.command);
    if (!cmd) {
      return undefined;
    }

    const md = new vscode.MarkdownString(renderCommandMarkdown(cmd));
    md.isTrusted = true;
    md.supportHtml = false;
    const range = new vscode.Range(
      document.positionAt(token.start),
      document.positionAt(commandEnd),
    );
    return new vscode.Hover(md, range);
  }
}
