#!/usr/bin/env node
/**
 * @file src/cli.mts
 * @description Zero-account, zero-installer Qt 6 (qtbase) CLI:
 *   - `qt hydrate`     : Hydrates Qt 6 qtbase into ~/.b8g/cas/qt6/<sha256>/
 *   - `qt env`         : Prints shell-ready QT6_DIR, CMAKE_PREFIX_PATH, INCLUDE, LIB, PATH exports
 *   - `qt --dry-run`   : Resolves cas-v1 entry and prints planned CAS paths without downloading
 *   - `qt --version`   : Prints CLI version
 *   - `qt --help`      : Prints usage help
 */

import { join } from 'node:path';
import {
  QT_PACKAGE_VERSION,
  buildQtEnvExports,
  formatQtEnvShell,
  getGhostCacheDir,
  getQtAssetKey,
  getQtInstallPaths,
  hydrateQt,
  isQtHydrated,
  tryResolveQtEntry,
} from './hydrate.mts';

export function printHelp(): string {
  return [
    `@awesome-os/qt v${QT_PACKAGE_VERSION} — Zero-account, zero-installer Qt 6 (qtbase) CAS SDK`,
    '',
    'Usage:',
    '  qt hydrate [--dry-run] [--json] [--asset <key>] [--sha256 <hex>]',
    '  qt env [--json | --pwsh] [--dry-run] [--dir <path>] [--asset <key>] [--sha256 <hex>]',
    '  qt --dry-run [--json]',
    '  qt --version',
    '  qt --help',
    '',
    'Environment:',
    '  QT6_GHOST_SHA256     Pin a Keep-Last-5 SHA-256 from awesome-os/b8g-ghost cas-v1',
    '  B8G_GHOST_CACHE_DIR  Override local CAS directory (default: ~/.b8g/cas)',
    '  B8G_GHOST_INDEX_URL  Override cas-v1 manifest index URL',
  ].join('\n');
}

interface ParsedArgs {
  command: string | null;
  dryRun: boolean;
  json: boolean;
  pwsh: boolean;
  version: boolean;
  help: boolean;
  assetKey?: string;
  pinnedSha256?: string;
  dir?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: null,
    dryRun: false,
    json: false,
    pwsh: false,
    version: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--pwsh') {
      parsed.pwsh = true;
    } else if (arg === '--version' || arg === '-v') {
      parsed.version = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--asset' && argv[i + 1]) {
      parsed.assetKey = argv[++i];
    } else if (arg === '--sha256' && argv[i + 1]) {
      parsed.pinnedSha256 = argv[++i];
    } else if (arg === '--dir' && argv[i + 1]) {
      parsed.dir = argv[++i];
    } else if (!arg.startsWith('-') && !parsed.command) {
      parsed.command = arg;
    }
  }

  return parsed;
}

async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.version) {
    console.log(`@awesome-os/qt ${QT_PACKAGE_VERSION}`);
    return 0;
  }

  if (args.help || (!args.command && !args.dryRun)) {
    console.log(printHelp());
    return 0;
  }

  const assetKey = args.assetKey ?? getQtAssetKey();
  const cacheDir = getGhostCacheDir();

  if (args.command === 'env') {
    let installDir: string;
    let status: 'ready' | 'resolved' | 'pending' = 'pending';
    let sha256: string | null = null;
    let hydrated = false;

    if (args.dir) {
      installDir = args.dir;
      hydrated = isQtHydrated(installDir);
      status = hydrated ? 'ready' : 'resolved';
    } else {
      const resolved = await tryResolveQtEntry({
        assetKey,
        pinnedSha256: args.pinnedSha256,
      });
      if (resolved.entry) {
        sha256 = resolved.entry.sha256;
        installDir = join(cacheDir, 'qt6', resolved.entry.sha256);
        hydrated = isQtHydrated(installDir);
        status = hydrated ? 'ready' : 'resolved';
      } else {
        const fallbackKey = (args.pinnedSha256 ?? process.env.QT6_GHOST_SHA256)?.trim() || 'pending';
        installDir = join(cacheDir, 'qt6', fallbackKey);
        status = 'pending';
      }
    }

    const paths = getQtInstallPaths(installDir);
    const exportsObj = buildQtEnvExports(paths);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            status,
            hydrated,
            assetKey,
            sha256,
            ...paths,
            env: exportsObj,
            ...exportsObj,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const fmt = args.pwsh ? 'pwsh' : process.platform === 'win32' ? 'pwsh' : 'posix';
    console.log(formatQtEnvShell(exportsObj, fmt));
    return 0;
  }

  if (args.dryRun || args.command === 'hydrate') {
    if (args.dryRun) {
      const resolved = await tryResolveQtEntry({
        assetKey,
        pinnedSha256: args.pinnedSha256,
      });
      const sha256 = resolved.entry?.sha256 ?? null;
      const installDir = join(cacheDir, 'qt6', sha256 ?? 'pending');
      const paths = getQtInstallPaths(installDir);
      const cacheHit = sha256 ? isQtHydrated(installDir) : false;
      const payload = {
        dryRun: true,
        status: resolved.entry ? (cacheHit ? 'cached' : 'available') : 'pending',
        assetKey,
        indexSchema: resolved.index.schema,
        totalEntries: resolved.index.total_entries,
        entry: resolved.entry,
        cacheHit,
        ...paths,
      };
      if (args.json) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(
          [
            `[@awesome-os/qt] dry-run (${payload.status})`,
            `  asset:     ${assetKey}`,
            `  sha256:    ${sha256 ?? '(pending publication in cas-v1)'}`,
            `  install:   ${paths.installDir}`,
            `  cmake:     ${paths.cmakePrefixPath}`,
            `  cacheHit:  ${cacheHit}`,
          ].join('\n'),
        );
      }
      return 0;
    }

    const result = await hydrateQt({
      assetKey,
      pinnedSha256: args.pinnedSha256,
      cacheDir,
    });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        [
          `[@awesome-os/qt] hydrated ${result.entry.filename} (${result.entry.version ?? 'latest'})`,
          `  sha256:    ${result.entry.sha256}`,
          `  install:   ${result.installDir}`,
          `  include:   ${result.includeDir}`,
          `  lib:       ${result.libDir}`,
          `  bin:       ${result.binDir}`,
          `  cmake:     ${result.cmakePrefixPath}`,
          `  cacheHit:  ${result.cacheHit}`,
        ].join('\n'),
      );
    }
    return 0;
  }

  console.error(`Unknown command: ${args.command}\n`);
  console.error(printHelp());
  return 1;
}

const isMain =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop() ?? '');

if (isMain) {
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
