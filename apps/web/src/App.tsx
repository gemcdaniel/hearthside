import {
  ThemeSwitcher,
  applyThemeToDocument,
  type ThemeMode,
  type ThemeName,
  type ThemePreference,
} from '@hearthside/ui';
import { useEffect, useState } from 'react';
import { getAppTitle } from './appInfo';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { PlaceholderGrid } from './components/PlaceholderGrid';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';
import {
  loadInitialThemePreference,
  readPersistedThemePreference,
  saveThemePreference,
} from './storage/themeStorage';

export function App() {
  const title = getAppTitle();
  const [preference, setPreference] = useState<ThemePreference>(() => loadInitialThemePreference());

  useEffect(() => {
    applyThemeToDocument(preference);
  }, [preference]);

  useEffect(() => {
    let active = true;
    void readPersistedThemePreference().then((persisted) => {
      if (!active || !persisted) {
        return;
      }
      setPreference((current) =>
        current.theme === persisted.theme && current.mode === persisted.mode ? current : persisted,
      );
    });
    return () => {
      active = false;
    };
  }, []);

  function updateTheme(theme: ThemeName) {
    const next: ThemePreference = { ...preference, theme };
    setPreference(next);
    void saveThemePreference(next);
  }

  function updateMode(mode: ThemeMode) {
    const next: ThemePreference = { ...preference, mode };
    setPreference(next);
    void saveThemePreference(next);
  }

  return (
    <div className="hs-shell">
      <header className="hs-header">
        <div className="hs-brand">
          <h1 className="hs-title">{title}</h1>
          <p className="hs-subtitle">Phase 0 Walking Skeleton</p>
        </div>
        <ThemeSwitcher
          theme={preference.theme}
          mode={preference.mode}
          onThemeChange={updateTheme}
          onModeChange={updateMode}
        />
      </header>

      <main>
        <PlaceholderGrid />
      </main>

      <DiagnosticsPanel />
      <PwaUpdateBanner />
    </div>
  );
}
