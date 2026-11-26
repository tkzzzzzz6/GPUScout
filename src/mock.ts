// 浏览器预览用的假数据（`npm run dev` 直接在浏览器里打开时生效；在 Tauri 里不会用到）
import type { LiveEvent, RegularInstance, Rule, ServerRecord, Watch, Settings, Snapshot, Template } from "./api";

const now = () => Math.floor(Date.now() / 1000);

// 和 regions.rs 的 REGIONS 一致（10 个区域），区域菜单的高度和真实情况一样，会出滚动条
const regionsRef = [
  { value: "westDC3", label: "西北B区" }, { value: "beijingDC2", label: "北京B区" },
  { value: "chongqingDC1", label: "重庆A区" }, { value: "neimengDC3", label: "内蒙B区" },
  { value: "beijingDC1", label: "北京A区" }, { value: "foshanDC1", label: "佛山区" },
  { value: "beijingDC3", label: "V100专区" }, { value: "neimengDC2", label: "A800专区" },
  { value: "shanghaiDC1", label: "摩尔线程专区" }, { value: "westDC2", label: "西北企业区" },
];

let settings: Settings = {
  poll_interval_secs: 60, regions: ["beijingDC3", "neimengDC2", "foshanDC1", "beijingDC2"], low_balance_yuan: 20,
  long_running_hours: 8, auto_min_balance_yuan: 10, history_keep_days: 30, watch_models: ["A100", "V100", "A800"],
  server_live: true, server_overview: true,
};

// 机房代码来自真实的 region/list：西北B区第一个机房 west-B，北京B区 bj-B1
const MKT: Record<string, string> = {
  westDC3: "https://www.autodl.com/market/list?region=west-B",
  beijingDC2: "https://www.autodl.com/market/list?region=bj-B1",
  beijingDC3: "https://www.autodl.com/market/list?region=bj-C1",
  neimengDC2: "https://www.autodl.com/market/list?region=nm-A1",
  foshanDC1: "https://www.autodl.com/market/list?region=fs-A1",
};

// 各区的假库存；快照只返回设置里勾选的区域
const STOCK: Record<string, { name: string; items: { gpu_name: string; idle: number; total: number }[] }> = {
  westDC3: { name: "西北B区", items: [
    { gpu_name: "vGPU-32GB", idle: 103, total: 2528 }, { gpu_name: "RTX 3080 Ti", idle: 60, total: 376 },
    { gpu_name: "RTX 4090", idle: 50, total: 1766 }, { gpu_name: "RTX 4090D", idle: 27, total: 1048 },
    { gpu_name: "vGPU-48GB", idle: 9, total: 970 }, { gpu_name: "RTX 6000D", idle: 7, total: 456 },
    { gpu_name: "RTX 5090", idle: 2, total: 2048 }, { gpu_name: "H800", idle: 1, total: 96 },
    { gpu_name: "RTX 5090 D", idle: 0, total: 240 }, { gpu_name: "RTX PRO 6000", idle: 0, total: 1588 },
  ] },
  beijingDC2: { name: "北京B区", items: [
    { gpu_name: "RTX 3080 Ti", idle: 21, total: 392 }, { gpu_name: "A100-SXM4-80GB", idle: 4, total: 160 },
    { gpu_name: "RTX A4000", idle: 6, total: 24 }, { gpu_name: "RTX 5090", idle: 3, total: 980 },
    { gpu_name: "RTX 4090", idle: 0, total: 940 }, { gpu_name: "RTX 4090D", idle: 0, total: 512 },
  ] },
  beijingDC3: { name: "V100专区", items: [
    { gpu_name: "Tesla V100-SXM2-32GB", idle: 18, total: 320 }, { gpu_name: "V100-SXM2-16GB", idle: 0, total: 64 },
  ] },
  neimengDC2: { name: "A800专区", items: [
    { gpu_name: "A800-SXM4-80GB", idle: 0, total: 512 }, { gpu_name: "A100-SXM4-80GB", idle: 2, total: 96 },
  ] },
  foshanDC1: { name: "佛山区", items: [
    { gpu_name: "RTX 4090", idle: 12, total: 600 }, { gpu_name: "A100-PCIE-40GB", idle: 3, total: 48 },
    { gpu_name: "A800-SXM4-80GB", idle: 5, total: 80 }, { gpu_name: "RTX 3090", idle: 30, total: 410 },
  ] },
};
const ruleUrl = (id: number) => MKT[rules.find((r) => r.id === id)?.region_sign ?? ""] ?? "https://www.autodl.com/market/list";
let rules: Rule[] = [
  ["westDC3", "4090"], ["westDC3", "5090"], ["beijingDC2", "4090"], ["beijingDC2", "5090"],
].map(([r, g], i) => ({
  id: i + 1, name: `${r === "westDC3" ? "西北B区" : "北京B区"} ${g}`, enabled: true, region_sign: r,
  gpu_keyword: g, min_idle: 1, cuda_v_from: null, max_price_yuan: null, cooldown_minutes: 15,
  action: "notify", template_id: null, instance_uuid: null, daily_limit: 1, last_fired_at: null, min_per_machine: i === 3 ? 2 : 1,
}));

