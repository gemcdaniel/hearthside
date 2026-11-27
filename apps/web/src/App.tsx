import { getAppInfo } from './appInfo';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { PlaceholderGrid } from './components/PlaceholderGrid';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';

export function App() {
  const { title, themeName, themeMode } = getAppInfo();

  return (
    <div className="hs-shell" data-theme-name={themeName} data-theme-mode={themeMode}>
      <header className="hs-header">
        <h1 className="hs-title">{title}</h1>
        <p className="hs-subtitle">Phase 0 Walking Skeleton</p>
      </header>

      <main>
        <PlaceholderGrid />
      </main>

      <DiagnosticsPanel />
      <PwaUpdateBanner />
    </div>
  );
}
