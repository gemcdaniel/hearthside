export interface SaveSlotSummary {
  readonly elapsedMs?: number;
  readonly label?: string;
}

export interface SaveEnvelope<TPayload = unknown> {
  readonly schemaVersion: number;
  readonly profileId: string;
  readonly gameId: string;
  readonly slot: string;
  readonly updatedAt: string;
  readonly summary?: SaveSlotSummary;
  readonly payload: TPayload;
}

export interface BaseGameStats {
  readonly gamesStarted: number;
  readonly gamesWon: number;
  readonly totalPlayMs: number;
}

export interface GameStatsRecord<TStats = unknown> {
  readonly schemaVersion: number;
  readonly profileId: string;
  readonly gameId: string;
  readonly updatedAt: string;
  readonly stats: TStats;
}

export interface CompletedPuzzleRecord {
  readonly profileId: string;
  readonly gameId: string;
  readonly puzzleId: string;
  readonly difficulty?: string;
  readonly mode?: 'standard' | 'daily';
  readonly dailyDate?: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
}

export interface CachedPuzzleEntry<TPuzzle = unknown> {
  readonly gameId: string;
  readonly cacheKey: string;
  readonly cachedAt: string;
  readonly puzzle: TPuzzle;
}

export interface GameStorageService {
  loadSave<TPayload = unknown>(slot: string): Promise<SaveEnvelope<TPayload> | null>;
  saveGame<TPayload = unknown>(envelope: SaveEnvelope<TPayload>): Promise<void>;
  deleteSave(slot: string): Promise<void>;
  listSaves(): Promise<readonly SaveEnvelope[]>;
  loadStats<TStats = unknown>(): Promise<GameStatsRecord<TStats> | null>;
  saveStats<TStats = unknown>(record: GameStatsRecord<TStats>): Promise<void>;
  recordCompletedPuzzle(record: CompletedPuzzleRecord): Promise<void>;
  listCompletedPuzzles(): Promise<readonly CompletedPuzzleRecord[]>;
  loadCachedPuzzle<TPuzzle = unknown>(cacheKey: string): Promise<TPuzzle | null>;
  saveCachedPuzzle<TPuzzle = unknown>(cacheKey: string, puzzle: TPuzzle): Promise<void>;
}

/** Optional online/cache sync adapter provided by the host shell without coupling games to HTTP APIs. */
export interface PuzzleSyncService {
  fetchDailyPuzzle<TPuzzle = unknown>(dateKey: string, difficulty: string): Promise<TPuzzle | null>;
  pickCachedBankPuzzle<TPuzzle = unknown>(
    difficulty: string,
    excludeIds: ReadonlySet<string>,
  ): Promise<TPuzzle | null>;
  requestBankTopUp?(difficulty: string, excludeIds: ReadonlySet<string>): Promise<void>;
}
