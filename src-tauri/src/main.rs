// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), cfg_attr(target_os = "windows", windows_subsystem = "windows"))]

mod profile;
mod pty;
mod storage;

use serde_json::Value;
use tauri::{ipc::Channel, Manager};

use profile::Profile;
use pty::{PtyManager, PtyMessage};
use storage::Skill;

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

#[tauri::command]
fn scan_skills(app: tauri::AppHandle, roots: Vec<String>) -> Vec<Skill> {
    // If no roots configured, default to the host's ~/.claude/skills.
    let mut roots = roots;
    if roots.iter().all(|r| r.trim().is_empty()) {
        if let Ok(home) = app.path().home_dir() {
            roots.push(home.join(".claude").join("skills").to_string_lossy().to_string());
        }
    }
    storage::scan_skills(&roots)
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
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            scan_skills,
            create_session,
            write_session,
            resize_session,
            close_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running mtc");
}
