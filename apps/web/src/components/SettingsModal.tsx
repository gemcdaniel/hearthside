import {
  AVATAR_IDS,
  PROFILE_ACCENT_IDS,
  type AudioService,
  type AvatarId,
  type Profile,
  type ProfileAccentId,
  type ProfileSettings,
} from '@hearthside/game-core';
import { ThemeSwitcher, type ThemeMode, type ThemeName } from '@hearthside/ui';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { StoragePersistenceStatus } from '../diagnostics/indexedDb';
import {
  exportAllData,
  getStoragePersistenceStatus,
  importAllData,
  requestStoragePersistence,
} from '../storage/hearthsideDb';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { ProfileAvatar } from './ProfileAvatar';

interface SettingsModalProps {
  readonly open: boolean;
  readonly profiles: readonly Profile[];
  readonly activeProfile: Profile;
  readonly settings: ProfileSettings;
  readonly audio: AudioService;
  readonly onClose: () => void;
  readonly onSelectProfile: (profileId: string) => void;
  readonly onCreateProfile: (input: {
    readonly name: string;
    readonly avatarId: AvatarId;
    readonly accentColor: ProfileAccentId;
  }) => Promise<void>;
  readonly onRenameProfile: (profileId: string, name: string) => Promise<void>;
  readonly onDeleteProfile: (profileId: string) => Promise<void>;
  readonly onUpdateSettings: (next: ProfileSettings) => void;
  readonly onDataImported: () => Promise<void>;
}

function formatPersistenceLabel(status: StoragePersistenceStatus | 'checking'): string {
  switch (status) {
    case 'checking':
      return 'Checking...';
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Not granted';
    case 'unsupported':
      return 'Unsupported';
  }
}

