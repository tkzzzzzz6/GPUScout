//! 服务器列表：AutoDL 实例（网页凭证现查，端口会变）+ 自己的服务器（存在 SQLite）。
//! 负责拼出统一的视图、SSH 目标（认证方式）、软件管理的 SSH 配置段。

use crate::market::RegularInstance;
use crate::ssh::{own_key_path, Target};
use crate::sshconfig::{alias_key, parse_ssh_command, slug, valid_alias, ConfigSnapshot, HostEntry};
use crate::store::{Server, Store};
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct ServerView {
    /// `autodl:<实例 uuid>` 或 `srv:<数据库 id>`
    pub id: String,
    /// "autodl" | "custom"
    pub kind: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub user: String,
    /// 连接时用的 SSH 别名：导入的用原来的 Host 名，其余是软件管理段里的名字（要同步过才能用）
    pub alias: String,
    /// 别名是不是已经在 ~/.ssh/config 里
    pub alias_ready: bool,
    pub auth: String,
    pub key_path: Option<String>,
    pub has_password: bool,
    /// 公钥推过了（之后优先用密钥登录）
    pub key_pushed: bool,
    /// AutoDL 实例的状态、卡型、区域
    pub status: Option<String>,
    pub gpu: Option<String>,
    pub region_name: Option<String>,
    pub note: Option<String>,
}

pub fn autodl_alias(i: &RegularInstance) -> String {
    i.name.clone()
}

pub fn custom_alias(s: &Server) -> String {
    s.alias.clone().unwrap_or_else(|| format!("lookout-{}-{}", slug(&s.name, "server"), s.id))
}

pub fn pushed_kv(user: &str, host: &str, port: i64) -> String {
    format!("keypushed:{user}@{host}:{port}")
}

/// 软件管理的配置段里要写的条目：有 SSH 信息的 AutoDL 实例 + 不是从配置导入的自己的服务器
pub fn managed_entries(instances: &[RegularInstance], servers: &[Server]) -> Result<Vec<HostEntry>, String> {
    let mut names = std::collections::HashMap::new();
    for instance in instances {
        let source = format!("{}，实例 {}", instance.region_name, instance.uuid.chars().take(8).collect::<String>());
        if !valid_alias(&instance.name) {
            return Err(format!("AutoDL 实例（{source}）的名称 {:?} 不能直接用于 SSH。请在 AutoDL 控制台改为最多 64 个中文/英文字母、数字、点、横线或下划线，不能含空格或以横线开头，再点“刷新”并重新同步。", instance.name));
        }
        if let Some(previous) = names.insert(alias_key(&instance.name), source.clone()) {
            return Err(format!("AutoDL 实例名称 {:?} 重名（{previous}；{source}，名称不区分大小写）。请在 AutoDL 控制台将它们改成不同名称，再点“刷新”并重新同步；不会自动追加编号。", instance.name));
        }
    }
    for server in servers {
        let alias = custom_alias(server);
        if let Some(previous) = names.insert(alias_key(&alias), format!("自有服务器 {}", server.name)) {
            return Err(format!("SSH 名称 {alias:?} 与{previous} 重名。请在 AutoDL 修改实例名，或调整自有/导入服务器的 SSH 名称，再刷新同步；这次没有修改配置。"));
        }
    }
    let own = own_key_path().filter(|p| p.exists()).map(|p| p.display().to_string());
    let mut out = vec![];
    for i in instances {
        if let Some((host, port, user)) = parse_ssh_command(&i.ssh_command) {
            out.push(HostEntry { alias: autodl_alias(i), host, port, user, identity_file: own.clone() });
        }
    }
    for s in servers.iter().filter(|s| s.alias.is_none()) {
        let key = s.key_path.clone().filter(|k| !k.is_empty()).or_else(|| own.clone());
        out.push(HostEntry { alias: custom_alias(s), host: s.host.clone(), port: s.port, user: s.user.clone(), identity_file: key });
    }
    Ok(out)
}

pub const SYNC_ERROR_KEY: &str = "ssh_sync_error";

/// 所有同步入口共用，后台错误也会留在服务器页，不再静默忽略。
pub fn sync_config(store: &Store, instances: &[RegularInstance], servers: &[Server]) -> Result<(bool, usize), String> {
    sync_with_writer(store, instances, servers, crate::sshconfig::write_block)
}

