//! Directory listing for the project-path autocomplete:
//! lists immediate subdirectory names under a given path.
//! On Windows, Linux-style paths (WSL) are listed inside WSL.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::storage::{is_linux_path, to_wsl_root_expr};

/// List immediate subdirectory names under `path`.
/// Returns `Ok(names)` — possibly empty — for an accessible directory.
/// Returns `Err` for a non-existent or inaccessible path.
pub fn list_directory(path: &str, windows: bool) -> Result<Vec<String>, String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("empty path".into());
    }
    if windows && is_linux_path(p) {
        list_wsl(p)
    } else {
        list_native(p)
    }
}

fn list_native(dir: &str) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.is_dir() {
                p.file_name().and_then(|n| n.to_str()).map(String::from)
            } else {
                None
            }
        })
        .collect();
    names.sort();
    Ok(names)
}

fn list_wsl(path: &str) -> Result<Vec<String>, String> {
    let expr = to_wsl_root_expr(path);
    // Test existence first; list directories only (ls -1p appends '/' to dirs,
    // grep '/$' keeps dirs only, sed strips the trailing slash).
    // `exit 0` after the pipeline ensures bash exits 0 even when grep finds
    // no matches — an empty directory is not an error.
    let script = format!(
        "if [ ! -d \"{expr}\" ]; then exit 1; fi\n\
         ls -1p \"{expr}\" 2>/dev/null | grep '/$' | sed 's|/$||'\n\
         exit 0\n"
    );
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--", "bash", "-s"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("wsl.exe: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes());
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!("not found: {path}"));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut names: Vec<String> = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect();
    names.sort();
    Ok(names)
}

fn no_window(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
}
