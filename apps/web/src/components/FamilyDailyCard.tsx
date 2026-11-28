import {
  isAvatarId,
  isProfileAccentId,
  type DailyTierStatus,
  type HouseholdDailySummary,
  type LeaderboardOpenTarget,
} from '@hearthside/game-core';
import { useCallback, useEffect, useState } from 'react';
import { getHouseholdDailySummary, isNavigatorOnline } from '../api/client';
import { ProfileAvatar } from './ProfileAvatar';

export interface FamilyDailyCardProps {
  readonly signedIn: boolean;
  readonly activeRemoteProfileId?: string;
  readonly dateYYYYMMDD: string;
  readonly refreshVersion: number;
  readonly onOpenLeaderboard: (target: LeaderboardOpenTarget) => void;
}

function formatMMSS(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function TierPill({ label, status }: { readonly label: string; readonly status: DailyTierStatus }) {
  if (!status.solved || status.elapsedMs === undefined) {
    return (
      <span className="hs-family-tier-pill" data-solved="false" aria-label={`${label}: Not solved`}>
        <span className="hs-family-tier-name">{label}</span>
        <span className="hs-family-tier-time">—</span>
      </span>
    );
  }

  const hintsCount = status.hintsUsed ?? 0;
  return (
    <span
      className="hs-family-tier-pill"
      data-solved="true"
      aria-label={`${label}: Solved in ${formatMMSS(status.elapsedMs)}${hintsCount === 0 ? ', clean' : `, ${hintsCount} hints`}`}
    >
      <svg
        viewBox="0 0 16 16"
        className="hs-family-tier-check"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M3.2 8.4 6.5 11.7 13 4.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="hs-family-tier-name">{label}</span>
      <span className="hs-family-tier-time">{formatMMSS(status.elapsedMs)}</span>
      <span className="hs-family-tier-hints">{hintsCount === 0 ? 'Clean' : `${hintsCount}h`}</span>
    </span>
  );
}

export function FamilyDailyCard({
  signedIn,
  activeRemoteProfileId,
  dateYYYYMMDD,
  refreshVersion,
  onOpenLeaderboard,
}: FamilyDailyCardProps) {
  const [summary, setSummary] = useState<HouseholdDailySummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'offline' | 'error'>('idle');

  const loadSummary = useCallback(async () => {
    if (!signedIn) {
      return;
    }
    if (!isNavigatorOnline()) {
      setStatus('offline');
      return;
    }
    setStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));
    const res = await getHouseholdDailySummary(dateYYYYMMDD);
    if (res.status === 'ok') {
      setSummary(res.data);
      setStatus('ready');
    } else if (res.status === 'offline' || res.status === 'unavailable') {
      setStatus('offline');
    } else if (res.status === 'unauthorized') {
      setSummary(null);
      setStatus('idle');
    } else {
      setStatus('error');
    }
  }, [signedIn, dateYYYYMMDD]);

  useEffect(() => {
    if (!signedIn) {
      setSummary(null);
      setStatus('idle');
      return;
    }
    void loadSummary();
  }, [signedIn, refreshVersion, loadSummary]);

  if (!signedIn) {
    return null;
  }

  return (
    <section className="hs-family-daily-card" aria-label="Today's Family Daily">
      <div className="hs-family-daily-header">
        <div>
          <h3 className="hs-settings-subheading">Today&rsquo;s Family Daily · {dateYYYYMMDD}</h3>
          {summary ? <p className="hs-account-meta">{summary.householdName}</p> : null}
        </div>
        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          onClick={() =>
            onOpenLeaderboard({ kind: 'daily', date: dateYYYYMMDD, difficulty: 'easy' })
          }
        >
          Leaderboards
        </button>
      </div>

      {status === 'loading' && !summary ? (
        <p className="hs-account-meta" role="status">
          Loading today&rsquo;s family board…
        </p>
      ) : null}

      {status === 'offline' && !summary ? (
        <div className="hs-family-daily-notice" role="status">
          <p className="hs-account-meta">
            Offline — connect to your home server to refresh Today&rsquo;s Family Daily.
          </p>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => void loadSummary()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {status === 'error' && !summary ? (
        <div className="hs-family-daily-notice" role="status">
          <p className="hs-account-meta">Unable to load Today&rsquo;s Family Daily right now.</p>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => void loadSummary()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {summary ? (
        <div className="hs-family-daily-list">
          {summary.profiles.map((member) => {
            const avatarId = isAvatarId(member.avatarId) ? member.avatarId : 'hearth';
            const accentColor = isProfileAccentId(member.accentColor)
              ? member.accentColor
              : 'cobalt';
            const isSelf = activeRemoteProfileId === member.profileId;
            return (
              <div
                key={member.profileId}
                className="hs-family-daily-row"
                data-self={isSelf ? 'true' : 'false'}
              >
                <div className="hs-profile-row-info">
                  <ProfileAvatar avatarId={avatarId} accentColor={accentColor} size="sm" />
                  <span className="hs-profile-row-name">{member.profileName}</span>
                  {member.isChild ? (
                    <span className="hs-badge" data-tone="warning">
                      Child
                    </span>
                  ) : null}
                </div>
                <div className="hs-family-tier-group">
                  <TierPill label="Easy" status={member.easy} />
                  <TierPill label="Med" status={member.medium} />
                  <TierPill label="Hard" status={member.hard} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
