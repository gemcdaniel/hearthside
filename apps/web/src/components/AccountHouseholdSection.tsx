import {
  AVATAR_IDS,
  PROFILE_ACCENT_IDS,
  isAvatarId,
  isProfileAccentId,
  type AvatarId,
  type Profile,
  type ProfileAccentId,
  type SyncStatusState,
} from '@hearthside/game-core';
import { useEffect, useState, type FormEvent } from 'react';
import {
  bootstrapHousehold,
  buildOidcStartUrl,
  createChildProfile,
  createInvite,
  deleteHouseholdProfile,
  listInvites,
  loginWithPassword,
  logout,
  registerWithInvite,
  revokeInvite,
  setSessionHint,
  updateHouseholdProfile,
} from '../api/client';
import type {
  AuthProvidersInfo,
  AuthSessionPayload,
  InviteMode,
  RemoteHouseholdProfile,
  RemoteInvite,
} from '../api/types';
import { ProfileAvatar } from './ProfileAvatar';

export type AccountBackendState = 'loading' | 'ready' | 'offline' | 'unavailable';

interface AccountHouseholdSectionProps {
  readonly session: AuthSessionPayload | null;
  readonly providers: AuthProvidersInfo | null;
  readonly backendState: AccountBackendState;
  readonly cachedBankCount: number;
  readonly localProfiles: readonly Profile[];
  readonly activeProfile?: Profile;
  readonly syncState?: SyncStatusState;
  readonly initialInviteToken?: string | null;
  readonly onRefreshStatus: () => Promise<void>;
  readonly onSessionChanged: (next: AuthSessionPayload | null) => Promise<void>;
  readonly onLinkLocalProfile: (
    localProfileId: string,
    remote: RemoteHouseholdProfile,
  ) => Promise<void>;
  readonly onUnlinkLocalProfile: (localProfileId: string) => Promise<void>;
  readonly onAddRemoteProfileToDevice: (remote: RemoteHouseholdProfile) => Promise<void>;
  readonly onSyncNow: () => Promise<void>;
  readonly onOpenConflicts?: () => void;
  readonly onClearPendingInvite: () => void;
}

function formatSyncBadge(
  syncState: SyncStatusState | undefined,
  backendState: AccountBackendState,
): { readonly label: string; readonly tone: 'success' | 'warning' | 'error' } {
  if (syncState?.status === 'conflict' || (syncState && syncState.conflicts.length > 0)) {
    return { label: 'Sync conflict', tone: 'warning' };
  }
  if (syncState?.status === 'error') {
    return { label: 'Sync error', tone: 'error' };
  }
  if (syncState?.status === 'offline' || backendState === 'offline') {
    return { label: 'Offline — changes saved locally', tone: 'warning' };
  }
  if (syncState?.status === 'syncing') {
    return { label: 'Syncing…', tone: 'warning' };
  }
  return { label: 'Synced', tone: 'success' };
}

function formatLastSynced(iso: string | undefined): string {
  if (!iso) {
    return 'Not synced yet';
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return 'Not synced yet';
  }
  return `Last synced: ${new Date(ms).toLocaleString()}`;
}

function formatInviteMode(mode: InviteMode): string {
  return mode === 'join_household' ? 'Join this household' : 'Start a new household';
}

function formatInviteStatus(status: RemoteInvite['status']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'used':
      return 'Used';
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired';
  }
}

