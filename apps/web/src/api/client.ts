import type {
  CloudSaveRecord,
  DailyLeaderboardResponse,
  HouseholdDailySummary,
  LeaderboardDifficulty,
  LeaderboardScope,
  LeaderboardSubmissionPayload,
  LeaderboardSubmissionResult,
  PuzzleLeaderboardResponse,
  PuzzleRecordLogEntry,
  SyncedProfilePreferences,
} from '@hearthside/game-core';
import type {
  AuthProvidersInfo,
  AuthSessionPayload,
  BankPageResponse,
  CreateInviteResponse,
  DailyAllResponse,
  DailySingleResponse,
  InviteMode,
  PullProfileSyncResponse,
  PushPreferencesResponse,
  PushRecordsBatchItem,
  PushRecordsBatchResponse,
  PushSaveSlotRequest,
  PushSaveSlotResult,
  RemoteHouseholdProfile,
  RemoteInvite,
  RemotePuzzleRecord,
  SavePushResolution,
  SubmitLeaderboardResultOutcome,
  SyncApiClient,
  ApiResult,
} from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
export const MAX_KEEPALIVE_BYTES = 60_000;
export const MAX_RECORDS_BATCH_SIZE = 500;
const SESSION_HINT_KEY = 'hearthside:has-session';

export function hasSessionHint(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSessionHint(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {
    // Ignore storage quota/privacy restrictions.
  }
}

export function clearSessionHint(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Ignore storage cleanup restrictions.
  }
}

export function isNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') {
    return true;
  }
  return navigator.onLine !== false;
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly treat404AsUnavailable?: boolean;
  readonly timeoutMs?: number;
  readonly keepalive?: boolean;
}

type RawFetchOutcome =
  | { readonly kind: 'ok'; readonly payload: unknown }
  | { readonly kind: 'http_error'; readonly httpStatus: number; readonly payload: unknown }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'unavailable' };

function extractApiError(payload: unknown): { code: string; message: string } | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const errField = (payload as Record<string, unknown>).error;
  if (typeof errField === 'string') {
    return { code: errField, message: errField };
  }
  if (typeof errField === 'object' && errField !== null) {
    const rec = errField as Record<string, unknown>;
    const code = typeof rec.code === 'string' ? rec.code : 'api_error';
    const message = typeof rec.message === 'string' ? rec.message : 'Request failed.';
    return { code, message };
  }
  return null;
}

function canUseKeepalive(bodyStr: string | undefined, keepalive: boolean | undefined): boolean {
  if (!keepalive) {
    return false;
  }
  if (!bodyStr) {
    return true;
  }
  const byteLength = new TextEncoder().encode(bodyStr).byteLength;
  return byteLength <= MAX_KEEPALIVE_BYTES;
}

async function performJsonFetch(
  path: string,
  options: RequestOptions = {},
): Promise<RawFetchOutcome> {
  if (!isNavigatorOnline()) {
    return { kind: 'offline' };
  }

  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  const fetchInit: RequestInit = {
    method,
    credentials: 'same-origin',
    headers,
    body: bodyStr,
    signal: controller.signal,
    ...(canUseKeepalive(bodyStr, options.keepalive) ? { keepalive: true } : {}),
  };

  try {
    const response = await fetch(path, fetchInit);

    if (response.status === 401) {
      clearSessionHint();
      return { kind: 'unauthorized' };
    }

    if (
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504 ||
      (response.status === 404 && options.treat404AsUnavailable)
    ) {
      return { kind: 'unavailable' };
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return { kind: 'unavailable' };
    }

    let parsed: unknown;
    try {
      parsed = (await response.json()) as unknown;
    } catch {
      return { kind: 'unavailable' };
    }

    if (!response.ok) {
      return { kind: 'http_error', httpStatus: response.status, payload: parsed };
    }

    return { kind: 'ok', payload: parsed };
  } catch {
    if (!isNavigatorOnline()) {
      return { kind: 'offline' };
    }
    return { kind: 'unavailable' };
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const outcome = await performJsonFetch(path, options);
  switch (outcome.kind) {
    case 'ok':
      return { status: 'ok', data: outcome.payload as T };
    case 'http_error': {
      const apiErr = extractApiError(outcome.payload);
      return {
        status: 'error',
        httpStatus: outcome.httpStatus,
        code: apiErr?.code ?? 'api_error',
        message: apiErr?.message ?? `Request failed with status ${outcome.httpStatus}.`,
      };
    }
    case 'unauthorized':
      return { status: 'unauthorized' };
    case 'offline':
      return { status: 'offline' };
    case 'unavailable':
      return { status: 'unavailable' };
  }
}

export function getAuthProviders(): Promise<ApiResult<AuthProvidersInfo>> {
  return requestJson<AuthProvidersInfo>('/api/v1/auth/providers', {
    treat404AsUnavailable: true,
  });
}

export async function getMe(): Promise<ApiResult<AuthSessionPayload>> {
  const res = await requestJson<AuthSessionPayload>('/api/v1/auth/me', {
    treat404AsUnavailable: true,
  });
  if (res.status === 'ok') {
    setSessionHint();
  }
  return res;
}

export interface BootstrapHouseholdInput {
  readonly householdName: string;
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
  readonly avatarId?: string;
  readonly accentColor?: string;
  readonly bootstrapToken?: string;
}

export async function bootstrapHousehold(
  input: BootstrapHouseholdInput,
): Promise<ApiResult<AuthSessionPayload>> {
  const res = await requestJson<AuthSessionPayload>('/api/v1/auth/bootstrap', {
    method: 'POST',
    body: input,
    treat404AsUnavailable: true,
  });
  if (res.status === 'ok') {
    setSessionHint();
  }
  return res;
}

export interface RegisterInviteInput {
  readonly inviteToken: string;
  readonly householdName?: string;
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
  readonly avatarId?: string;
  readonly accentColor?: string;
}

export async function registerWithInvite(
  input: RegisterInviteInput,
): Promise<ApiResult<AuthSessionPayload>> {
  const res = await requestJson<AuthSessionPayload>('/api/v1/auth/register', {
    method: 'POST',
    body: input,
    treat404AsUnavailable: true,
  });
  if (res.status === 'ok') {
    setSessionHint();
  }
  return res;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<ApiResult<AuthSessionPayload>> {
  const res = await requestJson<AuthSessionPayload>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    treat404AsUnavailable: true,
  });
  if (res.status === 'ok') {
    setSessionHint();
  }
  return res;
}

