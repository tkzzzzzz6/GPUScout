//! 跨地区是镜像新建与人工数据迁移，不调用普通克隆接口。
use crate::{images::Source,store::Store};
use serde::{Deserialize,Serialize};
#[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Migration {pub source_uuid:String,pub source_region:String,pub target_region:Option<String>,pub image_uuid:Option<String>,pub pending:bool,pub target_uuid:Option<String>,pub verified:bool}
pub fn read(store:&Store,uuid:&str)->Result<Option<Migration>,String>{store.kv_get(&format!("migration:{uuid}"))?.map(|s|serde_json::from_str(&s).map_err(|_|"迁移记录读取失败，请勿重复创建目标实例".into())).transpose()}
pub fn write(store:&Store,state:&Migration)->Result<(),String>{store.kv_set(&format!("migration:{}",state.source_uuid),&serde_json::to_string(state).map_err(|e|e.to_string())?)}
pub fn initial(uuid:&str,region:&str)->Migration{Migration{source_uuid:uuid.into(),source_region:region.into(),target_region:None,image_uuid:None,pending:false,target_uuid:None,verified:false}}
pub fn prepare(state:&mut Migration,region:&str,uuid:&str,source:Source)->Result<(),String>{
    if state.pending||state.target_uuid.is_some(){return Err("已经创建或正在核对目标实例，请先恢复已有目标，勿重复下单".into());}
    if region==state.source_region||region.is_empty(){return Err("跨地区迁移需选择不同的目标地区；同地区可使用克隆".into());}
    if source!=Source::Mine||uuid.is_empty(){return Err("请选择自己的就绪系统盘镜像，不能用基础或他人共享镜像代替源环境".into());}
    state.target_region=Some(region.into());state.image_uuid=Some(uuid.into());Ok(())
}
static LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
pub fn claim(store:&Store,uuid:&str,region:&str,image:&str,source:Source)->Result<(),String>{
    let _guard=LOCK.lock().map_err(|_|"迁移操作锁不可用")?;let mut m=read(store,uuid)?.ok_or("请先打开迁移向导")?;
    if m.pending||m.target_uuid.is_some(){return Err("目标创建已提交或已有目标，请回迁移向导恢复，勿重复下单".into());}
    if source!=Source::Mine||m.target_region.as_deref()!=Some(region)||m.image_uuid.as_deref()!=Some(image){return Err("当前地区或镜像与迁移记录不一致，请回向导确认".into());}
    m.pending=true;write(store,&m)
}
pub fn created(store:&Store,uuid:&str,target:&str)->Result<(),String>{let _guard=LOCK.lock().map_err(|_|"迁移操作锁不可用")?;let mut m=read(store,uuid)?.ok_or("迁移记录不存在")?;if m.target_uuid.as_deref().is_some_and(|id|id!=target){return Err("已有目标与新返回编号不同，请核对控制台".into());}m.target_uuid=Some(target.into());m.pending=false;write(store,&m)}
pub fn verify_target(m:&Migration,target:&str,region:&str)->Result<(),String>{
    if target==m.source_uuid||m.target_region.as_deref()!=Some(region){return Err("目标必须是选定的新地区实例，不能选源实例".into());}
    if m.target_uuid.as_deref().is_some_and(|id|id!=target){return Err("已有其他目标记录，请核对实例，不能直接覆盖".into());}Ok(())
}
pub fn ensure(store:&Store,uuid:&str,region:&str)->Result<Migration,String>{let _guard=LOCK.lock().map_err(|_|"迁移操作锁不可用")?;if let Some(m)=read(store,uuid)?{return Ok(m);}let m=initial(uuid,region);write(store,&m)?;Ok(m)}
pub fn prepare_saved(store:&Store,uuid:&str,region:&str,image:&str)->Result<Migration,String>{let _guard=LOCK.lock().map_err(|_|"迁移操作锁不可用")?;let mut m=read(store,uuid)?.ok_or("迁移记录不存在")?;prepare(&mut m,region,image,Source::Mine)?;write(store,&m)?;Ok(m)}
pub fn recover_saved(store:&Store,uuid:&str,target:&str,region:&str)->Result<Migration,String>{let _guard=LOCK.lock().map_err(|_|"迁移操作锁不可用")?;let mut m=read(store,uuid)?.ok_or("迁移记录不存在")?;verify_target(&m,target,region)?;m.target_uuid=Some(target.into());m.pending=false;write(store,&m)?;Ok(m)}
pub fn clear_pending(store:&Store,uuid:&str,checked:bool)->Result<(),String>{let _guard=LOCK.lock().map_err(|_|"迁移操作锁不可用")?;let mut m=read(store,uuid)?.ok_or("迁移记录不存在")?;if !checked||m.target_uuid.is_some(){return Err("请核对订单和已有目标，不能直接重建".into());}m.pending=false;write(store,&m)}

