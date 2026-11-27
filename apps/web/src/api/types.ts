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
