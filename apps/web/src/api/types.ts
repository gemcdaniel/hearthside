import type {
  CloudSaveRecord,
  LeaderboardSubmissionPayload,
  LeaderboardSubmissionResult,
  PuzzleRecordLogEntry,
  SyncedProfilePreferences,
} from '@hearthside/game-core';

export type ApiResult<T> =
  | { readonly status: 'ok'; readonly data: T }
  | { readonly status: 'unauthorized' }
  | {
      readonly status: 'error';
      readonly httpStatus: number;
      readonly code: string;
      readonly message: string;
    }
  | { readonly status: 'offline' }
  | { readonly status: 'unavailable' };

export interface AuthProvidersInfo {
  readonly bootstrapRequired: boolean;
  readonly emailEnabled: boolean;
  readonly oidcEnabled: boolean;
  readonly oidcProviderName: string;
}

export interface RemoteHousehold {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface RemoteUser {
  readonly id: string;
  readonly householdId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'owner' | 'adult';
  readonly createdAt: string;
}

export interface RemoteHouseholdProfile {
  readonly id: string;
  readonly householdId: string;
  readonly userId: string | null;
  readonly name: string;
  readonly avatarId: string;
  readonly accentColor: string;
  readonly isChild: boolean;
  readonly friendsVisible?: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthSessionPayload {
  readonly user: RemoteUser;
  readonly household: RemoteHousehold;
  readonly profiles: readonly RemoteHouseholdProfile[];
}

export type InviteMode = 'join_household' | 'new_household';
export type InviteStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface RemoteInvite {
  readonly id: string;
  readonly householdId: string;
  readonly createdByUserId: string;
  readonly mode: InviteMode;
  readonly emailHint?: string;
  readonly status: InviteStatus;
  readonly expiresAt: string;
  readonly usedAt?: string | null;
  readonly revokedAt?: string | null;
  readonly createdAt: string;
}

export interface CreateInviteResponse {
  readonly invite: RemoteInvite;
  readonly token: string;
}

export interface RemotePuzzleRecord {
  readonly seq?: number;
  readonly id: string;
  readonly seed: number;
  readonly engineVersion: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly techniquesRequired: readonly string[];
  readonly clues: string;
  readonly solution: string;
}

export interface DailySingleResponse {
  readonly date: string;
  readonly puzzle: RemotePuzzleRecord;
}

export interface DailyAllResponse {
  readonly date: string;
  readonly puzzles: {
    readonly easy: RemotePuzzleRecord;
    readonly medium: RemotePuzzleRecord;
    readonly hard: RemotePuzzleRecord;
  };
}

export interface BankPageResponse {
  readonly engineVersion: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly puzzles: readonly RemotePuzzleRecord[];
  readonly nextSeq: number;
  readonly hasMore: boolean;
}

export interface PullProfileSyncResponse {
  readonly profileId: string;
  readonly saves: readonly CloudSaveRecord[];
  readonly records: readonly PuzzleRecordLogEntry[];
  readonly preferences:
    | (SyncedProfilePreferences & {
        readonly profileId: string;
        readonly serverUpdatedAt: string;
      })
    | null;
  readonly serverTime: string;
}

export interface PushSaveSlotRequest<TPayload = unknown> {
  readonly schemaVersion: number;
  readonly baseRevision: number;
  readonly force?: boolean;
  readonly puzzleId: string;
  readonly completed: boolean;
  readonly deleted: boolean;
  readonly elapsedMs: number;
  readonly filledCells: number;
  readonly payload: TPayload;
  readonly clientUpdatedAt: string;
}

export type SavePushResolution = 'applied' | 'auto_completed_local' | 'auto_completed_remote';

export type PushSaveSlotResult<TPayload = unknown> =
  | {
      readonly ok: true;
      readonly resolution: SavePushResolution;
      readonly save: CloudSaveRecord<TPayload>;
    }
  | {
      readonly ok: false;
      readonly kind: 'conflict';
      readonly serverSave: CloudSaveRecord<TPayload>;
    }
  | {
      readonly ok: false;
      readonly kind: 'offline' | 'unauthorized' | 'too_large' | 'error';
      readonly message?: string;
    };

export interface PushRecordsBatchItem {
  readonly gameId: string;
  readonly puzzleId: string;
  readonly difficulty: string;
  readonly mode: 'standard' | 'daily';
  readonly dailyDate?: string;
  readonly status: 'started' | 'completed';
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface PushRecordsBatchResponse {
  readonly appliedCount: number;
  readonly records: readonly PuzzleRecordLogEntry[];
}

export interface PushPreferencesResponse {
  readonly preferences: SyncedProfilePreferences & {
    readonly profileId: string;
    readonly serverUpdatedAt: string;
  };
  readonly applied: boolean;
}

export type SubmitLeaderboardResultOutcome =
  | { readonly ok: true; readonly result: LeaderboardSubmissionResult }
  | {
      readonly ok: false;
      readonly kind: 'rejected';
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly kind: 'unauthorized' | 'offline' | 'error';
      readonly message?: string;
    };

export interface SyncApiClient {
  pullProfileSync(
    remoteProfileId: string,
    options?: { readonly gameId?: string; readonly since?: string },
  ): Promise<ApiResult<PullProfileSyncResponse>>;
  pushSaveSlot<TPayload = unknown>(
    remoteProfileId: string,
    gameId: string,
    slot: string,
    body: PushSaveSlotRequest<TPayload>,
    options?: { readonly keepalive?: boolean },
  ): Promise<PushSaveSlotResult<TPayload>>;
  pushRecordsBatch(
    remoteProfileId: string,
    records: readonly PushRecordsBatchItem[],
    options?: { readonly keepalive?: boolean },
  ): Promise<ApiResult<PushRecordsBatchResponse>>;
  pushPreferences(
    remoteProfileId: string,
    prefs: SyncedProfilePreferences,
    options?: { readonly keepalive?: boolean },
  ): Promise<ApiResult<PushPreferencesResponse>>;
  submitLeaderboardResult(
    payload: LeaderboardSubmissionPayload,
    options?: { readonly keepalive?: boolean },
  ): Promise<SubmitLeaderboardResultOutcome>;
}