export function SettingsModal({
  open,
  profiles,
  activeProfile,
  settings,
  audio,
  onClose,
  onSelectProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
  onUpdateSettings,
  onDataImported,
}: SettingsModalProps) {
  const [newName, setNewName] = useState('');
  const [newAvatar, setNewAvatar] = useState<AvatarId>('star');
  const [newAccent, setNewAccent] = useState<ProfileAccentId>('terracotta');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [profileStatus, setProfileStatus] = useState<string | null>(null);
  const [persistStatus, setPersistStatus] = useState<StoragePersistenceStatus | 'checking'>(
    'checking',
  );
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    void getStoragePersistenceStatus()
      .then((status) => {
        if (active) {
          setPersistStatus(status);
        }
      })
      .catch(() => {
        if (active) {
          setPersistStatus('unsupported');
        }
      });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      active = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setProfileStatus('Enter a display name before creating a profile.');
      return;
    }
    try {
      await onCreateProfile({
        name: trimmed,
        avatarId: newAvatar,
        accentColor: newAccent,
      });
      setNewName('');
      setProfileStatus(`Created and switched to profile "${trimmed}".`);
    } catch (err) {
      setProfileStatus(err instanceof Error ? err.message : 'Unable to create profile.');
    }
  }

  async function handleRenameSave(profileId: string) {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setProfileStatus('Profile name cannot be empty.');
      return;
    }
    try {
      await onRenameProfile(profileId, trimmed);
      setEditingProfileId(null);
      setEditingName('');
      setProfileStatus(`Renamed profile to "${trimmed}".`);
    } catch (err) {
      setProfileStatus(err instanceof Error ? err.message : 'Unable to rename profile.');
    }
  }

  async function handleDelete(profile: Profile) {
    try {
      await onDeleteProfile(profile.id);
      setProfileStatus(`Deleted profile "${profile.name}".`);
    } catch (err) {
      setProfileStatus(err instanceof Error ? err.message : 'Unable to delete profile.');
    }
  }

  function handleThemeChange(theme: ThemeName) {
    onUpdateSettings({ ...settings, theme });
  }

  function handleModeChange(mode: ThemeMode) {
    onUpdateSettings({ ...settings, mode });
  }

  async function handleExport() {
    setBackupStatus(null);
    try {
      const json = await exportAllData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `hearthside-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setBackupStatus('Exported backup JSON file.');
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Failed to export backup data.');
    }
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setBackupStatus(null);
    try {
      const text = await file.text();
      const imported = await importAllData(text);
      await onDataImported();
      setBackupStatus(
        `Imported ${imported.data.profiles.length} profile(s) and ${imported.data.saves.length} save(s).`,
      );
    } catch (err) {
      setBackupStatus(err instanceof Error ? err.message : 'Failed to import backup file.');
    }
  }

  async function handleRequestPersist() {
    const status = await requestStoragePersistence().catch(() => getStoragePersistenceStatus());
    setPersistStatus(status);
  }

  return (
    <div
      className="hs-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="hs-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hs-settings-title"
      >
        <div className="hs-modal-header">
          <h2 id="hs-settings-title" className="hs-section-title">
            Settings &amp; Profiles
          </h2>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={onClose}
            aria-label="Close Settings"
          >
            Close
          </button>
        </div>

        <div className="hs-modal-body">
          <section className="hs-settings-section" aria-label="Local Profiles">
            <h3 className="hs-settings-heading">Local Profiles</h3>
            <div className="hs-profile-list">
              {profiles.map((profile) => {
                const isActive = profile.id === activeProfile.id;
                const isEditing = editingProfileId === profile.id;
                return (
                  <div key={profile.id} className="hs-profile-row">
                    <div className="hs-profile-row-info">
                      <ProfileAvatar
                        avatarId={profile.avatarId}
                        accentColor={profile.accentColor}
                        size="sm"
                      />
                      {isEditing ? (
                        <input
                          type="text"
                          className="hs-input"
                          aria-label={`Edit name for ${profile.name}`}
                          value={editingName}
                          maxLength={32}
                          onChange={(event) => setEditingName(event.target.value)}
                        />
                      ) : (
                        <span className="hs-profile-row-name">{profile.name}</span>
                      )}
                      {isActive ? (
                        <span className="hs-badge" data-tone="success">
                          Active
                        </span>
                      ) : null}
                    </div>

                    <div className="hs-btn-group">
                      {!isActive ? (
                        <button
                          type="button"
                          className="hs-btn hs-btn-primary"
                          onClick={() => onSelectProfile(profile.id)}
                        >
                          Switch
                        </button>
                      ) : null}

                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="hs-btn hs-btn-primary"
                            onClick={() => void handleRenameSave(profile.id)}
                          >
                            Save Name
                          </button>
                          <button
                            type="button"
                            className="hs-btn hs-btn-secondary"
                            onClick={() => {
                              setEditingProfileId(null);
                              setEditingName('');
                            }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="hs-btn hs-btn-secondary"
                          onClick={() => {
                            setEditingProfileId(profile.id);
                            setEditingName(profile.name);
                          }}
                        >
                          Rename
                        </button>
                      )}

                      <button
                        type="button"
                        className="hs-btn hs-btn-secondary"
                        disabled={profiles.length <= 1}
                        aria-label={`Delete ${profile.name}`}
                        onClick={() => void handleDelete(profile)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <form className="hs-profile-form" onSubmit={(event) => void handleCreateSubmit(event)}>
              <div className="hs-form-row">
                <label className="hs-field-label" htmlFor="hs-new-profile-name">
                  New profile name
                </label>
                <div className="hs-btn-group">
                  <input
                    id="hs-new-profile-name"
                    type="text"
                    className="hs-input"
                    placeholder="e.g. Alex"
                    maxLength={32}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                  <button type="submit" className="hs-btn hs-btn-primary">
                    Add Profile
                  </button>
                </div>
              </div>

              <div className="hs-picker-row">
                <span className="hs-field-label">Avatar icon</span>
                <div className="hs-btn-group" role="group" aria-label="Choose avatar icon">
                  {AVATAR_IDS.map((avatarId) => (
                    <button
                      key={avatarId}
                      type="button"
                      className="hs-picker-btn"
                      aria-label={`Avatar ${avatarId}`}
                      aria-pressed={newAvatar === avatarId}
                      onClick={() => setNewAvatar(avatarId)}
                    >
                      <ProfileAvatar avatarId={avatarId} accentColor={newAccent} size="sm" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="hs-picker-row">
                <span className="hs-field-label">Accent color</span>
                <div className="hs-btn-group" role="group" aria-label="Choose accent color">
                  {PROFILE_ACCENT_IDS.map((accentId) => (
                    <button
                      key={accentId}
                      type="button"
                      className="hs-btn hs-btn-secondary"
                      aria-label={`Accent ${accentId}`}
                      aria-pressed={newAccent === accentId}
                      onClick={() => setNewAccent(accentId)}
                    >
                      {accentId}
                    </button>
                  ))}
                </div>
              </div>
            </form>

            {profileStatus ? (
              <p className="hs-diag-output" aria-live="polite">
                {profileStatus}
              </p>
            ) : null}
          </section>

          <section className="hs-settings-section" aria-label="Appearance">
            <h3 className="hs-settings-heading">Appearance ({activeProfile.name})</h3>
            <ThemeSwitcher
              theme={settings.theme}
              mode={settings.mode}
              onThemeChange={handleThemeChange}
              onModeChange={handleModeChange}
            />
          </section>

          <section className="hs-settings-section" aria-label="Audio">
            <h3 className="hs-settings-heading">Audio ({activeProfile.name})</h3>
            <div className="hs-setting-row">
              <label className="hs-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.sfxEnabled}
                  onChange={(event) =>
                    onUpdateSettings({ ...settings, sfxEnabled: event.target.checked })
                  }
                />
                <span>Sound effects (SFX)</span>
              </label>

              <div className="hs-slider-group">
                <label className="hs-field-label" htmlFor="hs-sfx-volume">
                  SFX volume ({Math.round(settings.sfxVolume * 100)}%)
                </label>
                <input
                  id="hs-sfx-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.sfxVolume * 100)}
                  onChange={(event) =>
                    onUpdateSettings({
                      ...settings,
                      sfxVolume: Number(event.target.value) / 100,
                    })
                  }
                />
                <button
                  type="button"
                  className="hs-btn hs-btn-secondary"
                  onClick={() => {
                    void audio.unlock();
                    audio.playSfx('hint');
                  }}
                >
                  Test Sound
                </button>
              </div>
            </div>

            <div className="hs-setting-row">
              <label className="hs-checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.musicEnabled}
                  aria-label="Background music"
                  onChange={(event) => {
                    if (event.target.checked) {
                      void audio.unlock();
                    }
                    onUpdateSettings({ ...settings, musicEnabled: event.target.checked });
                  }}
                />
                <span>Background music</span>
              </label>

              <div className="hs-slider-group">
                <label className="hs-field-label" htmlFor="hs-music-volume">
                  Music volume ({Math.round(settings.musicVolume * 100)}%)
                </label>
                <input
                  id="hs-music-volume"
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings.musicVolume * 100)}
                  onChange={(event) =>
                    onUpdateSettings({
                      ...settings,
                      musicVolume: Number(event.target.value) / 100,
                    })
                  }
                />
              </div>
            </div>
          </section>

          <section className="hs-settings-section" aria-label="Sudoku Defaults">
            <h3 className="hs-settings-heading">Sudoku Defaults ({activeProfile.name})</h3>
            <label className="hs-checkbox-label">
              <input
                type="checkbox"
                checked={settings.sudoku.flagDuplicateConflicts}
                onChange={(event) =>
                  onUpdateSettings({
                    ...settings,
                    sudoku: {
                      ...settings.sudoku,
                      flagDuplicateConflicts: event.target.checked,
                    },
                  })
                }
              />
              <span>Flag duplicate conflicts in row, column, or box</span>
            </label>

            <label className="hs-checkbox-label">
              <input
                type="checkbox"
                checked={settings.sudoku.flagWrongValues}
                onChange={(event) =>
                  onUpdateSettings({
                    ...settings,
                    sudoku: {
                      ...settings.sudoku,
                      flagWrongValues: event.target.checked,
                    },
                  })
                }
              />
              <span>Flag wrong values live (kid-friendly)</span>
            </label>
          </section>

          <section className="hs-settings-section" aria-label="Save Data and Storage">
            <h3 className="hs-settings-heading">Save Data &amp; Storage</h3>
            <div className="hs-diag-row">
              <span className="hs-diag-label">
                Persistent Storage:{' '}
                <span
                  className="hs-badge"
                  data-tone={persistStatus === 'granted' ? 'success' : 'warning'}
                >
                  {formatPersistenceLabel(persistStatus)}
                </span>
              </span>
              <button
                type="button"
                className="hs-btn hs-btn-secondary"
                onClick={() => void handleRequestPersist()}
              >
                Request Persist
              </button>
            </div>

            <div className="hs-btn-group">
              <button
                type="button"
                className="hs-btn hs-btn-primary"
                onClick={() => void handleExport()}
              >
                Export Save Data (JSON)
              </button>
              <button
                type="button"
                className="hs-btn hs-btn-secondary"
                onClick={() => importInputRef.current?.click()}
              >
                Import Save Data (JSON)
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hs-sr-only"
                aria-label="Import save backup file"
                onChange={(event) => void handleImportChange(event)}
              />
            </div>

            {backupStatus ? (
              <p className="hs-diag-output" aria-live="polite">
                {backupStatus}
              </p>
            ) : null}
          </section>

          <details className="hs-diagnostics-drawer">
            <summary className="hs-diagnostics-summary">Developer Diagnostics</summary>
            <DiagnosticsPanel />
          </details>
        </div>
      </section>
    </div>
  );
}
