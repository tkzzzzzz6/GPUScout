# AGENTS.md

写给在这个仓库里工作的 AI 编码助手（Claude Code、Codex、Cursor 等）和新贡献者。动手前请完整读一遍。

## 协作流程（Issue → PR）

本仓库所有改动都经过 issue 和 PR：先在 issue 里写清楚要做什么，再在独立分支上实现，提交 PR 由维护者审阅、合并。Agent 不直接修改维护者本机的工作区，也不直接提交到 `main`。

### 开始之前

- 每项工作对应一个 issue。没有 issue 时，先按 `.github/ISSUE_TEMPLATE/` 的格式起草，写明背景、工作范围、验收标准和不做的内容，由维护者确认后再动手。
- 从最新的 `origin/main` 拉分支，一个 issue 一个分支、一个 PR。分支命名：`<agent>/<issue 编号>-<简短英文描述>`，例如 `claude/3-webhook-notify`、`codex/4-per-machine-rule`。人工分支可用 `feat/...`、`fix/...`。
- 动手前先读 issue 里列出的参考入口，以及本文件后面的「两种凭证」「已知坑」「安全和钱」。
- 你只能看到已经推送到 GitHub 的内容。维护者本机未推送的改动、本机数据（`%APPDATA%\io.github.tkzzzzzz6.autodl-lookout\` 下的 SQLite 数据库：规则、模板、库存历史、日志）和系统凭据管理器里的凭证都不在你的工作副本里；需要时在 issue 或 PR 里说明，不要猜测它们的内容，也不要索要真实凭证。

### 实现

- 只做 issue 范围内的事。顺手发现的其他问题记下来，在 PR 里列出或另开 issue，不要混进同一个 PR。
- 保持现有代码风格：中文注释和界面文案，说明「为什么」而不是复述代码。
- 不要改写与任务无关的文件，不要批量格式化，不要改动换行符（仓库内文本文件统一为 LF，见 `.gitattributes`）。
- 改了用户可见的行为，同步更新 `README.md` 的功能表、用到的接口或注意事项。
- 新功能和缺陷修复都要有测试：Rust 测试写在对应模块的 `#[cfg(test)] mod tests` 里；调用 AutoDL 的代码用 `api.rs` / `market.rs` 里的本地假 HTTP 服务器检查请求方法、路径、请求头和 body，返回值用真实接口的字段形状。前端纯函数使用 Vitest（`src/**/*.test.ts`，Node 环境，不引入 DOM 测试库），界面继续通过 `tsc` 和演示模式实际操作验证。

### 开 PR 之前

在仓库根目录运行，全部通过才能提交 PR：

```bash
npm test          # 脚本测试 + Vitest 纯函数测试 + npm run build（tsc + vite build）+ cargo test
npm run lint:rust # cargo clippy --all-targets -- -D warnings
npm audit --audit-level=high # 依赖审计，阻止带高危或严重问题的依赖合入
```

`cargo` 和 Clippy 不能有新的 warning；CI 两个平台都运行 `npm run lint:rust`，本地缺少组件时先运行 `rustup component add clippy`。这些检查与 CI（`.github/workflows/ci.yml`，Windows 和 Ubuntu 各跑一遍）一致。改了界面时，用离线演示模式（`npm run demo`）实际操作一遍，截图放进 PR。

### 提交与 PR

- 提交信息用中文，`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` 开头，标题一行说清楚做了什么，正文分条列出要点。由 Agent 创建的提交，在末尾附上该 Agent 要求的署名行。
- PR 按 `.github/pull_request_template.md` 填写：
  - 关联 issue：`Closes #编号`（全部完成）或 `Refs #编号`（部分完成）；
  - 改了什么、为什么这样改；
  - 验证：分成「已验证」（跑过哪些测试、在什么环境下手动操作过）和「需要在本地确认」（Windows 桌面版实际运行、打包安装、需要真实凭证和真实 AutoDL 数据的部分、会扣费的操作）；
  - 边界：没有做什么、已知限制。
