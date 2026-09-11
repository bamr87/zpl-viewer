import * as vscode from 'vscode';
import { findCommand, renderCommandMarkdown } from '../zplCommands';
import { tokenAt, tokenize } from '../zplParser';
import {
  findEplCommand,
  renderEplCommandMarkdown,
} from '../formats/epl/commands';
import { eplTokenAt, tokenizeEpl } from '../formats/epl/tokenizer';
import {
  describeSymbology,
  findSymbology,
  symbologyForZplCommand,
} from '../barcode/symbologies';
import {
  symbologyForEpl2dCode,
  symbologyForEplCode,
} from '../formats/epl/parser';
import { formatOfDocument } from '../config';

/**
 * Hover documentation for label commands. Barcode commands additionally get
 * the symbology's data rules, which is the detail people actually reach for
 * when a code will not scan.
 */
export class LabelHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    return formatOfDocument(document) === 'epl'
      ? this.hoverEpl(document, position)
      : this.hoverZpl(document, position);
  }

  private hoverZpl(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
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

    const sections = [renderCommandMarkdown(cmd)];
    const symbology = symbologyForZplCommand(token.command);
    if (symbology) {
      sections.push('---', describeSymbology(symbology));
    }

    const md = new vscode.MarkdownString(sections.join('\n\n'));
    md.isTrusted = true;
    md.supportHtml = false;
    const range = new vscode.Range(
      document.positionAt(token.start),
      document.positionAt(commandEnd),
    );
    return new vscode.Hover(md, range);
  }

  private hoverEpl(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const tokens = tokenizeEpl(document.getText());
    const offset = document.offsetAt(position);
    const token = eplTokenAt(tokens, offset);
    if (!token) {
      return undefined;
    }
    const commandEnd = token.start + token.name.length;
    if (offset >= commandEnd) {
      return undefined;
    }
    const cmd = findEplCommand(token.name);
    if (!cmd) {
      return undefined;
    }

    const sections = [renderEplCommandMarkdown(cmd)];
    const selector =
      token.name === 'B' ? token.args[3] : token.name === 'b' ? token.args[2] : undefined;
    if (selector) {
      const spec = findSymbology(
        token.name === 'B'
          ? symbologyForEplCode(selector)
          : symbologyForEpl2dCode(selector),
      );
      if (spec) {
        sections.push('---', describeSymbology(spec));
      }
    }

    const md = new vscode.MarkdownString(sections.join('\n\n'));
    md.isTrusted = true;
    md.supportHtml = false;
    const range = new vscode.Range(
      document.positionAt(token.start),
      document.positionAt(commandEnd),
    );
    return new vscode.Hover(md, range);
  }
}

