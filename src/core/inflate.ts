/**
 * DEFLATE (RFC 1951) and zlib (RFC 1950) decompression in pure TypeScript.
 *
 * ZPL's `:Z64:` graphic encoding is zlib-compressed data in base64, and it is
 * what every modern label generator emits — but `zlib` is a Node built-in and
 * this layer also runs inside the preview webview, so the decompressor has to
 * come from here. It is small: a graphic field is at most a few hundred KB.
 */

/** Repeat lengths 257-285 and the extra bits each carries. */
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];
/** Order in which code-length code lengths appear in a dynamic block header. */
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/**
 * A canonical Huffman table in the "count of codes per bit length + symbols
 * sorted by code" form from RFC 1951 section 3.2.2, which decodes one bit at a
 * time without building a lookup tree.
 */
interface Huffman {
  counts: Uint16Array;
  symbols: Uint16Array;
}

function buildHuffman(lengths: Uint8Array): Huffman {
  const maxBits = 15;
  const counts = new Uint16Array(maxBits + 1);
  for (let i = 0; i < lengths.length; i += 1) {
    counts[lengths[i]] += 1;
  }
  counts[0] = 0;

  // Symbols are stored grouped by code length, ascending within each group, so
  // that a decoded (length, index) pair indexes straight into this array.
  const symbols = new Uint16Array(lengths.length);
  const next = new Uint16Array(maxBits + 1);
  let offset = 0;
  for (let bits = 1; bits <= maxBits; bits += 1) {
    next[bits] = offset;
    offset += counts[bits];
  }
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol];
    if (length > 0) {
      symbols[next[length]] = symbol;
      next[length] += 1;
    }
  }

  return { counts, symbols };
}

class BitReader {
  private bitBuffer = 0;
  private bitCount = 0;
  position = 0;

  constructor(private readonly input: Uint8Array) {}

  bits(need: number): number {
    while (this.bitCount < need) {
      if (this.position >= this.input.length) {
        throw new Error('Compressed data ended unexpectedly.');
      }
      this.bitBuffer |= this.input[this.position] << this.bitCount;
      this.position += 1;
      this.bitCount += 8;
    }
    const value = this.bitBuffer & ((1 << need) - 1);
    this.bitBuffer >>>= need;
    this.bitCount -= need;
    return value;
  }