fn sync_with_writer(store: &Store, instances: &[RegularInstance], servers: &[Server], write: impl FnOnce(&[HostEntry]) -> Result<bool, String>) -> Result<(bool, usize), String> {
    let result = (|| {
        let entries = managed_entries(instances, servers)?;
        write(&entries).map(|changed| (changed, entries.len()))
    })();
    let error = result.as_ref().err().cloned().unwrap_or_default();
    if store.kv_get(SYNC_ERROR_KEY).ok().flatten().as_deref() != Some(error.as_str()) {
        let _ = store.kv_set(SYNC_ERROR_KEY, &error);
        if !error.is_empty() { let _ = store.log(crate::monitor::now(), "warn", "server", None, &error); }
    }
    result
}

pub fn views(store: &Store, instances: &[RegularInstance], servers: &[Server], config: &ConfigSnapshot) -> Vec<ServerView> {
    let pushed = |u: &str, h: &str, p: i64| store.kv_get(&pushed_kv(u, h, p)).ok().flatten().is_some();
    let names_valid = managed_entries(instances, servers).is_ok();
    let ready = |alias: &str, host: &str, port: i64, user: &str, imported: bool| {
        let matches: Vec<_> = config.entries.iter().filter(|entry| alias_key(&entry.alias) == alias_key(alias)).collect();
        valid_alias(alias)
            && matches.len() == 1
            // 导入项以用户的 SSH 配置为准，User 等选项可能来自全局默认值，软件不管理它们。
            && (imported || names_valid && !config.reserved_aliases.iter().any(|a| alias_key(a) == alias_key(alias))
                && matches[0].host == host && matches[0].port == port && matches[0].user == user)
    };
    let mut out = vec![];
    for i in instances {
        let (host, port, user) = parse_ssh_command(&i.ssh_command).unwrap_or_default();
        let alias = autodl_alias(i);
        out.push(ServerView {
            id: format!("autodl:{}", i.uuid),
            kind: "autodl".into(),
            name: if i.name.is_empty() { format!("{} {}", i.region_name, i.machine_alias).trim().to_string() } else { i.name.clone() },
            alias_ready: ready(&alias, &host, port, &user, false),
            alias,
            key_pushed: !host.is_empty() && pushed(&user, &host, port),
            host,
            port,
            user,
            auth: "password".into(),
            key_path: None,
            has_password: i.has_password,
            status: Some(i.status.clone()),
            gpu: Some(format!("{} × {}", i.gpu, i.gpu_amount)),
            region_name: Some(i.region_name.clone()),
            note: None,
        });
    }
    for s in servers {
        let alias = custom_alias(s);
        out.push(ServerView {
            id: format!("srv:{}", s.id),
            kind: "custom".into(),
            name: s.name.clone(),
            host: s.host.clone(),
            port: s.port,
            user: s.user.clone(),
            alias_ready: ready(&alias, &s.host, s.port, &s.user, s.alias.is_some()),
            alias,
            auth: s.auth.clone(),
            key_path: s.key_path.clone(),
            has_password: s.auth == "password" && crate::secret::load_server_password(store, s.id).is_some(),
            key_pushed: pushed(&s.user, &s.host, s.port),
            note: s.note.clone(),
            ..Default::default()
        });
    }
    out
}

/// 连接用的目标：先试私钥（自己指定的 → 软件生成的），再试密码
pub fn target(v: &ServerView, password: Option<String>) -> Target {
    let mut keys = vec![];
    if let Some(k) = v.key_path.as_ref().filter(|k| !k.is_empty()) {
        keys.push(expand_home(k));
    }
    if let Some(p) = own_key_path() {
        keys.push(p);
    }
    Target { host: v.host.clone(), port: v.port as u16, user: v.user.clone(), keys, password }
}

/// 服务器的密码：AutoDL 实例用网页凭证单独取（不进列表、不写日志），自己的服务器从钥匙串读
pub async fn password(mon: &crate::monitor::Monitor, v: &ServerView) -> Result<Option<String>, String> {
    if let Some(uuid) = v.id.strip_prefix("autodl:") {
        if !v.has_password {
            return Ok(None);
        }
        return mon.instance_password_cached(uuid).await.map(Some);
    }
    let id: i64 = v.id.trim_start_matches("srv:").parse().map_err(|e: std::num::ParseIntError| e.to_string())?;
    Ok(crate::secret::load_server_password(&mon.store, id))
}

