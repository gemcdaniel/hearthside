import { MODE_OPTIONS, THEME_OPTIONS, type ThemeMode, type ThemeName } from './theme';

export interface ThemeSwitcherProps {
  readonly theme: ThemeName;
  readonly mode: ThemeMode;
  readonly onThemeChange: (theme: ThemeName) => void;
  readonly onModeChange: (mode: ThemeMode) => void;
}

export function ThemeSwitcher({ theme, mode, onThemeChange, onModeChange }: ThemeSwitcherProps) {
  return (
    <div className="hs-theme-switcher" aria-label="Theme and color mode controls">
      <div className="hs-switcher-group" role="group" aria-label="Theme">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="hs-switcher-btn"
            aria-pressed={theme === option.id}
            onClick={() => onThemeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="hs-switcher-group" role="group" aria-label="Color mode">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="hs-switcher-btn"
            aria-pressed={mode === option.id}
            onClick={() => onModeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
