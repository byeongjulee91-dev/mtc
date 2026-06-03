use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;

/// How many directory levels below a root a `SKILL.md` may live and still be
/// discovered. 1 = a root's immediate children, which is the classic layout;
/// deeper levels pick up bundled/namespaced skills (e.g. `gstack/canary`).
const MAX_SKILL_DEPTH: usize = 3;

/// Path to the persisted app-data JSON inside the OS app-config dir.
pub fn app_data_path(dir: &Path) -> PathBuf {
    dir.join("app-data.json")
}

/// Load persisted app data. Returns an empty object if nothing is stored yet
/// (the frontend fills in defaults).
pub fn load_app_data(config_dir: &Path) -> Value {
    let path = app_data_path(config_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| Value::Object(Default::default())),
        Err(_) => Value::Object(Default::default()),
    }
}

/// Persist app data atomically (temp file + rename).
pub fn save_app_data(config_dir: &Path, data: &Value) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let path = app_data_path(config_dir);
    let tmp = path.with_extension("json.tmp");
    let serialized = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&tmp, serialized).map_err(|e| format!("write failed: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub path: String,
}

/// A group of skills sharing one source root, for grouped display.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroup {
    /// The root the skills were found under (resolved path / display form).
    pub root: String,
    /// `"wsl"` = scanned inside WSL (only usable by a WSL terminal); `"host"` =
    /// scanned on the host filesystem (a native shell's `claude`).
    pub kind: String,
    pub skills: Vec<Skill>,
}

/// Result of a discovery pass: skills grouped by the root they were found under.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Discovery {
    pub groups: Vec<SkillGroup>,
}

// --- frontmatter parsing -----------------------------------------------------

/// Parse `name` and `description` from a SKILL.md's leading YAML frontmatter.
/// Handles both flat scalars (`name: foo`) and block scalars
/// (`description: |` / `>` followed by an indented body), which is how skills
/// commonly write multi-line descriptions. Nested mapping/list values are
/// skipped — only the two keys we care about are extracted.
pub fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let trimmed = content.trim_start_matches('\u{feff}');
    if !trimmed.starts_with("---") {
        return (None, None);
    }
    // Body between the first and second `---` fences. The closing fence is
    // optional: WSL scans only ship the file's head, which may be truncated
    // before it, and `name`/`description` live at the top regardless.
    let after = &trimmed[3..];
    let end = after.find("\n---").unwrap_or(after.len());
    let lines: Vec<&str> = after[..end].lines().collect();
    let mut name = None;
    let mut description = None;
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        // Only un-indented, non-blank lines begin a top-level mapping entry;
        // anything indented belongs to a value we've already handled or skipped.
        if line.trim().is_empty() || is_indented(line) {
            i += 1;
            continue;
        }
        let (key, val) = match line.split_once(':') {
            Some(kv) => kv,
            None => {
                i += 1;
                continue;
            }
        };
        let key = key.trim().to_lowercase();
        let val = val.trim();
        if is_block_scalar(val) {
            // Collect the following more-indented (or blank) lines as the body,
            // then fold them into a single whitespace-collapsed line.
            let mut body: Vec<&str> = Vec::new();
            i += 1;
            while i < lines.len() {
                let l = lines[i];
                if l.trim().is_empty() {
                    body.push("");
                    i += 1;
                } else if is_indented(l) {
                    body.push(l.trim());
                    i += 1;
                } else {
                    break;
                }
            }
            let collapsed = body.join(" ").split_whitespace().collect::<Vec<_>>().join(" ");
            assign(&key, collapsed, &mut name, &mut description);
        } else {
            assign(&key, unquote(val), &mut name, &mut description);
            i += 1;
        }
    }
    (name, description)
}

fn is_indented(line: &str) -> bool {
    line.starts_with(|c: char| c == ' ' || c == '\t')
}

fn is_block_scalar(val: &str) -> bool {
    matches!(val, "|" | ">" | "|-" | ">-" | "|+" | ">+")
}

