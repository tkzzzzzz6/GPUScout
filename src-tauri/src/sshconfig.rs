//! ~/.ssh/config 的读写，以及 SSH 目标的解析和校验。
//!
//! 软件只改自己标记的一段（`# >>> autodl-lookout >>>` 到 `# <<< autodl-lookout <<<`），
//! 用户手写的配置一个字都不动；写之前先备份。AutoDL 实例重新开机后端口可能会变，
//! 同步这一段就能让终端、VS Code、scp 一直用同一个名字连上去。

use std::path::PathBuf;
use std::collections::HashSet;
use std::sync::Mutex;

pub const BEGIN: &str = "# >>> autodl-lookout >>>";
pub const END: &str = "# <<< autodl-lookout <<<";
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct HostEntry {
    /// Host 名（别名）
    pub alias: String,
    pub host: String,
    pub port: i64,
    pub user: String,
    pub identity_file: Option<String>,
}

/// AutoDL 的 SSH 命令形如 `ssh -p 12345 root@region-9.autodl.pro`
pub fn parse_ssh_command(cmd: &str) -> Option<(String, i64, String)> {
    let parts: Vec<&str> = cmd.split_whitespace().collect();
    if parts.first() != Some(&"ssh") {
        return None;
    }
    let mut port = 22;
    let mut target = None;
    let mut i = 1;
    while i < parts.len() {
        match parts[i] {
            "-p" => {
                port = parts.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            p if p.starts_with("-p") && p.len() > 2 => {
                port = p[2..].parse().ok()?;
                i += 1;
            }
            p if !p.starts_with('-') => {
                target = Some(p);
                i += 1;
            }
            _ => i += 1,
        }
    }
    let (user, host) = target?.split_once('@')?;
    (valid_user(user) && valid_host(host)).then(|| (host.to_string(), port, user.to_string()))
}

/// 主机名 / IP 只允许这些字符：拼进终端命令时不会被当成选项或 shell 语法
pub fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && !h.starts_with('-')
        && h.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']' | '_'))
}

pub fn valid_user(u: &str) -> bool {
    !u.is_empty() && u.len() <= 64 && !u.starts_with('-')
        && u.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

pub fn valid_alias(a: &str) -> bool {
    !a.is_empty() && a.chars().count() <= 64 && a.len() <= 253 && !a.starts_with('-')
        && a.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

pub fn alias_key(alias: &str) -> String { alias.to_lowercase() }

/// 只解析参数，不执行 Match、命令替换或环境变量展开。引号和行尾注释不能隐藏重名 Host。
fn words(value: &str) -> Vec<String> {
    let mut out = vec![];
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut chars = value.chars().peekable();
    while let Some(c) = chars.next() {
        if escaped { word.push(c); escaped = false; continue; }
        if c == '\\' {
            if chars.peek().is_some_and(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '\\' | '#')) { escaped = true; }
            else { word.push(c); }
            continue;
        }
        if let Some(q) = quote {
            if c == q { quote = None; } else { word.push(c); }
        } else if c == '"' || c == '\'' { quote = Some(c); }
        else if c == '#' { break; }
        else if c.is_whitespace() {
            if !word.is_empty() { out.push(std::mem::take(&mut word)); }
        } else { word.push(c); }
    }
    if escaped { word.push('\\'); }
    if !word.is_empty() { out.push(word); }
    out
}

fn directives(text: &str, skip_managed: bool) -> Vec<(String, Vec<String>)> {
    let mut out = vec![];
    let mut managed = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line == BEGIN { managed = true; out.push(("match".into(), vec![])); continue; }
        if line == END { managed = false; out.push(("match".into(), vec![])); continue; }
        if (skip_managed && managed) || line.starts_with('#') { continue; }
        if let Some((key, value)) = line.split_once(|c: char| c.is_whitespace() || c == '=') {
            out.push((key.to_ascii_lowercase(), words(value.trim().trim_start_matches('='))));
        }
    }
    out
}

/// 名字里的中文等字符去掉，只留字母数字和 - _；全被去掉时用 fallback
pub fn slug(name: &str, fallback: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if s.is_empty() { fallback.to_string() } else { s.chars().take(32).collect() }
}

