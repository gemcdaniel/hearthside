import {
  createDefaultProfileSettings,
  type AvatarId,
  type Profile,
  type ProfileAccentId,
  type ProfileSettings,
  type SaveSlotSummary,
} from '@hearthside/game-core';
import { applyThemeToDocument } from '@hearthside/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { attachAudioUnlockListeners, audioService } from './audio/audioService';
import { GameHost } from './components/GameHost';
import { LibraryView, type SavedSlotsByGame } from './components/LibraryView';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';
import { SettingsModal } from './components/SettingsModal';
import { ShellHeader } from './components/ShellHeader';
import { shellGameRegistry } from './games/shellRegistry';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  createProfile,
  deleteProfile,
  ensureInitialized,
  getProfileSettings,
  listSavesForProfileGame,
  requestStoragePersistence,
  saveProfileSettings,
  setStoredActiveProfileId,
  updateProfile,
} from './storage/hearthsideDb';
import { loadInitialThemePreference, saveThemePreference } from './storage/themeStorage';

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
  const initPromiseRef = useRef<Promise<void> | null>(null);

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
      })
      .catch(() => {
        // Keep synchronous fallback profile/theme if IndexedDB is blocked in a restricted environment.
      });
    initPromiseRef.current = initPromise;

    return () => {
      active = false;
      detachAudio();
    };
  }, [applyActiveProfileState]);

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
    setSettings(next);
    const themePref = { theme: next.theme, mode: next.mode };
    applyThemeToDocument(themePref);
    void saveThemePreference(themePref);
    syncAudioFromSettings(next);
    void saveProfileSettings(activeProfile.id, next);
  }

  async function handleDataImported() {
    const init = await ensureInitialized();
    setProfiles(init.profiles);
    applyActiveProfileState(init.activeProfile, init.settings);
    setActiveLaunch(null);
  }

  function handleLaunchGame(gameId: string, modeId?: string) {
    audioService.playSfx('tap');
    setActiveLaunch({ gameId, modeId });
  }

  function handleExitToLibrary() {
    setActiveLaunch(null);
    setLibraryRefreshVersion((v) => v + 1);
    void refreshSavedSlots(activeProfile.id);
  }

  return (
    <div className="hs-shell" data-view={activeLaunch ? 'game' : 'library'}>
      <ShellHeader
        profiles={profiles}
        activeProfile={activeProfile}
        activeGameName={activeGameName}
        onSelectProfile={(id) => void handleSelectProfile(id)}
        onOpenSettings={() => {
          audioService.playSfx('tap');
          setSettingsOpen(true);
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

      <SettingsModal
        open={settingsOpen}
        profiles={profiles}
        activeProfile={activeProfile}
        settings={settings}
        audio={audioService}
        onClose={() => setSettingsOpen(false)}
        onSelectProfile={(id) => void handleSelectProfile(id)}
        onCreateProfile={handleCreateProfile}
        onRenameProfile={handleRenameProfile}
        onDeleteProfile={handleDeleteProfile}
        onUpdateSettings={handleUpdateSettings}
        onDataImported={handleDataImported}
      />

      <PwaUpdateBanner />
    </div>
  );
}
