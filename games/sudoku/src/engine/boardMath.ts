export const GRID_SIZE = 9;
export const BOX_SIZE = 3;
export const BOARD_SIZE = GRID_SIZE * GRID_SIZE;
/** 9-bit candidate bitmask holding bits 1<<1 through 1<<9 (0b11_1111_1110 = 0x3FE). */
export const ALL_DIGITS_MASK = 0x3fe;

export const ROW_OF: readonly number[] = Array.from({ length: BOARD_SIZE }, (_, idx) =>
  Math.floor(idx / GRID_SIZE),
);

export const COL_OF: readonly number[] = Array.from(
  { length: BOARD_SIZE },
  (_, idx) => idx % GRID_SIZE,
);

export const BOX_OF: readonly number[] = Array.from({ length: BOARD_SIZE }, (_, idx) => {
  const r = Math.floor(idx / GRID_SIZE);
  const c = idx % GRID_SIZE;
  return Math.floor(r / BOX_SIZE) * BOX_SIZE + Math.floor(c / BOX_SIZE);
});

export const ROWS: readonly (readonly number[])[] = Array.from({ length: GRID_SIZE }, (_, r) =>
  Array.from({ length: GRID_SIZE }, (__, c) => r * GRID_SIZE + c),
);

export const COLS: readonly (readonly number[])[] = Array.from({ length: GRID_SIZE }, (_, c) =>
  Array.from({ length: GRID_SIZE }, (__, r) => r * GRID_SIZE + c),
);

export const BOXES: readonly (readonly number[])[] = Array.from({ length: GRID_SIZE }, (_, b) => {
  const boxRow = Math.floor(b / BOX_SIZE) * BOX_SIZE;
  const boxCol = (b % BOX_SIZE) * BOX_SIZE;
  const cells: number[] = [];
  for (let dr = 0; dr < BOX_SIZE; dr += 1) {
    for (let dc = 0; dc < BOX_SIZE; dc += 1) {
      cells.push((boxRow + dr) * GRID_SIZE + (boxCol + dc));
    }
  }
  return cells;
});

export const PEERS: readonly (readonly number[])[] = Array.from({ length: BOARD_SIZE }, (_, idx) => {
  const peerSet = new Set<number>();
  const row = ROW_OF[idx] ?? 0;
  const col = COL_OF[idx] ?? 0;
  const box = BOX_OF[idx] ?? 0;

  for (const c of ROWS[row] ?? []) {
    if (c !== idx) peerSet.add(c);
  }
  for (const r of COLS[col] ?? []) {
    if (r !== idx) peerSet.add(r);
  }
  for (const b of BOXES[box] ?? []) {
    if (b !== idx) peerSet.add(b);
  }

  return Array.from(peerSet).sort((a, b) => a - b);
});

export function isValidCellIndex(cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < BOARD_SIZE;
}

export function isValidDigit(digit: number): boolean {
  return Number.isInteger(digit) && digit >= 1 && digit <= GRID_SIZE;
}

export function digitBit(digit: number): number {
  if (!isValidDigit(digit)) {
    return 0;
  }
  return 1 << digit;
}

export function hasDigitBit(mask: number, digit: number): boolean {
  const bit = digitBit(digit);
  return bit !== 0 && (mask & bit) !== 0;
}

export function maskToDigits(mask: number): number[] {
  const active = mask & ALL_DIGITS_MASK;
  const digits: number[] = [];
  for (let d = 1; d <= GRID_SIZE; d += 1) {
    if ((active & (1 << d)) !== 0) {
      digits.push(d);
    }
  }
  return digits;
}

export function digitsToMask(digits: readonly number[]): number {
  let mask = 0;
  for (const d of digits) {
    mask |= digitBit(d);
  }
  return mask;
}

export function parseBoardDigits(boardStr: string, label = 'board'): number[] {
  const trimmed = boardStr.trim();
  if (trimmed.length !== BOARD_SIZE) {
    throw new Error(`Invalid ${label} length: expected ${BOARD_SIZE}, got ${trimmed.length}.`);
  }

  const out: number[] = [];
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const ch = trimmed.charAt(i);
    if (ch === '0' || ch === '.') {
      out.push(0);
    } else if (ch >= '1' && ch <= '9') {
      out.push(Number(ch));
    } else {
      throw new Error(`Invalid ${label} character "${ch}" at cell ${i}.`);
    }
  }
  return out;
}
