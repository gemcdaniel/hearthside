import { describe, expect, it } from 'vitest';
import { MAX_NICKNAME_LENGTH, PRESET_NICKNAMES, validateNickname } from './nickname';

describe('validateNickname & PRESET_NICKNAMES', () => {
  it('accepts valid names and normalizes whitespace', () => {
    expect(validateNickname('Alex')).toEqual({ ok: true, normalized: 'Alex' });
    expect(validateNickname("  Mia   O'Connor  ")).toEqual({
      ok: true,
      normalized: "Mia O'Connor",
    });
    expect(validateNickname('Jean-Luc 7')).toEqual({ ok: true, normalized: 'Jean-Luc 7' });
    expect(validateNickname('Zoë-May')).toEqual({ ok: true, normalized: 'Zoë-May' });
    expect(validateNickname('1'.repeat(MAX_NICKNAME_LENGTH))).toEqual({
      ok: true,
      normalized: '1'.repeat(MAX_NICKNAME_LENGTH),
    });
  });

  it('rejects empty, over-long, markup, control characters, symbols, and URLs', () => {
    const invalid = [
      '',
      '   ',
      '1'.repeat(MAX_NICKNAME_LENGTH + 1),
      'https://example.com',
      'http://evil.net',
      'www.puzzle.org',
      'visit foo.com',
      '<script>alert(1)</script>',
      'Alex<B>',
      'Bad\nName',
      'Tab\tName',
      'Null\u0000Byte',
      'Name@home',
      'Player!One',
    ];

    for (const sample of invalid) {
      const res = validateNickname(sample);
      expect(res.ok, `expected "${sample}" to fail validation`).toBe(false);
    }
  });

  it('ensures every PRESET_NICKNAMES entry passes validateNickname cleanly', () => {
    expect(PRESET_NICKNAMES.length).toBeGreaterThanOrEqual(24);
    for (const preset of PRESET_NICKNAMES) {
      expect(validateNickname(preset)).toEqual({ ok: true, normalized: preset });
    }
  });
});
