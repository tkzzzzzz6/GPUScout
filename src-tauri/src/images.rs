//! 普通实例镜像：来源由平台字段确认，界面选择不能绕过保存状态与下单前的可用性检查。
use crate::api::{required_str, shape_error, ApiResult};
use crate::market::{MarketClient, MachineSlot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source { #[default] Base, Mine, Shared }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Image {
    pub uuid: String,
    pub source: Source,
    pub name: String,
    pub status: String,
    pub framework: String,
    pub cuda: Option<i64>,
    pub owner: Option<String>,
    pub created_at: Option<String>,
    pub origin: Option<String>,
}

fn text(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn parse_private(list: &Value) -> ApiResult<Vec<Image>> {
    list.as_array().ok_or_else(|| shape_error("private_image.list"))?.iter().map(|v| {
        let source = match v.get("share_image_type").and_then(Value::as_i64) {
            Some(0 | 1) => Source::Mine,
            Some(2) => Source::Shared,
            _ => return Err(shape_error("private_image.share_image_type")),
        };
        Ok(Image { uuid: required_str(v, "image_uuid", "private_image.image_uuid")?.into(), source,
            name: required_str(v, "name", "private_image.name")?.into(),
            status: required_str(v, "status", "private_image.status")?.into(),
            framework: text(v, "framework").unwrap_or_default(),
            cuda: text(v, "cuda_v").or_else(|| text(v, "cuda_version")).and_then(|s| crate::market::parse_cuda(&s)),
            owner: text(v, "share_image_user"), created_at: text(v, "created_at"), origin: text(v, "image_source"),
        })
    }).collect()
}

pub fn validate_choice(images: &[Image], uuid: &str, source: Source, max_cuda: Option<i64>) -> Result<Image, String> {
    let image = images.iter().find(|i| i.uuid == uuid && i.source == source)
        .ok_or("选定镜像已不可用或来源不匹配，请刷新镜像库重新选择")?;
    if image.status != "finished" { return Err("镜像尚未就绪或保存失败，请先查看镜像库状态".into()); }
    if let (Some(cuda), Some(max)) = (image.cuda, max_cuda) {
        if cuda > max { return Err("选定镜像的 CUDA 高于主机驱动支持版本，请换主机或明确选择其他镜像".into()); }
    }
    Ok(image.clone())
}

pub fn validate_save(status: &str, name: &str) -> Result<(), String> {
    if !["shutdown", "shutdown_by_starting_error", "shutdown_by_running_error"].contains(&status) {
        return Err("请先手动关机，再保存镜像；软件不会自动中断训练".into());
    }
    if name.trim().is_empty() || name.chars().count() > 32 || name.chars().any(char::is_control) {
        return Err("镜像名称需为 1–32 个字符，不能含换行或控制字符".into());
    }
    Ok(())
}

impl MarketClient {
    pub async fn private_images(&self) -> ApiResult<Vec<Image>> {
        let mut all = vec![];
        for page in 1..=10 {
            let d = self.call(reqwest::Method::POST, "/api/v1/image/private/list", Some(json!({
                "order_uuid":"", "date_from":"", "date_to":"", "page_index":page, "page_size":100
            }))).await?;
            let list = d.get("list").and_then(Value::as_array).ok_or_else(|| shape_error("private_image.list"))?;
            let items = parse_private(&Value::Array(list.clone()))?;
            let finished = list.len() < 100 || d.get("max_page").and_then(Value::as_i64).is_some_and(|n| page >= n);
            all.extend(items);
            if finished { return Ok(all); }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        Err(shape_error("private_image.pagination_limit"))
    }

    pub async fn image_catalog(&self, private: bool) -> Result<Vec<Image>, String> {
        if private { self.private_images().await.map_err(|e| e.to_string()) }
        else { self.base_images().await.map(|list| list.into_iter().map(|i| Image {
            uuid:i.uuid, source:Source::Base, name:i.label, framework:i.framework, cuda:i.cuda,
            status:"finished".into(), owner:None, created_at:None, origin:Some("base".into()),
        }).collect()).map_err(|e| e.to_string()) }
    }

    pub async fn check_private_for_machine(&self, image: &Image, slot: &MachineSlot) -> Result<(), String> {
        // 与控制台选择器相同：平台返回普通创建可用的私有镜像，不凭名称猜测兼容性。
        if slot.cpu_arch.is_empty() { return Err("主机未提供 CPU 架构，无法确认私有镜像兼容性，请刷新或在控制台核对".into()); }
        let d = self.call(reqwest::Method::POST, "/api/v1/image/private/get", Some(json!({"cpu_arch":[slot.cpu_arch],"chip_corp":["nvidia"]})))
            .await.map_err(|e| e.to_string())?;
        let list = d.as_array().ok_or_else(|| shape_error("private_image.available").to_string())?;
        let chosen = list.iter().find(|v| v.get("image_uuid").and_then(Value::as_str) == Some(&image.uuid))
            .ok_or("平台已不再允许使用该镜像，可能已移除共享或仍在保存，请刷新")?;
        if let Some(cuda) = text(chosen, "cuda_v").and_then(|s| crate::market::parse_cuda(&s)) {
            if slot.max_cuda.is_some_and(|max| cuda > max) { return Err("镜像 CUDA 与目标主机不兼容，请换主机".into()); }
        }
        Ok(())
    }

    pub async fn save_regular_image(&self, uuid: &str, name: &str) -> ApiResult<()> {
        self.call(reqwest::Method::POST, "/api/v1/instance/image/save", Some(json!({"instance_uuid":uuid,"image_name":name,"try_again":false}))).await?;
        Ok(())
    }
}

pub fn claim_save(store: &crate::store::Store, uuid: &str, now: i64) -> Result<(), String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _lock = LOCK.lock().map_err(|_| "镜像操作锁不可用")?;
    let key = format!("save_regular_image:{uuid}");
    if store.kv_get(&key)?.and_then(|v| v.parse::<i64>().ok()).is_some_and(|at| now.saturating_sub(at) < 60) {
        return Err("一分钟内已经提交过镜像保存，请先刷新镜像库确认结果，勿重复提交".into());
    }
    store.kv_set(&key, &now.to_string())
}

/// Pro 使用独立的开发者凭证与系统盘语义，但保存同样需要确认状态和存储费用。
pub async fn save_pro(store:&crate::store::Store,client:&crate::api::Client,uuid:&str,name:&str,min:f64,at:i64)->Result<Value,String>{
    let status=client.status(uuid).await.map_err(|e|e.to_string())?;validate_save(&status,name)?;
    crate::market::rent_guard(client.balance().await.map(|b|b.assets).map_err(|e|e.to_string()),min)?;
    claim_save(store,uuid,at)?;client.save_image(uuid,name).await.map_err(|_|"镜像保存结果无法确认，请在 Pro 控制台核对，未自动重试".into())
}

type Entry = (u64, Instant, Result<Vec<Image>, String>);
#[derive(Default)]
pub struct CatalogCache { epoch: AtomicU64, entries: tokio::sync::Mutex<HashMap<bool, Entry>> }
impl CatalogCache {
    pub fn epoch(&self) -> u64 { self.epoch.load(Ordering::SeqCst) }
    pub fn invalidate(&self) { self.epoch.fetch_add(1, Ordering::SeqCst); }
    pub async fn get<F, Fut>(&self, private: bool, epoch: u64, force: bool, fetch: F) -> Result<Vec<Image>, String>
    where F: FnOnce() -> Fut, Fut: std::future::Future<Output=Result<Vec<Image>, String>> {
        let mut entries = self.entries.lock().await;
        if self.epoch() != epoch { return Err("账号或镜像列表已变化，请重新读取".into()); }
        if let Some((e, at, value)) = entries.get(&private) {
            let ttl = if force || value.is_err() { 3 } else if private { 30 } else { 3600 };
            if *e == epoch && at.elapsed() < Duration::from_secs(ttl) { return value.clone(); }
        }
        // 一次仅一个镜像请求；不同来源之间也留出最小间隔。
        if let Some(last) = entries.values().map(|(_, at, _)| *at).max() {
            let wait = Duration::from_millis(300).saturating_sub(last.elapsed());
            if !wait.is_zero() { tokio::time::sleep(wait).await; }
        }
        let result = fetch().await;
        if self.epoch() != epoch { return Err("账号或镜像列表已变化，请重新读取".into()); }
        entries.insert(private, (epoch, Instant::now(), result.clone()));
        result
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    fn fixture(source: i64, status: &str) -> Value { json!({"image_uuid":"image-test","name":"训练环境","status":status,"share_image_type":source,"share_image_user":"示例分享者","image_source":"instance","created_at":"2026-11-26"}) }

    #[test]
    fn sources_status_and_unknown_versions_are_explicit() {
        for (kind, source) in [(0,Source::Mine),(1,Source::Mine),(2,Source::Shared)] {
            let list=parse_private(&json!([fixture(kind,"finished")])).unwrap();
            assert_eq!(list[0].source,source);assert_eq!(list[0].cuda,None);
            assert_eq!(list[0].name,"训练环境");
        }
        for key in ["image_uuid","name","status","share_image_type"] {
            let mut v=fixture(0,"finished");v.as_object_mut().unwrap().remove(key);
            assert!(parse_private(&json!([v])).is_err());
        }
        assert!(parse_private(&json!([fixture(3,"finished")])).is_err());
        assert!(parse_private(&json!({"items":[]})).is_err());
        assert!(parse_private(&json!([])).unwrap().is_empty());
    }

    #[test]
    fn choice_rejects_spoofed_source_missing_saving_failed_and_cuda_mismatch() {
        let mut list=parse_private(&json!([fixture(2,"finished")])).unwrap();
        assert!(validate_choice(&list,"image-test",Source::Mine,Some(124)).is_err());
        assert!(validate_choice(&list,"missing",Source::Shared,None).is_err());
        list[0].cuda=Some(128);
        assert!(validate_choice(&list,"image-test",Source::Shared,Some(124)).is_err());
        assert!(validate_choice(&list,"image-test",Source::Shared,Some(128)).is_ok());
        for status in ["saving","failed","unknown"] {list[0].status=status.into();assert!(validate_choice(&list,"image-test",Source::Shared,None).is_err());}
    }

    #[test]
    fn save_requires_stopped_instance_name_and_interval() {
        assert!(validate_save("running","valid").is_err());
        assert!(validate_save("starting","valid").is_err());
        assert!(validate_save("shutdown","环境").is_ok());
        for name in ["", "  ", "bad\nname", &"字".repeat(33)] {assert!(validate_save("shutdown",name).is_err());}
        let store=crate::store::Store::open_in_memory().unwrap();
        claim_save(&store,"source",100).unwrap();assert!(claim_save(&store,"source",101).is_err());
        claim_save(&store,"other",101).unwrap();claim_save(&store,"source",160).unwrap();
    }

    #[tokio::test]
    async fn cache_coalesces_requests_caches_errors_and_rejects_changed_account() {
        use std::sync::atomic::AtomicUsize;
        let cache=CatalogCache::default();let calls=AtomicUsize::new(0);let epoch=cache.epoch();
        let fetch=||async {calls.fetch_add(1,Ordering::SeqCst);Ok(vec![])};
        let (a,b)=tokio::join!(cache.get(true,epoch,false,fetch),cache.get(true,epoch,false,fetch));
        assert!(a.is_ok() && b.is_ok());assert_eq!(calls.load(Ordering::SeqCst),1,"空列表也缓存");
        cache.invalidate();assert!(cache.get(true,epoch,false,fetch).await.is_err());
        let next=cache.epoch();
        assert!(cache.get(true,next,false,||async {cache.invalidate();Ok(vec![])}).await.is_err(),"旧账号在途结果不能泄露");
        let epoch=cache.epoch();
        assert!(cache.get(true,epoch,false,||async {Err("offline".into())}).await.is_err());
        assert!(cache.get(true,epoch,true,fetch).await.is_err());assert_eq!(calls.load(Ordering::SeqCst),1);
    }

    pub(crate) async fn server(replies: Vec<Value>) -> (String,tokio::task::JoinHandle<Vec<String>>) {
        use tokio::io::{AsyncReadExt,AsyncWriteExt};
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base=format!("http://{}",listener.local_addr().unwrap());
        let task=tokio::spawn(async move {
            let mut requests=vec![];
            for reply in replies {
                let (mut socket,_)=listener.accept().await.unwrap();let mut bytes=vec![];let mut buf=[0;8192];
                loop {
                    let n=socket.read(&mut buf).await.unwrap();if n==0{break;} bytes.extend_from_slice(&buf[..n]);
                    let text=String::from_utf8_lossy(&bytes);
                    if let Some(end)=text.find("\r\n\r\n") {
                        let len=text[..end].lines().find_map(|l|l.to_ascii_lowercase().strip_prefix("content-length: ").and_then(|s|s.parse::<usize>().ok())).unwrap_or(0);
                        if bytes.len()>=end+4+len{break;}
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());let body=reply.to_string();
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
            }
            requests
        });(base,task)
    }
    fn response(data: Value) -> Value {json!({"code":"Success","data":data})}
    fn body(request: &str) -> Value {serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap()}

    #[tokio::test]
    async fn private_list_paginates_and_uses_web_auth_without_exposing_extra_fields() {
        let rows:Vec<_>=(0..100).map(|_|fixture(0,"finished")).collect();
        let (base,task)=server(vec![response(json!({"list":rows,"max_page":2})),response(json!({"list":[fixture(2,"saving")],"max_page":2}))]).await;
        let list=MarketClient::with_base("fake-web-token",base).private_images().await.unwrap();assert_eq!(list.len(),101);assert_eq!(list[100].source,Source::Shared);
        let requests=task.await.unwrap();
        for (idx,request) in requests.iter().enumerate(){assert!(request.starts_with("POST /api/v1/image/private/list "));assert!(request.contains("fake-web-token"));assert_eq!(body(request)["page_index"],idx+1);}
    }

    #[tokio::test]
    async fn eligibility_checks_target_architecture_and_revoked_shared_image() {
        let image=parse_private(&json!([fixture(2,"finished")])).unwrap().remove(0);
        let slot=MachineSlot{cpu_arch:"x86".into(),max_cuda:Some(124),..Default::default()};
        let (base,task)=server(vec![response(json!([{"image_uuid":"image-test","cuda_v":"12.4"}]))]).await;
        MarketClient::with_base("fake",base).check_private_for_machine(&image,&slot).await.unwrap();
        let requests=task.await.unwrap();assert!(requests[0].starts_with("POST /api/v1/image/private/get "));
        assert_eq!(body(&requests[0]),json!({"cpu_arch":["x86"],"chip_corp":["nvidia"]}));
        let (base,task)=server(vec![response(json!([]))]).await;
        assert!(MarketClient::with_base("fake",base).check_private_for_machine(&image,&slot).await.is_err());task.await.unwrap();
    }

    #[tokio::test]
    async fn saving_submits_once_and_rental_routes_exactly_one_image_field() {
        let (base,task)=server(vec![response(Value::Null)]).await;
        MarketClient::with_base("fake",base).save_regular_image("source","环境").await.unwrap();
        let requests=task.await.unwrap();assert!(requests[0].starts_with("POST /api/v1/instance/image/save "));
        assert_eq!(body(&requests[0]),json!({"instance_uuid":"source","image_name":"环境","try_again":false}));
        for source in [Source::Base,Source::Mine,Source::Shared] {
            let req=crate::market::RentReq{machine_id:"machine".into(),gpu_amount:2,image_uuid:"image".into(),image_source:source,name:"".into()};
            let b=crate::market::rent_body(&req);assert_eq!(b["instance_info"]["base_image_uuid"],if source==Source::Base{"image"}else{""});
            assert_eq!(b["instance_info"]["private_image_uuid"],if source==Source::Base{""}else{"image"});
        }
    }
    #[tokio::test]async fn pro_save_checks_status_balance_and_posts_once(){
        let store=crate::store::Store::open_in_memory().unwrap();
        let (base,h)=server(vec![response(json!("running"))]).await;
        assert!(save_pro(&store,&crate::api::Client::with_base("fake-dev",base),"pro-src","环境",10.0,100).await.is_err());assert_eq!(h.await.unwrap().len(),1);
        let (base,h)=server(vec![response(json!("shutdown")),response(json!({"assets":1000}))]).await;
        assert!(save_pro(&store,&crate::api::Client::with_base("fake-dev",base),"pro-src","环境",10.0,100).await.is_err());assert_eq!(h.await.unwrap().len(),2);
        let (base,h)=server(vec![response(json!("shutdown")),response(json!({"assets":100000})),response(Value::Null)]).await;
        save_pro(&store,&crate::api::Client::with_base("fake-dev",base),"pro-src","环境",10.0,100).await.unwrap();let req=h.await.unwrap();assert!(req[2].starts_with("POST /api/v1/dev/instance/pro/image/save "));assert_eq!(body(&req[2]),json!({"instance_uuid":"pro-src","image_name":"环境"}));assert!(req[2].contains("fake-dev"));assert!(claim_save(&store,"pro-src",101).is_err());
    }

}
