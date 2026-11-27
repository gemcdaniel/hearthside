import type {
  AuthProvidersInfo,
  AuthSessionPayload,
  BankPageResponse,
  CreateInviteResponse,
  DailyAllResponse,
  DailySingleResponse,
  InviteMode,
  RemoteHouseholdProfile,
  RemoteInvite,
  RemotePuzzleRecord,
  ApiResult,
} from './types';

const DEFAULT_REQUEST_TIMEOUT_MS = 8000;
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
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly treat404AsUnavailable?: boolean;
  readonly timeoutMs?: number;
}

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

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  if (!isNavigatorOnline()) {
    return { status: 'offline' };
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

  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: bodyStr,
      signal: controller.signal,
    });

    if (response.status === 401) {
      clearSessionHint();
      return { status: 'unauthorized' };
    }

    if (
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504 ||
      (response.status === 404 && options.treat404AsUnavailable)
    ) {
      return { status: 'unavailable' };
    }

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return { status: 'unavailable' };
    }

    let parsed: unknown;
    try {
      parsed = (await response.json()) as unknown;
    } catch {
      return { status: 'unavailable' };
    }

    if (!response.ok) {
      const apiErr = extractApiError(parsed);
      return {
        status: 'error',
        httpStatus: response.status,
        code: apiErr?.code ?? 'api_error',
        message: apiErr?.message ?? `Request failed with status ${response.status}.`,
      };
    }

    return { status: 'ok', data: parsed as T };
  } catch {
    if (!isNavigatorOnline()) {
      return { status: 'offline' };
    }
    return { status: 'unavailable' };
  } finally {
    globalThis.clearTimeout(timer);
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
