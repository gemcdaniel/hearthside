import { useEffect, useState } from 'react';
import {
  DEFAULT_SMOKE_RECORD_ID,
  deleteSmokeRecord,
  getStoragePersistenceStatus,
  readSmokeRecord,
  requestStoragePersistence,
  runIndexedDbSmokeTest,
  writeSmokeRecord,
  type StoragePersistenceStatus,
} from '../diagnostics/indexedDb';
import { playSmokeChime } from '../diagnostics/webAudio';

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

export function DiagnosticsPanel() {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [persistStatus, setPersistStatus] = useState<StoragePersistenceStatus | 'checking'>(
    'checking',
  );
  const [idbStatus, setIdbStatus] = useState<string>('Idle — not run yet.');
  const [audioStatus, setAudioStatus] = useState<string>('Tap Play Chime to test Web Audio.');
  const [busyIdb, setBusyIdb] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    let active = true;
    void requestStoragePersistence()
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

    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function handleWriteRecord() {
    setBusyIdb(true);
    try {
      const timestamp = new Date().toISOString();
      await writeSmokeRecord({
        id: DEFAULT_SMOKE_RECORD_ID,
        timestamp,
        note: 'Phase 0 manual write',
      });
      setIdbStatus(`Wrote record at ${timestamp}.`);
    } catch (err) {
      setIdbStatus(err instanceof Error ? err.message : 'IndexedDB write failed.');
    } finally {
      setBusyIdb(false);
    }
  }

  async function handleReadRecord() {
    setBusyIdb(true);
    try {
      const record = await readSmokeRecord(DEFAULT_SMOKE_RECORD_ID);
      if (!record) {
        setIdbStatus('No smoke record found in IndexedDB.');
      } else {
        setIdbStatus(`Read record (${record.timestamp}).`);
      }
    } catch (err) {
      setIdbStatus(err instanceof Error ? err.message : 'IndexedDB read failed.');
    } finally {
      setBusyIdb(false);
    }
  }

  async function handleDeleteRecord() {
    setBusyIdb(true);
    try {
      await deleteSmokeRecord(DEFAULT_SMOKE_RECORD_ID);
      const after = await readSmokeRecord(DEFAULT_SMOKE_RECORD_ID);
      setIdbStatus(
        after === null
          ? 'Deleted smoke record cleanly.'
          : 'Delete attempted, but record still exists.',
      );
    } catch (err) {
      setIdbStatus(err instanceof Error ? err.message : 'IndexedDB delete failed.');
    } finally {
      setBusyIdb(false);
    }
  }

  async function handleFullRoundtrip() {
    setBusyIdb(true);
    try {
      const result = await runIndexedDbSmokeTest();
      if (result.readBack?.timestamp === result.written.timestamp && result.deletedCleanly) {
        setIdbStatus(`Pass: wrote, read (${result.readBack.timestamp}), and deleted smoke record.`);
      } else {
        setIdbStatus('Roundtrip mismatch: read/delete verification failed.');
      }
    } catch (err) {
      setIdbStatus(err instanceof Error ? err.message : 'IndexedDB roundtrip failed.');
    } finally {
      setBusyIdb(false);
    }
  }

  async function handleRequestPersist() {
    const status = await requestStoragePersistence().catch(() => getStoragePersistenceStatus());
    setPersistStatus(status);
  }

  async function handlePlayChime() {
    const result = await playSmokeChime();
    if (result.played) {
      setAudioStatus(`Played chime (AudioContext: ${result.state}).`);
    } else {
      setAudioStatus(result.reason ?? `Audio unavailable (${result.state}).`);
    }
  }

  return (
    <section className="hs-diagnostics" aria-label="Phase 0 Diagnostics">
      <div className="hs-diagnostics-header">
        <h2 className="hs-section-title">Phase 0 Diagnostics</h2>
        <span className="hs-badge" data-tone={isOnline ? 'success' : 'warning'} aria-live="polite">
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="hs-diagnostics-grid">
        <div className="hs-diag-card">
          <div className="hs-diag-row">
            <span className="hs-diag-label">IndexedDB Smoke Test</span>
            <div className="hs-btn-group">
              <button
                type="button"
                className="hs-btn hs-btn-primary"
                disabled={busyIdb}
                onClick={() => void handleFullRoundtrip()}
              >
                Run Full Test
              </button>
              <button
                type="button"
                className="hs-btn hs-btn-secondary"
                disabled={busyIdb}
                onClick={() => void handleWriteRecord()}
              >
                Write
              </button>
              <button
                type="button"
                className="hs-btn hs-btn-secondary"
                disabled={busyIdb}
                onClick={() => void handleReadRecord()}
              >
                Read
              </button>
              <button
                type="button"
                className="hs-btn hs-btn-secondary"
                disabled={busyIdb}
                onClick={() => void handleDeleteRecord()}
              >
                Delete
              </button>
            </div>
          </div>
          <p className="hs-diag-output" aria-live="polite">
            {idbStatus}
          </p>
        </div>

        <div className="hs-diag-card">
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
              Check / Request Persist
            </button>
          </div>
        </div>

        <div className="hs-diag-card">
          <div className="hs-diag-row">
            <span className="hs-diag-label">Web Audio Smoke Test</span>
            <button
              type="button"
              className="hs-btn hs-btn-primary"
              onClick={() => void handlePlayChime()}
            >
              Play Chime
            </button>
          </div>
          <p className="hs-diag-output" aria-live="polite">
            {audioStatus}
          </p>
        </div>
      </div>
    </section>
  );
}
