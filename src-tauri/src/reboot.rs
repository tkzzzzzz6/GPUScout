//! 自有服务器重启：固定命令、明确确认，不因断线猜测成功或重发。
use crate::ssh::{ExecOut, OnceError};
use crate::store::Store;
use std::sync::Mutex;

static ATTEMPT_LOCK: Mutex<()> = Mutex::new(());
pub const ACK: &str = "GPUSCOUT_RESTART_ACCEPTED";
// 延迟一分钟使 shutdown 能返回明确结果，也给用户留出保存工作的时间。
// 不从界面拼接命令，不读取 sudo 密码；服务器权限由用户自行配置。
pub const COMMAND: &str = "if [ \"$(uname -s)\" != Linux ]; then exit 20; fi\nif [ \"$(id -u)\" = 0 ]; then\n /sbin/shutdown -r +1 </dev/null >/dev/null 2>&1\nelse\n sudo -n -- /sbin/shutdown -r +1 </dev/null >/dev/null 2>&1\nfi\nresult=$?\nif [ \"$result\" -eq 0 ]; then printf '%s\\n' GPUSCOUT_RESTART_ACCEPTED; else exit 21; fi";

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status { Submitted, Unknown }

#[derive(Debug, serde::Serialize)]
pub struct ResultInfo { pub status: Status, pub message: String }

pub fn server_id(id: &str) -> Result<i64, String> {
    id.strip_prefix("srv:").and_then(|s| s.parse::<i64>().ok()).filter(|id| *id > 0)
        .ok_or_else(|| "重新启动只支持「我的服务器」，AutoDL 实例请使用开关机功能".into())
}

/// 在发送前记录，失败也不立即重试；同步锁覆盖读取/写入，防止并发调用绕过间隔。
pub fn claim_attempt(store: &Store, id: i64, now: i64) -> Result<(), String> {
    let _lock = ATTEMPT_LOCK.lock().map_err(|_| "重启操作锁不可用，请重启软件")?;
    let key = format!("server_restart:{id}");
    if let Some(previous) = store.kv_get(&key)? {
        let previous = previous.parse::<i64>().map_err(|_| "重启记录异常，请检查服务器状态后再处理")?;
        if now.saturating_sub(previous) < 60 { return Err("这台服务器一分钟内已尝试重启，请先检查结果，勿重复提交".into()); }
    }
    store.kv_set(&key, &now.to_string())
}

pub fn interpret(result: Result<ExecOut, OnceError>) -> Result<ResultInfo, String> {
    match result {
        Err(OnceError::NotSent(error)) => Err(error),
        Ok(out) if out.code == Some(0) && out.stdout.lines().any(|line| line.trim() == ACK) => Ok(ResultInfo {
            status: Status::Submitted, message: "重启请求已提交，服务器约一分钟后重启。请稍候再点「测试连接」恢复状态采集。".into(),
        }),
        Ok(out) if out.code == Some(20) => Err("仅支持 Linux 服务器，此次没有提交重启请求".into()),
        Ok(out) if out.code.is_some_and(|code| code != 0) => Err("未成功提交重启请求。请确认服务器有 /sbin/shutdown；非 root 账户还需要该命令的免密 sudo 权限，软件不会代填密码。".into()),
        _ => Ok(ResultInfo { status: Status::Unknown,
            message: "连接中断或结果不完整，无法确认重启请求是否已提交。请先通过终端检查服务器状态，不要立即重复重启；软件没有自动重发。".into() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_own_server_ids_are_accepted() {
        assert_eq!(server_id("srv:12").unwrap(), 12);
        for id in ["autodl:123", "srv:0", "srv:-1", "srv:1;reboot", "", "srv:x"] { assert!(server_id(id).is_err()); }
    }
    #[test]
    fn cooldown_records_attempts_per_server_and_rejects_clock_rollback() {
        let store = Store::open_in_memory().unwrap();
        claim_attempt(&store, 1, 100).unwrap();
        assert!(claim_attempt(&store, 1, 100).is_err());
        assert!(claim_attempt(&store, 1, 159).is_err());
        assert!(claim_attempt(&store, 1, 90).is_err(), "时钟回拨不能绕过间隔");
        claim_attempt(&store, 2, 100).unwrap();
        claim_attempt(&store, 1, 160).unwrap();
        assert_eq!(store.kv_get("server_restart:1").unwrap().as_deref(), Some("160"));
    }
    #[test]
    fn concurrent_calls_cannot_bypass_restart_interval() {
        let store = std::sync::Arc::new(Store::open_in_memory().unwrap());
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let threads: Vec<_> = (0..2).map(|_| {
            let (store, barrier) = (store.clone(), barrier.clone());
            std::thread::spawn(move || { barrier.wait(); claim_attempt(&store, 1, 100).is_ok() })
        }).collect();
        let accepted = threads.into_iter().map(|thread| usize::from(thread.join().unwrap())).sum::<usize>();
        assert_eq!(accepted, 1);
    }
    #[test]
    fn explicit_ack_is_required_and_failure_output_is_not_exposed() {
        let out = |code, stdout: &str| ExecOut { code, stdout: stdout.into(), stderr: "fake-sensitive-output".into() };
        assert_eq!(interpret(Ok(out(Some(0), ACK))).unwrap().status, Status::Submitted);
        for value in [out(None, ACK), out(Some(0), ""), out(Some(0), "partial")] {
            let result = interpret(Ok(value)).unwrap(); assert_eq!(result.status, Status::Unknown);
            assert!(!result.message.contains("fake-sensitive-output"));
        }
        for code in [1, 20, 21, 255] { assert!(!interpret(Ok(out(Some(code), ACK))).unwrap_err().contains("fake-sensitive-output")); }
        assert_eq!(interpret(Err(OnceError::Unconfirmed)).unwrap().status, Status::Unknown);
        assert!(interpret(Err(OnceError::NotSent("HOSTKEY_CHANGED:fake".into()))).unwrap_err().starts_with("HOSTKEY_CHANGED:"));
    }
}
