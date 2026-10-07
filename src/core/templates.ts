/**
 * Starter label templates.
 *
 * These exist so "create a label" is a two-click operation instead of a blank
 * file and a manual. Every template is valid on its own and every one that
 * carries `{{placeholders}}` is ready to merge against a data source.
 */

import { LabelFormatId } from './formats';

export interface LabelTemplate {
  id: string;
  label: string;
  description: string;
  format: LabelFormatId;
  widthInches: number;
  heightInches: number;
  /** dpmm the coordinates were authored for. */
  dpmm: number;
  /** Placeholder fields the template expects from a data source. */
  placeholders: string[];
  source: string;
}

export const LABEL_TEMPLATES: LabelTemplate[] = [
  {
    id: 'zpl-shipping-4x6',
    label: 'Shipping label (4x6)',
    description: 'From/to blocks, tracking Code 128 and a QR tracking link.',
    format: 'zpl',
    widthInches: 4,
    heightInches: 6,
    dpmm: 8,
    placeholders: [
      'sender',
      'senderStreet',
      'senderCity',
      'recipient',
      'recipientStreet',
      'recipientCity',
      'tracking',
    ],
    source: [
      '^XA',
      '^PW812',
      '^LL1218',
      '^CF0,32',
      '^FO30,30^FDFROM:^FS',
      '^CF0,26',
      '^FO30,75^FD{{sender}}^FS',
      '^FO30,110^FD{{senderStreet}}^FS',
      '^FO30,145^FD{{senderCity}}^FS',
      '^FO30,190^GB750,3,3^FS',
      '^CF0,40',
      '^FO30,220^FDTO:^FS',
      '^CF0,34',
      '^FO30,275^FD{{recipient}}^FS',
      '^FO30,320^FD{{recipientStreet}}^FS',
      '^FO30,365^FD{{recipientCity}}^FS',
      '^FO30,430^GB750,3,3^FS',
      '^FO40,470^BY3,3,140',
      '^BCN,140,Y,N,N',
      '^FD{{tracking}}^FS',
      '^FO560,700^BQN,2,6',
      '^FDQA,https://track.example.com/{{tracking}}^FS',
      '^XZ',
      '',
    ].join('\n'),
  },
  {
    id: 'zpl-product-4x2',
    label: 'Product label (4x2)',
    description: 'Product name, SKU, price and a Code 128 SKU barcode.',
    format: 'zpl',
    widthInches: 4,
    heightInches: 2,
    dpmm: 8,
    placeholders: ['name', 'sku', 'price'],
    source: [
      '^XA',
      '^PW812',
      '^LL406',
      '^CF0,44',
      '^FO20,20^FD{{name}}^FS',
      '^CF0,24',
      '^FO20,80^FDSKU: {{sku}}^FS',
      '^FO20,112^FDPrice: {{price}}^FS',
      '^FO20,150^BY2,3,80',
      '^BCN,80,Y,N,N',
      '^FD{{sku}}^FS',
      '^XZ',
      '',
    ].join('\n'),
  },
  {
    id: 'zpl-asset-2x1',
    label: 'Asset tag (2x1)',
    description: 'Asset id in Code 39 with an owner line — IT and facilities.',
    format: 'zpl',
    widthInches: 2,
    heightInches: 1,
    dpmm: 8,
    placeholders: ['assetId', 'owner'],
    source: [
      '^XA',
      '^PW406',
      '^LL203',
      '^CF0,28',
      '^FO20,12^FD{{owner}}^FS',
      '^FO20,50^BY2,3,70',
      '^B3N,N,70,Y,N',
      '^FD{{assetId}}^FS',
      '^XZ',
      '',
    ].join('\n'),
  },
  {
    id: 'zpl-shelf-2x1',
    label: 'Shelf/retail label (2x1)',
    description: 'Retail shelf edge label with an EAN-13 article number.',
    format: 'zpl',
    widthInches: 2,
    heightInches: 1,
    dpmm: 8,
    placeholders: ['product', 'ean', 'price'],
    source: [
      '^XA',
      '^PW406',
      '^LL203',
      '^CF0,26',
      '^FO16,10^FD{{product}}^FS',
      '^CF0,40',
      '^FO16,42^FD{{price}}^FS',
      '^FO180,40^BY2,3,60',
      '^BEN,60,Y,N',
      '^FD{{ean}}^FS',
      '^XZ',
      '',
    ].join('\n'),
  },
  {
    id: 'zpl-gs1-carton-4x6',
    label: 'GS1 carton label (4x6)',
    description: 'GS1-128 shipping container label with SSCC and GTIN.',
    format: 'zpl',
    widthInches: 4,
    heightInches: 6,
    dpmm: 8,
    placeholders: ['shipTo', 'gtin', 'lot', 'sscc'],
    source: [
      '^XA',
      '^PW812',
      '^LL1218',
      '^CF0,30',
      '^FO30,30^FDSHIP TO: {{shipTo}}^FS',
      '^FO30,80^GB750,3,3^FS',
      '^CF0,26',
      '^FO30,110^FDGTIN (01): {{gtin}}^FS',
      '^FO30,150^FDLOT (10): {{lot}}^FS',
      '^FO30,200^BY3,3,120',
      '^BCN,120,Y,N,N',
      '^FD>;>8{{gtin}}^FS',
      '^FO30,420^GB750,3,3^FS',
      '^CF0,30',
      '^FO30,450^FDSSCC (00)^FS',
      '^FO30,500^BY4,3,180',
      '^BCN,180,Y,N,N',
      '^FD>;{{sscc}}^FS',
      '^XZ',
      '',
    ].join('\n'),
  },
  {
    id: 'epl-basic-4x2',
    label: 'EPL basic label (4x2)',
    description: 'Text plus a Code 128 barcode in EPL2.',
    format: 'epl',
    widthInches: 4,
    heightInches: 2,
    dpmm: 8,
    placeholders: ['title', 'code'],
    source: [
      'N',
      'q812',
      'Q406,24',
      'A20,20,0,4,1,1,N,"{{title}}"',
      'A20,70,0,3,1,1,N,"CODE: {{code}}"',
      'B20,110,0,3,2,6,100,B,"{{code}}"',
      'P1',
      '',
    ].join('\n'),
  },
  {
    id: 'epl-shipping-4x6',
    label: 'EPL shipping label (4x6)',
    description: 'Address blocks and a tracking barcode in EPL2.',
    format: 'epl',
    widthInches: 4,
    heightInches: 6,
    dpmm: 8,
    placeholders: ['recipient', 'street', 'city', 'tracking'],
    source: [
      'N',
      'q812',
      'Q1218,24',
      'A30,30,0,4,1,1,N,"SHIP TO"',
      'A30,90,0,4,1,1,N,"{{recipient}}"',
      'A30,140,0,3,1,1,N,"{{street}}"',
      'A30,180,0,3,1,1,N,"{{city}}"',
      'LO30,240,750,3',
      'B40,280,0,3,3,9,140,B,"{{tracking}}"',
      'b400,700,Q,m2,s6,"https://track.example.com/{{tracking}}"',
      'P1',
      '',
    ].join('\n'),
  },
];

