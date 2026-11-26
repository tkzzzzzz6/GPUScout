# 参与贡献

感谢你愿意改进 GPUScout！提 issue、修 bug、改文案、加功能都欢迎。

本仓库所有改动都走 **issue → 分支 → PR → 维护者审阅合并**，人和 AI 编码助手都一样。完整的协作规则、项目背景和各种约定写在 [AGENTS.md](./AGENTS.md)，动手前请读一遍，尤其是「两种凭证」「已知坑」「安全和钱」几节。

## 流程

1. **先开 issue**：用 [工作项](./.github/ISSUE_TEMPLATE/task.yml) 或 [缺陷报告](./.github/ISSUE_TEMPLATE/bug.yml) 模板，写明背景、工作范围、验收标准和不做的内容。等维护者确认后再动手。
2. **拉分支**：从最新的 `origin/main` 拉，一个 issue 一个分支、一个 PR。人工分支用 `feat/<issue 编号>-<描述>`、`fix/<issue 编号>-<描述>`；AI 编码助手用 `<agent>/<issue 编号>-<描述>`，例如 `claude/3-webhook-notify`。
3. **实现**：只做 issue 范围内的事；顺手发现的问题另开 issue。不要批量格式化、不要改换行符（统一 LF，见 `.gitattributes`）。新功能和缺陷修复都要有测试。
4. **自查**：在仓库根目录运行 `npm test`（脚本测试 + Vitest 纯函数测试 + 前端构建 + Rust 测试）、`npm run lint:rust` 和 `npm audit --audit-level=high`，全部通过且没有新 warning。改了界面就用 `npm run demo` 操作一遍并截图。
5. **开 PR**：按 [PR 模板](./.github/pull_request_template.md) 填写关联 issue、改了什么和为什么、验证（已验证 / 需要在本地确认）、边界，并打 label。
6. **审阅**：在同一个分支上继续提交修改，逐条回复意见。和 `main` 冲突时由提交方变基解决，只在自己的分支上 `git push --force-with-lease`。合并由维护者决定。

## 本地开发

需要：

- [Rust](https://rustup.rs)（stable）
- Node.js 22 LTS（22.12+）或 24 LTS，建议使用 24 LTS；兼容范围见 `package.json` 的 `engines`
- Windows：Visual Studio Build Tools 里的「使用 C++ 的桌面开发」，以及 WebView2（Win10/11 一般自带）
- macOS：Xcode Command Line Tools（`xcode-select --install`）

```bash
git clone https://github.com/tkzzzzzz6/autodl-lookout.git GPUScout
cd GPUScout
npm ci
npm run demo          # 离线演示：浏览器 + 假数据，不需要 AutoDL 账号
npm run tauri dev     # 桌面开发模式（需要在「设置」里填网页登录凭证）
npm test              # 提交前必跑（含 Vitest 纯函数测试）
npm run test:unit      # 只跑前端单测
rustup component add clippy
npm run lint:rust     # 和 CI 一样检查所有 Rust 目标
npm audit --audit-level=high  # 检查依赖中的高危和严重级别问题
```

每次拉取包含依赖更新的代码后，先停止旧的开发进程，在仓库根目录运行 `npm ci` 再启动。开发、演示和构建会检查依赖是否与锁文件一致，缺包时不会继续启动；该检查不会自动安装包或修改锁文件。

前端纯函数测试放在 `src/**/*.test.ts`，使用 Node 环境，不引入 DOM 测试库；界面仍通过离线演示验证。CI 在 Windows 和 Ubuntu 上都执行 npm 依赖审计、`npm test` 和 Clippy，不运行会导致全仓库格式化的 `cargo fmt --check`。

## 提交信息

用中文，以 `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` 开头，标题一行说清楚做了什么，正文分条列出要点：

```
feat: 规则支持「单机至少 N 卡」

- 规则新增 min_per_machine 字段，默认 1
- 用算力市场机器列表按单台机器的空闲数判断
- 补充 market.rs 的过滤测试
```

Release 说明按 PR 的 label 自动分类（见 [`.github/release.yml`](./.github/release.yml)）：新功能 `enhancement`、缺陷 `bug`、文档 `documentation`、破坏性变更 `breaking-change`。

## 依赖更新

Dependabot 每周一检查 npm、Cargo 和 GitHub Actions，每个生态最多保留 5 个版本更新 PR；同生态的 minor / patch 更新分组，major 更新单独审阅。配置合入默认分支后才会按计划运行，没有可更新版本时不一定产生 PR。

依赖 PR 需关联 #55 或对应的维护 issue，检查依赖声明与 lockfile 一起更新，运行现有 Windows / Ubuntu CI 的版本检查和 `npm test`。不要为依赖升级修改软件版本号，不跳过 CI、不自动合并，也不触发发版。已有的 russh 升级 PR #54 单独验证兼容性，不混进配置变更。

维护者还需在仓库 Settings → Code security 独立确认 Dependabot alerts 和 security updates 已开启；定期版本更新配置不代替这两个开关。安全更新可能不遵循版本更新的每周计划与 PR 数量限制。

Dependabot 触发的 CI 不应依赖 AutoDL 凭证或仓库 secrets。保持 `pull_request` 测试，不改用执行 PR 代码的 `pull_request_target` 来获取额外权限。

## 代码风格

- 中文注释和界面文案，注释说明「为什么」而不是复述代码。
- Rust：错误信息写给用户看，用中文说清楚原因和怎么办。
- 前端：颜色用 `src/styles.css` 里的变量，图标用 `src/icons.tsx`，交互组件优先复用 `src/ui.tsx`；只做浅色。

## 安全

- **不要**在 issue、PR、日志、截图或测试里贴出任何真实凭证（网页登录凭证、开发者 Token）。网页登录凭证等同于登录状态，泄露后请立即在 AutoDL 网页上退出登录让它失效；开发者 Token 请到控制台删除并重新生成。
- 安全问题请通过 [Security Advisory](https://github.com/tkzzzzzz6/autodl-lookout/security/advisories/new) 私下报告，不要公开提 issue。

## 关于 AutoDL 接口

本项目与 AutoDL 官方无关。库存和余额用的是 AutoDL 控制台网页自己调用的接口，不在官方开放 API 里，随时可能变化；发现接口变了，欢迎提 issue 附上新的返回格式（记得去掉凭证）。

## 许可

提交贡献即表示你同意你的代码以 [MIT 协议](./LICENSE) 发布。
