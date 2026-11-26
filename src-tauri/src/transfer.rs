//! 规则和模板的可移植配置：白名单导出、严格校验，导入时统一降为只提醒。
use crate::store::{Rule, Template};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Read;

pub const MAX_BYTES: usize = 2 * 1024 * 1024;
const FORMAT: &str = "autodl-lookout.rules-and-templates";

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bundle {
    pub format: String,
    pub version: u32,
    pub rules: Vec<Rule>,
    pub templates: Vec<Template>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode { Append, Replace }

#[derive(Debug, Serialize)]
pub struct Preview {
    pub rules: usize,
    pub templates: usize,
    pub automatic_rules: usize,
}

#[derive(Debug, Serialize)]
pub struct Imported {
    pub rules: usize,
    pub templates: usize,
}

const RULE_FIELDS: &[&str] = &["id", "name", "enabled", "region_sign", "gpu_keyword", "min_idle", "cuda_v_from", "max_price_yuan", "cooldown_minutes", "action", "template_id", "instance_uuid", "daily_limit", "min_per_machine"];
const TEMPLATE_FIELDS: &[&str] = &["id", "name", "gpu_spec_uuid", "gpu_amount", "data_center_list", "image_uuid", "cuda_v_from", "expand_disk_gb", "instance_name", "start_command"];

pub fn encode(rules: Vec<Rule>, templates: Vec<Template>) -> Result<String, String> {
    let mut value = serde_json::to_value(Bundle { format: FORMAT.into(), version: 1, rules, templates }).map_err(|_| "无法生成配置文件".to_string())?;
    for rule in value["rules"].as_array_mut().unwrap() { rule.as_object_mut().unwrap().remove("last_fired_at"); }
    let text = serde_json::to_string_pretty(&value).map_err(|_| "无法生成配置文件".to_string())?;
    parse(&text)?;
    Ok(text)
}

pub fn parse(text: &str) -> Result<Bundle, String> {
    if text.len() > MAX_BYTES { return Err("配置文件超过 2 MiB，请减少规则或模板数量后重试".into()); }
    let value: serde_json::Value = serde_json::from_str(text).map_err(|_| "配置文件不是有效的 JSON，请选择显卡管家导出的规则和模板文件".to_string())?;
    if value.get("format").and_then(|v| v.as_str()) != Some(FORMAT) { return Err("这不是显卡管家的规则和模板配置文件".into()); }
    if value.get("version").and_then(|v| v.as_u64()) != Some(1) { return Err("不支持这个配置文件的格式版本，请更新软件或重新导出".into()); }
    // 不接收凭据、服务器、运行状态等扩展字段，也不把字段值放进错误消息。
    for (key, allowed) in [("rules", RULE_FIELDS), ("templates", TEMPLATE_FIELDS)] {
        let entries = value.get(key).and_then(|v| v.as_array()).ok_or("配置文件中的规则和模板必须是列表")?;
        if entries.iter().any(|entry| entry.as_object().is_none_or(|object| object.keys().any(|field| !allowed.contains(&field.as_str())))) {
            return Err("配置文件含不支持的规则或模板字段，请重新导出；不会导入凭据或服务器".into());
        }
    }
    let bundle: Bundle = serde_json::from_value(value).map_err(|_| "配置文件的字段缺失或类型不正确，请重新导出".to_string())?;
    if bundle.rules.len() > 1000 || bundle.templates.len() > 500 { return Err("一次最多导入 1000 条规则和 500 个模板".into()); }
    let mut template_ids = HashSet::new();
    for template in &bundle.templates {
        if template.id <= 0 || !template_ids.insert(template.id) { return Err("模板 ID 无效或重复，无法对应规则引用，请重新导出".into()); }
        if !text_field(&template.name, 200) || !text_field(&template.gpu_spec_uuid, 200) || !text_field(&template.image_uuid, 500)
            || !(1..=4).contains(&template.gpu_amount) || !(0..=500).contains(&template.expand_disk_gb) || template.cuda_v_from < 0
            || template.data_center_list.len() > 100 || template.data_center_list.iter().any(|value| !text_field(value, 200))
            || template.instance_name.as_ref().is_some_and(|value| value.len() > 1000)
            || template.start_command.as_ref().is_some_and(|value| value.len() > 65536) {
            return Err("模板内容不合法，请检查名称、GPU 数量、扩容大小和字段长度".into());
        }
    }
    let mut rule_ids = HashSet::new();
    for rule in &bundle.rules {
        if rule.id <= 0 || !rule_ids.insert(rule.id) { return Err("规则 ID 无效或重复，请重新导出".into()); }
        if !text_field(&rule.name, 200) || !text_field(&rule.region_sign, 200) || rule.gpu_keyword.len() > 1000
            || rule.min_idle < 1 || rule.min_per_machine < 1 || rule.cooldown_minutes < 1 || rule.daily_limit < 1
            || rule.cuda_v_from.is_some_and(|value| value < 0) || rule.max_price_yuan.is_some_and(|value| value <= 0.0 || !value.is_finite())
            || !matches!(rule.action.as_str(), "notify" | "create" | "power_on")
            || rule.instance_uuid.as_ref().is_some_and(|value| value.len() > 1000) {
            return Err("规则内容不合法，请检查名称、数量、冷却时间和动作字段".into());
        }
        if rule.template_id.is_some_and(|id| !template_ids.contains(&id)) { return Err("规则引用了文件中不存在的模板，请将关联模板一起导出".into()); }
    }
    Ok(bundle)
}

fn text_field(value: &str, limit: usize) -> bool { !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control) }

