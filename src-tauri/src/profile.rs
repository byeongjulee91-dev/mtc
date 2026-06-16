use serde::{Deserialize, Serialize};

/// A launch profile, mirrored from the frontend `Profile` type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub distro: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub command: String,
    /// Which terminal backend to launch on Windows: `"wsl"` (default / empty),
    /// `"powershell"` (Windows PowerShell, `powershell.exe`), or `"cmd"`.
    /// Ignored on Unix, where bash is always used for local dev/tests.
    #[serde(default)]
    pub shell: String,
}

/// A concrete process invocation derived from a profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Invocation {
    pub program: String,
    pub args: Vec<String>,
    /// Working directory for the spawned process (host-side). `None` lets the
    /// child decide (on Windows the cwd is handled via `wsl --cd`).
    pub cwd: Option<String>,
}

/// Build the inner shell command that runs the profile's command, then drops
/// into an interactive login shell so the pane stays usable after the command
/// exits (instead of dying as a frozen `[process exited]` terminal).
fn inner_shell_args(profile: &Profile) -> Vec<String> {
    if profile.command.trim().is_empty() {
        // Just an interactive login shell.
        vec!["-l".to_string()]
    } else {
        // `command` is trusted user input authored in the profile editor; it is
        // composed verbatim into the shell script by design (the user is running
        // their own commands in their own WSL). `exec bash -l` keeps the shell
        // alive once the command returns, so Ctrl+C-ing out of claude lands you
        // back at a prompt rather than killing the whole session.
        let script = format!("{}; exec bash -l", profile.command);
        vec!["-lic".to_string(), script]
    }
}

/// `cwd` as an `Option`, treating a blank string as "let the child decide".
fn cwd_opt(cwd: &str) -> Option<String> {
    if cwd.trim().is_empty() {
        None
    } else {
        Some(cwd.to_string())
    }
}

/// Enter WSL via `wsl.exe` (optionally `-d <distro>` and `--cd <cwd>`), then run
/// the command in a bash login shell.
fn build_wsl(profile: &Profile) -> Invocation {
    let mut args: Vec<String> = Vec::new();
    if !profile.distro.trim().is_empty() {
        args.push("-d".to_string());
        args.push(profile.distro.clone());
    }
    if !profile.cwd.trim().is_empty() {
        args.push("--cd".to_string());
        args.push(profile.cwd.clone());
    }
    args.push("--".to_string());
    args.push("bash".to_string());
    args.extend(inner_shell_args(profile));
    Invocation {
        program: "wsl.exe".to_string(),
        args,
        // The cwd is handled by `wsl --cd` above (it is a Linux-side path).
        cwd: None,
    }
}

/// Launch Windows PowerShell (`powershell.exe`) directly on the host. The
/// optional `command` runs via `-Command`, with `-NoExit` so the prompt stays
/// after the command finishes. `cwd` is a host (Windows) path.
fn build_powershell(profile: &Profile) -> Invocation {
    let mut args = vec!["-NoLogo".to_string()];
    if !profile.command.trim().is_empty() {
        args.push("-NoExit".to_string());
        args.push("-Command".to_string());
        args.push(profile.command.clone());
    }
    Invocation {
        program: "powershell.exe".to_string(),
        args,
        cwd: cwd_opt(&profile.cwd),
    }
}

/// Launch the classic Windows command prompt (`cmd.exe`). With a command, `/k`
/// runs it and keeps the window open afterwards.
fn build_cmd(profile: &Profile) -> Invocation {
    let args = if profile.command.trim().is_empty() {
        Vec::new()
    } else {
        vec!["/k".to_string(), profile.command.clone()]
    };
    Invocation {
        program: "cmd.exe".to_string(),
        args,
        cwd: cwd_opt(&profile.cwd),
    }
}

/// Run bash directly (Unix local dev / Linux sandbox), so the exact same PTY
/// plumbing can be exercised without a Windows host.
fn build_bash(profile: &Profile) -> Invocation {
    Invocation {
        program: "bash".to_string(),
        args: inner_shell_args(profile),
        cwd: cwd_opt(&profile.cwd),
    }
}

