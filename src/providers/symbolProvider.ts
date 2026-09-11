import * as vscode from 'vscode';
import { tokenize, ZplToken } from '../zplParser';
import { findCommand } from '../zplCommands';
import { tokenizeEpl } from '../formats/epl/tokenizer';
import { findEplCommand } from '../formats/epl/commands';
import { formatOfDocument } from '../config';

/**
 * Document outline. Each label is a symbol containing its notable children
 * (fields, barcodes, graphics), for both ZPL and EPL documents.
 */
export class LabelSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    return formatOfDocument(document) === 'epl'
      ? this.symbolsEpl(document)
      : this.symbolsZpl(document);
  }

  private symbolsZpl(document: vscode.TextDocument): vscode.DocumentSymbol[] {
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

  private symbolsEpl(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const tokens = tokenizeEpl(document.getText());
    const symbols: vscode.DocumentSymbol[] = [];
    let labelIndex = 0;
    let current: vscode.DocumentSymbol | undefined;
    let openStart: number | undefined;

    const startLabel = (start: number, end: number): void => {
      labelIndex += 1;
      const range = new vscode.Range(
        document.positionAt(start),
        document.positionAt(end),
      );
      current = new vscode.DocumentSymbol(
        `Label ${labelIndex}`,
        '',
        vscode.SymbolKind.Namespace,
        range,
        range,
      );
      openStart = start;
      symbols.push(current);
    };

    for (const token of tokens) {
      if (token.name === 'N') {
        startLabel(token.start, token.end);
        continue;
      }
      if (!current) {
        startLabel(token.start, token.end);
      }
      const range = new vscode.Range(
        document.positionAt(token.start),
        document.positionAt(token.end),
      );
      if (token.name === 'P' && current && openStart !== undefined) {
        current.range = new vscode.Range(
          document.positionAt(openStart),
          document.positionAt(token.end),
        );
        current = undefined;
        openStart = undefined;
        continue;
      }

      const cmd = findEplCommand(token.name);
      if (!cmd || !current) {
        continue;
      }
      let kind: vscode.SymbolKind | undefined;
      let name = '';
      if (token.name === 'A') {
        kind = vscode.SymbolKind.String;
        name = `A "${(token.data ?? '').slice(0, 40)}"`;
      } else if (token.name === 'B' || token.name === 'b') {
        kind = vscode.SymbolKind.Enum;
        name = `${token.name} "${(token.data ?? '').slice(0, 32)}"`;
      } else if (token.name === 'X' || token.name.startsWith('L') || token.name === 'GW') {
        kind = vscode.SymbolKind.Struct;
        name = `${token.name} ${token.raw.slice(0, 30)}`;
      }
      if (kind !== undefined && name) {
        current.children.push(
          new vscode.DocumentSymbol(name, cmd.title, kind, range, range),
        );
      }
    }

    return symbols;
  }
}