let templates: Template[] = [{
  id: 1, name: "4090D · PyTorch 2.0 / CUDA 11.8", gpu_spec_uuid: "4090D", gpu_amount: 1,
  data_center_list: [], image_uuid: "base-image-l2t43iu6uk", cuda_v_from: 118, expand_disk_gb: 0,
  instance_name: "autodl-lookout", start_command: null,
}];

let tick = 0;
const snapshot = (): Snapshot => ({
  has_token: true, has_web_token: true, web_token_exp: now() + 59 * 86400, paused: false, running: false, last_run_at: now() - 12, next_run_at: now() + 48,
  last_error: null, interval_secs: 60,
  regions: settings.regions.filter((r) => STOCK[r]).map((r) => ({
    region: r, region_name: STOCK[r].name, error: null, market_url: MKT[r] ?? "https://www.autodl.com/market/list", items: STOCK[r].items.map((i) => ({ ...i })),
  })),
  rules: [
    { rule_id: 1, hit: true, idle_sum: 77, machines: null, matched: ["RTX 4090×50", "RTX 4090D×27"], error: null, market_url: ruleUrl(1) },
    { rule_id: 2, hit: true, idle_sum: 2, machines: null, matched: ["RTX 5090×2"], error: null, market_url: ruleUrl(2) },
    { rule_id: 3, hit: false, idle_sum: 0, machines: null, matched: [], error: null, market_url: ruleUrl(3) },
    { rule_id: 4, hit: true, idle_sum: 2, machines: 1, matched: ["RTX 5090×2"], error: null, market_url: ruleUrl(4) },
  ],
  balance: { assets: 187.46, accumulate: 2872.54, voucher_balance: 0 }, balance_at: now() - 60, balance_error: null,
});

let sshSynced = false;
const watches: Record<string, Watch> = {};
// 演示用的实时采集：start_live 之后每 2 秒推一帧
const liveListeners = new Set<(e: LiveEvent) => void>();
const liveTimers: Record<string, number> = {};
const liveSeeded = new Set<string>();
export function mockListenLive(cb: (e: LiveEvent) => void) { liveListeners.add(cb); return () => { liveListeners.delete(cb); }; }
function fakeStatus(id: string, at = now()) {
  const lab = id === "srv:1";
  const util = lab ? [96, 58] : id.startsWith("autodl:") ? [1, 0] : [];
  const t = at;
  const wob = (u: number, i: number) => (u > 3 ? Math.max(0, Math.min(100, Math.round(u - 8 + 8 * Math.sin(t / 7 + i) + Math.random() * 6))) : u);
  const gpus = util.map((u0, i) => wob(u0, i)).map((u, i) => ({ index: i, uuid: `GPU-${i}`, name: lab ? "NVIDIA GeForce RTX 3080" : "NVIDIA GeForce RTX 4090",
    util: u, mem_used_mb: u > 3 ? (lab ? 8650 - i * 1900 : 21234 + i * 900) : 4, mem_total_mb: lab ? 10240 : 24564, temp: 30 + u / 3, power_w: lab ? 30 + u * 2.9 : 60 + u * 3 }));
  const users = ["zhangsan", "lisi", "tk"];
  return {
    nvidia: gpus.length > 0, gpus,
    procs: gpus.filter((g) => g.util > 3).map((g, i) => ({ gpu: g.index, pid: 12000 + g.index, mem_mb: g.mem_used_mb - 500, user: lab ? users[i % 3] : null,
      elapsed_secs: lab ? 3600 * (i + 2) : null, cmd: lab ? `python train.py --cfg configs/exp${i}.yaml` : null })),
    load1: lab ? 9.5 + 2 * Math.sin(t / 11) : 0.4 + 0.2 * Math.sin(t / 5), cores: lab ? 24 : 16, mem_total: lab ? 64e9 : 64e9, mem_avail: lab ? 25e9 : 51e9,
    disks: lab ? [{ mount: "/", total: 5e11, used: 3.1e11 }, { mount: "/data", total: 4e12, used: 3.7e12 }]
      : [{ mount: "/", total: 3e10, used: 1.2e10 }, { mount: "/root/autodl-tmp", total: 5e10, used: 4.6e10 }],
    job_alive: watches[id]?.job_pid ? true : null, log_mtime: null, remote_now: null, fetched_at: at,
  };
}

