use std::sync::Mutex;
use std::time::Duration;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri::utils::config::BundleType;
use crate::AppState;

#[derive(Default)]
pub struct InstallGate(Mutex<Option<bool>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    configured: bool,
    can_install: bool,
    install_reason: Option<String>,
    auto_check: bool,
}

fn install_support(bundle: Option<BundleType>) -> (bool, Option<String>) {
    match bundle {
        Some(BundleType::Nsis | BundleType::App | BundleType::Dmg | BundleType::AppImage) => (true, None),
        Some(BundleType::Deb | BundleType::Rpm) => (false, Some("请下载对应的 deb/rpm 安装包，或使用包管理器升级。".into())),
        Some(BundleType::Msi) => (false, Some("当前使用 MSI 安装，请到发布页面下载同类型安装包升级。".into())),
        None => (false, Some("当前不是受支持的安装版，请到发布页面下载适合系统的安装包。".into())),
    }
}

fn auto_check(store: &crate::store::Store) -> Result<bool, String> {
    Ok(store.kv_get("update_auto_check")?.and_then(|value| value.parse().ok()).unwrap_or(true))
}

#[tauri::command]
pub fn updater_info(app: AppHandle, st: State<'_, AppState>) -> Result<UpdateInfo, String> {
    let configured = app.config().plugins.0.get("updater")
        .and_then(|value| value.get("pubkey")).and_then(|value| value.as_str())
        .is_some_and(|key| !key.trim().is_empty());
    let (can_install, install_reason) = install_support(tauri::utils::platform::bundle_type());
    Ok(UpdateInfo { version: app.package_info().version.to_string(), configured, can_install,
        install_reason, auto_check: auto_check(&st.store)? })
}

#[tauri::command]
pub fn set_update_auto_check(st: State<'_, AppState>, on: bool) -> Result<(), String> {
    // 独立存储，避免尚未保存的普通设置表单覆盖这个立即生效的开关。
    st.store.kv_set("update_auto_check", if on { "true" } else { "false" })
}

pub fn installing(app: &AppHandle) -> bool {
    app.state::<InstallGate>().0.lock().unwrap().is_some()
}

fn restore(st: &AppState, gate: &InstallGate) {
    if let Some(paused) = gate.0.lock().unwrap().take() { st.monitor.set_paused(paused); }
}

#[tauri::command]
pub async fn prepare_update_install(app: AppHandle, st: State<'_, AppState>, gate: State<'_, InstallGate>) -> Result<(), String> {
    let info = updater_info(app, st.clone())?;
    if !info.can_install || !info.configured { return Err("当前构建或安装方式不支持应用内更新，请使用对应安装包。".into()); }
    {
        let mut previous = gate.0.lock().unwrap();
        if previous.is_some() { return Err("已有更新正在安装。".into()); }
        *previous = Some(st.monitor.snapshot().paused);
    }
    st.monitor.set_paused(true);
    // 等待本轮自动动作结束，不能在数据库预留额度与实际请求之间重启。
    if tokio::time::timeout(Duration::from_secs(30), st.monitor.wait_idle_for_update()).await.is_ok() { return Ok(()); }
    restore(&st, &gate);
    Err("监控仍在完成当前查询，请稍后再安装更新。".into())
}

#[tauri::command]
pub fn cancel_update_install(st: State<'_, AppState>, gate: State<'_, InstallGate>) {
    restore(&st, &gate);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_policy_keeps_package_managers_and_msi_manual() {
        for kind in [BundleType::Deb, BundleType::Rpm, BundleType::Msi] {
            let (supported, reason) = install_support(Some(kind));
            assert!(!supported);
            assert!(reason.is_some());
        }
        assert!(!install_support(None).0);
        for kind in [BundleType::Nsis, BundleType::App, BundleType::AppImage] {
            assert!(install_support(Some(kind)).0);
        }
    }

    #[test]
    fn update_preference_defaults_on_and_survives_store_reopen() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("lookout-update-pref-{}-{nonce}.sqlite3", std::process::id()));
        {
            let store = crate::store::Store::open(&path).unwrap();
            assert!(auto_check(&store).unwrap());
            store.kv_set("update_auto_check", "false").unwrap();
        }
        let store = crate::store::Store::open(&path).unwrap();
        assert!(!auto_check(&store).unwrap());
        drop(store);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn failed_install_restores_the_previous_monitor_pause_state() {
        for paused in [false, true] {
            let store = std::sync::Arc::new(crate::store::Store::open(std::path::Path::new(":memory:")).unwrap());
            let monitor = crate::monitor::Monitor::new(store.clone(), None, None);
            let state = AppState { store, monitor };
            state.monitor.set_paused(true);
            let gate = InstallGate(Mutex::new(Some(paused)));
            restore(&state, &gate);
            assert_eq!(state.monitor.snapshot().paused, paused);
            assert!(gate.0.lock().unwrap().is_none());
        }
    }
}
