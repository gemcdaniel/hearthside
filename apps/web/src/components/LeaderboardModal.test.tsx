import type { DailyLeaderboardResponse, HouseholdDailySummary } from '@hearthside/game-core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FamilyDailyCard } from './FamilyDailyCard';
import { LeaderboardModal } from './LeaderboardModal';

const HOUSEHOLD_DAILY_RESPONSE: DailyLeaderboardResponse = {
  scope: 'household',
  noHintsOnly: false,
  gameId: 'sudoku',
  date: '2026-11-28',
  difficulty: 'easy',
  entries: [
    {
      rank: 1,
      profileId: 'remote-p1',
      profileName: 'Alex',
      avatarId: 'hearth',
      accentColor: 'cobalt',
      isChild: false,
      householdName: 'Oakwood',
      isOwnHousehold: true,
      elapsedMs: 65_000,
      hintsUsed: 0,
      completedAt: '2026-11-28T09:00:00.000Z',
    },
    {
      rank: 2,
      profileId: 'remote-child-1',
      profileName: 'Sunny Otter',
      avatarId: 'owl',
      accentColor: 'emerald',
      isChild: true,
      householdName: 'Oakwood',
      isOwnHousehold: true,
      elapsedMs: 95_000,
      hintsUsed: 2,
      completedAt: '2026-11-28T09:05:00.000Z',
    },
  ],
};

const FRIENDS_NO_HINTS_RESPONSE: DailyLeaderboardResponse = {
  scope: 'friends',
  noHintsOnly: true,
  gameId: 'sudoku',
  date: '2026-11-28',
  difficulty: 'easy',
  entries: [
    {
      rank: 1,
      profileId: 'remote-friend-1',
      profileName: 'Clever Owl',
      avatarId: 'owl',
      accentColor: 'amber',
      isChild: false,
      householdName: 'Birch Lane',
      isOwnHousehold: false,
      elapsedMs: 58_000,
      hintsUsed: 0,
      completedAt: '2026-11-28T08:30:00.000Z',
    },
  ],
};

const FAMILY_SUMMARY: HouseholdDailySummary = {
  gameId: 'sudoku',
  date: '2026-11-28',
  householdName: 'Oakwood',
  profiles: [
    {
      profileId: 'remote-p1',
      profileName: 'Alex',
      avatarId: 'hearth',
      accentColor: 'cobalt',
      isChild: false,
      friendsVisible: true,
      easy: { solved: true, elapsedMs: 65_000, hintsUsed: 0 },
      medium: { solved: false },
      hard: { solved: false },
    },
    {
      profileId: 'remote-child-1',
      profileName: 'Sunny Otter',
      avatarId: 'owl',
      accentColor: 'emerald',
      isChild: true,
      friendsVisible: false,
      easy: { solved: true, elapsedMs: 95_000, hintsUsed: 2 },
      medium: { solved: false },
      hard: { solved: false },
    },
  ],
};

describe('LeaderboardModal & FamilyDailyCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('switches Household vs Friends tabs, toggles No-Hint Only, renders Clean vs hint badges without PII, and handles offline/signed-out states', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('scope=friends') && url.includes('noHintsOnly=true')) {
        return new Response(JSON.stringify(FRIENDS_NO_HINTS_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('scope=friends')) {
        return new Response(JSON.stringify({ ...FRIENDS_NO_HINTS_RESPONSE, noHintsOnly: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(HOUSEHOLD_DAILY_RESPONSE), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });

    const { rerender } = render(
      <LeaderboardModal
        open={true}
        signedIn={true}
        activeRemoteProfileId="remote-p1"
        initialTarget={{ kind: 'daily', date: '2026-11-28', difficulty: 'easy' }}
        todayDateYYYYMMDD="2026-11-28"
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Leaderboards' });
    await within(dialog).findByText('Alex');
    expect(within(dialog).getByText('Sunny Otter')).toBeInTheDocument();
    expect(within(dialog).getByText('Clean')).toBeInTheDocument();
    expect(within(dialog).getByText('2 hints')).toBeInTheDocument();
    expect(within(dialog).getByText('01:05')).toBeInTheDocument();
    expect(within(dialog).queryByText(/@/)).not.toBeInTheDocument();

    // Switch to Friends tab and toggle No-Hint Only
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Friends' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'No-Hint Only' }));

    await waitFor(() => {
      expect(within(dialog).getByText('Clever Owl')).toBeInTheDocument();
      expect(within(dialog).getByText('Birch Lane')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('scope=friends&noHintsOnly=true'),
      expect.any(Object),
    );

    // Offline banner state
    vi.stubGlobal('navigator', { onLine: false });
    rerender(
      <LeaderboardModal
        open={true}
        signedIn={true}
        activeRemoteProfileId="remote-p1"
        initialTarget={{ kind: 'daily', date: '2026-11-28', difficulty: 'hard' }}
        todayDateYYYYMMDD="2026-11-28"
        refreshVersion={1}
        onClose={vi.fn()}
      />,
    );
    expect(
      await within(dialog).findByText(
        'Offline — connect to your home server to load leaderboard standings.',
      ),
    ).toBeInTheDocument();

    // Signed-out state
    rerender(
      <LeaderboardModal
        open={true}
        signedIn={false}
        initialTarget={{ kind: 'daily', date: '2026-11-28', difficulty: 'easy' }}
        todayDateYYYYMMDD="2026-11-28"
        onClose={vi.fn()}
      />,
    );
    expect(
      within(dialog).getByText(/Sign in to a household account in Settings/i),
    ).toBeInTheDocument();
  });

  it("renders Today's Family Daily pills cleanly, handles offline fallback, and stays hidden when signed out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(FAMILY_SUMMARY), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });

    const onOpenLeaderboard = vi.fn();
    const { container, rerender } = render(
      <FamilyDailyCard
        signedIn={true}
        activeRemoteProfileId="remote-p1"
        dateYYYYMMDD="2026-11-28"
        refreshVersion={0}
        onOpenLeaderboard={onOpenLeaderboard}
      />,
    );

    const section = screen.getByRole('region', { name: "Today's Family Daily" });
    await within(section).findByText('Alex');
    expect(within(section).getByText('Sunny Otter')).toBeInTheDocument();
    expect(within(section).getByLabelText('Easy: Solved in 01:05, clean')).toBeInTheDocument();
    expect(within(section).getByLabelText('Easy: Solved in 01:35, 2 hints')).toBeInTheDocument();
    expect(within(section).getAllByLabelText('Med: Not solved')).toHaveLength(2);

    fireEvent.click(within(section).getByRole('button', { name: 'Leaderboards' }));
    expect(onOpenLeaderboard).toHaveBeenCalledWith({
      kind: 'daily',
      date: '2026-11-28',
      difficulty: 'easy',
    });

    // Signed out -> renders nothing at all
    rerender(
      <FamilyDailyCard
        signedIn={false}
        dateYYYYMMDD="2026-11-28"
        refreshVersion={0}
        onOpenLeaderboard={onOpenLeaderboard}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    // Signed in while offline -> calm notice
    vi.stubGlobal('navigator', { onLine: false });
    rerender(
      <FamilyDailyCard
        signedIn={true}
        activeRemoteProfileId="remote-p1"
        dateYYYYMMDD="2026-11-29"
        refreshVersion={1}
        onOpenLeaderboard={onOpenLeaderboard}
      />,
    );
    expect(
      await screen.findByText(/Offline — connect to your home server to refresh/i),
    ).toBeInTheDocument();
  });
});