export async function logout(): Promise<ApiResult<{ readonly ok: boolean }>> {
  clearSessionHint();
  return requestJson<{ readonly ok: boolean }>('/api/v1/auth/logout', {
    method: 'POST',
    treat404AsUnavailable: true,
  });
}

export function buildOidcStartUrl(options?: {
  readonly bootstrap?: boolean;
  readonly inviteToken?: string;
}): string {
  const params = new URLSearchParams();
  if (options?.bootstrap) {
    params.set('bootstrap', '1');
  } else if (options?.inviteToken) {
    params.set('invite', options.inviteToken);
  }
  const qs = params.toString();
  return qs ? `/api/v1/auth/oidc/start?${qs}` : '/api/v1/auth/oidc/start';
}

export async function listInvites(): Promise<ApiResult<readonly RemoteInvite[]>> {
  const res = await requestJson<{ readonly invites: readonly RemoteInvite[] }>('/api/v1/invites');
  if (res.status !== 'ok') {
    return res;
  }
  return { status: 'ok', data: res.data.invites };
}

export function createInvite(input: {
  readonly mode: InviteMode;
  readonly emailHint?: string;
  readonly expiresInHours?: number;
}): Promise<ApiResult<CreateInviteResponse>> {
  return requestJson<CreateInviteResponse>('/api/v1/invites', {
    method: 'POST',
    body: input,
  });
}

