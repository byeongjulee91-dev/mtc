//! Counting git-tracked files for a project directory.
//!
//! On Windows a project path is usually a Linux-style WSL path (`/mnt/c/…` or
//! `~/…`), where the repo and `git` actually live, so we count inside WSL — the
//! same host/WSL split the skill scanner uses. Native paths (a Windows path, or
//! a real host path under Unix dev mode) run `git` directly.

use std::io::Write;
use std::process::{Command, Output, Stdio};

use crate::storage::{is_linux_path, to_wsl_root_expr};

/// Count git-tracked files in `path`:
/// - `Ok(None)` — the path is empty (nothing to count).
/// - `Ok(Some(n))` — a git work tree with `n` tracked files (possibly `0`).
/// - `Err(reason)` — git failed: not a repo, git not on PATH, dubious ownership,
///   etc. `reason` is a short message (git's first stderr line, or the spawn
///   error) the frontend can surface/log instead of silently hiding the badge.
pub fn count_tracked_files(path: &str, windows: bool) -> Result<Option<u32>, String> {
    let p = path.trim();
    if p.is_empty() {
        return Ok(None);
    }
    let out = if windows && is_linux_path(p) {
        run_in_wsl(p)
    } else {
        run_native(p)
    }
    .map_err(|e| format!("git을 실행하지 못했습니다: {e}"))?;
    if out.status.success() {
        Ok(Some(count_entries(&out.stdout)))
    } else {
        Err(failure_reason(&out))
    }
}

/// `git -C <path> ls-files -z` on the host.
fn run_native(path: &str) -> std::io::Result<Output> {
    let mut cmd = Command::new("git");
    cmd.args(["-C", path, "ls-files", "-z"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);
    cmd.output()
}

/// The same count inside the WSL default distro for a Linux-style path. The
/// command is fed over stdin (`bash -s`) so a leading `~` expands via `$HOME`
/// inside the quotes; git's exit status propagates as bash's.
fn run_in_wsl(path: &str) -> std::io::Result<Output> {
    let expr = to_wsl_root_expr(path);
    let script = format!("git -C \"{expr}\" ls-files -z\n");
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--", "bash", "-s"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_window(&mut cmd);
    let mut child = cmd.spawn()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes()); // dropped here → EOF
    }
    child.wait_with_output()
}

/// A concise failure reason: git's first non-empty stderr line, else its code.
fn failure_reason(out: &Output) -> String {
    let stderr = String::from_utf8_lossy(&out.stderr);
    match stderr.lines().map(str::trim).find(|l| !l.is_empty()) {
        Some(line) => line.to_string(),
        None => format!("git 비정상 종료 (코드 {})", out.status.code().unwrap_or(-1)),
    }
}

/// Windows: launch without allocating a console so the GUI app doesn't flash a
/// window each time git runs (on project switch / window focus). No-op elsewhere.
fn no_window(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
}

/// Number of entries in `git ls-files -z` output: each tracked path is
/// NUL-terminated, so the count is the number of NUL bytes. `-z` makes this
/// robust to filenames containing newlines.
fn count_entries(bytes: &[u8]) -> u32 {
    bytes.iter().filter(|&&b| b == 0).count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_nul_terminated_entries() {
        assert_eq!(count_entries(b""), 0);
        assert_eq!(count_entries(b"a\0"), 1);
        assert_eq!(count_entries(b"a/b.rs\0c.txt\0dir/with\nnewline\0"), 3);
    }

    #[test]
    fn empty_path_is_ok_none() {
        assert_eq!(count_tracked_files("", true), Ok(None));
        assert_eq!(count_tracked_files("   ", false), Ok(None));
    }
}
