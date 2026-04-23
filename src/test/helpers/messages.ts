export interface RenderMessage {
  type: 'render';
  source: string;
  options: {
    dpmm: number;
    widthInches: number;
    heightInches: number;
    scale: number;
  };
  pageIndex: number;
}

export interface ExportMessage {
  type: 'export';
  format: 'png' | 'pdf';
  requestId: string;
  source: string;
  options: {
    dpmm: number;
    widthInches: number;
    heightInches: number;
  };
}

export function makeRenderMessage(
  source: string,
  overrides?: Partial<RenderMessage['options']> & { pageIndex?: number },
): RenderMessage {
  return {
    type: 'render',
    source,
    options: {
      dpmm: overrides?.dpmm ?? 8,
      widthInches: overrides?.widthInches ?? 4,
      heightInches: overrides?.heightInches ?? 6,
      scale: overrides?.scale ?? 1,
    },
    pageIndex: overrides?.pageIndex ?? 0,
  };
}

export function makeExportMessage(
  source: string,
  format: 'png' | 'pdf',
  requestId = 'test-request',
): ExportMessage {
  return {
    type: 'export',
    format,
    requestId,
    source,
    options: {
      dpmm: 8,
      widthInches: 4,
      heightInches: 6,
    },
  };
}
