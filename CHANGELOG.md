# 更新日志 / Changelog

**中文** | [English](#changelog-en)

本项目的所有重要变更都会记录在此文件中。
版本号遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)。

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
