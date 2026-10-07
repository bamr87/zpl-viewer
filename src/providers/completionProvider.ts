import * as vscode from 'vscode';
import { ZPL_COMMANDS, renderCommandMarkdown } from '../zplCommands';
import {
  EPL_COMMANDS,
  renderEplCommandMarkdown,
} from '../formats/epl/commands';
import { formatOfDocument } from '../config';

/**
 * Command completion for both printer languages. ZPL completes after a `^` or
 * `~` prefix; EPL completes the verb at the start of a line, which is the only
 * place a command can appear.
 */
export class LabelCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    return formatOfDocument(document) === 'epl'
      ? this.completeEpl(document, position)
      : this.completeZpl(document, position);
  }

  private completeZpl(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
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

  private completeEpl(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const line = document.lineAt(position.line).text.slice(0, position.character);
    const match = line.match(/^([A-Za-z?]{0,2})$/);
    if (!match) {
      return undefined;
    }
    const typed = match[1];
    const items: vscode.CompletionItem[] = [];
    for (const cmd of EPL_COMMANDS) {
      if (typed && !cmd.name.toUpperCase().startsWith(typed.toUpperCase())) {
        continue;
      }
      const item = new vscode.CompletionItem(
        cmd.name,
        vscode.CompletionItemKind.Function,
      );
      item.detail = cmd.title;
      item.documentation = new vscode.MarkdownString(
        renderEplCommandMarkdown(cmd),
      );
      item.sortText = `${cmd.category}-${cmd.name}`;
      item.range = new vscode.Range(
        position.translate(0, -typed.length),
        position,
      );
      if (cmd.parameters && cmd.parameters.length > 0) {
        const placeholders = cmd.parameters
          .map((p, i) =>
            p.name === 'data' ? `"\${${i + 1}:${p.name}}"` : `\${${i + 1}:${p.name}}`,
          )
          .join(',');
        item.insertText = new vscode.SnippetString(`${cmd.name}${placeholders}`);
      } else {
        item.insertText = cmd.name;
      }
      items.push(item);
    }
    return items;
  }
}

