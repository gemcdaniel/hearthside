import type { Profile, SyncStatusState } from '@hearthside/game-core';
import { useFocusTrap } from '@hearthside/ui';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { getAppTitle } from '../appInfo';
import { ProfileAvatar } from './ProfileAvatar';

interface ShellHeaderProps {
  readonly profiles: readonly Profile[];
  readonly activeProfile: Profile;
  readonly activeGameName: string | null;
  readonly showSyncStatus?: boolean;
  readonly syncState?: SyncStatusState;
  readonly settingsButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly conflictButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onSelectProfile: (profileId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onOpenConflicts?: () => void;
  readonly onNavigateHome: () => void;
}

export function ShellHeader({
  profiles,
  activeProfile,
  activeGameName,
  showSyncStatus = false,
  syncState,
  settingsButtonRef,
  conflictButtonRef,
  onSelectProfile,
  onOpenSettings,
  onOpenConflicts,
  onNavigateHome,
}: ShellHeaderProps) {
  const appTitle = getAppTitle();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuTitleId = useId();
  const switcherRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useFocusTrap(menuRef, {
    active: menuOpen,
    onEscape: () => setMenuOpen(false),
    returnFocusRef: triggerRef,
  });

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

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [menuOpen]);

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const menuEl = menuRef.current;
    if (!menuEl) {
      return;
    }
    const items = Array.from(
      menuEl.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]'),
    );
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = items[(currentIndex + 1) % items.length];
      next?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = items[(currentIndex - 1 + items.length) % items.length];
      prev?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  return (
    <header className="hs-header">
      <div className="hs-brand">
        <h1 className="hs-title">
          <button
            type="button"
            className="hs-brand-btn"
            onClick={onNavigateHome}
            aria-label={`${appTitle} home`}
          >
            {appTitle}
          </button>
        </h1>
        <p className="hs-subtitle">
          {activeGameName ? `${activeGameName} · Offline Ready` : 'Offline Family Game Shelf'}
        </p>
      </div>

      <div className="hs-header-actions">
        {showSyncStatus && syncState && syncState.conflicts.length > 0 && onOpenConflicts ? (
          <button
            ref={conflictButtonRef}
            type="button"
            className="hs-sync-pill"
            data-tone="conflict"
            onClick={onOpenConflicts}
          >
            {syncState.conflicts.length === 1
              ? 'Resolve Conflict'
              : `Resolve Conflicts (${syncState.conflicts.length})`}
          </button>
        ) : showSyncStatus && syncState?.status === 'error' ? (
          <button
            type="button"
            className="hs-sync-pill"
            data-tone="error"
            aria-label="Sync error — open Settings"
            onClick={onOpenSettings}
          >
            Sync Error
          </button>
        ) : null}

        <div className="hs-profile-switcher" ref={switcherRef}>
          <button
            ref={triggerRef}
            type="button"
            className="hs-btn hs-btn-secondary hs-profile-trigger"
            aria-haspopup="dialog"
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
            <div
              ref={menuRef}
              className="hs-profile-menu"
              id={menuId}
              role="dialog"
              aria-modal="true"
              aria-labelledby={menuTitleId}
              tabIndex={-1}
              onKeyDown={handleMenuKeyDown}
            >
              <h2 id={menuTitleId} className="hs-sr-only">
                Switch profile
              </h2>
              <div role="menu" aria-labelledby={menuTitleId}>
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
            </div>
          ) : null}
        </div>

        <button
          ref={settingsButtonRef}
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
