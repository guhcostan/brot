/**
 * A small QR Code encoder (ISO/IEC 18004) for the pairing payload: byte mode, error correction level M,
 * versions 1 to 10 (up to 213 bytes). It follows the structure of Project Nayuki's reference encoder.
 * Returns the module grid, `true` for dark, without the quiet zone.
 */

const MAX_VERSION = 10;
/** Error correction codewords per block, level M, indexed by version. */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
/** Error correction blocks, level M, indexed by version. */
const ECC_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format bits for level M. */
const ECL_FORMAT_BITS = 0;

const bit = (value: number, index: number) => ((value >>> index) & 1) !== 0;

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version]! * ECC_BLOCKS[version]!;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const value of data) {
    const factor = value ^ result.shift()!;
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index]! ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function interleave(data: number[], version: number): number[] {
  const blocks = ECC_BLOCKS[version]!;
  const eccLength = ECC_PER_BLOCK[version]!;
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i += 1) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    all.push([...block, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < all[0]!.length; i += 1) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

function maskHit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Rules 1, 2 and 4 of the standard's penalty score; enough to steer away from bad masks. */
function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;
  for (let y = 0; y < size; y += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let x = 1; x < size; x += 1) {
        const same = horizontal ? grid[y]![x] === grid[y]![x - 1] : grid[x]![y] === grid[x - 1]![y];
        if (same) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = grid[y]![x];
      if (color === grid[y]![x + 1] && color === grid[y + 1]![x] && color === grid[y + 1]![x + 1]) score += 3;
    }
  }
  const dark = grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export function encodeQr(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  for (; version <= MAX_VERSION; version += 1) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new Error('Text is too long for a QR code');

  const capacity = dataCodewords(version) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const value of bytes) push(value, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, value) => (acc << 1) | value, 0));
  const codewords = interleave(data, version);

  const size = version * 4 + 17;
  const grid: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    grid[y]![x] = dark;
    reserved[y]![x] = true;
  };

  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPositions(version);
  positions.forEach((ay, i) => {
    positions.forEach((ax, j) => {
      const last = positions.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });

  const drawFormat = (mask: number) => {
    const value = (ECL_FORMAT_BITS << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((value << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i += 1) set(8, i, bit(format, i));
    set(8, 7, bit(format, 6));
    set(8, 8, bit(format, 7));
    set(7, 8, bit(format, 8));
    for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(format, i));
    for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(format, i));
    for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(format, i));
    set(8, size - 8, true);
  };
  drawFormat(0);

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const value = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(value, i));
      set(b, a, bit(value, i));
    }
  }

  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!reserved[y]![x] && index < codewords.length * 8) {
          grid[y]![x] = bit(codewords[index >>> 3]!, 7 - (index & 7));
          index += 1;
        }
      }
    }
  }

  const masked = (mask: number) => grid.map((row, y) => row.map((dark, x) => (!reserved[y]![x] && maskHit(mask, x, y) ? !dark : dark)));
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask += 1) {
    drawFormat(mask);
    const score = penalty(masked(mask));
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
  }
  drawFormat(best);
  return masked(best);
}

/** The grid as one SVG path of unit squares, for a viewBox of `size + 2 * margin`. */
export function qrPath(grid: boolean[][], margin = 4): string {
  const parts: string[] = [];
  grid.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    });
  });
  return parts.join('');
}