export function findTemplate(id: string): LabelTemplate | undefined {
  return LABEL_TEMPLATES.find((template) => template.id === id);
}

export function templatesForFormat(format: LabelFormatId): LabelTemplate[] {
  return LABEL_TEMPLATES.filter((template) => template.format === format);
}

/**
 * Replaces `{{placeholders}}` with readable sample values so the template can
 * be previewed immediately, before any data source is attached.
 */
export function fillTemplateSample(template: LabelTemplate): string {
  const samples: Record<string, string> = {
    sender: 'Acme Shipping Co.',
    senderStreet: '123 Main Street',
    senderCity: 'Springfield, IL 62701',
    recipient: 'Jane Doe',
    recipientStreet: '456 Oak Avenue',
    recipientCity: 'Lincoln, NE 68502',
    street: '456 Oak Avenue',
    city: 'Lincoln, NE 68502',
    tracking: '1Z999AA10123456784',
    name: 'Widget Deluxe',
    product: 'Widget Deluxe',
    sku: 'WD-001-RED',
    code: 'WD-001-RED',
    price: '$19.99',
    assetId: 'ASSET-0042',
    owner: 'IT Department',
    ean: '590123412345',
    title: 'RECEIVING',
    shipTo: 'Acme Distribution Center',
    gtin: '09501101020917',
    lot: 'LOT-24A',
    sscc: '00095011010209171',
  };
  return template.source.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, name: string) =>
    samples[name] ?? match,
  );
}
