//! 普通实例同地区复用。所有付费参数都来自重新读取的源实例与目标主机。
use crate::{api::{required_str,shape_error},market::{MarketClient,MarketRegion,MachineSlot},store::Store};
use serde::Serialize;
use serde_json::{json,Value};
use std::time::{Duration,Instant};
#[derive(Debug,Clone,Serialize)]
pub struct CloneSource {
    pub uuid:String,pub name:String,pub region:String,pub region_name:String,pub gpu:String,
    pub cpu_arch:String,pub cuda:Option<i64>,pub expand_bytes:i64,
    #[serde(skip_serializing)] base_uuid:String,
    #[serde(skip_serializing)] private_uuid:String,
}
pub fn region_of<'a>(regions:&'a [MarketRegion],sign:&str)->Result<&'a MarketRegion,String>{
    regions.iter().find(|r|r.signs.iter().any(|s|s==sign)).ok_or("平台未提供源实例地区，不能确认克隆范围".into())
}
fn str_at(v:&Value,k:&str)->String{v.get(k).and_then(Value::as_str).unwrap_or("").into()}
pub fn source(raw:&Value,snapshot:&Value,regions:&[MarketRegion])->Result<CloneSource,String>{
    crate::images::validate_save(&str_at(raw,"status"),"clone")?;
    let region=region_of(regions,required_str(raw,"region_sign","clone.region").map_err(|e|e.to_string())?)?;
    // 社区复现和应用市场镜像携带独立参数，第一版拒绝猜测，转控制台处理。
    if !str_at(raw,"reproduction_uuid").is_empty() || !str_at(snapshot,"cg_application_uuid").is_empty() || raw.get("reproduction_id").and_then(Value::as_i64).unwrap_or(0)>0 {return Err("此实例来自社区复现或应用市场，请在 AutoDL 控制台克隆".into());}
    let image=snapshot.get("image").ok_or("源实例镜像信息缺失")?;
    let kind=required_str(image,"image_type","clone.image_type").map_err(|e|e.to_string())?;
    if !["public","private"].contains(&kind){return Err("源镜像类型尚不支持，请到控制台克隆".into());}
    let private_uuid=if kind=="private"{str_at(raw,"private_image_uuid")}else{String::new()};
    let base_uuid=if kind=="public"{required_str(image,"image_name","clone.base_image").map_err(|e|e.to_string())?.into()}else{String::new()};
    if base_uuid.is_empty() && private_uuid.is_empty(){return Err("源镜像引用未提供，请在控制台确认".into());}
    let arch=required_str(image,"cpu_arch","clone.cpu_arch").map_err(|e|e.to_string())?;
    if str_at(image,"chip_corp")!="nvidia"{return Err("目前仅支持 NVIDIA 普通实例克隆，请在控制台处理其他架构".into());}
    let expand_bytes=raw.get("expand_data_disk_size").and_then(Value::as_i64).filter(|v|*v>=0).ok_or("源数据盘扩容信息缺失，请在控制台确认")?;
    Ok(CloneSource{uuid:required_str(raw,"uuid","clone.uuid").map_err(|e|e.to_string())?.into(),name:str_at(raw,"name"),region:region.data_center.clone(),region_name:region.name.clone(),gpu:required_str(snapshot,"snapshot_gpu_alias_name","clone.gpu").map_err(|e|e.to_string())?.into(),cpu_arch:arch.into(),cuda:image.get("cuda_version").and_then(Value::as_str).and_then(crate::market::parse_cuda),expand_bytes,base_uuid,private_uuid})
}
pub fn guard(src:&CloneSource,target_region:&str,regions:&[MarketRegion],slot:&MachineSlot,n:i64)->Result<f64,String>{
    if target_region!=src.region || region_of(regions,&slot.region_sign)?.data_center!=src.region{return Err("普通实例仅支持同地区直接克隆，跨地区请使用镜像迁移".into());}
    if !(1..=8).contains(&n)||slot.idle<n{return Err("目标主机单机空闲卡数不足".into());}
    if slot.cpu_arch!=src.cpu_arch{return Err("目标 CPU 架构与源环境不同，请换主机".into());}
    if let(Some(cuda),Some(max))=(src.cuda,slot.max_cuda){if cuda>max{return Err("源环境 CUDA 超出目标主机驱动支持范围".into());}}
    let price=slot.price_yuan.filter(|p|p.is_finite()&&*p>0.0).ok_or("目标价格不可用")?;Ok(price)
}
pub fn clone_body(src:&CloneSource,slot:&MachineSlot,n:i64,copy_data:bool)->Value{
    let expand=if copy_data{src.expand_bytes}else{0};
    json!({"instance_uuid":src.uuid,"instance_info":{"machine_id":slot.machine_id,"charge_type":"payg","req_gpu_amount":n,"base_image_uuid":src.base_uuid,"private_image_uuid":src.private_uuid,"reproduction_uuid":"","cg_application_uuid":"","cg_application_info":{},"instance_name":"","expand_data_disk":expand,"copy_data_disk_after_clone":copy_data,"keep_src_user_service_address_after_clone":false,"reproduction_id":0,"ft_sparse":false},"price_info":{"coupon_id_list":[],"machine_id":slot.machine_id,"charge_type":"payg","duration":1,"num":n,"expand_data_disk":expand}})
}
impl MarketClient {
    pub async fn clone_source(&self,uuid:&str)->Result<CloneSource,String>{
        if uuid.is_empty()||!uuid.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'||c==b'_'){return Err("实例编号无效".into());}
        let list=self.instances_raw().await.map_err(|e|e.to_string())?;let raw=list.iter().find(|v|v.get("uuid").and_then(Value::as_str)==Some(uuid)).ok_or("源实例已不存在，请刷新")?;
        let snapshot=self.call(reqwest::Method::GET,&format!("/api/v1/instance/snapshot?instance_uuid={uuid}"),None).await.map_err(|e|e.to_string())?;
        let regions=self.regions().await.map_err(|e|e.to_string())?;source(raw,&snapshot,&regions)
    }
    pub async fn clone_payg(&self,src:&CloneSource,slot:&MachineSlot,n:i64,copy_data:bool)->Result<String,String>{
        let d=self.call(reqwest::Method::POST,"/api/v1/order/instance/clone/payg",Some(clone_body(src,slot,n,copy_data))).await.map_err(|e|e.to_string())?;
        d.as_str().filter(|s|!s.is_empty()).map(str::to_string).ok_or_else(||shape_error("clone.instance_uuid").to_string())
    }
}
type Entry=(String,u64,Instant,Result<CloneSource,String>);
#[derive(Default)]pub struct SourceCache(tokio::sync::Mutex<Option<Entry>>);
impl SourceCache{
    pub async fn get(&self,client:&MarketClient,uuid:&str,epoch:u64,epochs:&crate::images::CatalogCache,force:bool)->Result<CloneSource,String>{
        let mut cache=self.0.lock().await;if epoch!=epochs.epoch(){return Err("账号已变化，请重新打开".into());}
        if let Some((id,e,at,result))=&*cache{if id==uuid && *e==epoch && at.elapsed()<Duration::from_secs(if force||result.is_err(){3}else{30}){return result.clone();}let wait=Duration::from_millis(300).saturating_sub(at.elapsed());if !wait.is_zero(){tokio::time::sleep(wait).await;}}
        let result=client.clone_source(uuid).await;if epoch!=epochs.epoch(){return Err("账号已变化，请重新打开".into());}*cache=Some((uuid.into(),epoch,Instant::now(),result.clone()));result
    }
}
pub fn claim(store:&Store,uuid:&str,now:i64)->Result<(),String>{
    static LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());let _lock=LOCK.lock().map_err(|_|"操作锁不可用")?;
    let key=format!("clone_regular:{uuid}");let daily=format!("{key}:{}",chrono::Local::now().format("%Y-%m-%d"));
    if store.kv_get(&key)?.and_then(|s|s.parse::<i64>().ok()).is_some_and(|at|now.saturating_sub(at)<60){return Err("一分钟内已提交克隆，请先检查实例列表，勿重复提交".into());}
    let count=store.kv_get(&daily)?.and_then(|s|s.parse::<i64>().ok()).unwrap_or(0);if count>=5{return Err("该实例今天已尝试克隆 5 次，请在控制台确认".into());}
    store.kv_set(&key,&now.to_string())?;store.kv_set(&daily,&(count+1).to_string())
}
#[cfg(test)]mod tests{
 use super::*;
 fn regions()->Vec<MarketRegion>{vec![MarketRegion{data_center:"dc".into(),name:"同名区域".into(),signs:vec!["room-a".into(),"room-b".into()]},MarketRegion{data_center:"other".into(),name:"同名区域".into(),signs:vec!["other-room".into()]}]}
 fn raw()->Value{json!({"uuid":"source-test","status":"shutdown","region_sign":"room-a","private_image_uuid":"","expand_data_disk_size":10737418240i64,"root_password":"must-not-escape"})}
 fn snap()->Value{json!({"snapshot_gpu_alias_name":"RTX 4090","image":{"image_type":"public","image_name":"base-test","cpu_arch":"x86","chip_corp":"nvidia","cuda_version":"12.4"}})}
 fn slot()->MachineSlot{MachineSlot{machine_id:"target".into(),region_sign:"room-b".into(),cpu_arch:"x86".into(),max_cuda:Some(128),idle:4,price_yuan:Some(2.0),..Default::default()}}
 #[test]fn guards_use_platform_region_identity_and_live_state(){let r=regions();let src=source(&raw(),&snap(),&r).unwrap();assert_eq!(guard(&src,"dc",&r,&slot(),2).unwrap(),2.0);assert!(guard(&src,"other",&r,&slot(),2).is_err());let mut target=slot();target.region_sign="other-room".into();assert!(guard(&src,"dc",&r,&target,2).is_err());target=slot();target.cpu_arch="arm".into();assert!(guard(&src,"dc",&r,&target,2).is_err());target=slot();target.max_cuda=Some(118);assert!(guard(&src,"dc",&r,&target,2).is_err());assert!(guard(&src,"dc",&r,&slot(),8).is_err());let mut raw=raw();raw["status"]="running".into();assert!(source(&raw,&snap(),&r).is_err());assert!(!serde_json::to_string(&src).unwrap().contains("must-not-escape"));}
 #[test]fn scope_budget_and_duplicate_attempts(){let src=source(&raw(),&snap(),&regions()).unwrap();for copy in [false,true]{let b=clone_body(&src,&slot(),2,copy);assert_eq!(b["instance_uuid"],"source-test");assert_eq!(b["instance_info"]["copy_data_disk_after_clone"],copy);assert_eq!(b["instance_info"]["expand_data_disk"],if copy{10737418240i64}else{0});assert_eq!(b["price_info"]["num"],2);}assert!(crate::rental_plans::budget(Some(3.0),2.0,2).is_err());let s=Store::open_in_memory().unwrap();claim(&s,"x",100).unwrap();assert!(claim(&s,"x",101).is_err());for i in 1..5{claim(&s,"x",100+i*60).unwrap();}assert!(claim(&s,"x",500).is_err());}
 #[tokio::test]async fn clone_request_is_single_post_with_exact_scope(){let (base,h)=crate::images::tests::server(vec![json!({"code":"Success","data":"new-test"})]).await;let src=source(&raw(),&snap(),&regions()).unwrap();assert_eq!(MarketClient::with_base("fake",base).clone_payg(&src,&slot(),2,true).await.unwrap(),"new-test");let req=h.await.unwrap();assert_eq!(req.len(),1);assert!(req[0].starts_with("POST /api/v1/order/instance/clone/payg "));let body:Value=serde_json::from_str(req[0].split_once("\r\n\r\n").unwrap().1).unwrap();assert_eq!(body,clone_body(&src,&slot(),2,true));}
 #[tokio::test]async fn source_read_uses_query_and_never_returns_password(){
 let replies=vec![json!({"code":"Success","data":{"list":[raw()],"max_page":1}}),json!({"code":"Success","data":snap()}),json!({"code":"Success","data":[{"region_sign":"room-a","region_name":"测试区域","data_center":"dc"}]})];
 let (base,h)=crate::images::tests::server(replies).await;let src=MarketClient::with_base("fake-web",base).clone_source("source-test").await.unwrap();assert_eq!(src.region,"dc");let req=h.await.unwrap();assert_eq!(req.len(),3);assert!(req[1].starts_with("GET /api/v1/instance/snapshot?instance_uuid=source-test "));assert!(!req[1].contains("content-type: application/json"));assert!(req[0].contains("fake-web"));assert!(!serde_json::to_string(&src).unwrap().contains("root_password"));
 }

}
