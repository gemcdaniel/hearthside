import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOidcStartUrl,
  clearSessionHint,
  getAuthProviders,
  getMe,
  getPuzzleBank,
  getPuzzleById,
  hasSessionHint,
  loginWithPassword,
  logout,
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
});
