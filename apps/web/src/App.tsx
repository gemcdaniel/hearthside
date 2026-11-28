import {
  createDefaultProfileSettings,
  type AvatarId,
  type Profile,
  type ProfileAccentId,
  type ProfileSettings,
  type SaveSlotSummary,
  type SaveSyncConflict,
  type SyncStatusState,
} from '@hearthside/game-core';
import { applyThemeToDocument } from '@hearthside/ui';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAuthProviders, getMe, hasSessionHint, isNavigatorOnline } from './api/client';
import type { AuthProvidersInfo, AuthSessionPayload, RemoteHouseholdProfile } from './api/types';
import { attachAudioUnlockListeners, audioService } from './audio/audioService';
import type { AccountBackendState } from './components/AccountHouseholdSection';
import { GameHost } from './components/GameHost';
import { LibraryView, type SavedSlotsByGame } from './components/LibraryView';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';
import { ShellHeader } from './components/ShellHeader';
import { SyncConflictModal } from './components/SyncConflictModal';

const LazySettingsModal = lazy(() =>
  import('./components/SettingsModal').then((mod) => ({ default: mod.SettingsModal })),
);
import { shellGameRegistry } from './games/shellRegistry';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  addRemoteProfileToDevice,
  countServerBankPuzzles,
  createProfile,
  deleteProfile,
  ensureInitialized,
  getProfileSettings,
  linkLocalProfileToHousehold,
  listSavesForProfileGame,
  listSyncConflicts,
  requestStoragePersistence,
  saveProfileSettings,
  setStoredActiveProfileId,
  unlinkLocalProfile,
  updateProfile,
} from './storage/hearthsideDb';
import { loadInitialThemePreference, saveThemePreference } from './storage/themeStorage';
import { prefetchDailyAndBank } from './sync/puzzleSync';
import { SyncManager } from './sync/syncManager';

interface ActiveGameLaunch {
  readonly gameId: string;
  readonly modeId?: string;
}

const FALLBACK_PROFILE: Profile = {
  id: DEFAULT_PROFILE_ID,
  name: DEFAULT_PROFILE_NAME,
  avatarId: 'hearth',
  accentColor: 'cobalt',
  createdAt: '2026-11-27T00:00:00.000Z',
};

function createInitialFallbackSettings(): ProfileSettings {
  const initialTheme = loadInitialThemePreference();
  return {
    ...createDefaultProfileSettings(initialTheme.mode),
    theme: initialTheme.theme,
  };
}

function syncAudioFromSettings(settings: ProfileSettings) {
  audioService.setSfxEnabled(settings.sfxEnabled);
  audioService.setSfxVolume(settings.sfxVolume);
  audioService.playMusicTrack(settings.theme);
  audioService.setMusicVolume(settings.musicVolume);
  audioService.setMusicEnabled(settings.musicEnabled);
}

