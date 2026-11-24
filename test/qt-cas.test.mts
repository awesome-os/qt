import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import {
  QT_PACKAGE_VERSION,
  applyQtPinnedSha,
  buildQtEnvExports,
  fetchGhostIndex,
  formatQtEnvShell,
  getQtAssetKey,
  getQtInstallPaths,
  tryResolveQtEntry,
  type QtCasEntry,
} from '../src/index.mts';

const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli.mts');

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: { ...process.env },
  });
}

test('gracefully checks qt6-base-* in live awesome-os/b8g-ghost cas-v1 index', async () => {
  const index = await fetchGhostIndex();
  assert.equal(index.schema, 'b8g-ghost-cas-index-v1');
  assert.ok(index.total_entries > 0, 'Expected non-empty cas-v1 index');

  const keys = ['qt6-base-win64.tar.zst', 'qt6-base-linux-x64.tar.zst'];
  for (const key of keys) {
    const resolved = await tryResolveQtEntry({ assetKey: key, index });
    assert.equal(resolved.assetKey, key);
    if (resolved.entry) {
      assert.equal(resolved.entry.filename, key);
      assert.match(resolved.entry.sha256, /^[a-f0-9]{64}$/);
      assert.ok(resolved.entry.bytes > 0, `Expected positive byte size for ${key}`);
      assert.ok(
        resolved.entry.download_url.includes(resolved.entry.sha256),
        `Expected CAS download URL for ${key}`,
      );
    }
  }
});

test('supports Keep-Last-5 QT6_GHOST_SHA256 pinning from entry history', () => {
  const latestSha = 'a'.repeat(64);
  const prevSha = 'b'.repeat(64);
  const entry: QtCasEntry = {
    filename: getQtAssetKey('linux', 'x64'),
    sha256: latestSha,
    bytes: 50_000_000,
    version: '6.8.3',
    download_url: `https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1/${latestSha}`,
    history: [
      {
        sha256: prevSha,
        bytes: 49_000_000,
        version: '6.8.2',
        retired_at: '2026-11-24T00:00:00.000Z',
      },
    ],
  };

  const pinned = applyQtPinnedSha(entry, prevSha);
  assert.equal(pinned.sha256, prevSha);
  assert.equal(pinned.version, '6.8.2');
  assert.equal(pinned.bytes, 49_000_000);
  assert.ok(pinned.download_url.endsWith(`/${prevSha}`));
});

test('builds and formats QT6_DIR, CMAKE_PREFIX_PATH, INCLUDE, LIB, PATH exports', () => {
  const paths = getQtInstallPaths('/tmp/qt6-sample');
  const exportsObj = buildQtEnvExports(paths, { PATH: '/usr/bin' }, 'linux');
  assert.equal(exportsObj.QT6_DIR, paths.installDir);
  assert.equal(exportsObj.CMAKE_PREFIX_PATH, paths.cmakePrefixPath);
  assert.equal(exportsObj.INCLUDE, paths.includeDir);
  assert.equal(exportsObj.LIB, paths.libDir);
  assert.ok(exportsObj.PATH.startsWith(`${paths.binDir}:`));

  const pwsh = formatQtEnvShell(exportsObj, 'pwsh');
  assert.match(pwsh, /\$env:QT6_DIR = /);
  assert.match(pwsh, /\$env:CMAKE_PREFIX_PATH = /);

  const posix = formatQtEnvShell(exportsObj, 'posix');
  assert.match(posix, /export QT6_DIR=/);
  assert.match(posix, /export CMAKE_PREFIX_PATH=/);
});

test('CLI --version reports @awesome-os/qt version', () => {
  const out = runCli(['--version']).trim();
  assert.equal(out, `@awesome-os/qt ${QT_PACKAGE_VERSION}`);
});

test('CLI --dry-run resolves live cas-v1 index cleanly without downloading', () => {
  const out = runCli(['--dry-run', '--json']);
  const payload = JSON.parse(out) as {
    dryRun: boolean;
    status: string;
    assetKey: string;
    indexSchema: string;
    installDir: string;
    cmakePrefixPath: string;
  };
  assert.equal(payload.dryRun, true);
  assert.equal(payload.indexSchema, 'b8g-ghost-cas-index-v1');
  assert.equal(payload.assetKey, getQtAssetKey());
  assert.ok(['cached', 'available', 'pending'].includes(payload.status));
  assert.ok(payload.installDir.length > 0);
  assert.ok(payload.cmakePrefixPath.length > 0);
});

test('CLI env --json emits QT6_DIR, CMAKE_PREFIX_PATH, INCLUDE, LIB, PATH', () => {
  const out = runCli(['env', '--json']);
  const payload = JSON.parse(out) as {
    status: string;
    assetKey: string;
    QT6_DIR: string;
    CMAKE_PREFIX_PATH: string;
    INCLUDE: string;
    LIB: string;
    PATH: string;
  };
  assert.ok(['ready', 'resolved', 'pending'].includes(payload.status));
  assert.equal(payload.assetKey, getQtAssetKey());
  assert.ok(payload.QT6_DIR.length > 0);
  assert.ok(payload.CMAKE_PREFIX_PATH.length > 0);
  assert.ok(payload.INCLUDE.length > 0);
  assert.ok(payload.LIB.length > 0);
  assert.ok(payload.PATH.length > 0);
});