/// Compute the process invocation for a profile.
///
/// On Windows the `shell` field selects the backend: `"powershell"` and `"cmd"`
/// launch the native Windows shells, anything else (including the default empty
/// value) enters WSL via `wsl.exe`. On Unix (local development / the Linux
/// sandbox) bash is always used regardless of `shell`.
pub fn build_invocation(profile: &Profile, windows: bool) -> Invocation {
    if !windows {
        return build_bash(profile);
    }
    match profile.shell.trim() {
        "powershell" => build_powershell(profile),
        "cmd" => build_cmd(profile),
        _ => build_wsl(profile),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(command: &str) -> Profile {
        Profile {
            id: "p".into(),
            name: "P".into(),
            color: "#fff".into(),
            distro: String::new(),
            cwd: String::new(),
            command: command.into(),
            shell: String::new(),
        }
    }

    #[test]
    fn windows_shell_profile_enters_wsl_interactively() {
        let inv = build_invocation(&profile(""), true);
        assert_eq!(inv.program, "wsl.exe");
        assert_eq!(inv.args, vec!["--", "bash", "-l"]);
        assert_eq!(inv.cwd, None);
    }

    #[test]
    fn windows_command_profile_runs_command_in_wsl() {
        let inv = build_invocation(&profile("claude"), true);
        assert_eq!(inv.program, "wsl.exe");
        assert_eq!(
            inv.args,
            vec!["--", "bash", "-lic", "claude; exec bash -l"]
        );
    }

    #[test]
    fn windows_profile_includes_distro_and_cwd() {
        let mut p = profile("codex");
        p.distro = "Ubuntu".into();
        p.cwd = "~/work".into();
        let inv = build_invocation(&p, true);
        assert_eq!(
            inv.args,
            vec!["-d", "Ubuntu", "--cd", "~/work", "--", "bash", "-lic", "codex; exec bash -l"]
        );
    }

    #[test]
    fn unix_command_profile_runs_bash_directly() {
        let mut p = profile("echo hi");
        p.cwd = "/tmp".into();
        let inv = build_invocation(&p, false);
        assert_eq!(inv.program, "bash");
        assert_eq!(inv.args, vec!["-lic", "echo hi; exec bash -l"]);
        assert_eq!(inv.cwd, Some("/tmp".to_string()));
    }

    #[test]
    fn unix_shell_profile_is_login_shell() {
        let inv = build_invocation(&profile(""), false);
        assert_eq!(inv.program, "bash");
        assert_eq!(inv.args, vec!["-l"]);
    }

    #[test]
    fn windows_powershell_shell_is_interactive() {
        let mut p = profile("");
        p.shell = "powershell".into();
        let inv = build_invocation(&p, true);
        assert_eq!(inv.program, "powershell.exe");
        assert_eq!(inv.args, vec!["-NoLogo"]);
        assert_eq!(inv.cwd, None);
    }

    #[test]
    fn windows_powershell_runs_command_and_keeps_open() {
        let mut p = profile("claude");
        p.shell = "powershell".into();
        p.cwd = "C:\\work".into();
        let inv = build_invocation(&p, true);
        assert_eq!(inv.program, "powershell.exe");
        assert_eq!(inv.args, vec!["-NoLogo", "-NoExit", "-Command", "claude"]);
        assert_eq!(inv.cwd, Some("C:\\work".to_string()));
    }

    #[test]
    fn windows_cmd_keeps_open_with_k() {
        let mut p = profile("dir");
        p.shell = "cmd".into();
        let inv = build_invocation(&p, true);
        assert_eq!(inv.program, "cmd.exe");
        assert_eq!(inv.args, vec!["/k", "dir"]);

        p.command = String::new();
        let inv = build_invocation(&p, true);
        assert!(inv.args.is_empty());
    }

    #[test]
    fn windows_powershell_falls_back_to_bash_on_unix() {
        let mut p = profile("");
        p.shell = "powershell".into();
        let inv = build_invocation(&p, false);
        assert_eq!(inv.program, "bash");
    }
}