let autoSync = false;
let ownKey: string | null = null;
let myServers: ServerRecord[] = [
  { id: 1, name: "实验室 3080", host: "10.12.0.20", port: 22, user: "tk", auth: "key", key_path: null, alias: null, note: "2 × RTX 3080，组里共用" },
  { id: 2, name: "阿里云", host: "47.100.12.9", port: 22, user: "root", auth: "password", key_path: null, alias: null, note: null },
];

let regular: RegularInstance[] = [
  { uuid: "a1b2c3d4e5-f6a7b8c9", name: "qwen-lora", status: "running", sub_status: "", gpu: "RTX 4090", gpu_amount: 2,
    region_name: "西北B区", region_sign: "west-B", machine_alias: "128机", charge_type: "payg", payg_price_yuan: 3.76,
    ssh_command: "ssh -p 32145 root@region-9.autodl.example", jupyter_url: "https://example.invalid/jupyter?token=x",
    service_6006_url: "https://example.invalid/6006", service_6008_url: null,
    started_at: now() - 9.3 * 3600, stopped_at: null, expired_at: null, has_password: true },
  { uuid: "b7c8d9e0f1-a2b3c4d5", name: "训练机-3090", status: "shutdown", sub_status: "", gpu: "RTX 3090", gpu_amount: 1,
    region_name: "北京B区", region_sign: "bj-B1", machine_alias: "41机", charge_type: "payg", payg_price_yuan: 1.58,
    ssh_command: "ssh -p 40211 root@region-4.autodl.example", jupyter_url: null, service_6006_url: null, service_6008_url: null,
    started_at: null, stopped_at: now() - 2 * 86400, expired_at: null, has_password: true },
];

const instances = {
  result_total: 2, max_page: 1, page_index: 1,
  list: [
    { uuid: "pro-76419909953e", name: "llm-sft", status: "running", region_sign: "westDC3", region_name: "西北B区",
      machine_alias: "westB-412", gpu_spec_uuid: "5090-p", req_gpu_amount: 1, charge_type: "payg",
      started_at: { Time: new Date(Date.now() - 9.3 * 3600e3).toISOString(), Valid: true } },
    { uuid: "pro-76576c61fdf1", name: "", status: "shutdown", region_sign: "beijingDC2", region_name: "北京B区",
      machine_alias: "bjB-077", gpu_spec_uuid: "4090D", req_gpu_amount: 2, charge_type: "payg",
      started_at: { Time: "0001-01-01T00:00:00Z", Valid: false } },
  ],
};

// 演示模式下 PageBoundary 记下的页面错误，日志页能看到
const PAGE_NAMES: Record<string, string> = {
  stock: "库存", rules: "提醒规则", analysis: "抢卡时段", instances: "我的实例", servers: "服务器", templates: "创建模板", logs: "日志", settings: "设置",
};
const uiLogs: { id: number; ts: number; level: string; kind: string; rule_id: null; message: string }[] = [];

