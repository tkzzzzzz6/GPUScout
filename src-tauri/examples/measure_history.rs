//! 离线测量真实 Store 的库存写入开销，不读取凭据、不访问 AutoDL、不触碰应用数据库。
use autodl_lookout_lib::{api::StockItem, store::Store};
use serde::Deserialize;

#[derive(Deserialize)]
struct Region {
    region: String,
    items: Vec<StockItem>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let profile: Vec<Region> = serde_json::from_str(include_str!("../../docs/history-profile.json"))?;
    let dir = std::env::temp_dir().join(format!("lookout-history-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_nanos()));
    std::fs::create_dir(&dir)?;
    let path = dir.join("measurement.sqlite3");
    let store = Store::open(&path)?;
    let settings = store.settings();
    let connection = rusqlite::Connection::open(&path)?;
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    let baseline = std::fs::metadata(&path)?.len();
    for second in (0..86400).step_by(settings.poll_interval_secs as usize) {
        for region in &settings.regions {
            let data = profile.iter().find(|entry| &entry.region == region).ok_or("测量样本缺少默认区域")?;
            store.insert_history(1_793_548_800 + second, region, &data.items)?;
        }
    }
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    let rows: i64 = connection.query_row("SELECT count(*) FROM stock_history", [], |row| row.get(0))?;
    let total = std::fs::metadata(&path)?.len();
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({
        "interval_seconds":settings.poll_interval_secs, "regions":settings.regions,
        "rows_per_day":rows, "baseline_bytes":baseline, "day1_bytes":total,
        "growth_bytes":total-baseline, "growth_mib_per_day":(total-baseline) as f64 / 1_048_576.0,
        "estimate_30days_mib":(total-baseline) as f64 * 30.0 / 1_048_576.0,
        "estimate_60days_mib":(total-baseline) as f64 * 60.0 / 1_048_576.0
    }))?);
    drop(connection); drop(store);
    std::fs::remove_dir_all(dir)?;
    Ok(())
}
