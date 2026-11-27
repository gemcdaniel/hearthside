const DB_NAME = 'hearthside-diagnostics';
const DB_VERSION = 1;
const STORE_NAME = 'smoke_tests';
export const DEFAULT_SMOKE_RECORD_ID = 'phase-0-smoke';

export interface SmokeTestRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly note: string;
}

export type StoragePersistenceStatus = 'granted' | 'denied' | 'unsupported';

function getIndexedDbFactory(): IDBFactory {
  if (typeof globalThis.indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable in this browser context.');
  }
  return globalThis.indexedDB;
}

function openDiagnosticsDb(): Promise<IDBDatabase> {
  const factory = getIndexedDbFactory();

  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open diagnostics IndexedDB database.'));
  });
}

function isSmokeTestRecord(value: unknown): value is SmokeTestRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.note === 'string'
  );
}

export async function writeSmokeRecord(record: SmokeTestRecord): Promise<void> {
  const db = await openDiagnosticsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onerror = () => reject(req.error ?? new Error('Failed to write smoke test record.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write transaction aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function readSmokeRecord(
  id = DEFAULT_SMOKE_RECORD_ID,
): Promise<SmokeTestRecord | null> {
  const db = await openDiagnosticsDb();
  try {
    return await new Promise<SmokeTestRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const result: unknown = req.result;
        if (result === undefined || result === null) {
          resolve(null);
          return;
        }
        resolve(isSmokeTestRecord(result) ? result : null);
      };
      req.onerror = () => reject(req.error ?? new Error('Failed to read smoke test record.'));
    });
  } finally {
    db.close();
  }
}

export async function deleteSmokeRecord(id = DEFAULT_SMOKE_RECORD_ID): Promise<void> {
  const db = await openDiagnosticsDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onerror = () => reject(req.error ?? new Error('Failed to delete smoke test record.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete transaction aborted.'));
    });
  } finally {
    db.close();
  }
}

export interface SmokeTestRoundtripResult {
  readonly written: SmokeTestRecord;
  readonly readBack: SmokeTestRecord | null;
  readonly deletedCleanly: boolean;
}

export async function runIndexedDbSmokeTest(): Promise<SmokeTestRoundtripResult> {
  const record: SmokeTestRecord = {
    id: `${DEFAULT_SMOKE_RECORD_ID}-roundtrip`,
    timestamp: new Date().toISOString(),
    note: 'Phase 0 IndexedDB roundtrip',
  };
  await writeSmokeRecord(record);
  const readBack = await readSmokeRecord(record.id);
  await deleteSmokeRecord(record.id);
  const afterDelete = await readSmokeRecord(record.id);
  return {
    written: record,
    readBack,
    deletedCleanly: afterDelete === null,
  };
}

export async function getStoragePersistenceStatus(): Promise<StoragePersistenceStatus> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage === 'undefined' ||
    typeof navigator.storage.persisted !== 'function'
  ) {
    return 'unsupported';
  }
  const persisted = await navigator.storage.persisted();
  return persisted ? 'granted' : 'denied';
}

export async function requestStoragePersistence(): Promise<StoragePersistenceStatus> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage === 'undefined' ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return getStoragePersistenceStatus();
  }
  const granted = await navigator.storage.persist();
  return granted ? 'granted' : 'denied';
}
