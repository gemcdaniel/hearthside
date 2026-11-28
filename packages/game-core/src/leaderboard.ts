export type LeaderboardScope = 'household' | 'friends';
export type LeaderboardMode = 'standard' | 'daily';
export type LeaderboardDifficulty = 'easy' | 'medium' | 'hard';

export interface LeaderboardEntry {
  readonly rank: number;
  readonly profileId: string;
  readonly profileName: string;
  readonly avatarId: string;
  readonly accentColor: string;
  readonly isChild: boolean;
  readonly householdName: string;
  readonly isOwnHousehold: boolean;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly completedAt: string;
}

export interface DailyLeaderboardResponse {
  readonly gameId: string;
  readonly date: string;
  readonly difficulty: LeaderboardDifficulty;
  readonly scope: LeaderboardScope;
  readonly noHintsOnly: boolean;
  readonly entries: readonly LeaderboardEntry[];
}

export interface PuzzleLeaderboardResponse {
  readonly gameId: string;
  readonly puzzleId: string;
  readonly scope: LeaderboardScope;
  readonly noHintsOnly: boolean;
  readonly entries: readonly LeaderboardEntry[];
}

export type LeaderboardResponse = DailyLeaderboardResponse | PuzzleLeaderboardResponse;

export interface DailyTierStatus {
  readonly solved: boolean;
  readonly elapsedMs?: number;
  readonly hintsUsed?: number;
  readonly completedAt?: string;
}

export interface HouseholdDailyProfileSummary {
  readonly profileId: string;
  readonly profileName: string;
  readonly avatarId: string;
  readonly accentColor: string;
  readonly isChild: boolean;
  readonly friendsVisible: boolean;
  readonly easy: DailyTierStatus;
  readonly medium: DailyTierStatus;
  readonly hard: DailyTierStatus;
}

export interface HouseholdDailySummary {
  readonly gameId: string;
  readonly date: string;
  readonly householdName: string;
  readonly profiles: readonly HouseholdDailyProfileSummary[];
}

export interface LeaderboardSubmissionPayload {
  readonly profileId: string;
  readonly gameId: string;
  readonly puzzleId: string;
  readonly mode: LeaderboardMode;
  readonly dailyDate?: string;
  readonly difficulty: LeaderboardDifficulty;
  readonly solutionGrid: string;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly completedAt: string;
}

export interface LeaderboardSubmissionResult {
  readonly created: boolean;
  readonly entry: LeaderboardEntry;
  readonly householdRank: number;
  readonly totalHouseholdEntries: number;
}

export type LeaderboardSubmitOutcome =
  | { readonly status: 'submitted'; readonly result: LeaderboardSubmissionResult }
  | { readonly status: 'queued' }
  | { readonly status: 'skipped' };

export type LeaderboardOpenTarget =
  | {
      readonly kind: 'daily';
      readonly date?: string;
      readonly difficulty?: LeaderboardDifficulty;
    }
  | {
      readonly kind: 'puzzle';
      readonly puzzleId: string;
      readonly label?: string;
    };

export interface LeaderboardService {
  submitResult(
    input: Omit<LeaderboardSubmissionPayload, 'profileId' | 'gameId'>,
  ): Promise<LeaderboardSubmitOutcome>;
  openLeaderboard(target: LeaderboardOpenTarget): void;
}
