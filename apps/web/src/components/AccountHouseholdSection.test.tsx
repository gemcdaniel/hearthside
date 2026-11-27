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
});