function sshNamingIssue(): string | null {
  const names = new Set<string>();
  for (const instance of regular) {
    if (!instance.name || Array.from(instance.name).length > 64 || new TextEncoder().encode(instance.name).length > 253
      || instance.name.startsWith("-") || !/^[\p{Alphabetic}\p{N}._-]+$/u.test(instance.name)) {
      return `AutoDL 实例名称“${instance.name}”不能直接用于 SSH，请在 AutoDL 修改名称后刷新并重新同步。`;
    }
    const key = instance.name.toLowerCase();
    if (names.has(key)) return `AutoDL 实例名称“${instance.name}”重名，请在 AutoDL 改成不同名称，不会自动追加编号。`;
    names.add(key);
  }
  for (const server of myServers) {
    const alias = server.alias ?? `lookout-${server.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "server"}-${server.id}`;
    if (names.has(alias.toLowerCase())) return `SSH 名称“${alias}”与自有或导入服务器重名，请在 AutoDL 修改实例名后刷新同步。`;
    names.add(alias.toLowerCase());
  }
  for (const reserved of ["lab-3090", "aliyun"]) {
    if (regular.some((instance) => instance.name.toLowerCase() === reserved)) return `SSH 名称“${reserved}”已被本机 Host 占用，请在 AutoDL 修改实例名后刷新同步。`;
  }
  return null;
}

function queryFormatError(scope: string, field: string): string | null {
  return new URLSearchParams(window.location.search).get("demoApiFormatError") === scope
    ? `AutoDL 的接口格式好像变了（${field} 字段缺失或类型不正确），相关数字暂时不可信。请到 GitHub 更新软件或反馈` : null;
}

