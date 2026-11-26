# AutoDL Lookout · 显卡管家

基于 AutoDL 开放 API 的桌面工具（Tauri 2 + Rust + React）：
监控各区域空闲显卡、有卡时发系统通知（可选自动创建 / 开机 Pro 实例）、管理普通容器实例和容器实例 Pro、余额和长时间运行提醒。

![显卡管家：库存页](docs/screenshots/stock.webp)

<p align="center"><img src="docs/screenshots/demo.gif" width="800" alt="操作演示：点开卡型看实时价格 → 抢卡时段 → 服务器实时状态"></p>

<p align="center"><sub>以上画面都是演示模式（<code>npm run demo</code>）的假数据。</sub></p>

## 下载

到 [Releases](https://github.com/tkzzzzzz6/autodl-lookout/releases) 下载安装包：

| 系统 | 文件 |
|---|---|
| Windows 10 / 11 | `*_x64-setup.exe`（批量部署用 `*.msi`） |
| macOS | Apple 芯片 `*_aarch64.dmg`，Intel `*_x64.dmg` |
| Linux（Debian / Ubuntu） | `*_amd64.deb`：`sudo apt install ./AutoDL.Lookout_*_amd64.deb` |
| Linux（Fedora / openSUSE） | `*.x86_64.rpm`：`sudo dnf install ./AutoDL.Lookout-*.x86_64.rpm` |
| Linux（其他发行版） | `*_amd64.AppImage`：`chmod +x` 后直接运行 |

Linux 需要桌面环境有系统托盘（GNOME 要装 AppIndicator 扩展）和钥匙串服务（gnome-keyring 或 KWallet）；没有钥匙串时网页凭证会退回存在本地数据库，服务器密码存不了。

安装包没有代码签名：Windows 首次运行弹出「Windows 已保护你的电脑」时点「更多信息 → 仍要运行」；macOS 提示无法打开时到「系统设置 → 隐私与安全性」点「仍要打开」。

## 运行

需要：Rust（`rustup`）、Node.js 22 LTS（22.12+）或 24 LTS，建议使用 24 LTS；兼容范围见 `package.json` 的 `engines`。
- Windows：还需要 Visual Studio Build Tools 里的「使用 C++ 的桌面开发」，以及 WebView2（Win10/11 一般自带）
- macOS：还需要 Xcode Command Line Tools（`xcode-select --install`）

界面：浅色毛玻璃风格（`src/styles.css`，CSS `backdrop-filter`），动效用 [Motion](https://motion.dev)（`motion/react`），图标在 `src/icons.tsx`，设计稿在 `design/`。
标题用的衬线字体是 Noto Serif SC 的子集（GB2312 常用字），放在 `src/assets/fonts/`，SIL OFL 授权。

```bash
npm install
npm run tauri dev      # 开发模式
npm run tauri build    # 打包安装包（Windows 是 .msi / .exe，macOS 是 .app / .dmg，在 src-tauri/target/release/bundle/）
```

只调界面时可以 `npm run dev` 在浏览器打开 http://localhost:1420 ，会用 `src/mock.ts` 里的假数据。

首次打开到「设置」填写两个凭证（都存在 Windows 凭据管理器 / macOS 钥匙串里）：

- **网页登录凭证**：查库存用，数字和控制台「算力市场」一致。获取：浏览器登录 autodl.com → F12 → Console 输入 `copy(localStorage.token)`。有效期约 60 天，快过期时软件会提醒。
- **开发者 Token**：查余额、管理和创建实例用（AutoDL 控制台 → 设置 → 开发者Token，账号需实名）。

### 开机自启动

桌面版在“设置 → 系统”中开启“开机时自动启动并隐藏到托盘”，开关立即保存，下次登录系统时生效；默认关闭。关闭窗口仍会留在托盘，彻底退出请使用托盘菜单。

界面会从系统读取实际状态；若显示“状态未知”或启停失败，请按提示“重新读取状态”，并检查系统启动项设置。浏览器演示只显示说明，不会修改启动项。Windows、macOS 和 Linux 的系统登录及托盘支持需要在对应安装版上确认。

## 功能

| 页面 | 内容 |
|---|---|
| 库存 | 顶部显示「关注卡型」（默认 A100、V100、A800）在看板区域里的空闲合计和分布；可切「按区域 / 按卡型」，按卡型时同一种卡各区的数量和合计放在一起；每个区域每种卡的空闲数，一格一张卡；点开看实时单价，可以直接「租用」（选单机卡数、机器、镜像，按量计费，点两次确认）；（价格区间、按价位分档的空闲卡数、单机能开几卡）、24h / 3 天 / 7 天历史，以及「去算力市场租」（打开时已选好区域） |
| 提醒规则 | 区域 + 卡型关键字 + 空闲门槛 (+ 单价上限 / 最低 CUDA / 单机至少 N 卡)，冷却时间内不重复提醒；有卡的规则旁边可以一键打开算力市场；可选「自动创建实例」或「自动开机」 |
| 抢卡时段 | 按「星期 × 小时」看库存历史的热力图（有卡比例 / 平均空闲，近 7 天 / 14 天 / 全部），标出实际覆盖日期和采样天数，采样不足一周时提示参考价值有限 |
| 配置导入导出 | 设置页备份规则和创建模板为带版本号的 JSON，导入前预览、选择追加或替换；模板引用自动重新对应，导入规则全部改为“只提醒” |
| 我的实例 | 普通容器实例（网页凭证）：列表、开机（含无卡模式，点两次确认）/ 关机、复制 SSH 和密码、打开 Jupyter / 6006 / 6008；填了开发者 Token 时还能管理容器实例 Pro（释放、保存镜像） |
| 服务器 | AutoDL 实例自动出现，实验室 / 云服务器手动添加或从 `~/.ssh/config` 导入；一键打开系统终端、用 VS Code Remote-SSH 打开；同步到 SSH 配置（AutoDL 端口变了自动更新）；生成密钥并推送公钥免密登录；主机密钥变化时拦下；点开看 GPU（利用率、显存、温度、功耗）、占卡进程和用户、CPU / 内存 / 磁盘，每 2 秒实时刷新并画出最近 5 分钟的曲线；列表上直接显示每台的 GPU 利用率和显存（10 秒一次）；两项都能在设置或页面上关掉；可开显卡空闲提醒（AutoDL，提醒不自动关机）、训练结束提醒（盯 PID 或日志）、磁盘告警 |
| 创建模板 | 卡型、卡数、镜像、CUDA、系统盘、开机命令，一键创建 |
| 日志 | 提醒、自动动作、手动操作记录；某一页出错时只那一页显示原因和「重新加载这一页」，错误也记在这里 |
| 设置 | Token、看板区域（默认 V100专区、A800专区、佛山区、北京B区）、关注卡型、轮询间隔、余额提醒线、自动动作余额下限、运行时长提醒、开机自启、当前版本与自动检查更新 |

### 界面一览

| | |
|---|---|
| ![库存：点开卡型看实时单价和分档](docs/screenshots/stock.webp) | ![提醒规则](docs/screenshots/rules.webp) |
| **库存**：各区空闲卡数，点开看实时单价、分档，直接租用 | **提醒规则**：区域 + 卡型 + 门槛，有卡就通知 |
| ![抢卡时段热力图](docs/screenshots/analysis.webp) | ![我的实例](docs/screenshots/instances.webp) |
| **抢卡时段**：按星期 × 小时看什么时候最容易有卡 | **我的实例**：开关机、复制 SSH 和密码 |
| ![服务器列表](docs/screenshots/servers.webp) | ![服务器实时状态](docs/screenshots/server-live.webp) |
| **服务器**：AutoDL 实例和自己的服务器放在一起，列表直接看 GPU 占用 | **服务器详情**：每 2 秒刷新，最近几分钟的曲线 |
| ![设置](docs/screenshots/settings.webp) | |
| **设置**：凭证、看板区域、关注卡型、提醒线 | |

截图用 `scripts/screenshots.mjs` 生成（说明见脚本开头），界面改了可以重新跑一遍。

关闭窗口会留在菜单栏继续监控（菜单栏图标旁的数字 = 当前有卡的规则数）。

### 扣费操作的安全阀

- 库存页租用：只能手动；余额查不到或低于「开机余额下限」不下单；下单前重查这台机器，租不了 / 空闲不够就拒绝，涨价了先提示新旧价格、确认后才按新价格下单；只做按量计费；镜像 CUDA 不能高于机器驱动支持的版本

- 默认所有规则只提醒；需要手动把「触发后」改成自动创建 / 自动开机
- 每条规则每天最多执行 N 次（失败也计数，避免反复重试）；执行前先在数据库里占名额，并发执行也不会超过上限
- 同一台电脑只能运行一个显卡管家：再打开一次只会把已有窗口拉到前台，不会出现两个进程重复轮询、重复执行自动动作
- 执行前先查余额，低于「开机余额下限」就跳过
- 单价上限会作为库存查询的 `price_to` 过滤条件
- 手动开机普通实例：点两次确认；先查余额，查不到或低于「开机余额下限」就不开机；每台实例每天最多手动开机 5 次（无卡模式也算，失败也计数）
- 「我的实例」页的列表出错时自动放慢刷新，最长 10 分钟一次

## 用到的接口

| 用途 | 接口 |
|---|---|
| 余额 | `POST /api/v1/dev/wallet/balance` |
| 库存 | 控制台内部接口（网页凭证）：`GET /api/v1/region/list`、`POST /api/v1/machine/region/gpu_type`、`POST /api/v1/user/machine/list`（带单价 / CUDA / 单机卡数条件的规则） |
| 普通实例 | 控制台内部接口（网页凭证）：`POST /api/v1/instance`、`POST /api/v1/instance/power_on`、`.../power_off` |
| Pro 实例 | `POST /api/v1/dev/instance/pro/{create,list,power_on,power_off,release}`、`GET .../snapshot`、`GET .../status` |
| 镜像 | `POST /api/v1/dev/instance/pro/image/save`、`.../image/private/list` |

注意：

- 为什么不用官方的 `dev/machine/region/gpu_stock`：它是「弹性部署可调度」口径，2026-11-06 21:03 实测西北B区 4090 显示 34 张空闲，同一时刻算力市场是 0 张，和能不能租到差得很远
- 新安装默认保留 30 天库存历史，已有设置（包括原来的 14 天）保持不变。保留越久数据库越大：默认 4 区、60 秒轮询、约 14 个区域卡型组合全天运行，历史与索引约增加 1.5 MiB/天，30 天约 46 MiB；实测方法见 [存储估算](docs/history-storage.md)。软件关闭或查询失败的时段没有采样。
- 在设置页“规则和模板备份”中导出 JSON，再在另一台电脑导入。文件不包含保存的凭据、服务器、余额设置、库存历史或日志；导入前会预览条数，替换模式会清空现有规则和模板，建议先导出备份。所有导入规则均强制改为“只提醒”，自动创建/开机需之后手动设置。最多 2 MiB、1000 条规则和 500 个模板；格式、版本、引用不合法或写入失败时不做部分导入。
- 控制台接口的关键字段缺失或类型变化时会明确提示“接口格式好像变了”，不再当成 0 张或 0 元；异常数据不写入历史、不触发规则，余额查不到时不执行收费动作。同一种格式错误每次启动只记一次日志，界面提供更新与反馈入口。浏览器演示可加 `?demoApiFormatError=1` 查看这个状态。
- 实例、服务器和实时单价的独立查询遇到格式变化时，错误旁也有反馈按钮。演示可将上面的参数分别设为 `instances`、`servers` 或 `prices`，验证库存轮询正常时这些入口仍可用。
- 库存的卡型名（如 `RTX 4090`）和 Pro 创建用的 `gpu_spec_uuid`（如 `4090D`、`5090-p`）是两套命名，规则用关键字匹配，模板里单独选规格
- AutoDL 实例同步到 SSH 配置的 `Host` 使用控制台里的原名称，保留大小写和安全中文名，不加前缀、UUID 或编号。名称需唯一（不区分大小写），最多 64 个字符，只含中文/字母、数字、点、横线或下划线，不能含空格或以横线开头。重名、空名或与已有手写/Include Host 冲突时，服务器页会显示原因并指导去 AutoDL“容器实例”改名；改好后点“刷新”再同步。
- 成功同步后，旧软件管理段中的 `autodl-名称-短ID` 会替换为原名称；原配置会先备份，手写条目保持原内容和相对顺序。你保存的旧终端命令或 VS Code Host 也需改用新名称。管理段置顶，避免前面的通配规则覆盖连接目标。
- 重名或无法检查的配置不会被部分覆盖。支持检查静态 Include；动态路径、循环、过深/过大的 Include 或无法读取的文件会明确提示并暂停同步。自动同步错误也会显示在服务器页，修复后可重新同步。
- 服务器页同步 SSH 配置时只改 `~/.ssh/config` 里 `# >>> autodl-lookout >>>` 到 `# <<< autodl-lookout <<<` 之间的内容，改之前备份成 `config.autodl-lookout.bak`；软件的密钥在 `~/.ssh/autodl_lookout_ed25519`；服务器密码存系统钥匙串
- 服务器详情的实时刷新在服务器上起一个常驻采集循环（2 秒一帧，复用同一条 SSH 连接），关掉面板、最小化或隐藏窗口就停，远程循环最多跑 30 分钟自动退出；列表状态只在「服务器」页开着时每 10 秒采集一次（AutoDL 实例只采运行中的，最多同时 4 台，单台出错退避）。两项都在「设置 → 服务器」里，关掉就不连服务器采集
- 服务器提醒只对打开了的服务器生效，后台每分钟用 SSH 跑一次采集脚本（`sh -c`，不受登录 shell 影响），出错退避到 10 分钟；同一种情况只提醒一次
- 库存按单卡统计，多卡机器不一定能开出来；点开卡型看「单机 ≥ N 卡」的机器数
- 点开卡型时的价格用你自己的网页凭证实时查（含会员折扣）：同一卡型 15 秒内用缓存、同时只查一次、全局限流，面板开着时 30 秒刷新一次，收起或窗口隐藏就停
- 官方文档没写限流，轮询间隔最少 30 秒，出错时指数退避到最多 10 分钟
- 实例状态只有 `running` 有文档，其他状态值界面里按原样显示

## 代码结构

前端代码在 [`src/`](./src/)，由 `main.tsx` 挂载 `App.tsx`，各功能页面在 `pages/`。桌面端 Rust 代码在 [`src-tauri/src/`](./src-tauri/src/)，`main.rs` 调用 `lib.rs` 启动应用，`commands.rs` 提供前端调用入口。

详细模块职责集中维护在 [AGENTS.md 的目录说明](./AGENTS.md#目录)，新增或调整模块时更新那里。

测试：`npm test`（脚本/Vitest 单测 + 前端检查与打包 + Rust 单测）、`npm run lint:rust`（Clippy）；只看界面：`npm run demo`。

数据库位置：Windows 在 `%APPDATA%\io.github.tkzzzzzz6.autodl-lookout\autodl-lookout.sqlite3`，macOS 在 `~/Library/Application Support/io.github.tkzzzzzz6.autodl-lookout/`。
早期开发版的数据在 `dev.local.autodl-lookout`（更早叫 autodl-manager 时在 `dev.local.autodl-manager`），首次启动会自动把旧数据库和凭证搬过来（旧文件保留不动）。

## 应用内更新

在“设置 → 软件更新”中查看当前版本、手动检查，或开关自动检查（立即保存）。桌面版启动后延迟检查，此后每 6 小时检查一次；离线时会退避重试，不阻塞库存监控。有新版本时顶栏显示入口，不会自动下载安装或强制更新。

查看更新说明后，点“下载并安装”并再次确认才开始。下载没有总大小时显示已下载的数据量；签名和绑定版本通过验证后，软件暂停新一轮监控、等待当前轮次结束，再进入安装。安装失败恢复此前暂停状态；Windows NSIS 安装程序会退出并重启，macOS / AppImage 安装后可点击“重新启动”。请在可以暂时暂停监控时更新。

MSI、deb/rpm 或未识别的安装方式只提供版本提示与发布页入口，使用同类型安装包或包管理器升级。更新不改变应用标识或删除规则、设置、数据库、SSH 配置和钥匙串凭据。首个接入更新功能的版本仍需手动安装一次。

正式发布包的更新公钥由下面的签名配置注入。未配置的本地构建不发起应用内更新请求，可打开发布页下载。浏览器演示支持完整假更新流程，不会连接 GitHub、下载文件或修改系统。

## 自动更新签名配置

维护者先在自己的电脑生成更新签名密钥：`npm run tauri -- signer generate -w <安全目录>/autodl-lookout.key`，按提示设置密码并备份私钥与 `.pub` 公钥。私钥丢失后，现有客户端无法验证新密钥签发的更新。

在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：

| 类型 | 名称 | 内容 |
|---|---|---|
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件完整内容 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |
| Variable | `TAURI_UPDATER_PUBLIC_KEY` | `.pub` 公钥文件完整内容 |

私钥和密码不要提交、贴进 issue 或发在聊天中；公钥可公开，会写入发布版配置。Tauri 的更新签名用于验证更新来源，不代替 Windows 代码签名和 Apple 公证。

发版会先检查签名配置；全平台构建成功后，保留更新包和签名、区分 macOS 两种架构，验证签名绑定的版本，再生成 `latest.json` 并统一发布。缺配置、缺产物、错签名或重名都会失败。dry-run 同样验签，但只留存核验后的 artifacts，不发布。手动运行时可填 `build_ref` 为已审阅的分支或提交 SHA，`tag` 填与该代码版本一致的 `vX.Y.Z`；这样无需先推送会触发正式发布的 tag，就能验证新代码。正式发布禁止使用 `build_ref`，仍从已推送的 tag 构建。Linux 上 `npm test` 会在安装了 `minisign` 时执行真实 Tauri 签名回归测试；没有该工具的平台明确跳过这一项，其余清单检查照常运行。

本地仅打普通安装包时，可用 `npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'` 关闭更新产物生成；正式发布必须通过配置签名的 workflow。首个支持自动更新的版本仍需用户手动安装一次。Windows NSIS、macOS、Linux AppImage 可接入应用内更新；deb/rpm 使用对应包或包管理器，MSI 用户需核实安装方式兼容性。

## 发版

推送 `v*` tag 后，GitHub Actions（`.github/workflows/release.yml`）会打包 Windows（`.exe`、`.msi`）、macOS（Apple 芯片、Intel 各一个 `.dmg`）和 Linux x64（`.deb`、`.rpm`、`.AppImage`），所有平台都打包成功后一次性创建并**直接发布**到 Releases（设为 Latest），说明按 PR 的 label 自动分组（`.github/release.yml`）。打包过程中不会建草稿；有一个平台失败就什么都不发布，不会发出缺安装包的版本。

**顺序很重要：先改版本号并合并到 main，再打 tag。** 发版时会检查 tag 和版本号是否一致（`v0.2.0` 对应版本号 `0.2.0`），对不上会直接失败。

1. **改版本号**：从 main 拉一个分支，改版本号，开 PR 合并到 main（PR 打 `ignore-for-release` label，不进更新说明）：
   ```bash
   git checkout main && git pull
   git checkout -b chore/bump-0.2.0
   npm run version:set -- 0.2.0   # 同时改 package.json、Cargo.toml、tauri.conf.json 和两个 lock 文件
   git commit -am "chore: 版本号改成 0.2.0"
   git push origin chore/bump-0.2.0   # 然后在 GitHub 上开 PR、合并
   ```
2. **打 tag**：PR 合并后，在 main 最新的提交上打 tag 并推送：
   ```bash
   git checkout main && git pull
   npm run version:check          # 确认版本号已经是 0.2.0
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. **等发布**：Actions 里的「发版」跑完（大约 15–25 分钟），Releases 页面就有新版本了。

出问题时：

- **tag 打早了**（版本号还没改，workflow 报「tag 和版本号对不上」）：什么都不会发布。按第 1 步改好版本号合并后，删掉旧 tag 重新打：
  ```bash
  git checkout main && git pull
  git tag -d v0.2.0
  git push origin :refs/tags/v0.2.0
  git tag v0.2.0
  git push origin v0.2.0
  ```
- **某个平台打包失败**：什么都不会发布。到 Actions 看是哪个平台、什么错；偶发问题（网络等）在那次运行里点「Re-run failed jobs」，已经成功的平台不用重打，全部成功后自动发布。要改代码才能修好的，修好合并后按「tag 打早了」的办法删掉 tag 在新提交上重打（没发布过的版本号可以继续用）。
- **想先试试发版流程**：在 Actions 页面手动运行「发版」，填一个已推送的 tag，勾上「只打包、核对，不发布」，安装包会出现在这次运行的 Artifacts 里。
- **已经发布的版本不会被覆盖**：发出去后发现问题，修好后发下一个版本号（如 `0.2.1`）。

也可以在 Actions 页面手动运行「发版」，填一个已经推送的 tag。

## 参与贡献

欢迎提 Issue 和 PR，开发环境、提交规范和注意事项见 [CONTRIBUTING.md](./CONTRIBUTING.md)。使用 AI 编码助手的话，项目约定写在 [AGENTS.md](./AGENTS.md)。

本项目与 AutoDL 官方无关。

## 许可

[MIT](./LICENSE) © 2026 tkzzzzzz6

打包的标题字体是 Noto Serif SC 子集，使用 [SIL Open Font License 1.1](./src/assets/fonts/LICENSE-OFL.txt)。
