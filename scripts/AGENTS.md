<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# scripts

## Purpose
Build-time helper scripts that are run manually (not part of the normal dev/build
loop). Currently this is just the app-icon generator.

## Key Files

| File | Description |
|------|-------------|
| `gen-icon.mjs` | Generates the 1024×1024 source icon at `../app-icon.png` with **no image dependencies** — it hand-encodes a PNG (a dark rounded square with an orange `>_` prompt glyph). The output is then fed to `tauri icon` to produce the platform icon set under `../src-tauri/icons/`. |

## For AI Agents

### Working In This Directory
- Run with `node scripts/gen-icon.mjs` from the repo root; it writes
  `../app-icon.png` (path is relative to the script via `import.meta.url`).
- Regenerating the source PNG does **not** update the bundled icons — run
  `npm run tauri icon` afterwards to refresh `src-tauri/icons/`.
- The PNG is encoded by hand (IHDR/IDAT/IEND chunks, CRC32, zlib `deflateSync`).
  Edit the drawing helpers (`inRounded`, `stroke`) and colors (`bg`/`fg`) to
  change the artwork; keep the chunk-encoding logic intact.

### Testing Requirements
- Visual: open the regenerated `app-icon.png` and confirm the glyph renders.
- Pipeline: `npm run tauri icon` should consume it without error.

### Common Patterns
- Pure Node ESM (`.mjs`), standard library only (`node:zlib`, `node:fs`).

## Dependencies

### External
- Node.js built-ins only (`node:zlib`, `node:fs`). No npm packages.

<!-- MANUAL: -->