#[derive(Clone,Serialize)]
pub struct SourceInfo {pub uuid:String,pub name:String,pub status:String,pub region:String,pub region_name:String,pub gpu:String}
type InfoEntry=(u64,std::time::Instant,Result<Vec<crate::market::RegularInstance>,String>);
#[derive(Default)]pub struct InfoCache(tokio::sync::Mutex<Option<InfoEntry>>);
impl InfoCache {pub async fn get(&self,client:&crate::market::MarketClient,epoch:u64,epochs:&crate::images::CatalogCache)->Result<Vec<crate::market::RegularInstance>,String>{
 let mut cache=self.0.lock().await;if epoch!=epochs.epoch(){return Err("账号已变化".into());}
 if let Some((e,at,result))=&*cache{if *e==epoch && at.elapsed()<std::time::Duration::from_secs(3){return result.clone();}}
 let result=client.instances().await.map_err(|e|e.to_string());if epoch!=epochs.epoch(){return Err("账号已变化".into());}*cache=Some((epoch,std::time::Instant::now(),result.clone()));result
}}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn stages_resume_and_do_not_repeat_paid_create(){let s=Store::open_in_memory().unwrap();let mut m=initial("source","dc-a");assert!(prepare(&mut m,"dc-a","img",Source::Mine).is_err());assert!(prepare(&mut m,"dc-b","img",Source::Shared).is_err());prepare(&mut m,"dc-b","img",Source::Mine).unwrap();write(&s,&m).unwrap();assert_eq!(read(&s,"source").unwrap(),Some(m));assert!(claim(&s,"source","dc-x","img",Source::Mine).is_err());claim(&s,"source","dc-b","img",Source::Mine).unwrap();assert!(claim(&s,"source","dc-b","img",Source::Mine).is_err());created(&s,"source","new").unwrap();let mut m=read(&s,"source").unwrap().unwrap();assert!(!m.verified);assert!(!m.pending);assert!(prepare(&mut m,"dc-c","img",Source::Mine).is_err());assert!(claim(&s,"source","dc-b","img",Source::Mine).is_err());assert!(verify_target(&m,"source","dc-b").is_err());assert!(verify_target(&m,"new","dc-a").is_err());assert!(verify_target(&m,"new","dc-b").is_ok());}
 #[tokio::test]async fn reads_coalesce_and_do_not_reuse_previous_account(){
 let cache=InfoCache::default();let epochs=crate::images::CatalogCache::default();let epoch=epochs.epoch();let response=serde_json::json!({"code":"Success","data":{"list":[],"max_page":1}});
 let (base,h)=crate::images::tests::server(vec![response]).await;let c=crate::market::MarketClient::with_base("fake",base);
 let (a,b)=tokio::join!(cache.get(&c,epoch,&epochs),cache.get(&c,epoch,&epochs));assert!(a.unwrap().is_empty());assert!(b.unwrap().is_empty());assert_eq!(h.await.unwrap().len(),1);epochs.invalidate();assert!(cache.get(&c,epoch,&epochs).await.is_err());
 }
 #[test]fn reopening_does_not_clear_pending_and_recovery_checks_existing_target(){let s=Store::open_in_memory().unwrap();ensure(&s,"src","dc-a").unwrap();prepare_saved(&s,"src","dc-b","img").unwrap();claim(&s,"src","dc-b","img",Source::Mine).unwrap();assert!(ensure(&s,"src","dc-a").unwrap().pending);assert!(prepare_saved(&s,"src","dc-c","img").is_err());assert!(clear_pending(&s,"src",false).is_err());recover_saved(&s,"src","new","dc-b").unwrap();assert!(recover_saved(&s,"src","other","dc-b").is_err());assert!(clear_pending(&s,"src",true).is_err());}
 #[tokio::test]async fn invalid_paid_result_is_unknown_not_an_instance_id(){
 for data in [serde_json::Value::Null,serde_json::json!({"uuid":"unexpected"})] {
 let (base,h)=crate::images::tests::server(vec![serde_json::json!({"code":"Success","data":data})]).await;
 let req=crate::market::RentReq{machine_id:"fake".into(),gpu_amount:1,image_uuid:"image".into(),image_source:Source::Mine,name:"".into()};assert!(crate::market::MarketClient::with_base("fake",base).rent_payg(&req).await.is_err());assert_eq!(h.await.unwrap().len(),1);
 }}

}