- 给 PR 打 label，Release 说明按 label 分类（见 `.github/release.yml`）：新功能 `enhancement`，缺陷 `bug`，文档 `documentation`，破坏性变更 `breaking-change`。
- 不要合并自己的 PR，合并由维护者决定。

### 审阅之后

- 审阅意见在同一个分支上继续提交修改并推送，不要另开 PR。逐条回复处理结果；不同意的意见说明理由。
- `main` 有新提交、与 PR 冲突时，由提交 PR 的一方变基到最新的 `origin/main` 并解决冲突，再请维护者审阅。只在自己的 PR 分支上强制推送（`--force-with-lease`），绝不强制推送 `main`。

## 项目是什么

**GPUScout**：基于 Tauri 2 的桌面工具，盯着 [AutoDL](https://www.autodl.com) 各区域的空闲显卡，有卡时推送系统通知，可选在有卡时自动创建 / 开机「容器实例 Pro」。

- 后端：Rust（`src-tauri/`），负责调用 AutoDL、轮询、规则判断、通知、SQLite 存储、托盘
- 前端：React 19 + TypeScript + Vite（`src/`），动效用 [Motion](https://motion.dev)（`motion/react`）
- 主要开发平台：Windows 10/11；也要能在 macOS 和 Linux（发版打 deb / rpm / AppImage）上编译运行
- 界面语言：简体中文

## 常用命令

前端开发与测试需要 Node.js 22 LTS（22.12+）或 24 LTS，建议使用 24 LTS；版本兼容范围以 `package.json` 的 `engines` 为准。CI 同时检查 npm 依赖审计，新增测试工具时也要验证其依赖。

```bash
npm ci                 # 按锁文件安装前端依赖，拉取依赖更新后重新运行
npm test               # 脚本/Vitest 单测 + 前端检查/打包 + Rust 单测（离线，不需要凭证）
npm run test:unit       # 只跑前端纯函数测试（不需要 Rust/桌面环境）
npm run lint:rust       # Rust 所有目标的 Clippy 检查，不允许警告
npm run build          # 只做前端类型检查 + 打包到 dist/（Rust 编译时要用到 dist/）
npm run demo           # 离线演示：浏览器打开 http://localhost:1420 ，用 src/mock.ts 的假数据
npm run tauri dev      # 桌面开发模式（需要真实凭证才有数据）
npm run tauri build    # 打安装包，产物在 src-tauri/target/release/bundle/
npm run version:set -- 0.2.0   # 发版前改版本号（三处一起改，见 README「发版」）
```

演示模式下顶栏会显示「预览数据」标记，不需要 AutoDL 账号。

## 目录

```
src-tauri/src/
  main.rs       桌面程序入口，调用 lib.rs 启动应用
  lib.rs        插件、Tauri 命令注册、后台任务启动与旧数据迁移
  commands.rs   暴露给前端的 Tauri 命令和手动操作入口
  api.rs        AutoDL 官方开放 API（开发者 Token）：余额、容器实例 Pro、镜像
  market.rs     算力市场库存、余额、普通容器实例（网页登录凭证，控制台内部接口）
  images.rs     普通镜像来源、保存与下单校验，账号隔离的查询缓存与限流
  monitor.rs    后台轮询、规则判断、通知、自动动作、提醒、缓存和监控轮次互斥
  price.rs      实时价格：分档汇总、缓存、合并请求与全局限流
  regions.rs    区域、Pro 规格、公共镜像对照表
  heatmap.rs    库存历史按星期/小时聚合，统计日期覆盖和采样日，生成时段结论
  servers.rs    AutoDL 与自有服务器统一视图、SSH 命名、同步校验和错误状态
  reboot.rs     自有 Linux 服务器重启的固定命令、单次提交结果与间隔保护
  ssh.rs        SSH 连接池、认证、流式采集、主机密钥记忆、软件密钥生成与推送
  sshconfig.rs  SSH 配置解析、静态 Include 冲突检查、管理段备份与写入、目标校验
  serverstat.rs 服务器采集脚本、GPU/进程/磁盘解析与空闲/训练结束/磁盘提醒
  terminal.rs   打开系统终端执行 SSH（Windows Terminal/cmd、macOS/Linux 终端）
  store.rs      SQLite：设置、规则、模板、历史、日志、服务器及配置导入事务
  transfer.rs   规则模板配置文件的白名单格式、版本与内容校验、受限文件读取
  secret.rs     系统钥匙串与旧凭据迁移；服务器密码不回退到数据库
  notify.rs     发送系统通知
  tray.rs       托盘图标、命中数和菜单
  updates.rs    更新能力、偏好与安装前监控暂停/恢复
src-tauri/examples/
  measure_history.rs  使用真实 Store 在临时库测量库存历史占用
src/
  main.tsx      React 页面挂载与全局上下文
  App.tsx       顶栏、导航、监控/余额状态和页面切换
  api.ts        Tauri 调用封装、类型、外链和卡型别名
  format.ts     页面共用的纯格式化、连接命令和退避逻辑
  hooks.ts      实时价格、轮询、服务器状态和历史曲线相关 hooks
  ui.tsx        共用 Group/Row、Segmented、Select、Switch、Stepper、Sheet、Toast 等组件
  icons.tsx     24×24 线条图标，与 design/ 同源
  styles.css    浅色设计令牌、布局和组件样式
  mock.ts       浏览器离线演示数据、错误开关和模拟操作
  PageBoundary.tsx  页面错误隔离、日志与重试
  autostart.ts / AutostartSettings.tsx  系统启动项状态控制与设置界面
  updates.ts / UpdateSettings.tsx      更新检查/下载/安装控制、设置与顶栏提醒
  ConfigurationTransfer.tsx           规则模板导出、选择文件、导入预览与确认
  SshConfigEditor.tsx / ServerRestartControls.tsx  本机 SSH 文本编辑与自有服务器重启
  api.test.ts / format.test.ts         Node 环境的 Vitest 纯函数测试
  vite-env.d.ts                        Vite 环境类型
  ImagePicker.tsx / ImageLibrary.tsx   分来源镜像浏览、筛选与选择
  RentSheet.tsx / SaveRegularImage.tsx 普通实例租用确认与镜像保存
  pages/
    Stock.tsx      库存、关注卡型、实时价格与普通实例租用
    Rules.tsx      提醒规则与自动动作设置
    Analysis.tsx   抢卡时段热力图
    Instances.tsx  普通实例/Pro 实例、详情与手动操作
    Servers.tsx    服务器、SSH 同步/连接、实时状态与提醒
    Templates.tsx  Pro 创建模板
    Logs.tsx       日志查看与筛选
    Settings.tsx   凭据、区域、监控、启动项、更新与配置导入导出设置
  assets/          应用图标与打包字体、字体许可
scripts/           开发依赖检查、版本校验、脚本测试、更新包核验与 minisign 安装脚本
design/            设计稿 SVG 和应用图标源文件
```

## 两种凭证（最重要的背景）

| 凭证 | 用途 | 接口 | 是否必填 |
|---|---|---|---|
| 网页登录凭证（JWT，浏览器 `localStorage.token`） | 库存、余额、普通容器实例 | `www.autodl.com/api/v1/...`（控制台内部接口） | 必填 |
| 开发者 Token | 容器实例 Pro 的列表 / 开关机 / 创建 / 镜像 | `api.autodl.com/api/v1/dev/...`（官方开放 API） | 可选 |

为什么库存不用官方的 `dev/machine/region/gpu_stock`：它是「弹性部署可调度」口径。2026-11-06 同一分钟实测，西北B区 RTX 4090 官方接口显示 34 张空闲，控制台算力市场是 0 张。用户要的是「现在能不能租到」，所以库存只用算力市场的数据（`market.rs`）。不要再把库存切回 `gpu_stock`。

算力市场用到的内部接口（只需要 `Authorization: <网页凭证>` 一个请求头）：

- `GET  /api/v1/region/list`：机房 `region_sign`（如 `west-B`）→ `region_name`、`data_center`（如 `westDC3`）。软件里的区域代码就是 `data_center`，一个区域对应多个机房。
- `POST /api/v1/machine/region/gpu_type`，body `{"region_sign_list": [...]}`：各卡型空闲 / 总数，和算力市场顶部数字一致。
- `POST /api/v1/user/machine/list`：按机器列出，带 `payg_price`（元 × 1000，每卡每小时）和 `highest_cuda_version`、每台的 `gpu_idle_num`，用于带单价 / CUDA / 单机卡数条件的规则。**`gpu_idle_num > 0` 不代表能租**：`on_line` 为 3–6（离线、维护）或 `binding_instance_num >= max_instance_num`（实例数满了）的机器要排除，见 `market::machine_rentable`，和控制台选机器的逻辑一致。
- `GET  /api/v1/wallet`：余额（元 × 1000）。
- `POST /api/v1/image/get`，body `{}`：公共基础镜像（`uuid`、框架 / 版本、`cuda_version`、`is_off`、`rank`）。
- `POST /api/v1/order/instance/create/payg`：按量计费创建普通实例（**会扣费**），body 是 `{instance_info: {machine_id, charge_type: "payg", req_gpu_amount, base_image_uuid, …}, price_info: {machine_id, charge_type, duration: 1, num, coupon_id_list, …}}`（见 `market::rent_body`，照控制台前端抄的），成功时 `data` 是实例 uuid。只有库存页的手动租用会调用，前面必须过 `market::rent_guard` 和下单前的价格复核（`commands::rent_instance`）。
- `POST /api/v1/instance`，body `{"page_index", "page_size"}`：我的普通容器实例；`POST /api/v1/instance/power_on` / `power_off`，body `{"instance_uuid"}`，无卡模式开机加 `"payload": "non_gpu"`。普通实例只做手动开关机，不接规则的自动动作；手动开机前过 `market::power_on_guard`（余额查得到且不低于「开机余额下限」、每台每天最多 5 次）；root 密码只在用户点复制时单独取，不放进列表、不写日志。

这些接口不是官方开放的，随时可能变。改动相关代码时，返回格式的测试要用真实返回的字段形状（见 `market.rs` 里的测试）。

## 已知坑

- **余额接口不能带 `Content-Type: application/json` 又不带 body**，否则 AutoDL 返回 `RequestParameterIsWrong`。`api.rs` 只在有 body 时用 `.json()` 加这个头，不要手动加。
- Pro 的 `snapshot` / `status` 是 GET 带 JSON body；参数错误时会退回用查询参数重试。
- 库存里有 `CPU`、`CPU-close-HT` 等无卡条目，`parse_stock` 会过滤掉。
- 卡型名有两套：库存用 `RTX 4090`、`vGPU-48GB`，Pro 创建用 `gpu_spec_uuid`（`4090D`、`5090-p`、`v-48g`…）。规则用关键字子串匹配，`4090` 会同时匹配 4090 和 4090D。
- 库存按单卡统计，多卡机器不一定开得出来。
- 用户粘贴的凭证可能带 `Bearer `、引号、换行，统一走 `api::clean_token`。
- 应用曾叫 `autodl-manager`，应用标识也从 `dev.local.autodl-lookout` 改成了 `io.github.tkzzzzzz6.autodl-lookout`：`lib.rs` 的 `migrate_legacy_db`（`LEGACY_DBS`）和 `secret.rs` 的 `LEGACY_SERVICE` 负责把旧数据搬过来，不要删。钥匙串服务名 `secret::SERVICE` 故意没跟着标识改，也不要改。
- 应用标识（`tauri.conf.json` 的 `identifier`）决定数据目录，发版后不要再改。
- 发版只通过推送 `v*` tag 触发（`.github/workflows/release.yml`），各平台先打包成 artifact，全部成功后一次性创建并发布 Release（不建草稿），所以打 tag 就等于发版；手动运行时可以勾「只打包不发布」试流程。Agent 不要打 tag、不要发布 Release；改版本号用 `npm run version:set`，三处版本号必须一致（CI 会检查）。

## 安全和钱

- **永远不要**把凭证写进日志、错误信息、提交、测试快照或截图。测试里用假字符串。
- 网页登录凭证等同于用户的登录状态，权限比开发者 Token 大，只能存在 `secret.rs` 的钥匙串里。
- 自动创建 / 开机会扣费。保留这些安全阀：每条规则每天次数上限（失败也计数）、执行前查余额并和「开机余额下限」（设置项 `auto_min_balance_yuan`）比较、查不到余额就不执行、默认只提醒。新增任何会产生费用的动作，包括手动操作，都要有同等的后端把关并写日志，界面上的二次确认不能代替。
- 释放实例等不可逆操作在界面上用 `ConfirmButton`（点两次）。
- SSH：服务器密码只存钥匙串（`secret::save_server_password`）；拼进终端命令的主机名、用户名、别名必须先过 `sshconfig::valid_*`；主机密钥变了不能自动接受，要用户在界面上确认。自动同步 `~/.ssh/config` 只改软件管理段（`sshconfig::replace_block`），写前备份；「本机 SSH 配置」文本编辑器在用户显式保存后可以修改主文件，须独立备份、检测外部修改、保留权限，不改 Include 文件或执行配置里的命令。开发和测试仍只用临时配置，不能修改维护者真实 SSH 文件。

## 更新签名

- 发布更新包必须使用维护者备份的签名私钥，通过 Actions Secrets 注入；公钥通过仓库 Variable `TAURI_UPDATER_PUBLIC_KEY` 写入发布配置。不要在 issue、聊天、日志或测试快照输出私钥/密码，也不要把测试密钥当正式密钥。
- `scripts/updater-artifacts.mjs` 先检查平台产物、签名和绑定版本，再生成清单；不能绕过校验发布。dry-run 不发布，Agent 不打 tag 或发布 Release。

## 界面约定

- **只做浅色**，不要加深色模式。
- 风格：留白 + 苹果式毛玻璃（`.glass`、`Group`）、蓝白配色。颜色只用 `styles.css` 里的变量，不要写死新颜色。
- 下拉选择用 `ui.tsx` 的 `Select`，不要用原生 `<select>`（WebView2 里是系统样式的方框列表）。
- 图标只用 `src/icons.tsx` 里的；需要新图标就按同样的 24×24 线条风格加进去。显卡用 `gpu`（大）/ `gpu_s`（小尺寸简化版）。
- 标题用衬线字体（`.title`、`.hero`，打包的 Noto Serif SC 子集只含 GB2312 常用字，生僻字会回退）。
- 动效用 Motion，并保持克制：弹簧参数用 `ui.tsx` 里的 `spring` / `softSpring`；`App` 已包了 `MotionConfig reducedMotion="user"`。
- 文案：中文、口语、句子式，按钮写清楚动作（「验证并保存」而不是「提交」）；出错时说清楚原因和怎么办。

## 改代码时

- 新的 Tauri 命令：在 `commands.rs` 实现，在 `lib.rs` 的 `generate_handler!` 注册；前端通过 `api.ts` 的 `call()` 调用，参数名用 camelCase（Tauri 自动转 snake_case）。如果浏览器预览要用到，同时在 `mock.ts` 里加假数据。
- 数据库结构变化要兼容老数据（`CREATE TABLE IF NOT EXISTS`、新增列给默认值）。
- 轮询间隔最少 30 秒，出错时指数退避到 10 分钟，不要为了“更实时”去掉。前端页面自己的定时刷新也一样（见 `Instances.tsx` 的 `usePolling`、`hooks.ts` 的 `useGpuPrice`）。
- 「最少 30 秒」是对 AutoDL 接口的要求。服务器详情的 2 秒实时刷新、列表的 10 秒概览连的是用户自己的服务器（SSH），只在界面开着且窗口可见时采集，并受设置里的 `server_live` / `server_overview` 开关控制；改这里时保持「看的时候才采、关掉就停」（`hooks.ts` 的 `useServerStatus`、`commands.rs` 的 `start_live` / `stop_live` / `servers_overview`）。
- 新增调用 AutoDL 的按需查询（用户点开才查的那种）走缓存 + 合并请求 + 限流，参考 `price.rs`；不要让界面直接、反复地打上游。