export function revokeInvite(inviteId: string): Promise<ApiResult<{ readonly ok: boolean }>> {
  return requestJson<{ readonly ok: boolean }>(`/api/v1/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
  });
}

export async function listHouseholdProfiles(): Promise<
  ApiResult<readonly RemoteHouseholdProfile[]>
> {
  const res = await requestJson<{ readonly profiles: readonly RemoteHouseholdProfile[] }>(
    '/api/v1/household/profiles',
  );
  if (res.status !== 'ok') {
    return res;
  }
  return { status: 'ok', data: res.data.profiles };
}

export async function createChildProfile(input: {
  readonly name: string;
  readonly avatarId: string;
  readonly accentColor: string;
}): Promise<ApiResult<RemoteHouseholdProfile>> {
  const res = await requestJson<{ readonly profile: RemoteHouseholdProfile }>(
    '/api/v1/household/profiles',
    {
      method: 'POST',
      body: { ...input, isChild: true },
    },
  );
  if (res.status !== 'ok') {
    return res;
  }
  return { status: 'ok', data: res.data.profile };
}

export async function updateHouseholdProfile(
  profileId: string,
  updates: {
    readonly name?: string;
    readonly avatarId?: string;
    readonly accentColor?: string;
    readonly friendsVisible?: boolean;
  },
): Promise<ApiResult<RemoteHouseholdProfile>> {
  const res = await requestJson<{ readonly profile: RemoteHouseholdProfile }>(
    `/api/v1/household/profiles/${encodeURIComponent(profileId)}`,
    {
      method: 'PATCH',
      body: updates,
    },
  );
  if (res.status !== 'ok') {
    return res;
  }
  return { status: 'ok', data: res.data.profile };
}

export function deleteHouseholdProfile(
  profileId: string,
): Promise<ApiResult<{ readonly ok: boolean }>> {
  return requestJson<{ readonly ok: boolean }>(
    `/api/v1/household/profiles/${encodeURIComponent(profileId)}`,
    { method: 'DELETE' },
  );
}

export function getDailyPuzzle(
  dateYYYYMMDD: string,
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<ApiResult<DailySingleResponse>> {
  const params = new URLSearchParams({ date: dateYYYYMMDD, difficulty });
  return requestJson<DailySingleResponse>(`/api/v1/puzzles/daily?${params.toString()}`);
}

export function getDailyPuzzlesAll(dateYYYYMMDD: string): Promise<ApiResult<DailyAllResponse>> {
  const params = new URLSearchParams({ date: dateYYYYMMDD });
  return requestJson<DailyAllResponse>(`/api/v1/puzzles/daily?${params.toString()}`);
}

export function getPuzzleBank(
  difficulty: 'easy' | 'medium' | 'hard',
  afterSeq = 0,
  limit = 25,
): Promise<ApiResult<BankPageResponse>> {
  const params = new URLSearchParams({
    difficulty,
    afterSeq: String(afterSeq),
    limit: String(limit),
  });
  return requestJson<BankPageResponse>(`/api/v1/puzzles/bank?${params.toString()}`);
}

export async function getPuzzleById(puzzleId: string): Promise<ApiResult<RemotePuzzleRecord>> {
  const res = await requestJson<{ readonly puzzle: RemotePuzzleRecord }>(
    `/api/v1/puzzles/${encodeURIComponent(puzzleId)}`,
  );
  if (res.status !== 'ok') {
    return res;
  }
  return { status: 'ok', data: res.data.puzzle };
}

export function pullProfileSync(
  remoteProfileId: string,
  options?: { readonly gameId?: string; readonly since?: string },
): Promise<ApiResult<PullProfileSyncResponse>> {
  const params = new URLSearchParams();
  if (options?.gameId) {
    params.set('gameId', options.gameId);
  }
  if (options?.since) {
    params.set('since', options.since);
  }
  const qs = params.toString();
  const basePath = `/api/v1/sync/profiles/${encodeURIComponent(remoteProfileId)}`;
  return requestJson<PullProfileSyncResponse>(qs ? `${basePath}?${qs}` : basePath);
}

export async function pushSaveSlot<TPayload = unknown>(
  remoteProfileId: string,
  gameId: string,
  slot: string,
  body: PushSaveSlotRequest<TPayload>,
  options?: { readonly keepalive?: boolean },
): Promise<PushSaveSlotResult<TPayload>> {
  const path = `/api/v1/sync/profiles/${encodeURIComponent(remoteProfileId)}/saves/${encodeURIComponent(gameId)}/${encodeURIComponent(slot)}`;
  const outcome = await performJsonFetch(path, {
    method: 'PUT',
    body,
    keepalive: options?.keepalive,
  });

  switch (outcome.kind) {
    case 'ok': {
      const rec = outcome.payload as {
        readonly resolution: SavePushResolution;
        readonly save: CloudSaveRecord<TPayload>;
      };
      return { ok: true, resolution: rec.resolution, save: rec.save };
    }
    case 'http_error': {
      if (
        outcome.httpStatus === 409 &&
        typeof outcome.payload === 'object' &&
        outcome.payload !== null
      ) {
        const conflictBody = outcome.payload as { readonly serverSave?: CloudSaveRecord<TPayload> };
        if (conflictBody.serverSave) {
          return { ok: false, kind: 'conflict', serverSave: conflictBody.serverSave };
        }
      }
      const apiErr = extractApiError(outcome.payload);
      if (outcome.httpStatus === 413) {
        return {
          ok: false,
          kind: 'too_large',
          message: apiErr?.message ?? 'Save payload exceeds server size limit.',
        };
      }
      return {
        ok: false,
        kind: 'error',
        message: apiErr?.message ?? `Save sync failed with status ${outcome.httpStatus}.`,
      };
    }
    case 'unauthorized':
      return { ok: false, kind: 'unauthorized' };
    case 'offline':
    case 'unavailable':
      return { ok: false, kind: 'offline' };
  }
}

export async function pushRecordsBatch(
  remoteProfileId: string,
  records: readonly PushRecordsBatchItem[],
  options?: { readonly keepalive?: boolean },
): Promise<ApiResult<PushRecordsBatchResponse>> {
  if (records.length === 0) {
    return { status: 'ok', data: { appliedCount: 0, records: [] } };
  }

  const path = `/api/v1/sync/profiles/${encodeURIComponent(remoteProfileId)}/records/batch`;
  let appliedCount = 0;
  const merged: PuzzleRecordLogEntry[] = [];

  for (let i = 0; i < records.length; i += MAX_RECORDS_BATCH_SIZE) {
    const chunk = records.slice(i, i + MAX_RECORDS_BATCH_SIZE);
    const res = await requestJson<PushRecordsBatchResponse>(path, {
      method: 'POST',
      body: { records: chunk },
      keepalive: options?.keepalive,
    });
    if (res.status !== 'ok') {
      return res;
    }
    appliedCount += res.data.appliedCount;
    merged.push(...res.data.records);
  }

  return {
    status: 'ok',
    data: {
      appliedCount,
      records: merged,
    },
  };
}

export function pushPreferences(
  remoteProfileId: string,
  prefs: SyncedProfilePreferences,
  options?: { readonly keepalive?: boolean },
): Promise<ApiResult<PushPreferencesResponse>> {
  const path = `/api/v1/sync/profiles/${encodeURIComponent(remoteProfileId)}/preferences`;
  return requestJson<PushPreferencesResponse>(path, {
    method: 'PUT',
    body: prefs,
    keepalive: options?.keepalive,
  });
}

export async function submitLeaderboardResult(
  payload: LeaderboardSubmissionPayload,
  options?: { readonly keepalive?: boolean },
): Promise<SubmitLeaderboardResultOutcome> {
  const outcome = await performJsonFetch('/api/v1/leaderboards/submissions', {
    method: 'POST',
    body: payload,
    keepalive: options?.keepalive,
  });

  switch (outcome.kind) {
    case 'ok':
      return { ok: true, result: outcome.payload as LeaderboardSubmissionResult };
    case 'http_error': {
      const apiErr = extractApiError(outcome.payload);
      if (outcome.httpStatus === 400 || outcome.httpStatus === 404 || outcome.httpStatus === 422) {
        return {
          ok: false,
          kind: 'rejected',
          code: apiErr?.code ?? 'rejected',
          message: apiErr?.message ?? `Submission rejected (${outcome.httpStatus}).`,
        };
      }
      return {
        ok: false,
        kind: 'error',
        message: apiErr?.message ?? `Leaderboard submission failed (${outcome.httpStatus}).`,
      };
    }
    case 'unauthorized':
      return { ok: false, kind: 'unauthorized' };
    case 'offline':
    case 'unavailable':
      return { ok: false, kind: 'offline' };
  }
}

export function getDailyLeaderboard(options: {
  readonly date?: string;
  readonly difficulty: LeaderboardDifficulty;
  readonly scope?: LeaderboardScope;
  readonly noHintsOnly?: boolean;
}): Promise<ApiResult<DailyLeaderboardResponse>> {
  const params = new URLSearchParams({ difficulty: options.difficulty });
  if (options.date) {
    params.set('date', options.date);
  }
  if (options.scope) {
    params.set('scope', options.scope);
  }
  if (options.noHintsOnly !== undefined) {
    params.set('noHintsOnly', options.noHintsOnly ? 'true' : 'false');
  }
  return requestJson<DailyLeaderboardResponse>(`/api/v1/leaderboards/daily?${params.toString()}`);
}

export function getPuzzleLeaderboard(
  puzzleId: string,
  options?: {
    readonly scope?: LeaderboardScope;
    readonly noHintsOnly?: boolean;
  },
): Promise<ApiResult<PuzzleLeaderboardResponse>> {
  const params = new URLSearchParams();
  if (options?.scope) {
    params.set('scope', options.scope);
  }
  if (options?.noHintsOnly !== undefined) {
    params.set('noHintsOnly', options.noHintsOnly ? 'true' : 'false');
  }
  const qs = params.toString();
  const basePath = `/api/v1/leaderboards/puzzles/${encodeURIComponent(puzzleId)}`;
  return requestJson<PuzzleLeaderboardResponse>(qs ? `${basePath}?${qs}` : basePath);
}

export function getHouseholdDailySummary(date?: string): Promise<ApiResult<HouseholdDailySummary>> {
  const params = new URLSearchParams();
  if (date) {
    params.set('date', date);
  }
  const qs = params.toString();
  return requestJson<HouseholdDailySummary>(
    qs
      ? `/api/v1/leaderboards/household/daily-summary?${qs}`
      : '/api/v1/leaderboards/household/daily-summary',
  );
}

export const defaultSyncApiClient: SyncApiClient = {
  pullProfileSync,
  pushSaveSlot,
  pushRecordsBatch,
  pushPreferences,
  submitLeaderboardResult,
};