/// 解析 ~/.ssh/config 里能直接用的 Host（跳过通配符和软件自己管理的那一段）
pub fn parse_config(text: &str) -> Vec<HostEntry> {
    parse_entries(text, true)
}

fn parse_entries(text: &str, skip_managed: bool) -> Vec<HostEntry> {
    let mut out: Vec<HostEntry> = vec![];
    let mut cur: Vec<HostEntry> = vec![];
    let flush = |cur: &mut Vec<HostEntry>, out: &mut Vec<HostEntry>| {
        for mut h in cur.drain(..) {
            if h.host.is_empty() {
                h.host = h.alias.clone();
            }
            if valid_alias(&h.alias) && valid_host(&h.host) {
                out.push(h);
            }
        }
    };
    // 管理段边界也要结束前一条记录，防止跨段继承字段。
    for (k, args) in directives(text, skip_managed) {
        let v = args.first().cloned().unwrap_or_default();
        match k.as_str() {
            "host" => {
                flush(&mut cur, &mut out);
                cur = args.into_iter()
                    .filter(|a| valid_alias(a))
                    .map(|a| HostEntry { alias: a, port: 22, ..Default::default() })
                    .collect();
            }
            "match" => flush(&mut cur, &mut out),
            "hostname" => cur.iter_mut().for_each(|h| h.host = v.clone()),
            "port" => {
                if let Ok(p) = v.parse() {
                    cur.iter_mut().for_each(|h| h.port = p);
                }
            }
            "user" => cur.iter_mut().for_each(|h| h.user = v.clone()),
            "identityfile" => cur.iter_mut().for_each(|h| h.identity_file = Some(v.clone())),
            _ => {}
        }
    }
    flush(&mut cur, &mut out);
    out
}

#[derive(Default)]
pub struct ConfigSnapshot {
    root: String,
    pub entries: Vec<HostEntry>,
    pub reserved_aliases: Vec<String>,
}

pub fn read_snapshot() -> Result<ConfigSnapshot, String> {
    read_snapshot_at(&config_path().ok_or("找不到用户目录")?)
}

/// Include 只读取静态文件中的 Host；不执行配置中的 Match exec，不能可靠展开时拒绝写入。
fn read_snapshot_at(path: &std::path::Path) -> Result<ConfigSnapshot, String> {
    struct Reader {
        snapshot: ConfigSnapshot,
        base: PathBuf,
        visited: HashSet<PathBuf>,
        stack: Vec<PathBuf>,
        bytes: usize,
    }
    impl Reader {
        fn scan(&mut self, path: &std::path::Path, root: bool) -> Result<(), String> {
            let text = match std::fs::read_to_string(path) {
                Ok(text) => text,
                Err(error) if root && error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(format!("读不了 SSH 配置 {}（{error}，可能不是 UTF-8 编码）。为了不覆盖你的配置，这次没有同步", path.display())),
            };
            let real = path.canonicalize().map_err(|error| format!("无法检查 SSH Include：{error}"))?;
            if self.stack.contains(&real) { return Err("SSH Include 存在循环，无法检查重名，这次没有同步。请先修正 Include 配置。".into()); }
            if self.visited.contains(&real) { return Ok(()); }
            self.bytes += text.len();
            if self.stack.len() >= 8 || self.visited.len() >= 64 || self.bytes > 1024 * 1024 {
                return Err("SSH Include 过多或配置过大，无法可靠检查重名，这次没有同步。".into());
            }
            self.stack.push(real.clone());
            self.visited.insert(real);
            if root {
                let begins: Vec<_> = text.lines().enumerate().filter(|(_, line)| line.trim() == BEGIN).map(|(n, _)| n).collect();
                let ends: Vec<_> = text.lines().enumerate().filter(|(_, line)| line.trim() == END).map(|(n, _)| n).collect();
                if !(begins.is_empty() && ends.is_empty() || begins.len() == 1 && ends.len() == 1 && begins[0] < ends[0]) {
                    return Err("SSH 配置里的 autodl-lookout 管理段标记不完整或重复，这次没有同步。请先修正标记或恢复备份。".into());
                }
                self.snapshot.root = text.clone();
            }
            self.snapshot.entries.extend(parse_entries(&text, false));
            for (key, args) in directives(&text, root) {
                if key == "host" {
                    self.snapshot.reserved_aliases.extend(args.into_iter().filter(|a| valid_alias(a)));
                } else if key == "include" {
                    for pattern in args {
                        if pattern.contains(['%', '$']) || pattern.starts_with('~') && !pattern.starts_with("~/") {
                            return Err("SSH Include 含动态路径，无法检查重名，这次没有同步。请将 Include 改为明确的本机路径后重试。".into());
                        }
                        let expanded = if let Some(rest) = pattern.strip_prefix("~/") {
                            self.base.parent().ok_or("无法解析 SSH Include 的用户目录")?.join(rest)
                        } else if std::path::Path::new(&pattern).is_absolute() { PathBuf::from(pattern) }
                        else { self.base.join(pattern) };
                        let files = glob::glob(&expanded.to_string_lossy()).map_err(|error| format!("SSH Include 路径不合法：{error}，这次没有同步"))?;
                        for file in files {
                            let file = file.map_err(|error| format!("无法读取 SSH Include：{error}，这次没有同步"))?;
                            self.scan(&file, false)?;
                        }
                    }
                }
            }
            self.stack.pop();
            Ok(())
        }
    }
    let mut reader = Reader { snapshot: ConfigSnapshot::default(), base: path.parent().ok_or("SSH 配置路径不合法")?.to_path_buf(),
        visited: HashSet::new(), stack: vec![], bytes: 0 };
    reader.scan(path, true)?;
    Ok(reader.snapshot)
}

