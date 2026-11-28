import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_KEEPALIVE_BYTES,
  MAX_RECORDS_BATCH_SIZE,
  buildOidcStartUrl,
  clearSessionHint,
  getAuthProviders,
  getMe,
  getPuzzleBank,
  getPuzzleById,
  hasSessionHint,
  loginWithPassword,
  logout,
  pullProfileSync,
  pushPreferences,
  pushRecordsBatch,
  pushSaveSlot,
} from './client';

describe('Hearthside same-origin API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearSessionHint();
  });

  it('short-circuits cleanly to offline without calling fetch when navigator.onLine is false', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('navigator', { onLine: false });

    const res = await getAuthProviders();
    expect(res).toEqual({ status: 'offline' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats HTML fallback or 404/502 on auth routes as unavailable without throwing', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    const htmlFallback = await getAuthProviders();
    expect(htmlFallback).toEqual({ status: 'unavailable' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'not_found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    expect(await getAuthProviders()).toEqual({ status: 'unavailable' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await getPuzzleBank('easy', 0, 20)).toEqual({ status: 'unavailable' });
  });

  it('handles 401 unauthorized, structured API errors, and session hint lifecycle', async () => {
    vi.stubGlobal('navigator', { onLine: true });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'bad pw' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const unauth = await getMe();
    expect(unauth).toEqual({ status: 'unauthorized' });
    expect(hasSessionHint()).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/me',
      expect.objectContaining({ credentials: 'same-origin' }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: {
              id: 'u1',
              householdId: 'h1',
              email: 'a@example.com',
              displayName: 'Alex',
              role: 'owner',
              createdAt: '2026-11-27T00:00:00.000Z',
            },
            household: { id: 'h1', name: 'Home', createdAt: '2026-11-27T00:00:00.000Z' },
            profiles: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const loggedIn = await loginWithPassword('a@example.com', 'secret-pw-123');
    expect(loggedIn.status).toBe('ok');
    expect(hasSessionHint()).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await logout();
    expect(hasSessionHint()).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'not_found', message: 'puzzle not found' } }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );
    expect(await getPuzzleById('missing')).toEqual({
      status: 'error',
      httpStatus: 404,
      code: 'not_found',
      message: 'puzzle not found',
    });
  });

  it('builds same-origin OIDC start URLs', () => {
    expect(buildOidcStartUrl()).toBe('/api/v1/auth/oidc/start');
    expect(buildOidcStartUrl({ bootstrap: true })).toBe('/api/v1/auth/oidc/start?bootstrap=1');
    expect(buildOidcStartUrl({ inviteToken: 'tok+1' })).toBe(
      '/api/v1/auth/oidc/start?invite=tok%2B1',
    );
  });

  it('handles sync pull, save conflict/too_large, chunked record batches, preferences, and 60 KiB keepalive guard', async () => {
    vi.stubGlobal('navigator', { onLine: true });

    // Pull with gameId and since query parameters
    const pullFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          profileId: 'rp-1',
          saves: [],
          records: [],
          preferences: null,
          serverTime: '2026-11-27T16:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', pullFetch);

    const pullRes = await pullProfileSync('rp-1', {
      gameId: 'sudoku',
      since: '2026-11-27T15:00:00Z',
    });
    expect(pullRes.status).toBe('ok');
    expect(pullFetch).toHaveBeenCalledWith(
      '/api/v1/sync/profiles/rp-1?gameId=sudoku&since=2026-11-27T15%3A00%3A00Z',
      expect.objectContaining({ credentials: 'same-origin' }),
    );

    // pushSaveSlot small keepalive -> passes keepalive: true; 409 conflict -> returns serverSave
    const conflictFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'sync_conflict', message: 'diverged' },
          serverSave: {
            profileId: 'rp-1',
            gameId: 'sudoku',
            slot: 'easy',
            schemaVersion: 1,
            revision: 3,
            puzzleId: 'p1',
            completed: false,
            deleted: false,
            elapsedMs: 4000,
            filledCells: 22,
            payload: '{}',
            clientUpdatedAt: '2026-11-27T15:59:00Z',
            updatedAt: '2026-11-27T15:59:01Z',
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', conflictFetch);

    const conflictRes = await pushSaveSlot(
      'rp-1',
      'sudoku',
      'easy',
      {
        schemaVersion: 1,
        baseRevision: 1,
        puzzleId: 'p1',
        completed: false,
        deleted: false,
        elapsedMs: 3000,
        filledCells: 20,
        payload: { board: 'small' },
        clientUpdatedAt: '2026-11-27T16:00:00Z',
      },
      { keepalive: true },
    );
    expect(conflictRes).toMatchObject({ ok: false, kind: 'conflict', serverSave: { revision: 3 } });
    expect(conflictFetch).toHaveBeenCalledWith(
      '/api/v1/sync/profiles/rp-1/saves/sudoku/easy',
      expect.objectContaining({ method: 'PUT', keepalive: true }),
    );

    // Oversized body (> MAX_KEEPALIVE_BYTES) drops keepalive: true and handles 413 cleanly
    const bigFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'payload_too_large', message: 'too big' } }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', bigFetch);

    const bigRes = await pushSaveSlot(
      'rp-1',
      'sudoku',
      'easy',
      {
        schemaVersion: 1,
        baseRevision: 0,
        puzzleId: 'p1',
        completed: false,
        deleted: false,
        elapsedMs: 100,
        filledCells: 1,
        payload: 'x'.repeat(MAX_KEEPALIVE_BYTES + 100),
        clientUpdatedAt: '2026-11-27T16:00:00Z',
      },
      { keepalive: true },
    );
    expect(bigRes).toEqual({ ok: false, kind: 'too_large', message: 'too big' });
    const bigInit = bigFetch.mock.calls[0]?.[1] as RequestInit;
    expect(bigInit.keepalive).toBeUndefined();

    // pushRecordsBatch chunks automatically into <= 500 items per request
    const items = Array.from({ length: MAX_RECORDS_BATCH_SIZE + 5 }, (_, idx) => ({
      gameId: 'sudoku',
      puzzleId: `puz-${idx}`,
      difficulty: 'easy',
      mode: 'standard' as const,
      status: 'completed' as const,
      elapsedMs: 10_000,
      hintsUsed: 0,
      startedAt: '2026-11-27T15:00:00Z',
      completedAt: '2026-11-27T15:01:00Z',
    }));
    const batchFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ appliedCount: 500, records: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ appliedCount: 5, records: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', batchFetch);

    const batchRes = await pushRecordsBatch('rp-1', items);
    expect(batchRes).toEqual({ status: 'ok', data: { appliedCount: 505, records: [] } });
    expect(batchFetch).toHaveBeenCalledTimes(2);

    // pushPreferences sends PUT JSON
    const prefFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          applied: true,
          preferences: {
            profileId: 'rp-1',
            theme: 'warm-hearthside',
            mode: 'dark',
            gameplay: { sudoku: { flagDuplicateConflicts: true, flagWrongValues: false } },
            updatedAt: '2026-11-27T16:00:00Z',
            serverUpdatedAt: '2026-11-27T16:00:01Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', prefFetch);

    const prefRes = await pushPreferences('rp-1', {
      theme: 'warm-hearthside',
      mode: 'dark',
      gameplay: { sudoku: { flagDuplicateConflicts: true, flagWrongValues: false } },
      updatedAt: '2026-11-27T16:00:00Z',
    });
    expect(prefRes.status).toBe('ok');
    expect(prefFetch).toHaveBeenCalledWith(
      '/api/v1/sync/profiles/rp-1/preferences',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
