import { getAppInfo } from './appInfo';

export function App() {
  const { title, themeName, themeMode } = getAppInfo();

  return (
    <main>
      <h1>{title}</h1>
      <p>
        Workspace shell ready ({themeName} / {themeMode}).
      </p>
    </main>
  );
}