  alignToByte(): void {
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  decode(table: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let length = 1; length <= 15; length += 1) {
      code |= this.bits(1);
      const count = table.counts[length];
      if (code - first < count) {
        return table.symbols[index + (code - first)];
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Invalid Huffman code in compressed data.');
  }
}

class ByteSink {
  private buffer: Uint8Array;
  length = 0;

  constructor(initial = 1024) {
    this.buffer = new Uint8Array(initial);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) {
      return;
    }
    let size = this.buffer.length * 2;
    while (size < this.length + extra) {
      size *= 2;
    }
    const grown = new Uint8Array(size);
    grown.set(this.buffer.subarray(0, this.length));
    this.buffer = grown;
  }

  push(byte: number): void {
    this.ensure(1);
    this.buffer[this.length] = byte;
    this.length += 1;
  }

  copyFromDistance(distance: number, length: number): void {
    if (distance > this.length) {
      throw new Error('Back-reference points before the start of the stream.');
    }
    this.ensure(length);
    let from = this.length - distance;
    for (let i = 0; i < length; i += 1) {
      this.buffer[this.length] = this.buffer[from];
      this.length += 1;
      from += 1;
    }
  }

  append(bytes: Uint8Array): void {
    this.ensure(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  toBytes(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

let fixedLiteralTable: Huffman | undefined;
let fixedDistanceTable: Huffman | undefined;

function fixedTables(): { literals: Huffman; distances: Huffman } {
  if (!fixedLiteralTable || !fixedDistanceTable) {
    const literalLengths = new Uint8Array(288);
    literalLengths.fill(8, 0, 144);
    literalLengths.fill(9, 144, 256);
    literalLengths.fill(7, 256, 280);
    literalLengths.fill(8, 280, 288);
    fixedLiteralTable = buildHuffman(literalLengths);
    fixedDistanceTable = buildHuffman(new Uint8Array(30).fill(5));
  }
  return { literals: fixedLiteralTable, distances: fixedDistanceTable };
}

function readDynamicTables(reader: BitReader): {
  literals: Huffman;
  distances: Huffman;
} {
  const literalCount = reader.bits(5) + 257;
  const distanceCount = reader.bits(5) + 1;
  const codeLengthCount = reader.bits(4) + 4;

  const codeLengthLengths = new Uint8Array(19);
  for (let i = 0; i < codeLengthCount; i += 1) {
    codeLengthLengths[CODE_LENGTH_ORDER[i]] = reader.bits(3);
  }
  const codeLengthTable = buildHuffman(codeLengthLengths);

  const lengths = new Uint8Array(literalCount + distanceCount);
  let index = 0;
  while (index < lengths.length) {
    const symbol = reader.decode(codeLengthTable);
    if (symbol < 16) {
      lengths[index] = symbol;
      index += 1;
    } else if (symbol === 16) {
      if (index === 0) {
        throw new Error('Code-length repeat with no previous length.');
      }
      const previous = lengths[index - 1];
      const repeat = 3 + reader.bits(2);
      for (let i = 0; i < repeat && index < lengths.length; i += 1) {
        lengths[index] = previous;
        index += 1;
      }
    } else if (symbol === 17) {
      index += 3 + reader.bits(3);
    } else {
      index += 11 + reader.bits(7);
    }
  }

  return {
    literals: buildHuffman(lengths.subarray(0, literalCount)),
    distances: buildHuffman(lengths.subarray(literalCount)),
  };
}

/** Decompresses a raw DEFLATE stream (no zlib or gzip wrapper). */
export function inflateRaw(input: Uint8Array): Uint8Array {
  const reader = new BitReader(input);
  const out = new ByteSink(Math.max(1024, input.length * 4));

  for (;;) {
    const final = reader.bits(1);
    const type = reader.bits(2);

    if (type === 0) {
      reader.alignToByte();
      if (reader.position + 4 > input.length) {
        throw new Error('Compressed data ended unexpectedly.');
      }
      const length = input[reader.position] | (input[reader.position + 1] << 8);
      reader.position += 4; // length + its one's complement
      if (reader.position + length > input.length) {
        throw new Error('Stored block runs past the end of the data.');
      }
      out.append(input.subarray(reader.position, reader.position + length));
      reader.position += length;
    } else if (type === 1 || type === 2) {
      const tables = type === 1 ? fixedTables() : readDynamicTables(reader);
      for (;;) {
        const symbol = reader.decode(tables.literals);
        if (symbol < 256) {
          out.push(symbol);
        } else if (symbol === 256) {
          break;
        } else {
          const lengthIndex = symbol - 257;
          if (lengthIndex >= LENGTH_BASE.length) {
            throw new Error(`Invalid length symbol ${symbol}.`);
          }
          const length =
            LENGTH_BASE[lengthIndex] + reader.bits(LENGTH_EXTRA[lengthIndex]);
          const distanceSymbol = reader.decode(tables.distances);
          if (distanceSymbol >= DIST_BASE.length) {
            throw new Error(`Invalid distance symbol ${distanceSymbol}.`);
          }
          const distance =
            DIST_BASE[distanceSymbol] + reader.bits(DIST_EXTRA[distanceSymbol]);
          out.copyFromDistance(distance, length);
        }
      }
    } else {
      throw new Error('Invalid DEFLATE block type.');
    }

    if (final) {
      break;
    }
  }

  return out.toBytes();
}

/**
 * Decompresses a zlib stream (RFC 1950). Falls back to treating the input as a
 * raw DEFLATE stream when the two-byte header is not a valid zlib header, which
 * is what some printer capture tools produce.
 */
export function inflate(input: Uint8Array): Uint8Array {
  if (input.length < 2) {
    throw new Error('Compressed data is too short to be a zlib stream.');
  }
  const cmf = input[0];
  const flg = input[1];
  const looksLikeZlib =
    (cmf & 0x0f) === 8 && ((cmf << 8) | flg) % 31 === 0 && (flg & 0x20) === 0;
  return inflateRaw(looksLikeZlib ? input.subarray(2) : input);
}
