# `@awesome-os/qt`

Zero-account, zero-installer **Qt 6 (`qtbase`)** SDK & shared runtime hydrated once per machine from [`awesome-os/b8g-ghost @ cas-v1`](https://github.com/awesome-os/b8g-ghost) (Keep-Last-5) for **`holo-compiler`**, **`ghost-cpp`**, and C++ desktop apps.

## Quick Install & Usage

### Install via `pnpm` (or release tarball)

```powershell
pnpm add github:awesome-os/qt
```

Or download the latest SHA-256 verified archive from [`Releases`](https://github.com/awesome-os/qt/releases/latest).

### Usage & Verification

```powershell
# Resolve/hydrate Qt 6 qtbase via CLI or inspect env exports
node src/cli.mts --dry-run
node src/cli.mts env --pwsh

# Verify locally (Node.js 22+)
node --test
```

## Why `@awesome-os/qt`?

- **Zero Qt Account Login:** No account creation, no license-gate wizard, no interactive installer prompts.
- **Zero 10 GB `MaintenanceTool`:** Hydrates only the zstd-compressed `qt6-base-<os>.tar.zst` SDK (`include/`, `lib/`, `bin/`, `lib/cmake/`) once per machine into `~/.b8g/cas/qt6/<sha256>/` with strict SHA-256 verification.
- **Keep-Last-5 Reproducibility:** Pin any of the last 5 `cas-v1` builds via `QT6_GHOST_SHA256=<sha256>` for deterministic CI and offline rollbacks.
- **Erasable TypeScript Direct Execution:** Runs natively on Node.js 22+ (`erasableSyntaxOnly: true`, zero build step).

## CLI Usage

```bash
# Hydrate Qt 6 qtbase into ~/.b8g/cas/qt6/<sha256>/
qt hydrate

# Dry-run resolution against live b8g-ghost cas-v1 index
qt --dry-run

# Print shell exports (POSIX sh/bash/zsh)
eval "$(qt env)"

# Print PowerShell exports
qt env --pwsh | Invoke-Expression

# Print machine-readable JSON (for holo-compiler / ghost-cpp / IDE tooling)
qt env --json
```

### Keep-Last-5 Pinning

```powershell
$env:QT6_GHOST_SHA256 = "<64-char-sha256-from-cas-v1-history>"
qt hydrate
```

## Programmatic API

```ts
import { hydrateQt, buildQtEnvExports } from '@awesome-os/qt';

const qt = await hydrateQt();
// { installDir, includeDir, libDir, binDir, cmakePrefixPath, entry, cacheHit }

const env = buildQtEnvExports(qt);
// { QT6_DIR, CMAKE_PREFIX_PATH, INCLUDE, LIB, PATH }
```

## Integration with `holo-compiler`, `ghost-cpp`, and CMake

### CMake

```bash
eval "$(qt env)"
cmake -B build -DCMAKE_PREFIX_PATH="$CMAKE_PREFIX_PATH"
cmake --build build
```

### `holo-compiler` & `ghost-cpp`

Use `qt env --json` or `await hydrateQt()` to pass `includeDir` (`-I`), `libDir` (`-L`), and `binDir` (`PATH` / `LD_LIBRARY_PATH`) directly into `holo-compiler` C++20/C++23 compilation units and `ghost-cpp` shared runtime loaders with zero per-project Qt SDK duplication.

## License

- Hydrator & CLI (`src/`, `test/`): **MIT**
- Hydrated Qt 6 (`qtbase`) SDK & shared runtime: **LGPL-3.0-or-later**

## Quick Install & Run (Windows / Linux / macOS)

```sh
# Install / hydrate from v11 CAS via holo-pm
holo-pm install repository://github.com/awesome-os/qt@main

# Or project & run directly via holo-project (0-byte hardlink)
holo-project "project://node/qt?from=repository://github.com/awesome-os/qt@main"
```
