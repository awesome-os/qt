/**
 * @file src/hydrate.mts
 * @description Resolves and hydrates Qt 6 (qtbase) SDK & shared runtime from
 * awesome-os/b8g-ghost @ cas-v1 into ~/.b8g/cas/qt6/<sha256>/ with SHA-256
 * verification and Keep-Last-5 QT6_GHOST_SHA256 pinning.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export const QT_PACKAGE_VERSION = '0.1.0';

export const GHOST_INDEX_URL =
  process.env.B8G_GHOST_INDEX_URL ??
  'https://raw.githubusercontent.com/awesome-os/b8g-ghost/main/manifests/index.json';

export const GHOST_CAS_BASE_URL =
  process.env.B8G_GHOST_CAS_URL ??
  'https://github.com/awesome-os/b8g-ghost/releases/download/cas-v1';

export interface QtCasHistoryEntry {
  sha256: string;
  bytes?: number;
  version?: string;
  retired_at?: string;
}

export interface QtCasEntry {
  filename: string;
  sha256: string;
  bytes: number;
  raw_bytes?: number;
  version?: string;
  category?: string;
  download_url: string;
  history?: Array<QtCasHistoryEntry | string>;
}

export interface GhostIndex {
  schema: string;
  cas_base_url: string;
  updated_at: string;
  total_entries: number;
  entries: Record<string, QtCasEntry>;
}

export interface QtInstallPaths {
  installDir: string;
  includeDir: string;
  libDir: string;
  binDir: string;
  cmakePrefixPath: string;
}

export interface QtHydrationResult extends QtInstallPaths {
  entry: QtCasEntry;
  cacheHit: boolean;
}

export interface QtEnvExports {
  QT6_DIR: string;
  CMAKE_PREFIX_PATH: string;
  INCLUDE: string;
  LIB: string;
  PATH: string;
}

export interface ResolveQtOptions {
  assetKey?: string;
  pinnedSha256?: string;
  index?: GhostIndex;
  indexUrl?: string;
  casBaseUrl?: string;
}

export interface HydrateQtOptions extends ResolveQtOptions {
  cacheDir?: string;
}

const HYDRATED_MARKER = '.b8g-qt6-hydrated';

export function getQtAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'qt6-base-win64.tar.zst';
  if (platform === 'darwin') return 'qt6-base-macos-arm64.tar.zst';
  return arch === 'arm64' ? 'qt6-base-linux-arm64.tar.zst' : 'qt6-base-linux-x64.tar.zst';
}

export function getGhostCacheDir(overrideDir?: string): string {
  const dir = overrideDir ?? process.env.B8G_GHOST_CACHE_DIR ?? join(homedir(), '.b8g', 'cas');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function fetchGhostIndex(indexUrl = GHOST_INDEX_URL): Promise<GhostIndex> {
  const res = await fetch(indexUrl, {
    headers: { 'User-Agent': `awesome-os-qt/${QT_PACKAGE_VERSION}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${indexUrl}`);
  }
  return (await res.json()) as GhostIndex;
}

export function applyQtPinnedSha(
  entry: QtCasEntry,
  pinnedShaRaw?: string,
  casBaseUrl = GHOST_CAS_BASE_URL,
): QtCasEntry {
  const pinnedSha = (pinnedShaRaw ?? process.env.QT6_GHOST_SHA256)?.trim().toLowerCase();
  if (!pinnedSha || pinnedSha === entry.sha256.toLowerCase()) {
    return entry;
  }

  for (const item of entry.history ?? []) {
    if (typeof item === 'string') {
      if (item.toLowerCase() === pinnedSha) {
        return {
          ...entry,
          sha256: pinnedSha,
          download_url: `${casBaseUrl}/${pinnedSha}`,
        };
      }
      continue;
    }
    if (item && typeof item === 'object' && item.sha256?.toLowerCase() === pinnedSha) {
      return {
        ...entry,
        sha256: item.sha256.toLowerCase(),
        bytes: item.bytes ?? entry.bytes,
        version: item.version ?? entry.version,
        download_url: `${casBaseUrl}/${item.sha256.toLowerCase()}`,
      };
    }
  }

  if (/^[a-f0-9]{64}$/.test(pinnedSha)) {
    return {
      ...entry,
      sha256: pinnedSha,
      download_url: `${casBaseUrl}/${pinnedSha}`,
    };
  }

  throw new Error(
    `Invalid QT6_GHOST_SHA256 "${pinnedSha}": expected a 64-character hex SHA-256 present in cas-v1 Keep-Last-5 history`,
  );
}

export async function resolveQtEntry(options: ResolveQtOptions = {}): Promise<QtCasEntry> {
  const assetKey = options.assetKey ?? getQtAssetKey();
  const idx = options.index ?? (await fetchGhostIndex(options.indexUrl));
  const entry = idx.entries[assetKey];
  if (!entry) {
    throw new Error(
      `Asset "${assetKey}" not found in b8g-ghost cas-v1 index (${idx.total_entries} entries)`,
    );
  }
  const casBaseUrl = options.casBaseUrl ?? idx.cas_base_url ?? GHOST_CAS_BASE_URL;
  return applyQtPinnedSha(entry, options.pinnedSha256, casBaseUrl);
}

export async function tryResolveQtEntry(
  options: ResolveQtOptions = {},
): Promise<{ entry: QtCasEntry | null; index: GhostIndex; assetKey: string }> {
  const assetKey = options.assetKey ?? getQtAssetKey();
  const index = options.index ?? (await fetchGhostIndex(options.indexUrl));
  const raw = index.entries[assetKey];
  if (!raw) {
    return { entry: null, index, assetKey };
  }
  const casBaseUrl = options.casBaseUrl ?? index.cas_base_url ?? GHOST_CAS_BASE_URL;
  return {
    entry: applyQtPinnedSha(raw, options.pinnedSha256, casBaseUrl),
    index,
    assetKey,
  };
}

function detectQtPrefixRoot(installDir: string): string {
  if (
    existsSync(join(installDir, 'include')) ||
    existsSync(join(installDir, 'lib')) ||
    existsSync(join(installDir, 'bin'))
  ) {
    return installDir;
  }
  if (existsSync(installDir)) {
    const children = readdirSync(installDir).filter((name) => !name.startsWith('.'));
    if (children.length === 1) {
      const nested = join(installDir, children[0]);
      if (
        statSync(nested).isDirectory() &&
        (existsSync(join(nested, 'include')) ||
          existsSync(join(nested, 'lib')) ||
          existsSync(join(nested, 'bin')))
      ) {
        return nested;
      }
    }
  }
  return installDir;
}

export function getQtInstallPaths(installDir: string): QtInstallPaths {
  const prefixRoot = detectQtPrefixRoot(installDir);
  const includeDir = join(prefixRoot, 'include');
  const libDir = join(prefixRoot, 'lib');
  const binDir = join(prefixRoot, 'bin');
  const cmakeDir = join(libDir, 'cmake');
  const cmakePrefixPath = existsSync(cmakeDir) ? prefixRoot : prefixRoot;
  return {
    installDir: prefixRoot,
    includeDir,
    libDir,
    binDir,
    cmakePrefixPath,
  };
}

export function isQtHydrated(installDir: string): boolean {
  if (!existsSync(installDir)) return false;
  if (existsSync(join(installDir, HYDRATED_MARKER))) return true;
  const paths = getQtInstallPaths(installDir);
  return existsSync(paths.includeDir) && existsSync(paths.libDir);
}

export async function hydrateQt(options: HydrateQtOptions = {}): Promise<QtHydrationResult> {
  const entry = await resolveQtEntry(options);
  const cacheDir = getGhostCacheDir(options.cacheDir);
  const installDir = join(cacheDir, 'qt6', entry.sha256);

  if (isQtHydrated(installDir)) {
    const paths = getQtInstallPaths(installDir);
    return { ...paths, entry, cacheHit: true };
  }

  const archivePath = join(cacheDir, `${entry.sha256}.tar.zst`);
  if (!existsSync(archivePath)) {
    const casBaseUrl = options.casBaseUrl ?? GHOST_CAS_BASE_URL;
    const url = entry.download_url || `${casBaseUrl}/${entry.sha256}`;
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': `awesome-os-qt/${QT_PACKAGE_VERSION}` },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} hydrating ${entry.filename} from ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== entry.sha256.toLowerCase()) {
      throw new Error(
        `SHA-256 mismatch for ${entry.filename}: expected ${entry.sha256}, got ${actual}`,
      );
    }
    const tmp = `${archivePath}.${process.pid}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, archivePath);
  }

  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['--zstd', '-xf', archivePath, '-C', installDir], { stdio: 'inherit' });
  writeFileSync(
    join(installDir, HYDRATED_MARKER),
    JSON.stringify(
      {
        filename: entry.filename,
        sha256: entry.sha256,
        version: entry.version ?? null,
        hydrated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  const paths = getQtInstallPaths(installDir);
  return { ...paths, entry, cacheHit: false };
}

export const ensureQtSdk = hydrateQt;

export function buildQtEnvExports(
  paths: QtInstallPaths,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): QtEnvExports {
  const sep = platform === 'win32' ? ';' : ':';
  const prepend = (dir: string, existing?: string): string =>
    existing && existing.length > 0 ? `${dir}${sep}${existing}` : dir;

  return {
    QT6_DIR: paths.installDir,
    CMAKE_PREFIX_PATH: prepend(paths.cmakePrefixPath, env.CMAKE_PREFIX_PATH),
    INCLUDE: prepend(paths.includeDir, env.INCLUDE),
    LIB: prepend(paths.libDir, env.LIB),
    PATH: prepend(paths.binDir, env.PATH ?? env.Path ?? (delimiter === ';' ? '' : '')),
  };
}

export function formatQtEnvShell(
  exportsObj: QtEnvExports,
  format: 'posix' | 'pwsh' | 'json' = 'posix',
): string {
  if (format === 'json') {
    return JSON.stringify(exportsObj, null, 2);
  }
  const entries = Object.entries(exportsObj) as Array<[keyof QtEnvExports, string]>;
  if (format === 'pwsh') {
    return entries
      .map(([key, value]) => `$env:${key} = '${value.replaceAll("'", "''")}'`)
      .join('\n');
  }
  return entries
    .map(([key, value]) => `export ${key}='${value.replaceAll("'", "'\\''")}'`)
    .join('\n');
}
