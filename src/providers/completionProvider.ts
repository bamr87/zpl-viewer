import * as vscode from 'vscode';
import { ZPL_COMMANDS, renderCommandMarkdown } from '../zplCommands';

export class ZplCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    const line = document.lineAt(position.line).text.slice(0, position.character);
    const match = line.match(/([\^~])([A-Za-z0-9@]{0,3})$/);
    if (!match) {
      return undefined;
    }

    const prefix = match[1];
    const typed = match[2].toUpperCase();
    const items: vscode.CompletionItem[] = [];
    for (const cmd of ZPL_COMMANDS) {
      if (cmd.prefix !== prefix) {
        continue;
      }
      if (typed && !cmd.name.startsWith(typed)) {
        continue;
      }
      const item = new vscode.CompletionItem(
        `${cmd.prefix}${cmd.name}`,
        vscode.CompletionItemKind.Function,
      );
      item.detail = cmd.title;
      item.documentation = new vscode.MarkdownString(renderCommandMarkdown(cmd));
      item.filterText = cmd.name;
      item.sortText = `${cmd.category}-${cmd.name}`;
      const replaceStart = position.translate(0, -match[0].length);
      item.range = new vscode.Range(replaceStart, position);
      if (cmd.parameters && cmd.parameters.length > 0) {
        const placeholders = cmd.parameters
          .map((p, i) => `\${${i + 1}:${p.name}}`)
          .join(',');
        item.insertText = new vscode.SnippetString(
          `${cmd.prefix}${cmd.name}${placeholders}`,
        );
      } else {
        item.insertText = `${cmd.prefix}${cmd.name}`;
      }
      items.push(item);
    }
    return items;
  }
}