export function App() {
  const [profiles, setProfiles] = useState<readonly Profile[]>([FALLBACK_PROFILE]);
  const [activeProfile, setActiveProfile] = useState<Profile>(FALLBACK_PROFILE);
  const [settings, setSettings] = useState<ProfileSettings>(createInitialFallbackSettings);
  const [activeLaunch, setActiveLaunch] = useState<ActiveGameLaunch | null>(null);
  const [savedSlotsByGame, setSavedSlotsByGame] = useState<SavedSlotsByGame>({});
  const [libraryRefreshVersion, setLibraryRefreshVersion] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [providers, setProviders] = useState<AuthProvidersInfo | null>(null);
  const [backendState, setBackendState] = useState<AccountBackendState>('loading');
  const [cachedBankCount, setCachedBankCount] = useState(0);
  const [syncState, setSyncState] = useState<SyncStatusState>({
    status: 'idle',
    pendingCount: 0,
    conflicts: [],
  });
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [conflictTargetSlot, setConflictTargetSlot] = useState<{
    readonly gameId: string;
    readonly slot: string;
  } | null>(null);
  const [pendingLaunchAfterConflict, setPendingLaunchAfterConflict] =
    useState<ActiveGameLaunch | null>(null);
  const [pendingCloudUpdate, setPendingCloudUpdate] = useState<{
    readonly gameId: string;
    readonly slot: string;
  } | null>(null);
  const [gameReloadNonce, setGameReloadNonce] = useState(0);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const conflictButtonRef = useRef<HTMLButtonElement>(null);
  const activeProfileIdRef = useRef<string>(activeProfile.id);
  activeProfileIdRef.current = activeProfile.id;
  const activeLaunchRef = useRef<ActiveGameLaunch | null>(null);
  activeLaunchRef.current = activeLaunch;

  const games = shellGameRegistry.listMetadata();
  const activeGameName =
    activeLaunch !== null
      ? (shellGameRegistry.get(activeLaunch.gameId)?.metadata.name ?? null)
      : null;

  const refreshSavedSlots = useCallback(async (profileId: string) => {
    const entries = shellGameRegistry.listMetadata();
    const map: Record<string, Record<string, SaveSlotSummary>> = {};

    await Promise.all(
      entries.map(async (game) => {
        try {
          const saves = await listSavesForProfileGame(profileId, game.id);
          if (saves.length > 0) {
            const slotMap: Record<string, SaveSlotSummary> = {};
            for (const save of saves) {
              slotMap[save.slot] = save.summary ?? {};
            }
            map[game.id] = slotMap;
          }
        } catch {
          // Ignore unavailable IndexedDB reads in restricted environments.
        }
      }),
    );

    setSavedSlotsByGame(map);
  }, []);

  const syncManagerRef = useRef<SyncManager | null>(null);
  if (syncManagerRef.current === null) {
    syncManagerRef.current = new SyncManager({
      onRemoteSettingsApplied: (profileId, nextSettings) => {
        if (activeProfileIdRef.current === profileId) {
          setSettings(nextSettings);
          const themePref = { theme: nextSettings.theme, mode: nextSettings.mode };
          applyThemeToDocument(themePref);
          void saveThemePreference(themePref);
          syncAudioFromSettings(nextSettings);
        }
      },
      onRemoteSavesApplied: (profileId, gameId, slots) => {
        if (activeProfileIdRef.current === profileId) {
          void refreshSavedSlots(profileId);
          setLibraryRefreshVersion((v) => v + 1);
          const currentLaunch = activeLaunchRef.current;
          if (currentLaunch && currentLaunch.gameId === gameId) {
            const activeSlot =
              shellGameRegistry.get(gameId)?.resolveSlot?.(currentLaunch.modeId) ??
              currentLaunch.modeId ??
              'easy';
            if (!slots || slots.includes(activeSlot)) {
              setPendingCloudUpdate({ gameId, slot: activeSlot });
            }
          }
        }
      },
      onRemoteRecordsApplied: (profileId) => {
        if (activeProfileIdRef.current === profileId) {
          setLibraryRefreshVersion((v) => v + 1);
        }
      },
      onUnauthorized: () => {
        setSession(null);
      },
    });
  }
  const syncManager = syncManagerRef.current;

  useEffect(() => syncManager.subscribe(setSyncState), [syncManager]);

  useEffect(() => {
    return syncManager.attachWindowListeners();
  }, [syncManager]);

  useEffect(() => {
    syncManager.setSessionActive(session !== null);
  }, [syncManager, session]);

  useEffect(() => {
    syncManager.setActiveProfileId(activeProfile.id);
  }, [syncManager, activeProfile.id]);

  const applyActiveProfileState = useCallback(
    (nextProfile: Profile, nextSettings: ProfileSettings) => {
      setActiveProfile(nextProfile);
      setSettings(nextSettings);
      setStoredActiveProfileId(nextProfile.id);
      const themePref = { theme: nextSettings.theme, mode: nextSettings.mode };
      applyThemeToDocument(themePref);
      void saveThemePreference(themePref);
      syncAudioFromSettings(nextSettings);
      void refreshSavedSlots(nextProfile.id);
    },
    [refreshSavedSlots],
  );

  const refreshCachedCounts = useCallback(async () => {
    try {
      const counts = await countServerBankPuzzles();
      setCachedBankCount(counts.total);
    } catch {
      // Ignore IndexedDB errors when unavailable.
    }
  }, []);

  const refreshAccountStatus = useCallback(
    async (profileIdOverride?: string) => {
      void refreshCachedCounts();
      if (!isNavigatorOnline()) {
        setBackendState('offline');
        return;
      }

      setBackendState((prev) => (prev === 'ready' ? 'ready' : 'loading'));
      const provRes = await getAuthProviders();
      if (provRes.status === 'offline') {
        setBackendState('offline');
        return;
      }
      if (provRes.status !== 'ok') {
        setProviders(null);
        setSession(null);
        setBackendState('unavailable');
        return;
      }

      setProviders(provRes.data);
      setBackendState('ready');

      if (!hasSessionHint()) {
        setSession(null);
        return;
      }

      const meRes = await getMe();
      if (meRes.status === 'ok') {
        setSession(meRes.data);
        const targetId = profileIdOverride ?? activeProfile.id;
        syncManager.setSessionActive(true);
        void syncManager.syncNow(targetId);
        await prefetchDailyAndBank(targetId);
        await refreshCachedCounts();
      } else {
        setSession(null);
      }
    },
    [activeProfile.id, refreshCachedCounts, syncManager],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    const invite = url.searchParams.get('invite')?.trim();
    if (invite) {
      url.searchParams.delete('invite');
      const cleaned = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
      window.history.replaceState({}, '', cleaned);
      setPendingInviteToken(invite);
      setSettingsOpen(true);
    }
  }, []);

  useEffect(() => {
    applyThemeToDocument({ theme: settings.theme, mode: settings.mode });
    syncAudioFromSettings(settings);
  }, [settings]);

  useEffect(() => {
    const detachAudio = attachAudioUnlockListeners(audioService);
    void requestStoragePersistence().catch(() => {});

    let active = true;
    const initPromise = ensureInitialized()
      .then((init) => {
        if (!active) {
          return;
        }
        setProfiles(init.profiles);
        applyActiveProfileState(init.activeProfile, init.settings);
        if (hasSessionHint() && isNavigatorOnline()) {
          void refreshAccountStatus(init.activeProfile.id);
        } else {
          void refreshCachedCounts();
        }
      })
      .catch(() => {
        // Keep synchronous fallback profile/theme if IndexedDB is blocked in a restricted environment.
      });
    initPromiseRef.current = initPromise;

    return () => {
      active = false;
      detachAudio();
    };
  }, [applyActiveProfileState, refreshAccountStatus, refreshCachedCounts]);

  useEffect(() => {
    if (settingsOpen) {
      void refreshAccountStatus();
    }
  }, [settingsOpen, refreshAccountStatus]);

  async function waitForInit(): Promise<void> {
    if (initPromiseRef.current) {
      await initPromiseRef.current;
    }
  }

  async function handleSelectProfile(profileId: string) {
    await waitForInit();
    const target = profiles.find((p) => p.id === profileId);
    if (!target) {
      return;
    }
    audioService.playSfx('tap');
    const nextSettings = await getProfileSettings(target.id);
    applyActiveProfileState(target, nextSettings);
    void syncManager.syncNow(target.id);
  }

  async function handleCreateProfile(input: {
    readonly name: string;
    readonly avatarId: AvatarId;
    readonly accentColor: ProfileAccentId;
  }) {
    await waitForInit();
    const initialSettings = createDefaultProfileSettings(settings.mode);
    const created = await createProfile({
      name: input.name,
      avatarId: input.avatarId,
      accentColor: input.accentColor,
      settings: initialSettings,
    });
    setProfiles((prev) => [...prev, created]);
    applyActiveProfileState(created, initialSettings);
    audioService.playSfx('place');
  }

  async function handleRenameProfile(profileId: string, name: string) {
    await waitForInit();
    const updated = await updateProfile(profileId, { name });
    setProfiles((prev) => prev.map((p) => (p.id === profileId ? updated : p)));
    if (activeProfile.id === profileId) {
      setActiveProfile(updated);
    }
  }

  async function handleDeleteProfile(profileId: string) {
    await waitForInit();
    await deleteProfile(profileId);
    const remaining = profiles.filter((p) => p.id !== profileId);
    setProfiles(remaining);
    if (activeProfile.id === profileId) {
      const next = remaining[0];
      if (next) {
        const nextSettings = await getProfileSettings(next.id);
        applyActiveProfileState(next, nextSettings);
      }
    }
  }

  function handleUpdateSettings(next: ProfileSettings) {
    const prev = settings;
    const syncedChanged =
      prev.theme !== next.theme ||
      prev.mode !== next.mode ||
      prev.sudoku.flagDuplicateConflicts !== next.sudoku.flagDuplicateConflicts ||
      prev.sudoku.flagWrongValues !== next.sudoku.flagWrongValues;
    setSettings(next);
    const themePref = { theme: next.theme, mode: next.mode };
    applyThemeToDocument(themePref);
    void saveThemePreference(themePref);
    syncAudioFromSettings(next);
    void saveProfileSettings(activeProfile.id, next).then(() => {
      if (syncedChanged) {
        syncManager.notifyPreferencesChanged(activeProfile.id);
      }
    });
  }

  async function handleDataImported() {
    const init = await ensureInitialized();
    setProfiles(init.profiles);
    applyActiveProfileState(init.activeProfile, init.settings);
    setActiveLaunch(null);
  }

  async function handleSessionChanged(next: AuthSessionPayload | null) {
    setSession(next);
    if (next) {
      syncManager.setSessionActive(true);
      await syncManager.syncNow(activeProfile.id);
      await prefetchDailyAndBank(activeProfile.id);
      await refreshCachedCounts();
      const provRes = await getAuthProviders();
      if (provRes.status === 'ok') {
        setProviders(provRes.data);
      }
      setBackendState('ready');
    } else {
      await refreshAccountStatus();
    }
  }

  async function handleLinkLocalProfile(localProfileId: string, remote: RemoteHouseholdProfile) {
    await waitForInit();
    const updated = await linkLocalProfileToHousehold(localProfileId, {
      id: remote.id,
      householdId: remote.householdId,
      isChild: remote.isChild,
    });
    setProfiles((prev) => prev.map((p) => (p.id === localProfileId ? updated : p)));
    if (activeProfile.id === localProfileId) {
      setActiveProfile(updated);
      syncManager.setActiveProfileId(updated.id);
    }
    await syncManager.syncNow(localProfileId);
  }

  async function handleUnlinkLocalProfile(localProfileId: string) {
    await waitForInit();
    const updated = await unlinkLocalProfile(localProfileId);
    setProfiles((prev) => prev.map((p) => (p.id === localProfileId ? updated : p)));
    if (activeProfile.id === localProfileId) {
      setActiveProfile(updated);
    }
  }

  async function handleAddRemoteProfileToDevice(remote: RemoteHouseholdProfile) {
    await waitForInit();
    const added = await addRemoteProfileToDevice(
      {
        id: remote.id,
        householdId: remote.householdId,
        name: remote.name,
        avatarId: remote.avatarId,
        accentColor: remote.accentColor,
        isChild: remote.isChild,
      },
      settings.mode,
    );
    if (added.created) {
      setProfiles((prev) => [...prev, added.profile]);
    }
    applyActiveProfileState(added.profile, added.settings);
    syncManager.setActiveProfileId(added.profile.id);
    await syncManager.syncNow(added.profile.id);
  }

  async function handleSyncNow() {
    await syncManager.syncNow(activeProfile.id);
    await prefetchDailyAndBank(activeProfile.id);
    await refreshCachedCounts();
  }

  const activeGameSyncService = useMemo(
    () =>
      activeLaunch
        ? syncManager.createGameCloudSyncService(activeProfile.id, activeLaunch.gameId)
        : undefined,
    [syncManager, activeProfile.id, activeLaunch],
  );

  function handleLaunchGame(gameId: string, modeId?: string) {
    audioService.playSfx('tap');
    const slot = shellGameRegistry.get(gameId)?.resolveSlot?.(modeId) ?? modeId ?? 'easy';
    const hasConflict = syncState.conflicts.some(
      (c) => c.profileId === activeProfile.id && c.gameId === gameId && c.slot === slot,
    );
    if (hasConflict) {
      setPendingLaunchAfterConflict({ gameId, modeId });
      setConflictTargetSlot({ gameId, slot });
      setConflictModalOpen(true);
      return;
    }
    setPendingCloudUpdate(null);
    setActiveLaunch({ gameId, modeId });
  }

  function handleExitToLibrary() {
    setActiveLaunch(null);
    setPendingCloudUpdate(null);
    setLibraryRefreshVersion((v) => v + 1);
    void refreshSavedSlots(activeProfile.id);
  }

  async function finishConflictResolution(
    conflict: SaveSyncConflict,
    resolution: 'local' | 'cloud',
  ) {
    if (resolution === 'local') {
      await syncManager.resolveConflictKeepLocal(
        conflict.profileId,
        conflict.gameId,
        conflict.slot,
      );
    } else {
      await syncManager.resolveConflictKeepCloud(
        conflict.profileId,
        conflict.gameId,
        conflict.slot,
      );
    }

    const remaining = await listSyncConflicts(activeProfile.id);
    if (remaining.length === 0) {
      setConflictModalOpen(false);
      setConflictTargetSlot(null);
    }

    if (
      pendingLaunchAfterConflict &&
      pendingLaunchAfterConflict.gameId === conflict.gameId &&
      (shellGameRegistry.get(conflict.gameId)?.resolveSlot?.(pendingLaunchAfterConflict.modeId) ??
        pendingLaunchAfterConflict.modeId ??
        'easy') === conflict.slot
    ) {
      const nextLaunch = pendingLaunchAfterConflict;
      setPendingLaunchAfterConflict(null);
      setPendingCloudUpdate(null);
      setActiveLaunch(nextLaunch);
      return;
    }

    if (resolution === 'cloud' && activeLaunch && activeLaunch.gameId === conflict.gameId) {
      const activeSlot =
        shellGameRegistry.get(activeLaunch.gameId)?.resolveSlot?.(activeLaunch.modeId) ??
        activeLaunch.modeId ??
        'easy';
      if (activeSlot === conflict.slot) {
        setPendingCloudUpdate(null);
        setGameReloadNonce((n) => n + 1);
      }
    }
  }

  const showHeaderSyncStatus = session !== null && Boolean(activeProfile.remoteProfileId);

  return (
    <div className="hs-shell" data-view={activeLaunch ? 'game' : 'library'}>
      <ShellHeader
        profiles={profiles}
        activeProfile={activeProfile}
        activeGameName={activeGameName}
        showSyncStatus={showHeaderSyncStatus}
        syncState={syncState}
        settingsButtonRef={settingsButtonRef}
        conflictButtonRef={conflictButtonRef}
        onSelectProfile={(id) => void handleSelectProfile(id)}
        onOpenSettings={() => {
          audioService.playSfx('tap');
          setSettingsOpen(true);
        }}
        onOpenConflicts={() => {
          audioService.playSfx('tap');
          setConflictTargetSlot(null);
          setPendingLaunchAfterConflict(null);
          setConflictModalOpen(true);
        }}
        onNavigateHome={() => {
          if (activeLaunch !== null) {
            audioService.playSfx('tap');
            handleExitToLibrary();
          }
        }}
      />

      <main className="hs-main">
        {activeLaunch ? (
          <GameHost
            gameId={activeLaunch.gameId}
            initialMode={activeLaunch.modeId}
            activeProfile={activeProfile}
            settings={settings}
            audio={audioService}
            isSignedIn={session !== null}
            reloadKey={gameReloadNonce}
            syncService={activeGameSyncService}
            onExitToLibrary={handleExitToLibrary}
          />
        ) : (
          <LibraryView
            games={games}
            activeProfile={activeProfile}
            savedSlotsByGame={savedSlotsByGame}
            refreshVersion={libraryRefreshVersion}
            onLaunchGame={handleLaunchGame}
          />
        )}
      </main>

      {settingsOpen ? (
        <Suspense fallback={null}>
          <LazySettingsModal
            open={settingsOpen}
            profiles={profiles}
            activeProfile={activeProfile}
            settings={settings}
            audio={audioService}
            returnFocusRef={settingsButtonRef}
            onClose={() => setSettingsOpen(false)}
            onSelectProfile={(id) => void handleSelectProfile(id)}
            onCreateProfile={handleCreateProfile}
            onRenameProfile={handleRenameProfile}
            onDeleteProfile={handleDeleteProfile}
            onUpdateSettings={handleUpdateSettings}
            onDataImported={handleDataImported}
            session={session}
            providers={providers}
            backendState={backendState}
            cachedBankCount={cachedBankCount}
            syncState={syncState}
            pendingInviteToken={pendingInviteToken}
            onRefreshAccountStatus={() => refreshAccountStatus()}
            onSessionChanged={handleSessionChanged}
            onLinkLocalProfile={handleLinkLocalProfile}
            onUnlinkLocalProfile={handleUnlinkLocalProfile}
            onAddRemoteProfileToDevice={handleAddRemoteProfileToDevice}
            onSyncNow={handleSyncNow}
            onOpenConflicts={() => {
              setSettingsOpen(false);
              setConflictTargetSlot(null);
              setPendingLaunchAfterConflict(null);
              setConflictModalOpen(true);
            }}
            onClearPendingInvite={() => setPendingInviteToken(null)}
          />
        </Suspense>
      ) : null}

      <SyncConflictModal
        open={conflictModalOpen}
        conflicts={syncState.conflicts}
        initialTarget={conflictTargetSlot}
        returnFocusRef={conflictButtonRef}
        onResolveKeepLocal={(conflict) => finishConflictResolution(conflict, 'local')}
        onResolveKeepCloud={(conflict) => finishConflictResolution(conflict, 'cloud')}
        onClose={() => {
          setConflictModalOpen(false);
          setConflictTargetSlot(null);
          setPendingLaunchAfterConflict(null);
        }}
      />

      {pendingCloudUpdate && activeLaunch ? (
        <aside className="hs-cloud-update-banner" role="status" aria-live="polite">
          <p className="hs-pwa-banner-text">
            A newer save for this puzzle arrived from another device.
          </p>
          <div className="hs-btn-group">
            <button
              type="button"
              className="hs-btn hs-btn-primary"
              onClick={() => {
                setPendingCloudUpdate(null);
                setGameReloadNonce((n) => n + 1);
              }}
            >
              Load Cloud Update
            </button>
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              onClick={() => setPendingCloudUpdate(null)}
            >
              Keep Current View
            </button>
          </div>
        </aside>
      ) : null}

      <PwaUpdateBanner />
    </div>
  );
}
