/**
 * Merge engine: expands one label template over every row of a dataset, the
 * way a mail merge expands a letter. The output is an ordinary label document
 * — so it previews, analyzes, exports and deploys through exactly the same
 * paths as a hand-written one.
 */

import { LabelFormatId } from '../core/formats';
import { Dataset, resolveField } from './dataset';
import {
  KNOWN_FILTERS,
  findPlaceholders,
  renderTemplate,
  templateFields,
} from './template';

export interface MergeOptions {
  format: LabelFormatId;
  /** Stop after this many rows (0 or undefined = no limit). */
  maxRows?: number;
  /** Index of the first row to merge (default 0). */
  startRow?: number;
  onMissing?: 'empty' | 'keep';
  /** Text placed between consecutive labels (default newline). */
  separator?: string;
}

export interface MergeResult {
  text: string;
  labelCount: number;
  /** Placeholder names that no row could resolve. */
  missingFields: string[];
  warnings: string[];
  /** True when `maxRows` cut the run short. */
  truncated: boolean;
}

export interface MappingReport {
  matched: { placeholder: string; field: string }[];
  /** Placeholders with no matching dataset field. */
  unresolved: string[];
  /** Dataset fields no placeholder references. */
  unusedFields: string[];
  /** Filters used in the template that the engine does not implement. */
  unknownFilters: string[];
}

/**
 * Compares a template against a dataset before merging thousands of labels —
 * a typo in a placeholder is otherwise only visible as a blank field on the
 * printed roll.
 */
export function analyzeMapping(
  template: string,
  dataset: Dataset,
): MappingReport {
  const fieldNames = dataset.fields.map((f) => f.name);
  const probe: Record<string, string> = {};
  for (const name of fieldNames) {
    probe[name] = '';
  }

  const matched: { placeholder: string; field: string }[] = [];
  const unresolved: string[] = [];
  const used = new Set<string>();

  for (const name of templateFields(template)) {
    const field =
      resolveField(probe, name) === undefined
        ? undefined
        : fieldNames.find(
            (candidate) => resolveField({ [candidate]: '' }, name) !== undefined,
          );
    if (field === undefined) {
      unresolved.push(name);
      continue;
    }
    matched.push({ placeholder: name, field });
    used.add(field);
  }

  const unknownFilters = new Set<string>();
  for (const placeholder of findPlaceholders(template)) {
    for (const filter of placeholder.filters) {
      if (!(KNOWN_FILTERS as readonly string[]).includes(filter.name)) {
        unknownFilters.add(filter.name);
      }
    }
  }

  return {
    matched,
    unresolved,
    unusedFields: fieldNames.filter((name) => !used.has(name)),
    unknownFilters: [...unknownFilters],
  };
}

export function mergeDataset(
  template: string,
  dataset: Dataset,
  options: MergeOptions,
): MergeResult {
  const separator = options.separator ?? '\n';
  const startRow = Math.max(0, options.startRow ?? 0);
  const limit =
    options.maxRows && options.maxRows > 0 ? options.maxRows : Number.MAX_SAFE_INTEGER;
  const selected = dataset.rows.slice(startRow, startRow + limit);
  const truncated = dataset.rows.length - startRow > selected.length;

  const warnings: string[] = [];
  const missing = new Set<string>();
  const chunks: string[] = [];

  if (templateFields(template).length === 0) {
    warnings.push(
      'Template contains no {{placeholders}}; every label will be identical.',
    );
  }

  for (const row of selected) {
    const rendered = renderTemplate(template, row, {
      format: options.format,
      onMissing: options.onMissing,
    });
    rendered.missing.forEach((name) => missing.add(name));
    chunks.push(rendered.text.replace(/\s+$/, ''));
  }

  if (missing.size > 0) {
    warnings.push(
      `No value for ${[...missing].map((f) => `{{${f}}}`).join(', ')}; those fields merged as empty.`,
    );
  }
  if (truncated) {
    warnings.push(
      `Only the first ${selected.length} of ${dataset.rows.length - startRow} rows were merged.`,
    );
  }

  return {
    text: chunks.length > 0 ? chunks.join(separator) + '\n' : '',
    labelCount: chunks.length,
    missingFields: [...missing],
    warnings,
    truncated,
  };
}

/** Markdown summary of a mapping check, shown before a large merge. */
export function mappingToMarkdown(
  report: MappingReport,
  dataset: Dataset,
): string {
  const lines: string[] = [
    `# Merge mapping: ${dataset.name}`,
    '',
    `- Rows available: ${dataset.rows.length}`,
    `- Placeholders resolved: ${report.matched.length}`,
    `- Placeholders unresolved: ${report.unresolved.length}`,
    '',
  ];
  if (report.matched.length > 0) {
    lines.push('## Resolved', '', '| Placeholder | Data field |', '|---|---|');
    for (const entry of report.matched) {
      lines.push(`| \`{{${entry.placeholder}}}\` | \`${entry.field}\` |`);
    }
    lines.push('');
  }
  if (report.unresolved.length > 0) {
    lines.push('## Unresolved placeholders', '');
    for (const name of report.unresolved) {
      lines.push(`- \`{{${name}}}\` — no matching column`);
    }
    lines.push('');
  }
  if (report.unknownFilters.length > 0) {
    lines.push('## Unknown filters', '');
    for (const name of report.unknownFilters) {
      lines.push(`- \`${name}\` — value passes through unchanged`);
    }
    lines.push('');
  }
  if (report.unusedFields.length > 0) {
    lines.push(
      '## Unused data fields',
      '',
      report.unusedFields.map((f) => `\`${f}\``).join(', '),
      '',
    );
  }
  return lines.join('\n');
}
