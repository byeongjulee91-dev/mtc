<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-02 | Updated: 2026-06-02 -->

# capabilities

## Purpose
Tauri capability files declare which permissions the frontend (a given window) is
allowed to use. They are the allow-list that gates IPC and plugin access at
runtime; without an entry here, a command or plugin API is rejected.

## Key Files

| File | Description |
|------|-------------|
| `default.json` | Capabilities for the `main` window. Grants `core:default` (baseline Tauri APIs) and `dialog:default` (the dialog plugin used by the folder picker in `RightPanel.svelte`). References the generated `../gen/schemas/desktop-schema.json`. |

## For AI Agents

### Working In This Directory
- When you add a Tauri plugin or use a permission-gated API, add the corresponding
  permission string here (e.g. `dialog:default`) or the call fails at runtime.
- The custom `#[tauri::command]`s in `../src/main.rs` are exposed via the invoke
  handler and do not each need a separate permission entry, but plugin APIs
  (like `tauri-plugin-dialog`) do.
- `$schema` points at generated schema under `../gen/` — leave it; it powers
  editor validation.

### Testing Requirements
- Verify at runtime: a missing permission surfaces as a denied-API error in the
  app. Exercise the affected feature (e.g. the "Browse folder" button) after
  changes.

### Common Patterns
- One capability file per logical permission set, scoped to named `windows`.

## Dependencies

### Internal
- `../gen/schemas/desktop-schema.json` (generated) — schema for validation.

### External
- `tauri` core + `tauri-plugin-dialog` permission sets.

<!-- MANUAL: -->