function readConfiguration(text: string): { rules: Rule[]; templates: Template[] } {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw "配置文件超过 2 MiB";
  let data: any;
  try { data = JSON.parse(text); } catch { throw "配置文件不是有效的 JSON，请选择GPUScout导出的文件"; }
  if (data?.format !== "autodl-lookout.rules-and-templates") throw "这不是GPUScout的规则和模板配置文件";
  if (data.version !== 1) throw "不支持这个配置文件的格式版本，请更新软件或重新导出";
  if (!Array.isArray(data.rules) || !Array.isArray(data.templates) || data.rules.length > 1000 || data.templates.length > 500) throw "规则或模板列表不合法";
  const ruleFields = ["id", "name", "enabled", "region_sign", "gpu_keyword", "min_idle", "cuda_v_from", "max_price_yuan", "cooldown_minutes", "action", "template_id", "instance_uuid", "daily_limit", "min_per_machine"];
  const templateFields = ["id", "name", "gpu_spec_uuid", "gpu_amount", "data_center_list", "image_uuid", "cuda_v_from", "expand_disk_gb", "instance_name", "start_command"];
  if (Object.keys(data).some((key) => !["format", "version", "rules", "templates"].includes(key))
    || data.rules.some((rule: any) => !rule || Object.keys(rule).some((key) => !ruleFields.includes(key)))
    || data.templates.some((template: any) => !template || Object.keys(template).some((key) => !templateFields.includes(key)))) throw "配置文件含不支持的字段，不会导入凭据或服务器";
  const templateIds = new Set<number>();
  for (const template of data.templates) {
    if (!Number.isSafeInteger(template.id) || template.id <= 0 || templateIds.has(template.id) || !template.name || !template.gpu_spec_uuid || !template.image_uuid
      || !Number.isInteger(template.gpu_amount) || template.gpu_amount < 1 || template.gpu_amount > 4 || !Array.isArray(template.data_center_list)) throw "模板内容不合法";
    templateIds.add(template.id);
  }
  const ruleIds = new Set<number>();
  for (const rule of data.rules) {
    if (!Number.isSafeInteger(rule.id) || rule.id <= 0 || ruleIds.has(rule.id) || !rule.name || !rule.region_sign || typeof rule.enabled !== "boolean"
      || !Number.isInteger(rule.min_idle) || rule.min_idle < 1 || !Number.isInteger(rule.cooldown_minutes) || rule.cooldown_minutes < 1
      || !["notify", "create", "power_on"].includes(rule.action)) throw "规则内容不合法";
    if (rule.template_id != null && !templateIds.has(rule.template_id)) throw "规则引用了文件中不存在的模板";
    ruleIds.add(rule.id);
  }
  return data;
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const a = (args ?? {}) as any;
  const out: Record<string, () => unknown> = {
    export_configuration: () => ({ file_name: "autodl-lookout-rules-templates.json", rules: rules.length, templates: templates.length,
      content: JSON.stringify({ format: "autodl-lookout.rules-and-templates", version: 1,
        rules: rules.map(({ last_fired_at: _lastFiredAt, ...rule }) => rule), templates }, null, 2) }),
    preview_configuration: () => { const data = readConfiguration(a.json); return { rules: data.rules.length, templates: data.templates.length,
      automatic_rules: data.rules.filter((rule) => rule.action !== "notify").length }; },
    import_configuration: () => {
      const data = readConfiguration(a.json);
      if (!["append", "replace"].includes(a.mode)) throw "请选择追加或替换";
      let nextTemplate = Math.max(0, ...templates.map((t) => t.id)), nextRule = Math.max(0, ...rules.map((r) => r.id));
      const ids = new Map<number, number>();
      const importedTemplates = data.templates.map((template) => { const id = ++nextTemplate; ids.set(template.id, id); return { ...template, id }; });
      const importedRules = data.rules.map((rule) => ({ ...rule, id: ++nextRule, action: "notify" as const, last_fired_at: null,
        template_id: rule.template_id != null ? ids.get(rule.template_id)! : null }));
      templates = [...(a.mode === "replace" ? [] : templates), ...importedTemplates];
      rules = [...(a.mode === "replace" ? [] : rules), ...importedRules];
      return { rules: importedRules.length, templates: importedTemplates.length };
    },
    get_snapshot: () => {
      const sn = snapshot();
      const states = sn.rules;
      sn.rules = rules.filter((rule) => rule.enabled).map((rule, index) => ({ ...states[index % states.length], rule_id: rule.id, market_url: ruleUrl(rule.id) }));
      tick++;
      // 浏览器预览里每次刷新让数字变一点，方便看动效
      const find = (r: string, g: string) => sn.regions.find((x) => x.region === r)?.items.find((i) => i.gpu_name === g);
      const a = find("foshanDC1", "RTX 4090") ?? find("westDC3", "RTX 4090");
      if (a) a.idle = 12 + ((tick * 7) % 13) - 6;
      const b = find("beijingDC2", "RTX 5090");
      if (b) b.idle = tick % 3 === 0 ? 2 : 0;
      // 仅浏览器演示使用：用 ?demoApiFormatError=1 查看上游字段变化时的错误界面。
      if (new URLSearchParams(window.location.search).get("demoApiFormatError") === "1") {
        const error = "AutoDL 的接口格式好像变了（gpu_type.idle_gpu_num 字段缺失或类型不正确），相关数字暂时不可信。请到 GitHub 更新软件或反馈";
        sn.last_error = error;
        sn.regions.forEach((r) => { r.items = []; r.error = error; });
        sn.rules.forEach((r) => { r.hit = false; r.idle_sum = 0; r.matched = []; r.error = error; });
        sn.balance = null;
        sn.balance_error = error.replace("gpu_type.idle_gpu_num", "wallet.assets");
      }
      return sn;
    },
    ref_data: () => ({
      regions: regionsRef, pro_regions: regionsRef.filter((r) => ["westDC3", "beijingDC2"].includes(r.value)),
      gpu_specs: [{ value: "5090-p", label: "5090-32G 性能型" }, { value: "4090D", label: "4090D 通用型" }],
      base_images: [{ value: "base-image-l2t43iu6uk", label: "PyTorch 2.0.0 · CUDA 11.8 · Py3.8" }],
    }),
    get_settings: () => settings,
    save_settings: () => { settings = a.settings; },
    list_rules: () => rules,
    save_rule: () => {
      const r = a.rule as Rule;
      if (r.id) rules = rules.map((x) => (x.id === r.id ? r : x)); else rules.push({ ...r, id: Date.now() });
      return r.id;
    },
    delete_rule: () => { rules = rules.filter((r) => r.id !== a.id); },
    list_templates: () => templates,
    save_template: () => {
      const t = a.template as Template;
      if (t.id) templates = templates.map((x) => (x.id === t.id ? t : x)); else templates.push({ ...t, id: Date.now() });
    },
    delete_template: () => { templates = templates.filter((t) => t.id !== a.id); },
    list_instances: () => instances,
    list_regular_instances: () => { const error = queryFormatError("instances", "instance.list"); if (error) throw error; return regular; },
    regular_instance_password: () => "xxxxxx",
    regular_power_on: () => { regular = regular.map((i) => (i.uuid === a.uuid ? { ...i, status: "running", started_at: now() } : i)); },
    regular_power_off: () => { regular = regular.map((i) => (i.uuid === a.uuid ? { ...i, status: "shutdown", started_at: null, stopped_at: now() } : i)); },
    instance_snapshot: () => ({
      ssh_command: "ssh -p 32145 root@connect.westb.seetacloud.com", root_password: "xxxxxx",
      jupyter_domain: "https://example.invalid/jupyter", service_6006_domain: "https://example.invalid/6006",
      payg_price: 3880, usage_info: { cpu_usage_percent: 34, mem_usage_percent: 61 },
    }),
    // 假价格：几个价位，机器上空闲 1~8 张
    gpu_prices: () => {
      const error = queryFormatError("prices", "machine.gpu_idle_num"); if (error) throw error;
      const g = String(a.gpu);
      const base = /5090/.test(g) ? 3.08 : /4090D/.test(g) ? 1.68 : /4090/.test(g) ? 1.88 : /3090/.test(g) ? 1.38 : 2.28;
      const tiers = [0, 0.2, 0.5].map((d, i) => ({
        price_yuan: Math.round((base + d) * 100) / 100, idle: [14, 6, 3][i], machines: [5, 3, 1][i],
        max_per_machine: [8, 4, 3][i], max_cuda: [128, 124, 122][i],
      }));
      const idles = [8, 4, 2, 1, 1, 3, 1, 2, 1];
      const offers = idles.map((idle, i) => ({ machine_id: `m-${i}`, machine_alias: `${120 + i * 7}机`, region_sign: i % 2 ? "bj-B2" : "bj-B1",
        idle, price_yuan: tiers[i < 5 ? 0 : i < 8 ? 1 : 2].price_yuan, max_cuda: i === 2 ? 118 : 128 }));
      return { gpu_name: g, fetched_at: now() - 4, machines: 9, idle: 23, min_yuan: tiers[0].price_yuan, median_yuan: tiers[0].price_yuan,
        max_yuan: tiers[2].price_yuan, tiers, multi: [{ cards: 2, machines: 6 }, { cards: 4, machines: 3 }, { cards: 8, machines: 1 }], unpriced_idle: 0, offers };
    },
    list_servers: () => {
      const issue = sshNamingIssue();
      const autodlError = queryFormatError("servers", "instance.list");
      if (autoSync && !issue && !autodlError) sshSynced = true;
      return ({
      servers: [
        ...(autodlError ? [] : regular).map((i) => ({
          id: `autodl:${i.uuid}`, kind: "autodl", name: i.name || `${i.gpu} 实例`, host: i.ssh_command.split("@")[1] ?? "",
          port: Number(i.ssh_command.split(" ")[2]) || 22, user: "root", alias: i.name,
          alias_ready: sshSynced && !issue, auth: "password", key_path: null, has_password: true, key_pushed: i.uuid === regular[0].uuid,
          status: i.status, gpu: `${i.gpu} × ${i.gpu_amount}`, region_name: i.region_name, note: null,
        })),
        ...myServers.map((s) => ({
          id: `srv:${s.id}`, kind: "custom", name: s.name, host: s.host, port: s.port, user: s.user,
          alias: s.alias ?? `lookout-${s.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-+|-+$/g, "") || "server"}-${s.id}`, alias_ready: !!s.alias || (sshSynced && !issue),
          auth: s.auth, key_path: s.key_path, has_password: s.auth === "password", key_pushed: s.id === 1, status: null, gpu: null, region_name: null, note: s.note,
        })),
      ],
      ssh_sync_error: issue, ssh_name_error: !!issue,
      autodl_error: autodlError, own_key: ownKey, ssh_config_path: "C:\\Users\\you\\.ssh\\config", auto_sync: autoSync, synced: false,
    });
    },
    save_server: () => { const sv = a.server as ServerRecord; if (sv.id > 0) myServers = myServers.map((x) => (x.id === sv.id ? sv : x)); else myServers = [...myServers, { ...sv, id: myServers.length + 10 }]; return 1; },
    delete_server: () => { myServers = myServers.filter((x) => x.id !== a.id); },
    ssh_config_hosts: () => [
      { alias: "lab-3090", host: "10.12.0.31", port: 22, user: "tk", identity_file: "~/.ssh/id_ed25519" },
      { alias: "aliyun", host: "47.100.12.8", port: 22, user: "ubuntu", identity_file: null },
    ],
    import_ssh_hosts: () => (a.aliases as string[]).length,
    sync_ssh_config: () => { const issue = sshNamingIssue(); if (issue) throw issue; sshSynced = true; return { changed: true, count: 4, path: "C:\\Users\\you\\.ssh\\config" }; },
    set_ssh_auto_sync: () => { autoSync = !!a.on; },
    open_terminal: () => {},
    open_vscode: () => { if (!sshSynced) throw "NEED_SYNC|VS Code 要通过 SSH 配置里的名字连接，先点「同步到 SSH 配置」"; },
    server_password: () => "xxxxxx",
    test_server: () => (a.id === "srv:2"
      ? (() => { throw "HOSTKEY_CHANGED:SHA256:fake|47.100.12.9:22 的主机密钥和上次连接时不一样。AutoDL 实例换了机器或重装系统时会这样，也可能是有人冒充。确认没问题后可以信任新的密钥。"; })()
      : { ms: 86, system: "Linux 5.15.0-105-generic x86_64 · Ubuntu 22.04.4 LTS", via_key: true }),
    ensure_ssh_key: () => { ownKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemo autodl-lookout"; return ownKey; },
    push_ssh_key: () => {},
    trust_host_key: () => {},
    server_status: () => fakeStatus(a.id as string),
    start_live: () => {
      const id = a.id as string;
      if (!settings.server_live) throw "设置里关了「详情实时刷新」";
      if (id === "srv:2") throw "HOSTKEY_CHANGED:SHA256:fake|主机密钥变了";
      window.clearInterval(liveTimers[id]);
      // 演示：第一次打开时补上前 3 分钟，曲线不是空的
      if (!liveSeeded.has(id)) { liveSeeded.add(id); for (let k = 90; k > 0; k--) liveListeners.forEach((cb) => cb({ id, status: fakeStatus(id, now() - k * 2), ended: false, error: null })); }
      const emit = () => liveListeners.forEach((cb) => cb({ id, status: fakeStatus(id), ended: false, error: null }));
      emit();
      liveTimers[id] = window.setInterval(emit, 2000);
    },
    stop_live: () => { window.clearInterval(liveTimers[a.id as string]); delete liveTimers[a.id as string]; },
    servers_overview: () => {
      if (!settings.server_overview) return {};
      const out: Record<string, unknown> = {};
      for (const id of ["srv:1", "srv:2", ...regular.filter((i) => i.status === "running").map((i) => `autodl:${i.uuid}`)]) {
        if (id === "srv:2") { out[id] = { gpus: 0, util_avg: null, mem_used_mb: 0, mem_total_mb: 0, no_gpu: false, error: "主机密钥变了，点开处理" }; continue; }
        const s = fakeStatus(id);
        out[id] = { gpus: s.gpus.length, util_avg: s.gpus.length ? s.gpus.reduce((x, g) => x + g.util, 0) / s.gpus.length : null,
          mem_used_mb: s.gpus.reduce((x, g) => x + g.mem_used_mb, 0), mem_total_mb: s.gpus.reduce((x, g) => x + g.mem_total_mb, 0), no_gpu: s.gpus.length === 0, error: null };
      }
      return out;
    },
    get_server_watch: () => watches[a.id as string] ?? { id: a.id, idle: false, idle_minutes: 30, disk: false, job_pid: null, job_log: null, job_quiet_minutes: 15 },
    save_server_watch: () => { const w = a.watch as Watch; watches[w.id] = w; },
    base_images: () => [
      { uuid: "base-image-pt251", label: "PyTorch 2.5.1 · Python 3.12(ubuntu22.04) · CUDA 12.4", framework: "PyTorch", cuda: 124, rank: 30 },
      { uuid: "base-image-pt210", label: "PyTorch 2.1.0 · Python 3.10(ubuntu22.04) · CUDA 12.1", framework: "PyTorch", cuda: 121, rank: 20 },
      { uuid: "base-image-pt200", label: "PyTorch 2.0.0 · Python 3.8(ubuntu20.04) · CUDA 11.8", framework: "PyTorch", cuda: 118, rank: 10 },
      { uuid: "base-image-conda", label: "Miniconda conda3 · Python 3.10(ubuntu22.04) · CUDA 11.8", framework: "Miniconda", cuda: 118, rank: 5 },
    ],
    // 演示：第一次租 m-1 时模拟价格刚涨了
    rent_instance: () => (a.machineId === "m-1" && !a.acceptPrice
      ? { status: "price_changed", old_yuan: a.expectedPrice, new_yuan: Math.round((Number(a.expectedPrice) + 0.2) * 100) / 100 }
      : { status: "created", instance_uuid: "demo-instance-uuid" }),
    stock_history: () => Array.from({ length: 96 }, (_, i) => ({
      ts: now() - (96 - i) * 900,
      idle: Math.max(0, Math.round(6 + 6 * Math.sin(i / 9) + (i % 7) - 3)), total: 1240,
    })),
    // 假历史：遵守范围和保留期；?demoHistoryDays=3 可查看采样不足一周的状态
    stock_heatmap: () => {
      const demoDays = Math.max(1, Math.min(90, Number(new URLSearchParams(window.location.search).get("demoHistoryDays")) || settings.history_keep_days));
      const days = Math.min(Number(a.days) || demoDays, demoDays, settings.history_keep_days);
      const first = new Date(); first.setHours(0, 0, 0, 0); first.setDate(first.getDate() - days + 1);
      const cells = Array.from({ length: 168 }, (_, i) => {
        const weekday = Math.floor(i / 24), hour = i % 24;
        const night = Math.max(0, Math.cos(((hour - 3) / 24) * Math.PI * 2));
        const hit = Math.min(1, night * 0.85 + (weekday >= 5 ? 0.18 : 0) + ((i * 37) % 11) / 80);
        let samples = 0;
        for (let day = 0; day < days; day++) {
          const date = new Date(first); date.setDate(date.getDate() + day); date.setHours(hour);
          if ((date.getDay() + 6) % 7 === weekday && date.getTime() <= Date.now()) samples += 60;
        }
        return { weekday, hour, samples, hit_ratio: samples ? hit : null, avg_idle: samples ? hit * 9 : null };
      });
      return { cells, samples: cells.reduce((s, c) => s + c.samples, 0), first_ts: first.getTime() / 1000, last_ts: now(), coverage_days: days, sample_days: days,
        summary: "每天 02:00–05:00 最容易有卡（有卡比例约 86%），周末比工作日更容易抢到。" };
    },
    history_gpus: () => ["RTX 4090", "RTX 4090D", "RTX 3090", "vGPU-48GB"],
    log_ui_error: () => {
      uiLogs.unshift({ id: 100 + uiLogs.length, ts: now(), level: "error", kind: "ui", rule_id: null, message: `「${PAGE_NAMES[a.page] ?? "未知页面"}」页渲染出错：${a.message}` });
      return null;
    },
    list_logs: () => [
      ...uiLogs,
      { id: 3, ts: now() - 30, level: "info", kind: "alert", rule_id: 1, message: "有卡了：西北B区 4090 — 西北B区 · RTX 4090 空闲 7，RTX 4090D 空闲 3" },
      { id: 2, ts: now() - 4000, level: "warn", kind: "long_running", rule_id: null, message: "llm-sft 已连续运行 8.1 小时，记得关机" },
      { id: 1, ts: now() - 9000, level: "info", kind: "manual", rule_id: null, message: "开机 pro-76419909953e" },
    ],
    get_balance: () => snapshot().balance,
  };
  const f = out[cmd];
  return (f ? f() : null) as T;
}
