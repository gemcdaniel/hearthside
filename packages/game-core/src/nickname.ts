export const MAX_NICKNAME_LENGTH = 24;

export type NicknameValidationResult =
  | { readonly ok: true; readonly normalized: string }
  | { readonly ok: false; readonly reason: string };

const FORBIDDEN_URL_FRAGMENTS = [
  'http://',
  'https://',
  '://',
  'www.',
  '.com',
  '.net',
  '.org',
  '.io',
  '.co',
  '.gg',
  '.tv',
  '.me',
  '.info',
  '.biz',
  '.edu',
  '.gov',
] as const;

const CONTROL_CHAR_RE = /\p{Cc}/u;
const ALLOWED_NICKNAME_RE = /^[\p{L}\p{N} '-]+$/u;

/**
 * Normalizes and validates a profile nickname under D38 child-safe guardrails:
 * trims whitespace, collapses internal whitespace runs, enforces 1..24 characters
 * of Unicode letters, digits, spaces, hyphens, or apostrophes, and rejects
 * control characters, markup brackets, or URLs.
 */
export function validateNickname(raw: string): NicknameValidationResult {
  if (CONTROL_CHAR_RE.test(raw)) {
    return { ok: false, reason: 'Nicknames cannot contain control characters.' };
  }

  if (raw.includes('<') || raw.includes('>')) {
    return { ok: false, reason: 'Nicknames cannot include < or > brackets.' };
  }

  const normalized = raw.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { ok: false, reason: 'Enter a nickname (1–24 characters).' };
  }

  const lower = normalized.toLowerCase();
  for (const fragment of FORBIDDEN_URL_FRAGMENTS) {
    if (lower.includes(fragment)) {
      return { ok: false, reason: 'Nicknames cannot contain website links or URLs.' };
    }
  }

  if (Array.from(normalized).length > MAX_NICKNAME_LENGTH) {
    return {
      ok: false,
      reason: `Nicknames must be ${MAX_NICKNAME_LENGTH} characters or fewer.`,
    };
  }

  if (!ALLOWED_NICKNAME_RE.test(normalized)) {
    return {
      ok: false,
      reason: "Use only letters, numbers, spaces, hyphens (-), or apostrophes (').",
    };
  }

  return { ok: true, normalized };
}

export const PRESET_NICKNAMES: readonly string[] = [
  'Cozy Fox',
  'Sunny Otter',
  'Pixel Panda',
  'Clever Owl',
  'Breezy Bear',
  'Maple Squirrel',
  'Happy Hedgehog',
  'Gentle Deer',
  'Starry Rabbit',
  'Swift Falcon',
  'Pebble Turtle',
  'Acorn Badger',
  'Misty Robin',
  'Clover Duck',
  'Bouncy Frog',
  'Golden Finch',
  'Velvet Moth',
  'River Beaver',
  'Cedar Wolf',
  'Willow Wren',
  'Pinecone Jay',
  'Meadow Mouse',
  'Sparkle Seal',
  'Honey Bee',
];
