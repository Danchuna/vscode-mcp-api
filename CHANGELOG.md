# 更新日志 / Changelog

**中文** | [English](#changelog-en)

本项目的所有重要变更都会记录在此文件中。
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-09-23

### 新增

- **固定端口策略**：`mcpServer.port` 默认严格绑定，本地地址 `http://127.0.0.1:3333/...` 跨重启不再漂移；端口被占用时给出占用进程（PID）以及「打开端口设置 / 复制占用信息 / 重试」操作，旧版自动顺延行为移入 `mcpServer.portFallback`（默认关闭）
- **令牌隧道（固定公网地址）**：新增 `mcpServer.tunnelTokenFile`，配合 `mcpServer.tunnelHostname` 运行 `cloudflared tunnel run --token`，用户端无需 Cloudflare 账号 / 域名 / 登录
- **localtunnel 隧道（零账号、零域名）**：新增 `mcpServer.tunnelProvider`（`cloudflare` / `localtunnel`）与 `mcpServer.tunnelSubdomain`，可得到固定地址 `https://<子域名>.loca.lt/mcp`，且免安装 cloudflared
- **新命令**：「设置隧道令牌」「清除隧道令牌」；管理面板新增 🔑 按钮与隧道令牌状态显示

### 修复

- **本地地址每次启动都不一样**：根因是端口被占用时静默顺延到 3334–3337，导致 MCP 地址漂移
- **loca.lt 静默降级**：请求的固定子域名当下不可用时，loca.lt 不报错而是返回一个随机子域名，使「固定地址」悄悄失效。现在会校验实际分配到的子域名并自动重试（每 5 秒 × 18 次 ≈ 85 秒，覆盖实测的 55–60 秒释放窗口），仍失败则明确报错，不再把随机地址当成固定地址展示
- **子域名占用者诊断**：失败时探测 `https://<子域名>.loca.lt/health`，区分「你自己的另一个 VS Code 窗口」「被别人占用」「旧连接尚未超时释放」，并提供「用随机地址启动」退路

### 安全

- **隧道令牌不再是设置项**：改存 VS Code 系统凭据库（SecretStorage），无法被 Settings Sync 同步或被 git 提交；cloudflared 输出中的令牌会先脱敏再写入日志

### 文档

- README 新增「固定公网地址（给多个用户分发时必读）」「令牌安全」与「免费域名 / 隧道服务实机实测」章节

## [1.0.0] - 2026-09-15

首个公开版本。基于 MIT 协议的开源项目
[vscode-mcp-bridge](https://github.com/jhamama/vscode-mcp-bridge) 二次开发。

### 新增

- **27 个 MCP 工具**：上下文感知、文件读写、LSP 导航、重构/快速修复、终端管理
- **双传输端点**：`/sse`（经典 SSE）与 `/mcp`（Streamable HTTP，远程/代理环境推荐）
- **cloudflared 外网隧道**：一键把本机 VS Code 暴露到公网，支持 winget 自动安装引导
- **MCP 桥接面板**：实时显示外网地址，一键复制地址 / 复制关键提示词
- **可选 Bearer Token 鉴权**与 `execute_vscode_command` 命令白名单
- **GitHub Actions 工作流**：推送自动做类型检查 + 编译 + 打包 VSIX，打 tag 自动发 Release
- **中英双语文档**：README 与 CHANGELOG 均提供简体中文与 English 两个版本

### 变更

- 项目名统一为 `vscode-mcp-api`（扩展 ID：`jhamama.vscode-mcp-api`）
- 版本号改为构建时从 `package.json` 注入（`__EXT_VERSION__`），消除多处硬编码导致的版本漂移

### 安全

- 公网隧道 + 未设置 `mcpServer.authToken` 时，扩展会主动弹出安全警告
- `execute_vscode_command` 默认全部禁止，仅执行白名单内的命令

---

<a id="changelog-en"></a>

# Changelog

[中文](#更新日志--changelog) | **English**

All notable changes to this project are recorded in this file.
Versioning follows [Semantic Versioning 2.0.0](https://semver.org/).

## [1.0.1] - 2026-09-23

### Added

- **Pinned port policy**: `mcpServer.port` is now strictly honoured, so the local address `http://127.0.0.1:3333/...` no longer drifts across restarts; a busy port reports the owning process (PID) with "open port settings / copy details / retry" actions. The legacy auto-increment behaviour moved to `mcpServer.portFallback` (off by default)
- **Token tunnel (fixed public URL)**: new `mcpServer.tunnelTokenFile`, paired with `mcpServer.tunnelHostname`, runs `cloudflared tunnel run --token` — no Cloudflare account, domain or login needed on the user side
- **localtunnel provider (no account, no domain)**: new `mcpServer.tunnelProvider` (`cloudflare` / `localtunnel`) and `mcpServer.tunnelSubdomain`, giving a fixed `https://<subdomain>.loca.lt/mcp` without installing cloudflared
- **New commands**: "Set Tunnel Token" and "Clear Tunnel Token"; the panel gained a 🔑 button and a tunnel-token status indicator

### Fixed

- **Local address changed on every startup**: caused by silently falling back to ports 3334–3337 when the configured port was busy
- **loca.lt silent downgrade**: when the requested subdomain is momentarily unavailable, loca.lt returns a random subdomain instead of failing, which silently broke the "fixed address" promise. The extension now verifies the assigned subdomain and retries (every 5 s × 18 ≈ 85 s, covering the measured 55–60 s release window), then fails loudly instead of presenting a random address as your fixed one
- **Subdomain holder diagnostics**: on failure it probes `https://<subdomain>.loca.lt/health` to distinguish "your own other VS Code window", "taken by someone else" and "old connection not yet timed out", and offers a "start with a random address" fallback

### Security

- **The tunnel token is no longer a setting**: it is stored in the VS Code OS credential store (SecretStorage), so it cannot be Settings-Synced or committed; tokens in cloudflared output are redacted before logging

### Docs

- README gained "Fixed public URL (required reading when distributing to many users)", "Token security" and "Measured results for free domain / tunnel services" sections

## [1.0.0] - 2026-09-15

First public release. Derived from the MIT-licensed open-source project
[vscode-mcp-bridge](https://github.com/jhamama/vscode-mcp-bridge).

### Added

- **27 MCP tools**: context awareness, file read/write, LSP navigation, refactor/quick fix, terminal management
- **Dual transport endpoints**: `/sse` (classic SSE) and `/mcp` (Streamable HTTP, recommended for remote or proxied setups)
- **Cloudflare tunnel**: expose your local VS Code to the internet with one click, with guided `winget` installation
- **MCP Bridge Panel**: live public URL with one-click copy for the URL and the starter prompt
- **Optional Bearer token auth** and an allowlist for `execute_vscode_command`
- **GitHub Actions workflow**: type check + build + VSIX packaging on every push, automatic Release on tag push
- **Bilingual docs**: both README and CHANGELOG ship in Simplified Chinese and English

### Changed

- Renamed the project to `vscode-mcp-api` (extension ID: `jhamama.vscode-mcp-api`)
- The version is now injected at build time from `package.json` (`__EXT_VERSION__`), removing hardcoded duplicates

### Security

- The extension warns you when a public tunnel is running without `mcpServer.authToken`
- `execute_vscode_command` denies everything by default; only allowlisted commands run
