//! Counting *modified* git-tracked files for a project directory — the number
//! of tracked files with staged or unstaged changes (untracked files excluded),
//! i.e. what `git status` reports as changes to tracked files.
//!
//! On Windows a project path is usually a Linux-style WSL path (`/mnt/c/…` or
//! `~/…`), where the repo and `git` actually live, so we run inside WSL — the
//! same host/WSL split the skill scanner uses. Native paths (a Windows path, or
//! a real host path under Unix dev mode) run `git` directly.

use std::io::Write;
use std::process::{Command, Output, Stdio};

use crate::storage::{is_linux_path, to_wsl_root_expr};

/// Count modified (changed) git-tracked files in `path` via
/// `git status --porcelain --untracked-files=no`:
/// - `Ok(None)` — the path is empty (nothing to count).
/// - `Ok(Some(n))` — a git work tree with `n` changed tracked files (maybe `0`).
/// - `Err(reason)` — git failed: not a repo, git not on PATH, dubious ownership,
///   etc. `reason` is a short message (git's first stderr line, or the spawn
///   error) the frontend can surface/log instead of silently hiding the badge.
pub fn count_modified_files(path: &str, windows: bool) -> Result<Option<u32>, String> {
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
        Ok(Some(count_changes(&out.stdout)))
    } else {
        Err(failure_reason(&out))
    }
}

/// The status args: machine-readable, one tracked change per line, untracked
/// files omitted (so the count is "tracked & modified", not "tracked").
const STATUS_ARGS: [&str; 2] = ["--porcelain", "--untracked-files=no"];

/// `git -C <path> status --porcelain -uno` on the host.
fn run_native(path: &str) -> std::io::Result<Output> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(path)
        .arg("status")
        .args(STATUS_ARGS)
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
    let script = format!("git -C \"{expr}\" status {}\n", STATUS_ARGS.join(" "));
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

/// Number of changed tracked files in `git status --porcelain` output: one
/// non-empty line per entry (a rename is a single `R old -> new` line, and git
/// quotes paths with special chars, so line counting is robust).
fn count_changes(bytes: &[u8]) -> u32 {
    String::from_utf8_lossy(bytes)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_porcelain_lines() {
        assert_eq!(count_changes(b""), 0);
        assert_eq!(count_changes(b" M package-lock.json\n"), 1);
        // staged-modified, deleted, and a rename (one line) → 3.
        assert_eq!(count_changes(b"M  staged.rs\n D del.rs\nR  old.rs -> new.rs\n"), 3);
    }

    #[test]
    fn empty_path_is_ok_none() {
        assert_eq!(count_modified_files("", true), Ok(None));
        assert_eq!(count_modified_files("   ", false), Ok(None));
    }
}
