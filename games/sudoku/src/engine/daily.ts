import { getStarterBank } from './starterBank';
import type { SudokuDifficulty, SudokuMode } from './types';

export const SUDOKU_ENGINE_VERSION = getStarterBank().engineVersion;
export const STARTER_OVERFLOW_SEED_BASE = 1_000_000;

const FNV1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const U64_MASK = 0xffffffffffffffffn;
const SAFE_53_MASK = 0x1fffffffffffffn;

export function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function hashFnv1a64(input: string): bigint {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV1A_64_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV1A_64_PRIME) & U64_MASK;
  }
  return hash;
}

/**
 * Computes a deterministic, 53-bit-safe positive integer seed (>= 1 and <= MAX_SAFE_INTEGER)
 * so JSON -> Go uint64 serialization stays lossless and identical across all family devices.
 */
export function computeDailySeed(
  dateStr: string,
  difficulty: SudokuDifficulty,
  engineVersion = SUDOKU_ENGINE_VERSION,
): number {
  const hash = hashFnv1a64(`${dateStr}:${difficulty}:${engineVersion}`);
  const masked = Number(hash & SAFE_53_MASK);
  return masked >= 1 ? masked : 1;
}

/**
 * Computes a deterministic 53-bit-safe seed above starter-bank range (1..50)
 * when a profile finishes every bundled starter puzzle in a difficulty tier.
 */
export function computeOverflowSeed(
  difficulty: SudokuDifficulty,
  overflowIndex: number,
  engineVersion = SUDOKU_ENGINE_VERSION,
): number {
  const normalizedIdx = Math.max(0, Math.floor(overflowIndex));
  const hash = hashFnv1a64(`overflow:${difficulty}:${normalizedIdx}:${engineVersion}`);
  const span = BigInt(Number.MAX_SAFE_INTEGER - STARTER_OVERFLOW_SEED_BASE);
  const masked = (hash & SAFE_53_MASK) % span;
  return Number(BigInt(STARTER_OVERFLOW_SEED_BASE) + masked);
}

export function dailySlotKey(dateStr: string, difficulty: SudokuDifficulty): string {
  return `daily:${dateStr}:${difficulty}`;
}

export function dailyCacheKey(
  dateStr: string,
  difficulty: SudokuDifficulty,
  engineVersion = SUDOKU_ENGINE_VERSION,
): string {
  return `daily:${dateStr}:${difficulty}:${engineVersion}`;
}

export interface ParsedSudokuLaunch {
  readonly mode: SudokuMode;
  readonly difficulty: SudokuDifficulty;
  readonly dailyDate?: string;
  readonly slot: string;
}

export function isSudokuDifficulty(value: string): value is SudokuDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

export function parseSudokuLaunchMode(
  mode?: string,
  todayDate = getLocalDateString(),
): ParsedSudokuLaunch {
  if (mode && mode.startsWith('daily:')) {
    const parts = mode.split(':');
    if (parts.length === 2) {
      const diffPart = parts[1] ?? 'easy';
      const difficulty = isSudokuDifficulty(diffPart) ? diffPart : 'easy';
      return {
        mode: 'daily',
        difficulty,
        dailyDate: todayDate,
        slot: dailySlotKey(todayDate, difficulty),
      };
    }
    if (parts.length === 3) {
      const datePart = parts[1] ?? '';
      const diffPart = parts[2] ?? 'easy';
      const dailyDate = isValidDateKey(datePart) ? datePart : todayDate;
      const difficulty = isSudokuDifficulty(diffPart) ? diffPart : 'easy';
      return {
        mode: 'daily',
        difficulty,
        dailyDate,
        slot: dailySlotKey(dailyDate, difficulty),
      };
    }
  }

  const difficulty = mode && isSudokuDifficulty(mode) ? mode : 'easy';
  return {
    mode: 'standard',
    difficulty,
    slot: difficulty,
  };
}
