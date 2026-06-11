// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), cfg_attr(target_os = "windows", windows_subsystem = "windows"))]

mod git;
mod profile;
mod pty;
mod storage;

use serde_json::Value;
use tauri::{ipc::Channel, Manager};

use profile::Profile;
use pty::{PtyManager, PtyMessage};
use storage::Discovery;

#[tauri::command]
fn load_app_data(app: tauri::AppHandle) -> Result<Value, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir: {e}"))?;
    Ok(storage::load_app_data(&dir))
}

#[tauri::command]
fn save_app_data(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("config dir: {e}"))?;
    storage::save_app_data(&dir, &data)
}

/// Discover skills with zero manual configuration: the user's manual roots plus
/// the host + WSL user skill dirs and the active project's `.claude/skills` /
/// `.codex/skills`.
/// WSL roots are scanned inside WSL (so owner-only/symlinked skills resolve).
/// Returns the merged skill list and the roots consulted. `project_path` is the
/// active project's path, or `None`.
#[tauri::command]
async fn discover_skills(
    app: tauri::AppHandle,
    manual_roots: Vec<String>,
    project_path: Option<String>,
    include_global: bool,
) -> Result<Discovery, String> {
    let home = app.path().home_dir().ok();
    let windows = cfg!(windows);
    // The WSL branch spawns `wsl.exe` and blocks on its output; run the whole
    // scan on the blocking pool so a project switch never freezes the UI
    // (synchronous Tauri commands run on the main thread).
    tauri::async_runtime::spawn_blocking(move || {
        storage::discover_skills(
            home.as_deref(),
            &manual_roots,
            project_path.as_deref(),
            windows,
            include_global,
        )
    })
    .await
    .map_err(|e| format!("skill discovery failed: {e}"))
}

/// Count modified (changed) git-tracked files in a project directory.
/// `Ok(None)` = empty path; `Ok(Some(n))` = a git repo with `n` changed tracked
/// files; `Err(reason)` = git failed (not a repo, git not on PATH, etc.) so the
/// frontend can surface the reason. On Windows a Linux-style path is counted
/// inside WSL; native paths run `git` directly. Spawns a process and blocks on
/// it, so it runs on the blocking pool to keep project switches from freezing
/// the UI.
#[tauri::command]
async fn count_git_modified(path: String) -> Result<Option<u32>, String> {
    let windows = cfg!(windows);
    tauri::async_runtime::spawn_blocking(move || git::count_modified_files(&path, windows))
        .await
        .map_err(|e| format!("git modified count failed: {e}"))?
}

#[tauri::command]
fn create_session(
    manager: tauri::State<PtyManager>,
    profile: Profile,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyMessage>,
) -> Result<u32, String> {
    manager.create(&profile, cols, rows, on_event)
}

#[tauri::command]
fn write_session(manager: tauri::State<PtyManager>, id: u32, data: String) -> Result<(), String> {
    manager.write(id, &data)
}

#[tauri::command]
fn resize_session(
    manager: tauri::State<PtyManager>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(id, cols, rows)
}

#[tauri::command]
fn close_session(manager: tauri::State<PtyManager>, id: u32) -> Result<(), String> {
    manager.close(id)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            discover_skills,
            count_git_modified,
            create_session,
            write_session,
            resize_session,
            close_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mtc");
}
