import * as vscode from 'vscode';
import { tokenize, ZplToken } from '../zplParser';
import { findCommand } from '../zplCommands';

/**
 * Provides a document outline. Each `^XA` … `^XZ` block is a label symbol
 * containing its notable children (fields, barcodes, graphics).
 */
export class ZplSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    const tokens = tokenize(document.getText());
    const symbols: vscode.DocumentSymbol[] = [];

    let labelIndex = 0;
    let current: vscode.DocumentSymbol | undefined;
    let currentOpen: ZplToken | undefined;

    for (const token of tokens) {
      if (token.command === '^XA') {
        labelIndex += 1;
        currentOpen = token;
        const range = new vscode.Range(
          document.positionAt(token.start),
          document.positionAt(token.end),
        );
        current = new vscode.DocumentSymbol(
          `Label ${labelIndex}`,
          '',
          vscode.SymbolKind.Namespace,
          range,
          range,
        );
        symbols.push(current);
        continue;
      }

      if (token.command === '^XZ' && current && currentOpen) {
        const full = new vscode.Range(
          document.positionAt(currentOpen.start),
          document.positionAt(token.end),
        );
        current.range = full;
        current = undefined;
        currentOpen = undefined;
        continue;
      }

      if (!current) {
        continue;
      }

      const cmd = findCommand(token.command);
      if (!cmd) {
        continue;
      }

      const range = new vscode.Range(
        document.positionAt(token.start),
        document.positionAt(token.end),
      );

      let kind: vscode.SymbolKind | undefined;
      let detail = '';
      let name = '';
      switch (cmd.category) {
        case 'field':
          if (cmd.name === 'FO' || cmd.name === 'FT') {
            kind = vscode.SymbolKind.Property;
            name = `${token.command}(${token.args.slice(0, 2).join(',')})`;
            detail = cmd.title;
          } else if (cmd.name === 'FD') {
            kind = vscode.SymbolKind.String;
            name = `^FD "${(token.raw || '').slice(0, 40)}"`;
            detail = 'Field data';
          }
          break;
        case 'barcode':
          kind = vscode.SymbolKind.Enum;
          name = `${token.command} ${cmd.title}`;
          detail = token.raw.slice(0, 40);
          break;
        case 'graphic':
          kind = vscode.SymbolKind.Struct;
          name = `${token.command} ${cmd.title}`;
          detail = token.raw.slice(0, 40);
          break;
        default:
          kind = undefined;
      }

      if (kind !== undefined && name) {
        current.children.push(
          new vscode.DocumentSymbol(name, detail, kind, range, range),
        );
      }
    }

    return symbols;
  }
}
