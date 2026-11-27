import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionHint, setSessionHint } from '../api/client';
import {
  getServerSyncMeta,
  listServerBankPuzzles,
  putServerBankPuzzles,
  resetHearthsideDbForTests,
} from '../storage/hearthsideDb';
import { createShellPuzzleSync, prefetchDailyAndBank } from './puzzleSync';

describe('puzzleSync online top-up & offline fallback', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearSessionHint();
    await resetHearthsideDbForTests();
  });

  it('draws unplayed puzzles from serverPuzzleBank and triggers background top-up below low water', async () => {
    setSessionHint();
    vi.stubGlobal('navigator', { onLine: true });

    await putServerBankPuzzles(
      'easy',
      [
        {
          seq: 1,
          id: 'srv-1',
          seed: 1000001,
          engineVersion: '0.1.0-dev',
          difficulty: 'easy',
          techniquesRequired: ['naked_single'],
          clues: '0'.repeat(81),
          solution: '1'.repeat(81),
        },
        {
          seq: 2,
          id: 'srv-2',
          seed: 1000002,
          engineVersion: '0.1.0-dev',
          difficulty: 'easy',
          techniquesRequired: ['naked_single'],
          clues: '0'.repeat(81),
          solution: '2'.repeat(81),
        },
      ],
      2,
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          engineVersion: '0.1.0-dev',
          difficulty: 'easy',
          puzzles: [
            {
              seq: 3,
              id: 'srv-3',
              seed: 1000003,
              engineVersion: '0.1.0-dev',
              difficulty: 'easy',
              techniquesRequired: ['hidden_single'],
              clues: '0'.repeat(81),
              solution: '3'.repeat(81),
            },
          ],
          nextSeq: 3,
          hasMore: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const sync = createShellPuzzleSync(true);
    const picked = await sync.pickCachedBankPuzzle<{ id: string }>('easy', new Set(['srv-1']));
    expect(picked?.id).toBe('srv-2');

    // Background low-water top-up fetches afterSeq=2 -> stores srv-3 with cursor 3.
    await vi.waitFor(async () => {
      const cached = await listServerBankPuzzles('easy');
      expect(cached.some((p) => p.id === 'srv-3')).toBe(true);
    });
    expect(await getServerSyncMeta('easy')).toMatchObject({ lastSeq: 3 });
  });

  it('returns null cleanly when offline or signed out so WASM fallback takes over', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const syncSignedOut = createShellPuzzleSync(false);
    expect(await syncSignedOut.fetchDailyPuzzle('2026-11-27', 'easy')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    setSessionHint();
    const syncOffline = createShellPuzzleSync(true);
    expect(await syncOffline.fetchDailyPuzzle('2026-11-27', 'medium')).toBeNull();
    await prefetchDailyAndBank('profile-1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