export function AccountHouseholdSection({
  session,
  providers,
  backendState,
  cachedBankCount,
  localProfiles,
  activeProfile,
  syncState,
  initialInviteToken,
  onRefreshStatus,
  onSessionChanged,
  onLinkLocalProfile,
  onUnlinkLocalProfile,
  onAddRemoteProfileToDevice,
  onSyncNow,
  onOpenConflicts,
  onClearPendingInvite,
}: AccountHouseholdSectionProps) {
  const [authTab, setAuthTab] = useState<'login' | 'register'>(
    initialInviteToken ? 'register' : 'login',
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [authStatus, setAuthStatus] = useState<string | null>(null);

  // Bootstrap form
  const [bootHousehold, setBootHousehold] = useState('');
  const [bootDisplay, setBootDisplay] = useState('');
  const [bootEmail, setBootEmail] = useState('');
  const [bootPassword, setBootPassword] = useState('');
  const [bootToken, setBootToken] = useState('');

  // Login form
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Invite redeem form
  const [regInvite, setRegInvite] = useState(initialInviteToken ?? '');
  const [regHousehold, setRegHousehold] = useState('');
  const [regDisplay, setRegDisplay] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  // Signed-in invites & child profiles state
  const [invites, setInvites] = useState<readonly RemoteInvite[]>([]);
  const [inviteMode, setInviteMode] = useState<InviteMode>('join_household');
  const [inviteEmailHint, setInviteEmailHint] = useState('');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const [childName, setChildName] = useState('');
  const [childAvatar, setChildAvatar] = useState<AvatarId>('fox');
  const [childAccent, setChildAccent] = useState<ProfileAccentId>('amber');
  const [editingChildId, setEditingChildId] = useState<string | null>(null);
  const [editingChildName, setEditingChildName] = useState('');
  const [confirmDeleteChildId, setConfirmDeleteChildId] = useState<string | null>(null);

  const [linkSelections, setLinkSelections] = useState<Record<string, string>>({});
  const [householdStatus, setHouseholdStatus] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  useEffect(() => {
    if (initialInviteToken) {
      setRegInvite(initialInviteToken);
      setAuthTab('register');
    }
  }, [initialInviteToken]);

  useEffect(() => {
    if (!session) {
      setInvites([]);
      setCreatedInviteUrl(null);
      return;
    }
    let active = true;
    void listInvites().then((res) => {
      if (active && res.status === 'ok') {
        setInvites(res.data);
      }
    });
    return () => {
      active = false;
    };
  }, [session]);

  const unlinkedLocalProfiles = localProfiles.filter((p) => !p.remoteProfileId);
  const isActiveProfileLinked = Boolean(activeProfile?.remoteProfileId);
  const syncBadge = formatSyncBadge(syncState, backendState);
  const syncDisabled =
    syncBusy ||
    syncState?.status === 'syncing' ||
    syncState?.status === 'offline' ||
    backendState === 'offline';

  async function refreshSessionAndInvites() {
    await onRefreshStatus();
    const invRes = await listInvites();
    if (invRes.status === 'ok') {
      setInvites(invRes.data);
    }
  }

  async function handleBootstrapSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const res = await bootstrapHousehold({
        householdName: bootHousehold.trim(),
        displayName: bootDisplay.trim(),
        email: bootEmail.trim(),
        password: bootPassword,
        ...(bootToken.trim() ? { bootstrapToken: bootToken.trim() } : {}),
      });
      if (res.status === 'ok') {
        await onSessionChanged(res.data);
        setBootPassword('');
        setBootToken('');
        setAuthStatus('Household created and signed in.');
      } else if (res.status === 'error') {
        setAuthStatus(res.message);
      } else {
        setAuthStatus('Home server is unreachable. Offline play remains available.');
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const res = await loginWithPassword(loginEmail.trim(), loginPassword);
      if (res.status === 'ok') {
        await onSessionChanged(res.data);
        setLoginPassword('');
        setAuthStatus('Signed in to household.');
      } else if (res.status === 'unauthorized' || res.status === 'error') {
        setAuthStatus('Invalid email or password.');
      } else {
        setAuthStatus('Home server is unreachable. Offline play remains available.');
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthStatus(null);
    try {
      const res = await registerWithInvite({
        inviteToken: regInvite.trim(),
        ...(regHousehold.trim() ? { householdName: regHousehold.trim() } : {}),
        displayName: regDisplay.trim(),
        email: regEmail.trim(),
        password: regPassword,
      });
      if (res.status === 'ok') {
        onClearPendingInvite();
        await onSessionChanged(res.data);
        setRegPassword('');
        setAuthStatus('Invite redeemed and signed in.');
      } else if (res.status === 'error') {
        setAuthStatus(res.message);
      } else {
        setAuthStatus('Home server is unreachable. Offline play remains available.');
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    setHouseholdStatus(null);
    try {
      await logout();
      await onSessionChanged(null);
      setAuthStatus('Signed out. Local profiles and saves remain on this device.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCreateChildSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = childName.trim();
    if (!trimmed) {
      setHouseholdStatus('Enter a child profile name.');
      return;
    }
    setHouseholdStatus(null);
    const res = await createChildProfile({
      name: trimmed,
      avatarId: childAvatar,
      accentColor: childAccent,
    });
    if (res.status === 'ok') {
      setChildName('');
      await refreshSessionAndInvites();
      setHouseholdStatus(`Added child profile "${res.data.name}".`);
    } else if (res.status === 'error') {
      setHouseholdStatus(res.message);
    } else {
      setHouseholdStatus('Unable to reach home server while adding child profile.');
    }
  }

  async function handleSaveChildRename(profileId: string) {
    const trimmed = editingChildName.trim();
    if (!trimmed) {
      setHouseholdStatus('Child profile name cannot be empty.');
      return;
    }
    const res = await updateHouseholdProfile(profileId, { name: trimmed });
    if (res.status === 'ok') {
      setEditingChildId(null);
      setEditingChildName('');
      await refreshSessionAndInvites();
      setHouseholdStatus(`Updated profile "${res.data.name}".`);
    } else if (res.status === 'error') {
      setHouseholdStatus(res.message);
    }
  }

  async function handleConfirmDeleteChild(profileId: string) {
    const res = await deleteHouseholdProfile(profileId);
    if (res.status === 'ok') {
      setConfirmDeleteChildId(null);
      await refreshSessionAndInvites();
      setHouseholdStatus('Removed child profile from household.');
    } else if (res.status === 'error') {
      setHouseholdStatus(res.message);
    }
  }

  async function handleCreateInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHouseholdStatus(null);
    setCopiedInvite(false);
    const res = await createInvite({
      mode: inviteMode,
      ...(inviteEmailHint.trim() ? { emailHint: inviteEmailHint.trim() } : {}),
    });
    if (res.status === 'ok') {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setCreatedInviteUrl(`${origin}/?invite=${encodeURIComponent(res.data.token)}`);
      setInviteEmailHint('');
      await refreshSessionAndInvites();
      setHouseholdStatus('Single-use invite link created. Copy it now — it is shown once.');
    } else if (res.status === 'error') {
      setHouseholdStatus(res.message);
    } else {
      setHouseholdStatus('Unable to reach home server while creating invite.');
    }
  }

  async function handleCopyInvite() {
    if (!createdInviteUrl) {
      return;
    }
    try {
      await navigator.clipboard?.writeText(createdInviteUrl);
      setCopiedInvite(true);
    } catch {
      setCopiedInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    const res = await revokeInvite(inviteId);
    if (res.status === 'ok') {
      await refreshSessionAndInvites();
      setHouseholdStatus('Revoked invite.');
    } else if (res.status === 'error') {
      setHouseholdStatus(res.message);
    }
  }

  return (
    <section className="hs-settings-section" aria-label="Account and Household">
      <h3 className="hs-settings-heading">Account &amp; Household</h3>

      {session ? (
        <div className="hs-account-panel">
          <div className="hs-profile-row">
            <div className="hs-account-summary">
              <div className="hs-account-title-row">
                <strong className="hs-profile-row-name">{session.household.name}</strong>
                <span className="hs-badge" data-tone="success">
                  {session.user.role === 'owner' ? 'Owner' : 'Adult'}
                </span>
              </div>
              <p className="hs-account-meta">
                Signed in as {session.user.displayName} ({session.user.email})
              </p>
              <p className="hs-account-meta">
                Server sync: {cachedBankCount} cached bank puzzle{cachedBankCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className="hs-btn-group">
              {!isActiveProfileLinked ? (
                <button
                  type="button"
                  className="hs-btn hs-btn-secondary"
                  disabled={syncDisabled}
                  onClick={() => {
                    setSyncBusy(true);
                    void onSyncNow().finally(() => setSyncBusy(false));
                  }}
                >
                  {syncBusy ? 'Syncing...' : 'Sync Now'}
                </button>
              ) : null}
              <button
                type="button"
                className="hs-btn hs-btn-secondary"
                disabled={authBusy}
                onClick={() => void handleSignOut()}
              >
                Sign Out
              </button>
            </div>
          </div>

          {isActiveProfileLinked ? (
            <section className="hs-sync-card" aria-label="Cloud Sync Status">
              <div className="hs-sync-card-info">
                <div className="hs-sync-card-header">
                  <strong className="hs-profile-row-name">
                    Cloud Sync ({activeProfile?.name})
                  </strong>
                  <span className="hs-badge" data-tone={syncBadge.tone}>
                    {syncBadge.label}
                  </span>
                </div>
                <p className="hs-sync-card-meta">
                  {formatLastSynced(syncState?.lastSyncedAt)}
                  {syncState && syncState.pendingCount > 0
                    ? ` · ${syncState.pendingCount} pending change${syncState.pendingCount === 1 ? '' : 's'}`
                    : ''}
                </p>
                {syncState?.status === 'error' && syncState.lastError ? (
                  <p className="hs-sync-card-meta" role="status">
                    {syncState.lastError}
                  </p>
                ) : null}
              </div>

              <div className="hs-btn-group">
                {syncState && syncState.conflicts.length > 0 && onOpenConflicts ? (
                  <button type="button" className="hs-btn hs-btn-primary" onClick={onOpenConflicts}>
                    {syncState.conflicts.length === 1
                      ? 'Resolve Conflict'
                      : `Resolve Conflicts (${syncState.conflicts.length})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="hs-btn hs-btn-secondary"
                  disabled={syncDisabled}
                  onClick={() => {
                    setSyncBusy(true);
                    void onSyncNow().finally(() => setSyncBusy(false));
                  }}
                >
                  {syncBusy || syncState?.status === 'syncing' ? 'Syncing…' : 'Sync Now'}
                </button>
              </div>
            </section>
          ) : null}

          <div className="hs-account-subsection">
            <h4 className="hs-settings-subheading">Household Profiles</h4>
            <div className="hs-profile-list">
              {session.profiles.map((remote) => {
                const linkedLocal = localProfiles.find((lp) => lp.remoteProfileId === remote.id);
                const selectedLocalId =
                  linkSelections[remote.id] ?? unlinkedLocalProfiles[0]?.id ?? '';
                const safeAvatar: AvatarId = isAvatarId(remote.avatarId)
                  ? remote.avatarId
                  : 'hearth';
                const safeAccent: ProfileAccentId = isProfileAccentId(remote.accentColor)
                  ? remote.accentColor
                  : 'cobalt';
                const isEditing = editingChildId === remote.id;
                const isConfirmingDelete = confirmDeleteChildId === remote.id;

                return (
                  <div key={remote.id} className="hs-profile-row">
                    <div className="hs-profile-row-info">
                      <ProfileAvatar avatarId={safeAvatar} accentColor={safeAccent} size="sm" />
                      {isEditing ? (
                        <input
                          type="text"
                          className="hs-input"
                          aria-label={`Edit child name for ${remote.name}`}
                          value={editingChildName}
                          maxLength={40}
                          onChange={(e) => setEditingChildName(e.target.value)}
                        />
                      ) : (
                        <span className="hs-profile-row-name">{remote.name}</span>
                      )}
                      <span className="hs-badge" data-tone={remote.isChild ? 'warning' : 'success'}>
                        {remote.isChild ? 'Child' : 'Adult'}
                      </span>
                      <span className="hs-badge" data-tone={linkedLocal ? 'success' : 'warning'}>
                        {linkedLocal ? `On device (${linkedLocal.name})` : 'Not on device'}
                      </span>
                    </div>

                    <div className="hs-btn-group">
                      {linkedLocal ? (
                        <button
                          type="button"
                          className="hs-btn hs-btn-secondary"
                          onClick={() => void onUnlinkLocalProfile(linkedLocal.id)}
                        >
                          Unlink
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="hs-btn hs-btn-primary"
                            onClick={() => void onAddRemoteProfileToDevice(remote)}
                          >
                            Add to Device
                          </button>
                          {unlinkedLocalProfiles.length > 0 ? (
                            <>
                              <select
                                className="hs-input"
                                aria-label={`Choose local profile to link to ${remote.name}`}
                                value={selectedLocalId}
                                onChange={(e) =>
                                  setLinkSelections((prev) => ({
                                    ...prev,
                                    [remote.id]: e.target.value,
                                  }))
                                }
                              >
                                {unlinkedLocalProfiles.map((lp) => (
                                  <option key={lp.id} value={lp.id}>
                                    {lp.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="hs-btn hs-btn-secondary"
                                onClick={() =>
                                  selectedLocalId &&
                                  void onLinkLocalProfile(selectedLocalId, remote)
                                }
                              >
                                Link Local
                              </button>
                            </>
                          ) : null}
                        </>
                      )}

                      {remote.isChild ? (
                        isEditing ? (
                          <>
                            <button
                              type="button"
                              className="hs-btn hs-btn-primary"
                              onClick={() => void handleSaveChildRename(remote.id)}
                            >
                              Save Child
                            </button>
                            <button
                              type="button"
                              className="hs-btn hs-btn-secondary"
                              onClick={() => {
                                setEditingChildId(null);
                                setEditingChildName('');
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="hs-btn hs-btn-secondary"
                              onClick={() => {
                                setEditingChildId(remote.id);
                                setEditingChildName(remote.name);
                              }}
                            >
                              Edit Child
                            </button>
                            {isConfirmingDelete ? (
                              <>
                                <button
                                  type="button"
                                  className="hs-btn hs-btn-primary"
                                  onClick={() => void handleConfirmDeleteChild(remote.id)}
                                >
                                  Confirm Remove
                                </button>
                                <button
                                  type="button"
                                  className="hs-btn hs-btn-secondary"
                                  onClick={() => setConfirmDeleteChildId(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="hs-btn hs-btn-secondary"
                                aria-label={`Remove child ${remote.name}`}
                                onClick={() => setConfirmDeleteChildId(remote.id)}
                              >
                                Remove
                              </button>
                            )}
                          </>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <form
              className="hs-profile-form"
              onSubmit={(e) => void handleCreateChildSubmit(e)}
              aria-label="Add Child Profile"
            >
              <div className="hs-form-row">
                <label className="hs-field-label" htmlFor="hs-child-name">
                  Add child profile (no email or password needed)
                </label>
                <div className="hs-btn-group">
                  <input
                    id="hs-child-name"
                    type="text"
                    className="hs-input"
                    placeholder="e.g. Leo"
                    maxLength={40}
                    value={childName}
                    onChange={(e) => setChildName(e.target.value)}
                  />
                  <button type="submit" className="hs-btn hs-btn-primary">
                    Add Child Profile
                  </button>
                </div>
              </div>

              <div className="hs-picker-row">
                <span className="hs-field-label">Child avatar</span>
                <div className="hs-btn-group" role="group" aria-label="Choose child avatar">
                  {AVATAR_IDS.map((avatarId) => (
                    <button
                      key={avatarId}
                      type="button"
                      className="hs-picker-btn"
                      aria-label={`Child avatar ${avatarId}`}
                      aria-pressed={childAvatar === avatarId}
                      onClick={() => setChildAvatar(avatarId)}
                    >
                      <ProfileAvatar avatarId={avatarId} accentColor={childAccent} size="sm" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="hs-picker-row">
                <span className="hs-field-label">Child accent</span>
                <div className="hs-btn-group" role="group" aria-label="Choose child accent">
                  {PROFILE_ACCENT_IDS.map((accentId) => (
                    <button
                      key={accentId}
                      type="button"
                      className="hs-btn hs-btn-secondary"
                      aria-label={`Child accent ${accentId}`}
                      aria-pressed={childAccent === accentId}
                      onClick={() => setChildAccent(accentId)}
                    >
                      {accentId}
                    </button>
                  ))}
                </div>
              </div>
            </form>
          </div>

          <div className="hs-account-subsection">
            <h4 className="hs-settings-subheading">Household Invites</h4>
            <form
              className="hs-profile-form"
              onSubmit={(e) => void handleCreateInviteSubmit(e)}
              aria-label="Create Invite"
            >
              <div className="hs-form-grid">
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-invite-mode">
                    Invite type
                  </label>
                  <select
                    id="hs-invite-mode"
                    className="hs-input"
                    value={inviteMode}
                    onChange={(e) => setInviteMode(e.target.value as InviteMode)}
                  >
                    <option value="join_household">Join this household</option>
                    <option value="new_household">Start a new household</option>
                  </select>
                </div>
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-invite-email">
                    Email hint (optional)
                  </label>
                  <input
                    id="hs-invite-email"
                    type="email"
                    className="hs-input"
                    placeholder="family@example.com"
                    value={inviteEmailHint}
                    onChange={(e) => setInviteEmailHint(e.target.value)}
                  />
                </div>
              </div>
              <div className="hs-btn-group">
                <button type="submit" className="hs-btn hs-btn-primary">
                  Create Invite
                </button>
              </div>
            </form>

            {createdInviteUrl ? (
              <div className="hs-profile-form" role="region" aria-label="Generated Invite Link">
                <label className="hs-field-label" htmlFor="hs-created-invite-url">
                  One-time invite link
                </label>
                <div className="hs-btn-group">
                  <input
                    id="hs-created-invite-url"
                    type="text"
                    readOnly
                    className="hs-input hs-input-grow"
                    value={createdInviteUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    type="button"
                    className="hs-btn hs-btn-primary"
                    onClick={() => void handleCopyInvite()}
                  >
                    {copiedInvite ? 'Copied Link' : 'Copy Link'}
                  </button>
                </div>
              </div>
            ) : null}

            {invites.length > 0 ? (
              <div className="hs-profile-list">
                {invites.map((inv) => (
                  <div key={inv.id} className="hs-profile-row">
                    <div className="hs-profile-row-info">
                      <span className="hs-profile-row-name">{formatInviteMode(inv.mode)}</span>
                      {inv.emailHint ? (
                        <span className="hs-account-meta">{inv.emailHint}</span>
                      ) : null}
                      <span
                        className="hs-badge"
                        data-tone={inv.status === 'active' ? 'success' : 'warning'}
                      >
                        {formatInviteStatus(inv.status)}
                      </span>
                    </div>
                    {inv.status === 'active' ? (
                      <button
                        type="button"
                        className="hs-btn hs-btn-secondary"
                        onClick={() => void handleRevokeInvite(inv.id)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {householdStatus ? (
            <p className="hs-diag-output" aria-live="polite">
              {householdStatus}
            </p>
          ) : null}
        </div>
      ) : backendState === 'offline' || backendState === 'unavailable' ? (
        <div className="hs-profile-form">
          <p className="hs-account-meta">
            Playing offline — sign in when connected to your home server
          </p>
          <div className="hs-btn-group">
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              onClick={() => void onRefreshStatus()}
            >
              Retry Connection
            </button>
          </div>
        </div>
      ) : backendState === 'loading' || !providers ? (
        <p className="hs-account-meta">Checking home server connection...</p>
      ) : providers.bootstrapRequired && !initialInviteToken ? (
        <form
          className="hs-profile-form"
          onSubmit={(e) => void handleBootstrapSubmit(e)}
          aria-label="Set Up Household"
        >
          <h4 className="hs-settings-subheading">Set Up Household</h4>
          <p className="hs-account-meta">
            Create the founding household account. Existing local profiles and saves stay intact.
          </p>
          <div className="hs-form-grid">
            <div className="hs-form-row">
              <label className="hs-field-label" htmlFor="hs-bootstrap-household">
                Household name
              </label>
              <input
                id="hs-bootstrap-household"
                type="text"
                required
                className="hs-input"
                placeholder="e.g. Family Home"
                value={bootHousehold}
                onChange={(e) => setBootHousehold(e.target.value)}
              />
            </div>
            <div className="hs-form-row">
              <label className="hs-field-label" htmlFor="hs-bootstrap-name">
                Your display name
              </label>
              <input
                id="hs-bootstrap-name"
                type="text"
                required
                className="hs-input"
                placeholder="e.g. Alex"
                value={bootDisplay}
                onChange={(e) => setBootDisplay(e.target.value)}
              />
            </div>
            <div className="hs-form-row">
              <label className="hs-field-label" htmlFor="hs-bootstrap-email">
                Email address
              </label>
              <input
                id="hs-bootstrap-email"
                type="email"
                required
                className="hs-input"
                value={bootEmail}
                onChange={(e) => setBootEmail(e.target.value)}
              />
            </div>
            <div className="hs-form-row">
              <label className="hs-field-label" htmlFor="hs-bootstrap-password">
                Password (min 10 characters)
              </label>
              <input
                id="hs-bootstrap-password"
                type="password"
                required
                minLength={10}
                className="hs-input"
                value={bootPassword}
                onChange={(e) => setBootPassword(e.target.value)}
              />
            </div>
            <div className="hs-form-row">
              <label className="hs-field-label" htmlFor="hs-bootstrap-token">
                Bootstrap token (if configured)
              </label>
              <input
                id="hs-bootstrap-token"
                type="password"
                className="hs-input"
                value={bootToken}
                onChange={(e) => setBootToken(e.target.value)}
              />
            </div>
          </div>
          <div className="hs-btn-group">
            <button type="submit" className="hs-btn hs-btn-primary" disabled={authBusy}>
              {authBusy ? 'Creating...' : 'Set Up Household'}
            </button>
            {providers.oidcEnabled ? (
              <a
                className="hs-btn hs-btn-secondary"
                href={buildOidcStartUrl({ bootstrap: true })}
                onClick={() => setSessionHint()}
              >
                Continue with {providers.oidcProviderName || 'SSO'}
              </a>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="hs-account-panel">
          <div className="hs-btn-group" role="group" aria-label="Account action mode">
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              aria-pressed={authTab === 'login'}
              onClick={() => {
                setAuthTab('login');
                setAuthStatus(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              aria-pressed={authTab === 'register'}
              onClick={() => {
                setAuthTab('register');
                setAuthStatus(null);
              }}
            >
              Redeem Invite
            </button>
          </div>

          {authTab === 'login' ? (
            <form
              className="hs-profile-form"
              onSubmit={(e) => void handleLoginSubmit(e)}
              aria-label="Sign In"
            >
              <div className="hs-form-grid">
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-login-email">
                    Email address
                  </label>
                  <input
                    id="hs-login-email"
                    type="email"
                    required
                    className="hs-input"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                </div>
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-login-password">
                    Password
                  </label>
                  <input
                    id="hs-login-password"
                    type="password"
                    required
                    className="hs-input"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="hs-btn-group">
                <button type="submit" className="hs-btn hs-btn-primary" disabled={authBusy}>
                  {authBusy ? 'Signing In...' : 'Sign In'}
                </button>
                {providers.oidcEnabled ? (
                  <a
                    className="hs-btn hs-btn-secondary"
                    href={buildOidcStartUrl()}
                    onClick={() => setSessionHint()}
                  >
                    Continue with {providers.oidcProviderName || 'SSO'}
                  </a>
                ) : null}
              </div>
            </form>
          ) : (
            <form
              className="hs-profile-form"
              onSubmit={(e) => void handleRegisterSubmit(e)}
              aria-label="Redeem Invite"
            >
              <div className="hs-form-grid">
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-register-invite">
                    Invite code
                  </label>
                  <input
                    id="hs-register-invite"
                    type="text"
                    required
                    className="hs-input"
                    value={regInvite}
                    onChange={(e) => setRegInvite(e.target.value)}
                  />
                </div>
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-register-name">
                    Your display name
                  </label>
                  <input
                    id="hs-register-name"
                    type="text"
                    required
                    className="hs-input"
                    value={regDisplay}
                    onChange={(e) => setRegDisplay(e.target.value)}
                  />
                </div>
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-register-email">
                    Email address
                  </label>
                  <input
                    id="hs-register-email"
                    type="email"
                    required
                    className="hs-input"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                  />
                </div>
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-register-password">
                    Password (min 10 characters)
                  </label>
                  <input
                    id="hs-register-password"
                    type="password"
                    required
                    minLength={10}
                    className="hs-input"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                  />
                </div>
                <div className="hs-form-row">
                  <label className="hs-field-label" htmlFor="hs-register-household">
                    New household name (only for new-household invites)
                  </label>
                  <input
                    id="hs-register-household"
                    type="text"
                    className="hs-input"
                    value={regHousehold}
                    onChange={(e) => setRegHousehold(e.target.value)}
                  />
                </div>
              </div>
              <div className="hs-btn-group">
                <button type="submit" className="hs-btn hs-btn-primary" disabled={authBusy}>
                  {authBusy ? 'Redeeming...' : 'Create Account from Invite'}
                </button>
                {providers.oidcEnabled ? (
                  <a
                    className="hs-btn hs-btn-secondary"
                    href={buildOidcStartUrl({ inviteToken: regInvite.trim() || undefined })}
                    onClick={() => setSessionHint()}
                  >
                    Continue with {providers.oidcProviderName || 'SSO'}
                  </a>
                ) : null}
              </div>
            </form>
          )}
        </div>
      )}

      {authStatus ? (
        <p className="hs-diag-output" aria-live="polite">
          {authStatus}
        </p>
      ) : null}
    </section>
  );
}