/// 在服务器上执行命令：推过公钥或用私钥的先只用密钥，失败（比如实例重建过）再带上密码重试；
/// 主机密钥变化的错误直接返回，不会退回密码
pub async fn exec(mon: &crate::monitor::Monitor, v: &ServerView, cmd: &str) -> Result<crate::ssh::ExecOut, String> {
    let pool = &mon.ssh;
    if v.host.is_empty() {
        return Err("这台实例还没有 SSH 信息（可能还没开机）".into());
    }
    if v.key_pushed || v.auth == "key" {
        match pool.exec(&target(v, None), cmd).await {
            Ok(o) => return Ok(o),
            Err(e) if e.starts_with(crate::ssh::HOSTKEY_CHANGED) => return Err(e),
            Err(e) if v.auth == "key" && !v.has_password => return Err(e),
            Err(_) => {}
        }
    }
    let pw = password(mon, v).await?;
    let t = target(v, pw);
    pool.forget(&t).await;
    pool.exec(&t, cmd).await
}

/// 配置里常见的 `~/.ssh/id_xxx`
pub fn expand_home(p: &str) -> std::path::PathBuf {
    if let Some(rest) = p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        if let Some(d) = crate::sshconfig::ssh_dir().and_then(|d| d.parent().map(|x| x.to_path_buf())) {
            return d.join(rest);
        }
    }
    std::path::PathBuf::from(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inst(name: &str, uuid: &str, cmd: &str) -> RegularInstance {
        RegularInstance { uuid: uuid.into(), name: name.into(), gpu: "RTX 4090".into(), gpu_amount: 2, region_name: "西北B区".into(),
            ssh_command: cmd.into(), status: "running".into(), has_password: true, ..Default::default() }
    }

    #[test]
    fn aliases_are_stable_and_safe() {
        assert_eq!(autodl_alias(&inst("Qwen-LoRA", "a1b2c3d4e5-f6a7b8c9", "")), "Qwen-LoRA");
        assert_eq!(autodl_alias(&inst("训练机-A100", "A1B2C3D4E5", "")), "训练机-A100");
        let s = Server { id: 7, name: "实验室 A100".into(), ..Default::default() };
        assert_eq!(custom_alias(&s), "lookout-a100-7");
        let imported = Server { alias: Some("lab".into()), ..s };
        assert_eq!(custom_alias(&imported), "lab");
    }

    #[test]
    fn managed_entries_skip_imported_and_broken() {
        let insts = vec![inst("a", "u1", "ssh -p 32145 root@region-9.autodl.pro"), inst("b", "u2", "")];
        let servers = vec![
            Server { id: 1, name: "lab".into(), host: "10.0.0.8".into(), port: 22, user: "tk".into(), auth: "key".into(), key_path: Some("~/.ssh/id_lab".into()), ..Default::default() },
            Server { id: 2, name: "cloud".into(), host: "47.1.2.3".into(), port: 22, user: "ubuntu".into(), alias: Some("cloud".into()), ..Default::default() },
        ];
        let e = managed_entries(&insts, &servers).unwrap();
        assert_eq!(e.len(), 2, "没有 SSH 信息的实例和导入的服务器不写");
        assert_eq!((e[0].host.as_str(), e[0].port, e[0].user.as_str()), ("region-9.autodl.pro", 32145, "root"));
        assert_eq!(e[1].alias, "lookout-lab-1");
        assert_eq!(e[1].identity_file.as_deref(), Some("~/.ssh/id_lab"));
    }

    #[test]
    fn views_merge_both_kinds() {
        let store = Store::open_in_memory().unwrap();
        store.kv_set(&pushed_kv("root", "region-9.autodl.pro", 32145), "1").unwrap();
        let insts = vec![inst("a", "u1", "ssh -p 32145 root@region-9.autodl.pro")];
        let servers = vec![Server { id: 3, name: "lab".into(), host: "10.0.0.8".into(), port: 22, user: "tk".into(), auth: "key".into(), ..Default::default() }];
        let mut config = ConfigSnapshot::default();
        config.entries.push(HostEntry { alias: "lookout-lab-3".into(), host: "10.0.0.8".into(), port: 22, user: "tk".into(), identity_file: None });
        let v = views(&store, &insts, &servers, &config);
        assert_eq!(v.len(), 2);
        assert_eq!((v[0].id.as_str(), v[0].kind.as_str(), v[0].key_pushed, v[0].alias_ready), ("autodl:u1", "autodl", true, false));
        assert_eq!((v[1].id.as_str(), v[1].alias_ready, v[1].key_pushed), ("srv:3", true, false));
    }

    #[test]
    fn duplicate_names_and_invalid_names_require_renaming() {
        for name in ["", "bad name", "-option", "bad*", "bad\nHost injected"] {
            assert!(managed_entries(&[inst(name, "u1", "ssh root@h.example")], &[]).unwrap_err().contains("AutoDL"));
        }
        let instances = [inst("Train", "u1", "ssh root@one.example"), inst("train", "u2", "")];
        let error = managed_entries(&instances, &[]).unwrap_err();
        assert!(error.contains("重名") && error.contains("u1") && error.contains("u2"));
    }

    #[test]
    fn imported_and_generated_custom_aliases_reserve_their_names() {
        let custom = Server { id: 1, name: "lab".into(), alias: Some("TRAIN".into()), ..Default::default() };
        assert!(managed_entries(&[inst("train", "u1", "ssh root@h.example")], &[custom]).is_err());
        let custom = Server { id: 1, name: "lab".into(), ..Default::default() };
        assert!(managed_entries(&[inst("lookout-lab-1", "u1", "ssh root@h.example")], &[custom]).is_err());
    }

    #[test]
    fn alias_ready_requires_the_correct_target_and_no_name_conflict() {
        let store = Store::open_in_memory().unwrap();
        let instances = [inst("train", "u1", "ssh -p 1234 root@h.example")];
        let mut config = ConfigSnapshot::default();
        config.entries.push(HostEntry { alias: "train".into(), host: "other.example".into(), port: 1234, user: "root".into(), identity_file: None });
        assert!(!views(&store, &instances, &[], &config)[0].alias_ready);
        config.entries[0].host = "h.example".into();
        assert!(views(&store, &instances, &[], &config)[0].alias_ready);
        config.entries[0].port = 22;
        assert!(!views(&store, &instances, &[], &config)[0].alias_ready);
        config.entries[0].port = 1234;
        config.entries[0].user = "other".into();
        assert!(!views(&store, &instances, &[], &config)[0].alias_ready);
        config.entries[0].user = "root".into();
        config.reserved_aliases.push("TRAIN".into());
        assert!(!views(&store, &instances, &[], &config)[0].alias_ready);
        config.reserved_aliases.clear();
        let duplicates = [instances[0].clone(), inst("Train", "u2", "ssh root@different.example")];
        assert!(!views(&store, &duplicates, &[], &config)[0].alias_ready);
        let imported = Server { alias: Some("train".into()), host: "h.example".into(), port: 1234, user: "root".into(), ..Default::default() };
        config.entries[0].user.clear();
        assert!(views(&store, &[], &[imported], &config)[0].alias_ready, "导入项的全局默认用户名由 SSH 自己解析");
    }

    #[test]
    fn sync_errors_are_visible_and_clear_after_a_successful_retry() {
        let store = Store::open_in_memory().unwrap();
        let instances = [inst("train", "u1", "ssh root@h.example")];
        let failure = |_: &[HostEntry]| Err("写入失败：permission denied".to_string());
        assert!(sync_with_writer(&store, &instances, &[], failure).is_err());
        assert_eq!(store.kv_get(SYNC_ERROR_KEY).unwrap().as_deref(), Some("写入失败：permission denied"));
        assert_eq!(sync_with_writer(&store, &instances, &[], |_| Ok(false)).unwrap(), (false, 1));
        assert_eq!(store.kv_get(SYNC_ERROR_KEY).unwrap().as_deref(), Some(""));
        let invalid = [inst("train", "u1", "ssh root@h.example"), inst("TRAIN", "u2", "")];
        assert!(sync_with_writer(&store, &invalid, &[], |_| panic!("重名时不能调用写入")).is_err());
        assert!(store.kv_get(SYNC_ERROR_KEY).unwrap().unwrap().contains("重名"));
    }
}
