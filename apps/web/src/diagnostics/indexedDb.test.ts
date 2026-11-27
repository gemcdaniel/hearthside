import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SMOKE_RECORD_ID,
  deleteSmokeRecord,
  getStoragePersistenceStatus,
  readSmokeRecord,
  requestStoragePersistence,
  runIndexedDbSmokeTest,
  writeSmokeRecord,
} from './indexedDb';

describe('indexedDb diagnostics helper', () => {
  afterEach(async () => {
    await deleteSmokeRecord(DEFAULT_SMOKE_RECORD_ID);
    vi.restoreAllMocks();
  });

  it('writes, reads, and deletes a smoke test record', async () => {
    const record = {
      id: DEFAULT_SMOKE_RECORD_ID,
      timestamp: '2026-11-26T18:00:00.000Z',
      note: 'unit test',
    };

    await writeSmokeRecord(record);
    expect(await readSmokeRecord(record.id)).toEqual(record);

    await deleteSmokeRecord(record.id);
    expect(await readSmokeRecord(record.id)).toBeNull();
  });

  it('runs the full roundtrip smoke test cleanly', async () => {
    const result = await runIndexedDbSmokeTest();
    expect(result.readBack).toEqual(result.written);
    expect(result.deletedCleanly).toBe(true);
  });

  it('reports navigator.storage persistence status cleanly', async () => {
    const originalStorage = navigator.storage;

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: vi.fn().mockResolvedValue(true),
        persist: vi.fn().mockResolvedValue(true),
      },
    });

    expect(await getStoragePersistenceStatus()).toBe('granted');
    expect(await requestStoragePersistence()).toBe('granted');

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: undefined,
    });
    expect(await getStoragePersistenceStatus()).toBe('unsupported');

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: originalStorage,
    });
  });
});
