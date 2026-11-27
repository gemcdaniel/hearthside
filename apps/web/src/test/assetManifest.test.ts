import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface AssetManifestEntry {
  path: string;
  source: string;
  license: string;
  attribution: string;
  tool: string;
  termsUrl: string;
}

interface AssetManifest {
  version: number;
  assets: AssetManifestEntry[];
}

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '../../../..');
const ASSETS_DIR = resolve(REPO_ROOT, 'assets');
const MANIFEST_PATH = resolve(ASSETS_DIR, 'manifest.json');

function walkFiles(dir: string, relativePrefix: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    if (entry.name === '.gitkeep') {
      continue;
    }
    const fullPath = resolve(dir, entry.name);
    const relPath = posix.join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, relPath));
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

describe('assets/manifest.json provenance guard (D6)', () => {
  it('records valid provenance metadata for every asset in assets/', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true);
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as AssetManifest;

    expect(Array.isArray(manifest.assets)).toBe(true);
    expect(manifest.assets.length).toBeGreaterThan(0);

    const seenPaths = new Set<string>();
    for (const entry of manifest.assets) {
      expect(entry.path.trim().length).toBeGreaterThan(0);
      expect(entry.source.trim().length).toBeGreaterThan(0);
      expect(entry.license.trim().length).toBeGreaterThan(0);
      expect(entry.attribution.trim().length).toBeGreaterThan(0);
      expect(entry.tool.trim().length).toBeGreaterThan(0);
      expect(entry.termsUrl.trim().length).toBeGreaterThan(0);
      expect(seenPaths.has(entry.path)).toBe(false);
      seenPaths.add(entry.path);

      if (entry.path.startsWith('assets/')) {
        expect(existsSync(resolve(REPO_ROOT, entry.path))).toBe(true);
      }
    }

    const assetFiles = walkFiles(ASSETS_DIR, 'assets').filter(
      (relPath) => relPath !== 'assets/manifest.json',
    );
    const unrecorded = assetFiles.filter((relPath) => !seenPaths.has(relPath));
    expect(unrecorded).toEqual([]);
  });
});
