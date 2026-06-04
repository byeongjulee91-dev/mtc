//! Counting git-tracked files for a project directory.
//!
//! On Windows a project path is usually a Linux-style WSL path (`/mnt/c/…` or
//! `~/…`), where the repo and `git` actually live, so we count inside WSL — the
//! same host/WSL split the skill scanner uses. Native paths (a Windows path, or
//! a real host path under Unix dev mode) run `git` directly.

use std::io::Write;
use std::process::{Command, Stdio};

use crate::storage::{is_linux_path, to_wsl_root_expr};

/// Count git-tracked files in `path`. Returns `None` when the path is empty, is
/// not a git work tree, or git is unavailable (so the UI hides the indicator);
/// `Some(n)` — possibly `0` — for a real repository.
pub fn count_tracked_files(path: &str, windows: bool) -> Option<u32> {
    let p = path.trim();
    if p.is_empty() {
        return None;
    }
    if windows && is_linux_path(p) {
        count_in_wsl(p)
    } else {
        count_native(p)
    }
}

/// `git -C <path> ls-files -z` on the host, counting the NUL-terminated entries.
/// A non-repo dir (or missing git) makes `git` exit non-zero / fail to spawn,
/// which we surface as `None`.
fn count_native(path: &str) -> Option<u32> {
    let out = Command::new("git")
        .args(["-C", path, "ls-files", "-z"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status.success().then(|| count_entries(&out.stdout))
}

/// The same count inside the WSL default distro for a Linux-style path. The
/// command is fed over stdin (`bash -s`) so a leading `~` expands via `$HOME`
/// inside the quotes; git's exit status propagates as bash's, so a non-repo dir
/// yields `None`.
fn count_in_wsl(path: &str) -> Option<u32> {
    let expr = to_wsl_root_expr(path);
    let script = format!("git -C \"{expr}\" ls-files -z\n");
    let mut cmd = Command::new("wsl.exe");
    cmd.args(["--", "bash", "-s"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // Windows: launch wsl.exe without allocating a console — this runs on every
    // project switch and would otherwise flash a window. CREATE_NO_WINDOW.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes()); // dropped here → EOF
    }
    let out = child.wait_with_output().ok()?;
    out.status.success().then(|| count_entries(&out.stdout))
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
    fn empty_path_is_none() {
        assert_eq!(count_tracked_files("", true), None);
        assert_eq!(count_tracked_files("   ", false), None);
    }
}