impl Bundle {
    pub fn preview(&self) -> Preview {
        Preview { rules: self.rules.len(), templates: self.templates.len(), automatic_rules: self.rules.iter().filter(|rule| rule.action != "notify").count() }
    }
}

/// 从用户在原生对话框选择的文件读取。按实际读取字节限制大小，避免检查元数据后文件被替换。
pub fn read_file(path: &std::path::Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|_| "无法读取选中的配置文件，请检查文件权限".to_string())?;
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|_| "读取配置文件失败，请重试".to_string())?;
    if bytes.len() > MAX_BYTES { return Err("配置文件超过 2 MiB，请减少规则或模板数量后重试".into()); }
    String::from_utf8(bytes).map_err(|_| "配置文件不是 UTF-8 文本，请选择显卡管家导出的 JSON 文件".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use serde_json::json;

    #[test]
    fn malformed_versions_unknown_fields_and_dangling_references_are_rejected() {
        let source = Store::open_in_memory().unwrap().configuration_json().unwrap();
        let original: serde_json::Value = serde_json::from_str(&source).unwrap();
        for text in ["not JSON", "{}", &"x".repeat(MAX_BYTES + 1)] { assert!(parse(text).is_err()); }
        for mutate in [
            |v: &mut serde_json::Value| { v["version"] = json!(2); },
            |v: &mut serde_json::Value| { v["web_token"] = json!("fake-secret"); },
            |v: &mut serde_json::Value| { v["rules"][0]["password"] = json!("fake-secret"); },
            |v: &mut serde_json::Value| { v["rules"][0]["min_idle"] = json!("1"); },
            |v: &mut serde_json::Value| { v["rules"][0]["template_id"] = json!(999); },
            |v: &mut serde_json::Value| { v["rules"][1]["id"] = v["rules"][0]["id"].clone(); },
            |v: &mut serde_json::Value| { v["templates"][0]["gpu_amount"] = json!(99); },
        ] {
            let mut changed = original.clone(); mutate(&mut changed);
            let error = parse(&changed.to_string()).unwrap_err();
            assert!(!error.contains("fake-secret"));
        }
        assert_eq!(parse(&source).unwrap().preview().rules, 4);
    }

    #[test]
    fn selected_files_are_bounded_utf8_and_errors_do_not_echo_their_content() {
        let dir = std::env::temp_dir().join(format!("lookout-transfer-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("config.json");
        std::fs::write(&path, b"\xfffake-secret").unwrap();
        let error = read_file(&path).unwrap_err();
        assert!(error.contains("UTF-8") && !error.contains("fake-secret"));
        std::fs::write(&path, vec![b'x'; MAX_BYTES + 1]).unwrap();
        assert!(read_file(&path).unwrap_err().contains("2 MiB"));
        let text = Store::open_in_memory().unwrap().configuration_json().unwrap();
        std::fs::write(&path, &text).unwrap();
        assert_eq!(read_file(&path).unwrap(), text);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
