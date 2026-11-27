import type { Profile } from '@hearthside/game-core';
import { useEffect, useId, useRef, useState } from 'react';
import { getAppTitle } from '../appInfo';
import { ProfileAvatar } from './ProfileAvatar';

interface ShellHeaderProps {
  readonly profiles: readonly Profile[];
  readonly activeProfile: Profile;
  readonly activeGameName: string | null;
  readonly onSelectProfile: (profileId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onNavigateHome: () => void;
}

export function ShellHeader({
  profiles,
  activeProfile,
  activeGameName,
  onSelectProfile,
  onOpenSettings,
  onNavigateHome,
}: ShellHeaderProps) {
  const appTitle = getAppTitle();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !switcherRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="hs-header">
      <div className="hs-brand">
        <button
          type="button"
          className="hs-brand-btn"
          onClick={onNavigateHome}
          aria-label={`${appTitle} home`}
        >
          <h1 className="hs-title">{appTitle}</h1>
        </button>
        <p className="hs-subtitle">
          {activeGameName ? `${activeGameName} · Offline Ready` : 'Offline Family Game Shelf'}
        </p>
      </div>

      <div className="hs-header-actions">
        <div className="hs-profile-switcher" ref={switcherRef}>
          <button
            type="button"
            className="hs-btn hs-btn-secondary hs-profile-trigger"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={`Active profile: ${activeProfile.name}`}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <ProfileAvatar
              avatarId={activeProfile.avatarId}
              accentColor={activeProfile.accentColor}
              size="sm"
            />
            <span className="hs-profile-trigger-name">{activeProfile.name}</span>
          </button>

          {menuOpen ? (
            <div className="hs-profile-menu" id={menuId} role="menu" aria-label="Switch profile">
              {profiles.map((profile) => {
                const isCurrent = profile.id === activeProfile.id;
                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isCurrent}
                    className="hs-profile-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onSelectProfile(profile.id);
                    }}
                  >
                    <ProfileAvatar
                      avatarId={profile.avatarId}
                      accentColor={profile.accentColor}
                      size="sm"
                    />
                    <span className="hs-profile-menu-name">{profile.name}</span>
                    {isCurrent ? (
                      <span className="hs-badge" data-tone="success">
                        Active
                      </span>
                    ) : null}
                  </button>
                );
              })}

              <button
                type="button"
                role="menuitem"
                className="hs-profile-menu-item hs-profile-manage-item"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
              >
                Manage Profiles...
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="hs-btn hs-btn-secondary"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          Settings
        </button>
      </div>
    </header>
  );
}
