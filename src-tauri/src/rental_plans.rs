//! 普通方案只记录偏好，与 Pro 模板和自动规则分开存储。
use serde::{Deserialize, Serialize};
use crate::images::Source;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub id: i64, pub name: String, pub image_uuid: String, pub image_source: Source,
    pub gpu_amount: i64, pub max_hourly: Option<f64>, pub region: Option<String>, pub gpu: Option<String>,
}
impl Plan {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.id < 0 || !(1..=8).contains(&self.gpu_amount) { return Err("方案卡数需为 1–8，编号不能为负数".into()); }
        fn valid(s:&str, max:usize)->bool { !s.trim().is_empty() && s.chars().count()<=max && !s.chars().any(char::is_control) }
        if !valid(&self.image_uuid,128) || self.region.as_ref().is_some_and(|s|!valid(s,80)) || self.gpu.as_ref().is_some_and(|s|!valid(s,80)) { return Err("方案镜像或硬件偏好无效".into()); }
        budget(self.max_hourly,0.0,1)?;
        self.name=self.name.trim().into();
        if self.name.is_empty() { self.name=format!("{} · {} 卡", self.gpu.as_deref().unwrap_or("普通实例"),self.gpu_amount); }
        if !valid(&self.name,64) { return Err("方案名称需为 1–64 个字符".into()); } Ok(())
    }
}
pub fn budget(limit:Option<f64>, price:f64, n:i64)->Result<(),String> {
    if !price.is_finite() || price<0.0 || !(1..=8).contains(&n) {return Err("价格或卡数无效".into());}
    if let Some(limit)=limit {
        if !limit.is_finite() || limit<=0.0 || limit>100_000.0 {return Err("预算需为大于 0 且不超过 100000 的每小时总价".into());}
        if price*n as f64>limit+0.000001 {return Err("当前整机每小时总价超过方案预算，请调整预算或重新选卡".into());}
    } Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn plan()->Plan {Plan{id:0,name:"".into(),image_uuid:"private-test".into(),image_source:Source::Shared,gpu_amount:2,max_hourly:Some(4.0),region:None,gpu:None}}
    #[test] fn persistence_and_pro_data_are_independent(){
        let s=crate::store::Store::open_in_memory().unwrap();let before=s.templates().unwrap().len();
        let id=s.save_rental_plan(plan()).unwrap();let saved=s.rental_plans().unwrap().remove(0);assert_eq!(saved.id,id);assert_eq!(saved.image_source,Source::Shared);assert!(!saved.name.is_empty());
        s.save_recent_rental(saved.clone()).unwrap();let mut recent=saved;recent.id=0;assert_eq!(s.recent_rental().unwrap(),Some(recent));
        s.delete_rental_plan(id).unwrap();assert!(s.rental_plans().unwrap().is_empty());assert_eq!(s.templates().unwrap().len(),before);
        let mut bad=plan();bad.gpu_amount=9;assert!(s.save_rental_plan(bad).is_err());
    }
    #[test] fn reject_unknown_fields_and_invalid_budget(){
        let mut v=serde_json::to_value(plan()).unwrap();v["machine_id"]="stale-machine".into();assert!(serde_json::from_value::<Plan>(v).is_err());
        for limit in [f64::NAN,f64::INFINITY,-1.0,0.0]{assert!(budget(Some(limit),1.0,1).is_err());}
        assert!(budget(Some(4.0),2.1,2).is_err());assert!(budget(Some(4.0),2.0,2).is_ok());
        let mut p=plan();p.name="bad\nname".into();assert!(p.validate().is_err());
    }
}
