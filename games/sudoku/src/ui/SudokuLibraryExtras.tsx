import type { GameLibraryExtrasProps, SaveSlotSummary } from '@hearthside/game-core';
import { useEffect, useState } from 'react';
import { dailySlotKey, getLocalDateString } from '../engine/daily';
import {
  createEmptySudokuStats,
  normalizeSudokuStats,
  type SudokuProfileStats,
} from '../engine/stats';
import type { SudokuDifficulty } from '../engine/types';
import { CalendarIcon, StatsIcon } from './SudokuIcons';
import { SudokuStatsModal } from './SudokuStatsModal';
import { formatElapsedTime } from './formatTime';
import './sudoku.css';

const DAILY_TIERS: readonly { readonly id: SudokuDifficulty; readonly label: string }[] = [
  { id: 'easy', label: 'Daily Easy' },
  { id: 'medium', label: 'Daily Medium' },
  { id: 'hard', label: 'Daily Hard' },
];

export function SudokuLibraryExtras({
  activeProfile,
  storage,
  savedSlots,
  refreshVersion,
  onLaunchMode,
}: GameLibraryExtrasProps) {
  const todayDate = getLocalDateString();
  const [stats, setStats] = useState<SudokuProfileStats>(createEmptySudokuStats);
  const [statsOpen, setStatsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const record = await storage.loadStats();
        if (!active) {
          return;
        }
        setStats(record ? normalizeSudokuStats(record.stats, todayDate) : createEmptySudokuStats());
      } catch {
        if (active) {
          setStats(createEmptySudokuStats());
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [storage, todayDate, refreshVersion]);

  return (
    <div className="hs-sudoku-lib-extras">
      <div className="hs-sudoku-daily-header">
        <span className="hs-sudoku-daily-title">
          <CalendarIcon />
          <span>Daily Puzzle · {todayDate}</span>
        </span>
        <div className="hs-sudoku-daily-meta">
          <span
            className="hs-badge"
            data-tone={stats.currentDailyStreak > 0 ? 'success' : 'warning'}
          >
            {stats.currentDailyStreak} day streak
          </span>
          <button type="button" className="hs-sudoku-stats-link" onClick={() => setStatsOpen(true)}>
            <StatsIcon />
            <span>View Stats</span>
          </button>
        </div>
      </div>

      <div className="hs-btn-group">
        {DAILY_TIERS.map(({ id, label }) => {
          const slot = dailySlotKey(todayDate, id);
          const saveSummary: SaveSlotSummary | undefined = savedSlots[slot];
          const solvedMs = stats.dailySolvedKeys[`${todayDate}:${id}`];
          let statusLabel = 'Not Started';
          if (saveSummary) {
            statusLabel = `Resume · ${formatElapsedTime(saveSummary.elapsedMs ?? 0)}`;
          } else if (solvedMs !== undefined) {
            statusLabel = `Solved · ${formatElapsedTime(solvedMs)}`;
          }

          return (
            <button
              key={id}
              type="button"
              className="hs-btn hs-btn-secondary hs-mode-btn"
              onClick={() => onLaunchMode(slot)}
            >
              <span>{label}</span>
              <span className="hs-mode-resume">{statusLabel}</span>
            </button>
          );
        })}
      </div>

      <SudokuStatsModal
        open={statsOpen}
        profileName={activeProfile.name}
        stats={stats}
        onClose={() => setStatsOpen(false)}
      />
    </div>
  );
}