/// 软件管理的那一段
pub fn render_block(entries: &[HostEntry]) -> String {
    let mut s = String::new();
    s.push_str(BEGIN);
    s.push_str("\n# 由 AutoDL Lookout 自动生成，下次同步会被覆盖；要自定义请写在这一段外面\n");
    for h in entries {
        s.push_str(&format!("Host {}\n    HostName {}\n    Port {}\n    User {}\n", h.alias, h.host, h.port, h.user));
        if let Some(f) = &h.identity_file {
            s.push_str(&format!("    IdentityFile \"{f}\"\n"));
        }
        s.push_str("    ServerAliveInterval 30\n");
    }
    // 管理段置顶后要恢复全局作用域，不能让用户原有的全局选项落到最后一台服务器下面。
    s.push_str("Host *\n");
    s.push_str(END);
    s.push('\n');
    s
}

/// 管理段始终置顶，避免前面的通配规则覆盖目标；用户手写内容的字节和相对顺序不变。
pub fn replace_block(text: &str, block: &str) -> String {
    let (mut begin, mut end, mut offset) = (None, None, 0);
    for line in text.split_inclusive('\n') {
        if line.trim() == BEGIN { begin = Some(offset); }
        if line.trim() == END { end = Some(offset + line.len()); }
        offset += line.len();
    }
    if let (Some(a), Some(b)) = (begin, end) {
        if a < b {
            return format!("{}{}{}", block, &text[..a], &text[b..]);
        }
    }
    format!("{block}{text}")
}

pub fn ssh_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".ssh"))
}

pub fn config_path() -> Option<PathBuf> {
    ssh_dir().map(|d| d.join("config"))
}

/// 写回 ~/.ssh/config：内容没变就不写；变了先备份成 config.autodl-lookout.bak
pub fn write_block(entries: &[HostEntry]) -> Result<bool, String> {
    write_block_at(&config_path().ok_or("找不到用户目录")?, entries)
}