fn assign(key: &str, val: String, name: &mut Option<String>, description: &mut Option<String>) {
    match key {
        "name" => *name = Some(val),
        "description" => *description = Some(val),
        _ => {}
    }
}

fn unquote(s: &str) -> String {
    let bytes = s.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

/// `<dir>/.claude/skills` as a string.
fn skills_dir(dir: &Path) -> String {
    dir.join(".claude")
        .join("skills")
        .to_string_lossy()
        .to_string()
}

fn make_skill(dir: &Path, skill_file: &Path, content: &str) -> Skill {
    let (name, description) = parse_frontmatter(content);
    let fallback = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    Skill {
        name: name.unwrap_or(fallback),
        description: description.unwrap_or_default(),
        path: skill_file.to_string_lossy().to_string(),
    }
}

// --- native (host filesystem) scanning ---------------------------------------

/// Recursively scan `dir` (down to `MAX_SKILL_DEPTH`): each subdirectory holding
/// a `SKILL.md` is a skill, and we keep descending so bundled/nested skills are
/// found too. Hidden (dot) directories are skipped. Missing dirs are ignored.
fn scan_dir(dir: &Path, depth: usize, out: &mut Vec<Skill>) {
    if depth > MAX_SKILL_DEPTH {
        return;
    }
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // missing/unreadable dir is not an error
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or(true, |n| n.starts_with('.'))
        {
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        let skill_file = path.join("SKILL.md");
        if let Ok(content) = fs::read_to_string(&skill_file) {
            // A skill dir is a leaf: its subfolders are that skill's own files,
            // not separate skills, so we stop descending here.
            out.push(make_skill(&path, &skill_file, &content));
        } else {
            scan_dir(&path, depth + 1, out);
        }
    }
}

/// Discover skills across the given host-filesystem roots (deduped by path,
/// sorted by name). Test-only: production scanning goes through
/// [`discover_skills`] / [`finalize_groups`], which group results per root.
#[cfg(test)]
pub fn scan_skills(roots: &[String]) -> Vec<Skill> {
    let mut skills: Vec<Skill> = Vec::new();
    for root in roots {
        if root.trim().is_empty() {
            continue;
        }
        scan_dir(Path::new(root), 1, &mut skills);
    }
    finalize(skills)
}

/// Dedup by path, drop skills nested inside another skill's directory, and sort
/// by name. The nesting prune mirrors `scan_dir`'s leaf rule for the WSL side,
/// where `find` enumerates every `SKILL.md` without pruning. Test-only helper
/// (see [`scan_skills`]); the flat variant the grouped scanner superseded.
#[cfg(test)]
fn finalize(skills: Vec<Skill>) -> Vec<Skill> {
    let mut seen = std::collections::HashSet::new();
    let unique: Vec<Skill> = skills.into_iter().filter(|s| seen.insert(s.path.clone())).collect();
    let dirs: Vec<&str> = unique.iter().map(|s| skill_parent(&s.path)).collect();
    let mut out: Vec<Skill> = unique
        .iter()
        .enumerate()
        .filter(|(i, _)| !dirs.iter().enumerate().any(|(j, d)| j != *i && is_ancestor(d, dirs[*i])))
        .map(|(_, s)| s.clone())
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// The directory holding a `SKILL.md` (its path minus the trailing filename).
fn skill_parent(skill_md_path: &str) -> &str {
    match skill_md_path.rfind(['/', '\\']) {
        Some(i) => &skill_md_path[..i],
        None => skill_md_path,
    }
}

/// True if `anc` is a strict ancestor directory of `desc` (same path family).
fn is_ancestor(anc: &str, desc: &str) -> bool {
    desc.len() > anc.len()
        && desc.starts_with(anc)
        && matches!(desc.as_bytes()[anc.len()], b'/' | b'\\')
}

// --- WSL-side scanning -------------------------------------------------------
//
// Reading skills from the Windows host over `\\wsl.localhost\…` fails for the
// common case: skill dirs are often `0700` (owner-only) and contain symlinks,
// neither of which the host can traverse. So for WSL roots we run the scan
// *inside* WSL — as the owning user — where everything is readable.

/// True for a Linux-style path (absolute `/…` or home-relative `~…`) as opposed
/// to a native Windows path (`C:\…`, `\\server\…`).
fn is_linux_path(path: &str) -> bool {
    let p = path.trim();
    p.starts_with('/') || p.starts_with('~')
}

/// A double-quote-safe WSL expression for a root path: a leading `~` becomes
/// `$HOME` so bash expands it inside the quotes (a bare `~` would not).
fn to_wsl_root_expr(path: &str) -> String {
    match path.trim().strip_prefix('~') {
        Some(rest) => format!("$HOME{rest}"),
        None => path.trim().to_string(),
    }
}

/// Parse a `\\wsl.localhost\<distro>\…` (or `\\wsl$\<distro>\…`) UNC path into
/// `(distro, linux_path)`. Returns `None` for non-WSL paths.
fn parse_wsl_unc(path: &str) -> Option<(String, String)> {
    let p = path.trim().replace('/', "\\");
    let rest = p
        .strip_prefix(r"\\wsl.localhost\")
        .or_else(|| p.strip_prefix(r"\\wsl$\"))?;
    let (distro, win_rest) = rest.split_once('\\').unwrap_or((rest, ""));
    if distro.is_empty() {
        return None;
    }
    Some((distro.to_string(), format!("/{}", win_rest.replace('\\', "/"))))
}

/// Framing for the WSL scan output (control chars that never appear in Markdown):
/// GS (0x1D) precedes each group's resolved root, RS (0x1E) precedes each skill
/// record, US (0x1F) separates a record's path from the file head.
const GROUP_SEP: char = '\u{1d}';
const REC_SEP: char = '\u{1e}';
const FIELD_SEP: char = '\u{1f}';

/// Parse the grouped scan output into `(resolved_root, skills)` pairs.
fn parse_wsl_groups(out: &str) -> Vec<(String, Vec<Skill>)> {
    let mut groups = Vec::new();
    for chunk in out.split(GROUP_SEP) {
        if chunk.is_empty() {
            continue;
        }
        // chunk = "<resolved root>\n<records…>"
        let (root, rest) = chunk.split_once('\n').unwrap_or((chunk, ""));
        let root = root.trim();
        if root.is_empty() {
            continue;
        }
        groups.push((root.to_string(), parse_wsl_records(rest)));
    }
    groups
}

fn parse_wsl_records(out: &str) -> Vec<Skill> {
    let mut skills = Vec::new();
    for rec in out.split(REC_SEP) {
        if rec.is_empty() {
            continue;
        }
        let mut parts = rec.splitn(2, FIELD_SEP);
        let path = parts.next().unwrap_or("").trim();
        // A valid record always has a field separator; anything without one is
        // shell preamble before the first record, so skip it.
        let head = match parts.next() {
            Some(h) => h,
            None => continue,
        };
        if path.is_empty() {
            continue;
        }
        let (name, description) = parse_frontmatter(head);
        let fallback = Path::new(path)
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        skills.push(Skill {
            name: name.unwrap_or(fallback),
            description: description.unwrap_or_default(),
            path: path.to_string(),
        });
    }
    skills
}

/// Scan skill roots inside WSL (default distro when `distro` is `None`), grouped
/// per root. `roots` are Linux-side directory expressions (e.g.
/// `"$HOME/.claude/skills"` or `"/mnt/c/proj/.claude/skills"`). Returns
/// `(resolved_root, skills)` per root. Best-effort: an unavailable/failed WSL or
/// empty root set yields nothing.
fn scan_wsl_skills(distro: Option<&str>, roots: &[String]) -> Vec<(String, Vec<Skill>)> {
    let roots: Vec<&String> = roots.iter().filter(|r| !r.trim().is_empty()).collect();
    if roots.is_empty() {
        return Vec::new();
    }
    // Per root: GS + the resolved root + newline, then for each found SKILL.md
    // RS + linux-path + US + the file head (enough lines to cover frontmatter).
    let body = roots
        .iter()
        .map(|r| {
            format!(
                "printf '\\035%s\\n' \"{r}\"; find -L \"{r}\" -maxdepth {MAX_SKILL_DEPTH} -name SKILL.md -type f 2>/dev/null | sort -u | while IFS= read -r f; do printf '\\036%s\\037' \"$f\"; sed -n '1,60p' \"$f\"; done"
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    let script = format!("{body}\n");
    // The script is fed over stdin (`bash -s`), not as an argv string: passing a
    // complex script as a `wsl.exe -- bash -lc <arg>` argument gets mangled by
    // the Windows→WSL argument bridge (e.g. loop variables come back empty).
    let mut cmd = Command::new("wsl.exe");
    if let Some(d) = distro.map(str::trim).filter(|d| !d.is_empty()) {
        cmd.args(["-d", d]);
    }
    cmd.args(["--", "bash", "-s"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // Windows: launch wsl.exe without allocating a console. Discovery runs on
    // every project switch, and without this Windows 11 flashes a Windows
    // Terminal window each time. CREATE_NO_WINDOW = 0x08000000.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(script.as_bytes()); // dropped here → EOF
    }
    match child.wait_with_output() {
        Ok(o) if o.status.success() => parse_wsl_groups(&String::from_utf8_lossy(&o.stdout)),
        _ => Vec::new(),
    }
}

/// Add a WSL root to the group for its distro (de-duping within the group).
fn push_wsl_root(groups: &mut Vec<(Option<String>, Vec<String>)>, distro: Option<String>, root: String) {
    if let Some(g) = groups.iter_mut().find(|(d, _)| *d == distro) {
        if !g.1.contains(&root) {
            g.1.push(root);
        }
    } else {
        groups.push((distro, vec![root]));
    }
}

// --- discovery (auto-detect + scan, the one entry point) ---------------------

/// Discover skills with zero manual configuration, merging:
///   1. the user's manual roots (WSL UNC roots scanned inside WSL, the rest
///      natively),
///   2. the host user skills dir (`<host home>/.claude/skills`),
///   3. on Windows, the WSL default-distro user skills dir,
///   4. the active project's `.claude/skills` (WSL-translated when the project
///      path is Linux-style, native otherwise).
/// Returns the deduped/sorted skills and the list of roots consulted.
pub fn discover_skills(
    host_home: Option<&Path>,
    manual_roots: &[String],
    project_path: Option<&str>,
    windows: bool,
) -> Discovery {
    let project = project_path.map(str::trim).filter(|p| !p.is_empty());

    let mut native_roots: Vec<String> = Vec::new();
    // WSL roots grouped by distro; `None` = the default distro.
    let mut wsl_groups: Vec<(Option<String>, Vec<String>)> = Vec::new();

    // 1. Manual roots.
    for r in manual_roots {
        let r = r.trim();
        if r.is_empty() {
            continue;
        }
        match windows.then(|| parse_wsl_unc(r)).flatten() {
            Some((distro, linux)) => push_wsl_root(&mut wsl_groups, Some(distro), linux),
            None => native_roots.push(r.to_string()),
        }
    }

    // 2. Host user skills.
    if let Some(home) = host_home {
        native_roots.push(skills_dir(home));
    }

    // 3. WSL default-distro user skills (Windows only).
    if windows {
        push_wsl_root(&mut wsl_groups, None, "$HOME/.claude/skills".to_string());
    }

    // 4. Active project skills.
    if let Some(p) = project {
        if windows && is_linux_path(p) {
            let dir = format!("{}/.claude/skills", to_wsl_root_expr(p).trim_end_matches('/'));
            push_wsl_root(&mut wsl_groups, None, dir);
        } else if windows {
            native_roots.push(skills_dir(Path::new(p)));
        } else {
            // Unix dev mode: the project path is a real host path; expand `~`.
            let base = match (p.strip_prefix('~'), host_home) {
                (Some(rest), Some(home)) => home.join(rest.trim_start_matches('/')),
                _ => PathBuf::from(p),
            };
            native_roots.push(skills_dir(&base));
        }
    }

    // --- scan, one group per root ---
    let mut groups: Vec<(String, &'static str, Vec<Skill>)> = Vec::new();

    for r in &native_roots {
        let mut skills = Vec::new();
        scan_dir(Path::new(r), 1, &mut skills);
        groups.push((r.clone(), "host", skills));
    }
    for (distro, linux_roots) in &wsl_groups {
        for (root, skills) in scan_wsl_skills(distro.as_deref(), linux_roots) {
            groups.push((root, "wsl", skills));
        }
    }

    Discovery { groups: finalize_groups(groups) }
}

/// Merge groups sharing a root, dedup skills by path, drop skills nested inside
/// another skill's directory (any group), and sort each group by name. Empty
/// roots are kept (so a checked-but-empty location is still visible) and sink
/// below the non-empty ones; otherwise order follows first appearance.
fn finalize_groups(raw: Vec<(String, &'static str, Vec<Skill>)>) -> Vec<SkillGroup> {
    let mut merged: Vec<(String, String, Vec<Skill>)> = Vec::new();
    for (root, kind, skills) in raw {
        match merged.iter_mut().find(|(r, _, _)| *r == root) {
            Some(g) => g.2.extend(skills),
            None => merged.push((root, kind.to_string(), skills)),
        }
    }
    // Dedup by path across all groups (first occurrence wins).
    let mut seen = std::collections::HashSet::new();
    for g in &mut merged {
        g.2.retain(|s| seen.insert(s.path.clone()));
    }
    // Prune any skill whose directory sits under another skill's directory.
    let all_dirs: Vec<String> = merged
        .iter()
        .flat_map(|g| g.2.iter().map(|s| skill_parent(&s.path).to_string()))
        .collect();
    for g in &mut merged {
        g.2.retain(|s| {
            let d = skill_parent(&s.path);
            !all_dirs.iter().any(|a| is_ancestor(a, d))
        });
    }
    let mut groups: Vec<SkillGroup> = merged
        .into_iter()
        .map(|(root, kind, mut skills)| {
            skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            SkillGroup { root, kind, skills }
        })
        .collect();
    // Surface non-empty groups first; empty roots sink to the bottom. Stable, so
    // each partition keeps its discovery order.
    groups.sort_by_key(|g| g.skills.is_empty());
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn parses_name_and_description() {
        let md = "---\nname: my-skill\ndescription: Does a thing\nlevel: 3\n---\n# Body";
        let (n, d) = parse_frontmatter(md);
        assert_eq!(n.as_deref(), Some("my-skill"));
        assert_eq!(d.as_deref(), Some("Does a thing"));
    }

    #[test]
    fn handles_quoted_and_missing() {
        let (n, _) = parse_frontmatter("---\nname: \"quoted\"\n---\n");
        assert_eq!(n.as_deref(), Some("quoted"));
        assert_eq!(parse_frontmatter("no frontmatter"), (None, None));
    }

    #[test]
    fn parses_block_scalar_description() {
        // A `|` block scalar body, followed by an unrelated nested mapping that
        // must not bleed into the description.
        let md = "---\nname: gstack\ndescription: |\n  Fast headless browser for QA.\n  Navigate pages and verify state.\nallowed-tools:\n  - Bash\n---\nbody";
        let (n, d) = parse_frontmatter(md);
        assert_eq!(n.as_deref(), Some("gstack"));
        assert_eq!(
            d.as_deref(),
            Some("Fast headless browser for QA. Navigate pages and verify state.")
        );
    }

    #[test]
    fn classifies_linux_vs_native_paths() {
        assert!(is_linux_path("/home/u/proj"));
        assert!(is_linux_path("~/work"));
        assert!(!is_linux_path("C:\\Users\\me"));
        assert!(!is_linux_path("\\\\server\\share"));
    }

    #[test]
    fn builds_wsl_root_expr() {
        assert_eq!(to_wsl_root_expr("~/work"), "$HOME/work");
        assert_eq!(to_wsl_root_expr("~"), "$HOME");
        assert_eq!(to_wsl_root_expr("/mnt/c/x"), "/mnt/c/x");
    }

    #[test]
    fn parses_grouped_wsl_output() {
        let out = "\u{1d}/home/me/.claude/skills\n\u{1e}/home/me/.claude/skills/a/SKILL.md\u{1f}---\nname: a\ndescription: A.\n---\n\u{1d}/mnt/c/proj/.claude/skills\n\u{1e}/mnt/c/proj/.claude/skills/b/SKILL.md\u{1f}---\nname: b\ndescription: B.\n---\n";
        let groups = parse_wsl_groups(out);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].0, "/home/me/.claude/skills");
        assert_eq!(groups[0].1.len(), 1);
        assert_eq!(groups[0].1[0].name, "a");
        assert_eq!(groups[1].0, "/mnt/c/proj/.claude/skills");
        assert_eq!(groups[1].1[0].name, "b");
    }

    #[test]
    fn finalize_groups_merges_roots_prunes_and_orders() {
        let sk = |name: &str, path: &str| Skill {
            name: name.into(),
            description: String::new(),
            path: path.into(),
        };
        let raw = vec![
            ("/empty".to_string(), "host", vec![]),
            ("/r".to_string(), "wsl", vec![sk("g", "/r/g/SKILL.md"), sk("a", "/r/a/SKILL.md")]),
            // Same root again (e.g. a manual UNC root resolving to the auto one):
            // duplicate path is deduped; `x` lives under the `g` skill so it's pruned.
            ("/r".to_string(), "wsl", vec![sk("dup", "/r/a/SKILL.md"), sk("x", "/r/g/x/SKILL.md")]),
        ];
        let groups = finalize_groups(raw);
        // Same root merged; empty group kept but sunk below the non-empty one.
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].root, "/r");
        let names: Vec<&str> = groups[0].skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["a", "g"]); // deduped, pruned, sorted
        assert_eq!(groups[1].root, "/empty");
        assert!(groups[1].skills.is_empty());
    }

    #[test]
    fn parses_wsl_unc_paths() {
        assert_eq!(
            parse_wsl_unc(r"\\wsl.localhost\Ubuntu\home\me\.claude\skills"),
            Some(("Ubuntu".into(), "/home/me/.claude/skills".into()))
        );
        assert_eq!(
            parse_wsl_unc(r"\\wsl$\Debian\opt\x"),
            Some(("Debian".into(), "/opt/x".into()))
        );
        assert_eq!(parse_wsl_unc(r"C:\Users\me"), None);
    }

    #[test]
    fn parses_wsl_scan_records() {
        let out = "\u{1e}/home/me/.claude/skills/a/SKILL.md\u{1f}---\nname: a\ndescription: First.\n---\n\u{1e}/home/me/.claude/skills/b/SKILL.md\u{1f}---\nname: b\ndescription: |\n  Second one.\n---\n";
        let skills = parse_wsl_records(out);
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].name, "a");
        assert_eq!(skills[0].description, "First.");
        assert_eq!(skills[0].path, "/home/me/.claude/skills/a/SKILL.md");
        assert_eq!(skills[1].name, "b");
        assert_eq!(skills[1].description, "Second one.");
    }

    #[test]
    fn scans_skill_dirs_and_ignores_missing() {
        let base = env::temp_dir().join(format!("mtc-skills-{}", std::process::id()));
        let skill = base.join("sample");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: sample\ndescription: A sample\n---\nbody",
        )
        .unwrap();
        fs::create_dir_all(base.join("not-a-skill")).unwrap();

        let skills = scan_skills(&[base.to_string_lossy().to_string(), "/no/such/dir".into()]);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "sample");
        assert_eq!(skills[0].description, "A sample");

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn scan_treats_skill_dirs_as_leaves_but_descends_through_plain_dirs() {
        let base = env::temp_dir().join(format!("mtc-nested-{}", std::process::id()));
        // A bundle skill with an internal nested skill dir...
        let inner = base.join("bundle").join("inner");
        fs::create_dir_all(&inner).unwrap();
        fs::write(base.join("bundle").join("SKILL.md"), "---\nname: bundle\n---\n").unwrap();
        fs::write(inner.join("SKILL.md"), "---\nname: inner\n---\n").unwrap();
        // ...and a plugin-style layout where the skill sits below plain dirs.
        let deep = base.join("plugin").join("skills").join("deep");
        fs::create_dir_all(&deep).unwrap();
        fs::write(deep.join("SKILL.md"), "---\nname: deep\n---\n").unwrap();

        let names: Vec<String> = scan_skills(&[base.to_string_lossy().to_string()])
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert!(names.contains(&"bundle".to_string()));
        assert!(
            !names.contains(&"inner".to_string()),
            "a skill dir is a leaf — its internal nested skill is not listed separately"
        );
        assert!(
            names.contains(&"deep".to_string()),
            "skills below plain (non-skill) directories are still discovered"
        );

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn finalize_prunes_skills_nested_under_another_skill() {
        let skills = vec![
            Skill { name: "gstack".into(), description: String::new(), path: "/s/gstack/SKILL.md".into() },
            Skill { name: "x".into(), description: String::new(), path: "/s/gstack/x/SKILL.md".into() },
            Skill { name: "top".into(), description: String::new(), path: "/s/top/SKILL.md".into() },
        ];
        let names: Vec<String> = finalize(skills).into_iter().map(|s| s.name).collect();
        // `x` lives under the `gstack` skill, so it is pruned; result is sorted.
        assert_eq!(names, vec!["gstack".to_string(), "top".to_string()]);
    }

    #[test]
    fn discover_on_unix_uses_native_paths_and_dedups() {
        let base = env::temp_dir().join(format!("mtc-discover-{}", std::process::id()));
        let home = base.join("home");
        let proj = base.join("proj");
        // home/.claude/skills/h/SKILL.md  and  proj/.claude/skills/p/SKILL.md
        let h = home.join(".claude").join("skills").join("h");
        let p = proj.join(".claude").join("skills").join("p");
        fs::create_dir_all(&h).unwrap();
        fs::create_dir_all(&p).unwrap();
        fs::write(h.join("SKILL.md"), "---\nname: h\n---\n").unwrap();
        fs::write(p.join("SKILL.md"), "---\nname: p\n---\n").unwrap();

        let d = discover_skills(
            Some(&home),
            &[],
            Some(&proj.to_string_lossy().to_string()),
            false,
        );
        let names: Vec<&str> = d
            .groups
            .iter()
            .flat_map(|g| g.skills.iter().map(|s| s.name.as_str()))
            .collect();
        assert!(names.contains(&"h"), "host home skills detected");
        assert!(names.contains(&"p"), "active-project skills detected");
        // Two distinct roots → two groups.
        assert_eq!(d.groups.len(), 2);

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn parses_frontmatter_without_closing_fence() {
        // A head truncated before the closing `---` (as a WSL scan may ship for
        // a skill with very long frontmatter) must still yield name + desc.
        let head = "---\nname: longy\ndescription: |\n  A long one.\ntriggers:\n  - a\n  - b";
        let (n, d) = parse_frontmatter(head);
        assert_eq!(n.as_deref(), Some("longy"));
        assert_eq!(d.as_deref(), Some("A long one."));
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = env::temp_dir().join(format!("mtc-data-{}", std::process::id()));
        let value = serde_json::json!({"todos": [{"id":"1","text":"x","done":false}]});
        save_app_data(&dir, &value).unwrap();
        let loaded = load_app_data(&dir);
        assert_eq!(loaded, value);
        fs::remove_dir_all(&dir).ok();
    }
}
