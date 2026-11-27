import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaUpdateBanner() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) {
    return null;
  }

  return (
    <aside className="hs-pwa-banner" role="status" aria-live="polite">
      {needRefresh ? (
        <>
          <p className="hs-pwa-banner-text">
            A new version of Hearthside is ready. Update when you are between moves.
          </p>
          <div className="hs-btn-group">
            <button
              type="button"
              className="hs-btn hs-btn-primary"
              onClick={() => void updateServiceWorker(true)}
            >
              Reload to update
            </button>
            <button
              type="button"
              className="hs-btn hs-btn-secondary"
              onClick={() => setNeedRefresh(false)}
            >
              Later
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hs-pwa-banner-text">Ready for offline play.</p>
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => setOfflineReady(false)}
          >
            Dismiss
          </button>
        </>
      )}
    </aside>
  );
}
