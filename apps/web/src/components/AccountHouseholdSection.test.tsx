import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionHint } from '../api/client';
import type { AuthProvidersInfo, AuthSessionPayload } from '../api/types';
import { AccountHouseholdSection } from './AccountHouseholdSection';

const LOCAL_PROFILE = {
  id: 'local-p1',
  name: 'Player 1',
  avatarId: 'hearth' as const,
  accentColor: 'cobalt' as const,
  createdAt: '2026-11-27T00:00:00.000Z',
};

describe('AccountHouseholdSection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearSessionHint();
  });

  it('shows calm offline message with Retry when backend is offline or unavailable', () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <AccountHouseholdSection
        session={null}
        providers={null}
        backendState="offline"
        cachedBankCount={0}
        localProfiles={[LOCAL_PROFILE]}
        onRefreshStatus={onRefresh}
        onSessionChanged={vi.fn()}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Playing offline — sign in when connected to your home server'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Connection' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders bootstrap form when bootstrapRequired is true and submits to /api/v1/auth/bootstrap', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const sessionPayload: AuthSessionPayload = {
      user: {
        id: 'u-1',
        householdId: 'hh-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'owner',
        createdAt: '2026-11-27T00:00:00.000Z',
      },
      household: { id: 'hh-1', name: 'Oakwood', createdAt: '2026-11-27T00:00:00.000Z' },
      profiles: [],
    };
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(sessionPayload), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const onSessionChanged = vi.fn().mockResolvedValue(undefined);
    const providers: AuthProvidersInfo = {
      bootstrapRequired: true,
      emailEnabled: true,
      oidcEnabled: true,
      oidcProviderName: 'Family SSO',
    };

    render(
      <AccountHouseholdSection
        session={null}
        providers={providers}
        backendState="ready"
        cachedBankCount={0}
        localProfiles={[LOCAL_PROFILE]}
        onRefreshStatus={vi.fn()}
        onSessionChanged={onSessionChanged}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );

    expect(screen.getByRole('link', { name: 'Continue with Family SSO' })).toHaveAttribute(
      'href',
      '/api/v1/auth/oidc/start?bootstrap=1',
    );

    fireEvent.change(screen.getByLabelText('Household name'), { target: { value: 'Oakwood' } });
    fireEvent.change(screen.getByLabelText('Your display name'), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'alex@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password (min 10 characters)'), {
      target: { value: 'oakwood-pass-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set Up Household' }));

    await waitFor(() => {
      expect(onSessionChanged).toHaveBeenCalledWith(sessionPayload);
    });
  });

  it('prefills invite token in Redeem Invite mode and supports child profile creation & linking when signed in', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url === '/api/v1/invites' && (!init?.method || init.method === 'GET')) {
          return new Response(JSON.stringify({ invites: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url === '/api/v1/household/profiles' && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              profile: {
                id: 'child-1',
                householdId: 'hh-1',
                userId: null,
                name: 'Sammy',
                avatarId: 'fox',
                accentColor: 'amber',
                isChild: true,
                createdAt: '2026-11-27T00:00:00.000Z',
                updatedAt: '2026-11-27T00:00:00.000Z',
              },
            }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );

    const providers: AuthProvidersInfo = {
      bootstrapRequired: false,
      emailEnabled: true,
      oidcEnabled: false,
      oidcProviderName: '',
    };

    const { rerender } = render(
      <AccountHouseholdSection
        session={null}
        providers={providers}
        backendState="ready"
        cachedBankCount={0}
        localProfiles={[LOCAL_PROFILE]}
        initialInviteToken="inv-abc-123"
        onRefreshStatus={vi.fn().mockResolvedValue(undefined)}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Invite code')).toHaveValue('inv-abc-123');

    const signedInSession: AuthSessionPayload = {
      user: {
        id: 'u-1',
        householdId: 'hh-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'owner',
        createdAt: '2026-11-27T00:00:00.000Z',
      },
      household: { id: 'hh-1', name: 'Oakwood', createdAt: '2026-11-27T00:00:00.000Z' },
      profiles: [
        {
          id: 'remote-p1',
          householdId: 'hh-1',
          userId: 'u-1',
          name: 'Alex',
          avatarId: 'hearth',
          accentColor: 'cobalt',
          isChild: false,
          createdAt: '2026-11-27T00:00:00.000Z',
          updatedAt: '2026-11-27T00:00:00.000Z',
        },
      ],
    };
    const onLink = vi.fn().mockResolvedValue(undefined);
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    rerender(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={12}
        localProfiles={[LOCAL_PROFILE]}
        onRefreshStatus={onRefresh}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={onLink}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={onAdd}
        onSyncNow={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );

    expect(screen.getByText(/12 cached bank puzzles/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Link Local' }));
    expect(onLink).toHaveBeenCalledWith('local-p1', signedInSession.profiles[0]);

    const childForm = screen.getByRole('form', { name: 'Add Child Profile' });
    fireEvent.change(
      within(childForm).getByLabelText('Add child profile (no email or password needed)'),
      { target: { value: 'Sammy' } },
    );
    fireEvent.click(within(childForm).getByRole('button', { name: 'Add Child Profile' }));

    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
    expect(screen.getByText('Added child profile "Sammy".')).toBeInTheDocument();
  });

  it('renders Cloud Sync Status card only for linked profiles across idle, syncing, offline, and conflict states', () => {
    const providers: AuthProvidersInfo = {
      bootstrapRequired: false,
      emailEnabled: true,
      oidcEnabled: false,
      oidcProviderName: '',
    };
    const signedInSession: AuthSessionPayload = {
      user: {
        id: 'u-1',
        householdId: 'hh-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'owner',
        createdAt: '2026-11-27T00:00:00.000Z',
      },
      household: { id: 'hh-1', name: 'Oakwood', createdAt: '2026-11-27T00:00:00.000Z' },
      profiles: [],
    };
    const linkedProfile = {
      ...LOCAL_PROFILE,
      remoteProfileId: 'remote-p1',
      householdId: 'hh-1',
      isChild: false,
    };

    // Unlinked profile: Cloud Sync Status card stays hidden
    const { rerender } = render(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={0}
        localProfiles={[LOCAL_PROFILE]}
        activeProfile={LOCAL_PROFILE}
        syncState={{ status: 'idle', pendingCount: 0, conflicts: [] }}
        onRefreshStatus={vi.fn().mockResolvedValue(undefined)}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn().mockResolvedValue(undefined)}
        onOpenConflicts={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Cloud Sync Status' })).not.toBeInTheDocument();

    // Linked idle -> Synced + formatted lastSyncedAt + enabled Sync Now
    rerender(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={5}
        localProfiles={[linkedProfile]}
        activeProfile={linkedProfile}
        syncState={{
          status: 'idle',
          lastSyncedAt: '2026-11-27T16:10:00.000Z',
          pendingCount: 0,
          conflicts: [],
        }}
        onRefreshStatus={vi.fn().mockResolvedValue(undefined)}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn().mockResolvedValue(undefined)}
        onOpenConflicts={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );
    const card = screen.getByRole('region', { name: 'Cloud Sync Status' });
    expect(within(card).getByText('Synced')).toBeInTheDocument();
    expect(within(card).getByText(/Last synced:/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Sync Now' })).toBeEnabled();

    // Syncing -> disabled Syncing… button
    rerender(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={5}
        localProfiles={[linkedProfile]}
        activeProfile={linkedProfile}
        syncState={{ status: 'syncing', pendingCount: 2, conflicts: [] }}
        onRefreshStatus={vi.fn().mockResolvedValue(undefined)}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn().mockResolvedValue(undefined)}
        onOpenConflicts={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );
    expect(within(card).getByRole('button', { name: 'Syncing…' })).toBeDisabled();
    expect(within(card).getByText(/2 pending changes/)).toBeInTheDocument();

    // Offline -> Offline badge + disabled Sync Now
    rerender(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={5}
        localProfiles={[linkedProfile]}
        activeProfile={linkedProfile}
        syncState={{ status: 'offline', pendingCount: 1, conflicts: [] }}
        onRefreshStatus={vi.fn().mockResolvedValue(undefined)}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn().mockResolvedValue(undefined)}
        onOpenConflicts={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );
    expect(within(card).getByText('Offline — changes saved locally')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Sync Now' })).toBeDisabled();

    // Conflict -> Sync conflict badge + Resolve Conflict button opens conflict modal
    const onOpenConflicts = vi.fn();
    rerender(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={5}
        localProfiles={[linkedProfile]}
        activeProfile={linkedProfile}
        syncState={{
          status: 'conflict',
          pendingCount: 1,
          conflicts: [
            {
              profileId: linkedProfile.id,
              gameId: 'sudoku',
              slot: 'easy',
              localSave: {
                schemaVersion: 1,
                profileId: linkedProfile.id,
                gameId: 'sudoku',
                slot: 'easy',
                updatedAt: '2026-11-27T16:12:00.000Z',
                payload: '{}',
              },
              serverSave: {
                profileId: 'remote-p1',
                gameId: 'sudoku',
                slot: 'easy',
                schemaVersion: 1,
                revision: 2,
                puzzleId: 'p1',
                completed: false,
                deleted: false,
                elapsedMs: 1000,
                filledCells: 20,
                payload: '{}',
                clientUpdatedAt: '2026-11-27T16:11:00.000Z',
                updatedAt: '2026-11-27T16:11:01.000Z',
              },
              detectedAt: '2026-11-27T16:13:00.000Z',
            },
          ],
        }}
        onRefreshStatus={vi.fn().mockResolvedValue(undefined)}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn().mockResolvedValue(undefined)}
        onOpenConflicts={onOpenConflicts}
        onClearPendingInvite={vi.fn()}
      />,
    );
    expect(within(card).getByText('Sync conflict')).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Resolve Conflict' }));
    expect(onOpenConflicts).toHaveBeenCalledTimes(1);
  });

  it('supports Fun Nicknames picker, rejects URL nicknames inline, and toggles friendsVisible per profile', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/v1/invites') {
        return new Response(JSON.stringify({ invites: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/v1/household/profiles' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { name?: string };
        return new Response(
          JSON.stringify({
            profile: {
              id: 'remote-child-2',
              householdId: 'hh-1',
              userId: '',
              name: body.name ?? 'Cozy Fox',
              avatarId: 'owl',
              accentColor: 'emerald',
              isChild: true,
              friendsVisible: false,
              createdAt: '2026-11-28T00:00:00.000Z',
              updatedAt: '2026-11-28T00:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/v1/household/profiles/remote-child-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body ?? '{}')) as { friendsVisible?: boolean };
        return new Response(
          JSON.stringify({
            profile: {
              id: 'remote-child-1',
              householdId: 'hh-1',
              userId: '',
              name: 'Sunny Otter',
              avatarId: 'owl',
              accentColor: 'emerald',
              isChild: true,
              friendsVisible: Boolean(body.friendsVisible),
              createdAt: '2026-11-28T00:00:00.000Z',
              updatedAt: '2026-11-28T00:01:00.000Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const signedInSession: AuthSessionPayload = {
      user: {
        id: 'u-1',
        householdId: 'hh-1',
        email: 'alex@example.com',
        displayName: 'Alex',
        role: 'owner',
        createdAt: '2026-11-27T00:00:00.000Z',
      },
      household: { id: 'hh-1', name: 'Oakwood', createdAt: '2026-11-27T00:00:00.000Z' },
      profiles: [
        {
          id: 'remote-p1',
          householdId: 'hh-1',
          userId: 'u-1',
          name: 'Alex',
          avatarId: 'hearth',
          accentColor: 'cobalt',
          isChild: false,
          friendsVisible: true,
          createdAt: '2026-11-27T00:00:00.000Z',
          updatedAt: '2026-11-27T00:00:00.000Z',
        },
        {
          id: 'remote-child-1',
          householdId: 'hh-1',
          userId: '',
          name: 'Sunny Otter',
          avatarId: 'owl',
          accentColor: 'emerald',
          isChild: true,
          friendsVisible: false,
          createdAt: '2026-11-27T00:00:00.000Z',
          updatedAt: '2026-11-27T00:00:00.000Z',
        },
      ],
    };

    const providers: AuthProvidersInfo = {
      bootstrapRequired: false,
      emailEnabled: true,
      oidcEnabled: false,
      oidcProviderName: '',
    };
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <AccountHouseholdSection
        session={signedInSession}
        providers={providers}
        backendState="ready"
        cachedBankCount={3}
        localProfiles={[LOCAL_PROFILE]}
        onRefreshStatus={onRefresh}
        onSessionChanged={vi.fn().mockResolvedValue(undefined)}
        onLinkLocalProfile={vi.fn()}
        onUnlinkLocalProfile={vi.fn()}
        onAddRemoteProfileToDevice={vi.fn()}
        onSyncNow={vi.fn()}
        onClearPendingInvite={vi.fn()}
      />,
    );

    // Child profile defaults friendsVisible OFF and calls PATCH when toggled ON
    const childCheckbox = screen.getByLabelText('Show Sunny Otter on Friends leaderboards');
    expect(childCheckbox).not.toBeChecked();
    fireEvent.click(childCheckbox);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/household/profiles/remote-child-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ friendsVisible: true }),
        }),
      );
    });

    // Invalid URL nickname is rejected inline without hitting POST
    const childForm = screen.getByRole('form', { name: 'Add Child Profile' });
    fireEvent.change(
      within(childForm).getByLabelText('Add child profile (no email or password needed)'),
      { target: { value: 'https://bad.com' } },
    );
    fireEvent.click(within(childForm).getByRole('button', { name: 'Add Child Profile' }));
    expect(screen.getByText(/Nicknames cannot contain website links or URLs/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/v1/household/profiles',
      expect.objectContaining({ method: 'POST' }),
    );

    // Expand Fun Nicknames picker, verify Surprise Me + chip selection, and submit cleanly
    fireEvent.click(within(childForm).getByRole('button', { name: 'Surprise Me' }));
    const childInput = within(childForm).getByLabelText(
      'Add child profile (no email or password needed)',
    ) as HTMLInputElement;
    expect(childInput.value.length).toBeGreaterThan(0);

    fireEvent.click(within(childForm).getByRole('button', { name: 'Fun Nicknames' }));
    fireEvent.click(within(childForm).getByRole('button', { name: 'Cozy Fox' }));
    expect(childInput).toHaveValue('Cozy Fox');
    fireEvent.click(within(childForm).getByRole('button', { name: 'Add Child Profile' }));
    await waitFor(() => {
      expect(screen.getByText('Added child profile "Cozy Fox".')).toBeInTheDocument();
    });
  });
});