pub fn validate_entries(entries: &[HostEntry], snapshot: &ConfigSnapshot) -> Result<(), String> {
    let mut names = HashSet::new();
    for entry in entries {
        if !valid_alias(&entry.alias) { return Err(format!("SSH 名称 {:?} 不合法。请在 AutoDL 改为最多 64 个中文/英文字母、数字、点、横线或下划线，不能以横线开头，再刷新同步。", entry.alias)); }
        let key = alias_key(&entry.alias);
        if !names.insert(key.clone()) { return Err(format!("SSH 名称 {:?} 重复。请将 AutoDL 实例改成不同名称，再刷新同步；这次没有修改配置。", entry.alias)); }
        if snapshot.reserved_aliases.iter().any(|name| alias_key(name) == key) {
            return Err(format!("SSH 名称 {:?} 已被手写配置或 Include 中的 Host 占用。请在 AutoDL 修改实例名，或自行调整原 Host 名称，再刷新同步；这次没有修改配置。", entry.alias));
        }
    }
    Ok(())
}

/// 只有文件不存在时才当成空文件；其他读取错误（比如不是 UTF-8 编码）一律中止，绝不覆盖用户的配置
pub fn write_block_at(path: &std::path::Path, entries: &[HostEntry]) -> Result<bool, String> {
    let _writer = WRITE_LOCK.lock().map_err(|_| "SSH 配置同步锁不可用，请重启软件后重试")?;
    let path = path.to_path_buf();
    let snapshot = read_snapshot_at(&path)?;
    validate_entries(entries, &snapshot)?;
    let old = snapshot.root;
    let new = replace_block(&old, &render_block(entries));
    if new == old {
        return Ok(false);
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| format!("创建 .ssh 目录失败：{e}"))?;
    if !old.is_empty() {
        std::fs::write(path.with_file_name("config.autodl-lookout.bak"), &old).map_err(|e| format!("备份 SSH 配置失败：{e}"))?;
    }
    std::fs::write(&path, new).map_err(|e| format!("写入 SSH 配置失败：{e}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_autodl_ssh_command() {
        assert_eq!(parse_ssh_command("ssh -p 32145 root@region-9.autodl.pro"), Some(("region-9.autodl.pro".into(), 32145, "root".into())));
        assert_eq!(parse_ssh_command("ssh root@1.2.3.4"), Some(("1.2.3.4".into(), 22, "root".into())));
        assert_eq!(parse_ssh_command("ssh -p32145 root@h.example"), Some(("h.example".into(), 32145, "root".into())));
        assert_eq!(parse_ssh_command("scp a b"), None);
        assert_eq!(parse_ssh_command("ssh -p 22 root@h;rm -rf /"), None, "不合法的主机名不能通过");
    }

    #[test]
    fn validates_targets() {
        assert!(valid_host("region-9.autodl.pro") && valid_host("10.0.0.8") && valid_host("[::1]"));
        assert!(!valid_host("-oProxyCommand=x") && !valid_host("a b") && !valid_host("a'b") && !valid_host(""));
        assert!(valid_user("root") && !valid_user("-l") && !valid_user("a$b"));
    }

    #[test]
    fn slug_keeps_ascii() {
        assert_eq!(slug("qwen-lora", "x"), "qwen-lora");
        assert_eq!(slug("实验室 A100 (2号)", "x"), "a100-2");
        assert_eq!(slug("训练机", "fallback"), "fallback");
    }

    const CONFIG: &str = "\
Host *
    ServerAliveInterval 60

Host lab lab-alias
    HostName 10.0.0.8
    User tk
    Port 2222
    IdentityFile ~/.ssh/id_lab

Host cloud
  HostName=47.1.2.3
  User ubuntu

# >>> autodl-lookout >>>
Host autodl-old-1
    HostName region-1.autodl.pro
    Port 1
    User root
# <<< autodl-lookout <<<

Host gh
    HostName github.com
    User git
";

    #[test]
    fn parses_config_hosts() {
        let hs = parse_config(CONFIG);
        let names: Vec<&str> = hs.iter().map(|h| h.alias.as_str()).collect();
        assert_eq!(names, vec!["lab", "lab-alias", "cloud", "gh"], "跳过通配符和软件管理的段");
        assert_eq!(hs[0], HostEntry { alias: "lab".into(), host: "10.0.0.8".into(), port: 2222, user: "tk".into(), identity_file: Some("~/.ssh/id_lab".into()) });
        assert_eq!((hs[2].host.as_str(), hs[2].user.as_str(), hs[2].port), ("47.1.2.3", "ubuntu", 22));
    }

    #[test]
    fn write_block_never_clobbers_unreadable_config() {
        let dir = std::env::temp_dir().join(format!("lookout-sshcfg-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let entry = [HostEntry { alias: "autodl-x".into(), host: "h.example".into(), port: 2, user: "root".into(), identity_file: None }];
        // 不是 UTF-8 的配置（比如 GBK 注释）：报错，文件原样不动，也不生成备份
        let bad = dir.join("config-gbk");
        let gbk: &[u8] = b"# \xd6\xd0\xce\xc4\nHost lab\n  HostName 10.0.0.8\n";
        std::fs::write(&bad, gbk).unwrap();
        assert!(write_block_at(&bad, &entry).unwrap_err().contains("没有同步"));
        assert_eq!(std::fs::read(&bad).unwrap(), gbk);
        assert!(!bad.with_file_name("config.autodl-lookout.bak").exists());
        // 文件不存在：新建
        let fresh = dir.join("sub").join("config");
        assert!(write_block_at(&fresh, &entry).unwrap());
        assert!(std::fs::read_to_string(&fresh).unwrap().contains("Host autodl-x"));
        // 已有内容：先备份再写；再同步一次不变
        let ok = dir.join("config");
        std::fs::write(&ok, "Host gh\n  User git\n").unwrap();
        assert!(write_block_at(&ok, &entry).unwrap());
        assert_eq!(std::fs::read_to_string(dir.join("config.autodl-lookout.bak")).unwrap(), "Host gh\n  User git\n");
        assert!(!write_block_at(&ok, &entry).unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn replaces_only_managed_block() {
        let block = render_block(&[HostEntry { alias: "autodl-qwen".into(), host: "region-9.autodl.pro".into(), port: 32145, user: "root".into(), identity_file: None }]);
        assert!(block.ends_with(&format!("Host *\n{END}\n")), "恢复后续全局选项的作用域");
        let out = replace_block(CONFIG, &block);
        assert!(out.contains("Port 32145") && !out.contains("autodl-old-1"));
        assert!(out.starts_with(BEGIN) && out.contains("Host *\n") && out.contains("Host gh\n    HostName github.com"), "管理段置顶，用户手写的部分不动");
        assert_eq!(replace_block(&out, &block), out, "再同步一次内容不变");
        // 没有管理段时加到开头
        let fresh = replace_block("Host gh\n  User git\n", &block);
        assert!(fresh.starts_with(BEGIN) && fresh.ends_with("Host gh\n  User git\n"));
        assert_eq!(replace_block("", &block), block);
        assert_eq!(replace_block("\n\n", &block), format!("{block}\n\n"), "手写段的空行也要保留");
    }

    fn temporary_dir(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("lookout-ssh-{label}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn entry(alias: &str) -> HostEntry {
        HostEntry { alias: alias.into(), host: "h.example".into(), port: 22, user: "root".into(), identity_file: None }
    }

    #[test]
    fn chinese_aliases_are_safe_but_shell_and_pattern_characters_are_not() {
        assert!(valid_alias("训练机-A100_1"));
        for alias in ["", "a b", "-option", "a*b", "a?b", "a!b", "a$b", "a\nHost evil", "a#b", "a;b", "a'b", "a\\b", "a/b", "a@b", "a%b", "a\0b"] {
            assert!(!valid_alias(alias), "{alias:?}");
        }
        assert!(!valid_alias(&"训".repeat(65)));
        assert!(valid_alias(&"训".repeat(64)));
    }

    #[test]
    fn parser_handles_quotes_comments_case_and_windows_key_paths() {
        let hosts = parse_config("HOST=\"训练机-A100\" MixedCase # note\n HostName=h.example\n User root # comment\n Port 2222\n IdentityFile \"C:\\Users\\you\\.ssh\\my key\"\n");
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "训练机-A100");
        assert_eq!(hosts[1].alias, "MixedCase");
        assert_eq!(hosts[0].identity_file.as_deref(), Some("C:\\Users\\you\\.ssh\\my key"));
        assert_eq!((hosts[0].user.as_str(), hosts[0].port), ("root", 2222));
    }

    #[test]
    fn conflict_in_manual_config_preserves_file_and_existing_backup() {
        let dir = temporary_dir("manual-conflict");
        let path = dir.join("config");
        let original = "# user configuration\nHOST=\"TRAIN\" alternate # duplicate\n HostName %h\n";
        std::fs::write(&path, original).unwrap();
        let backup = dir.join("config.autodl-lookout.bak");
        std::fs::write(&backup, "existing backup").unwrap();
        let error = write_block_at(&path, &[entry("train")]).unwrap_err();
        assert!(error.contains("占用") && error.contains("AutoDL"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "existing backup");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn static_nested_include_conflicts_are_detected_without_writing() {
        let dir = temporary_dir("include-conflict");
        std::fs::create_dir(dir.join("config folder")).unwrap();
        let path = dir.join("config");
        let original = "Include \"config folder/*.conf\"\n# mine\n";
        std::fs::write(&path, original).unwrap();
        std::fs::write(dir.join("config folder/one.conf"), "Include more.conf\n").unwrap();
        std::fs::write(dir.join("more.conf"), "Host first Train\n  HostName h.example\n").unwrap();
        assert!(write_block_at(&path, &[entry("train")]).unwrap_err().contains("占用"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(!dir.join("config.autodl-lookout.bak").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn uncheckable_includes_and_broken_markers_never_write() {
        let dir = temporary_dir("uncheckable");
        let path = dir.join("config");
        for original in ["Include ${HOME}/config\n".to_string(), "Include config\n".into(), format!("{BEGIN}\nHost old\n"), format!("{END}\n{BEGIN}\n")] {
            std::fs::write(&path, &original).unwrap();
            assert!(write_block_at(&path, &[entry("train")]).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
            assert!(!dir.join("config.autodl-lookout.bak").exists());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn overly_deep_include_chains_do_not_write() {
        let dir = temporary_dir("deep-include");
        let path = dir.join("config");
        let original = "Include child0.conf\n";
        std::fs::write(&path, original).unwrap();
        for n in 0..9 {
            std::fs::write(dir.join(format!("child{n}.conf")), format!("Include child{}.conf\n", n + 1)).unwrap();
        }
        assert!(write_block_at(&path, &[entry("train")]).unwrap_err().contains("过多"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        assert!(!dir.join("config.autodl-lookout.bak").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn marker_text_inside_user_comments_is_not_a_managed_block() {
        let original = format!("# documentation mentions {BEGIN}\n# and {END}\nHost lab\n HostName h.example\n");
        let block = render_block(&[entry("train")]);
        assert_eq!(replace_block(&original, &block), format!("{block}{original}"));
    }

    #[test]
    fn invalid_and_duplicate_entries_never_create_a_config() {
        let dir = temporary_dir("bad-entry");
        let path = dir.join("config");
        for entries in [vec![entry("a\nHost evil")], vec![entry("Train"), entry("train")]] {
            assert!(write_block_at(&path, &entries).is_err());
            assert!(!path.exists());
            assert!(!dir.join("config.autodl-lookout.bak").exists());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn name_migration_preserves_manual_bytes_and_is_repeatable() {
        let dir = temporary_dir("migration");
        let path = dir.join("config");
        let prefix = "# 中文注释\r\nHost *\r\n  ServerAliveInterval 60\r\n";
        let suffix = "\r\nHost lab\r\n  HostName 10.0.0.8\r\n";
        let old = format!("{prefix}{BEGIN}\nHost autodl-train-abcdef\n HostName old.example\n{END}\n{suffix}");
        std::fs::write(&path, &old).unwrap();
        assert!(write_block_at(&path, &[entry("训练机-A100")]).unwrap());
        let result = std::fs::read_to_string(&path).unwrap();
        assert!(result.starts_with(BEGIN));
        assert!(result.contains("Host 训练机-A100\n"));
        assert!(!result.contains("autodl-train-abcdef"));
        assert!(result.ends_with(&format!("{prefix}{suffix}")));
        assert_eq!(std::fs::read_to_string(dir.join("config.autodl-lookout.bak")).unwrap(), old);
        assert!(!write_block_at(&path, &[entry("训练机-A100")]).unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
