# vscode-mcp-api（VS Code MCP 桥接）
> bilibili视频教程 https://www.bilibili.com/video/BV1FMeW6RE1J
> 
> 用户 QQ 交流群：611067889
> 
> 注意！所有能够调用 MCP 的 AI 都可以使用本插件，本插件正在持续更新中。开源不易，请点个 Star 支持。




**中文** | [English](#english)

> 本项目基于开源项目 [vscode-mcp-bridge](https://github.com/jhamama/vscode-mcp-bridge) 完成。
> This project is based on the open-source project [vscode-mcp-bridge](https://github.com/jhamama/vscode-mcp-bridge).

---

把正在运行的 **VS Code 实例**通过 MCP（Model Context Protocol）暴露给 AI 智能体：智能体可以读写文件、查看 LSP 诊断、执行终端命令、操作 git、进行重构——就像坐在你电脑前一样。

## 功能特性

- **27 个 MCP 工具**：文件读写、可视化 Diff、LSP（诊断/定义/引用/悬停/符号）、全工作区重构、终端管理、git 状态等
- **双传输端点**：`/sse`（本地经典 SSE）+ `/mcp`（Streamable HTTP 无状态，远程/代理环境推荐）
- **内置 cloudflared 外网隧道**：一键把本机 VS Code 暴露到公网（trycloudflare.com），让网页版/其它电脑上的智能体接入
- **「MCP 桥接面板」**：真实输入框显示当前外网地址（自动刷新），真按钮一键复制地址 / 复制关键提示词
- **可选 Bearer Token 鉴权**与命令白名单，控制访问面
- 扩展随 VS Code 启动自动运行，无需手动开启

---

## 安装

### 方式一：命令行安装 VSIX

```powershell
code --install-extension "vscode-mcp-api-1.0.0.vsix" --force
```

### 方式二：VS Code 界面安装

1. 打开扩展面板（`Ctrl+Shift+X`）
2. 点击面板右上角 `···` → **从 VSIX 安装**
3. 选择 `vscode-mcp-api-1.0.0.vsix`
4. **重新加载窗口**（`Ctrl+Shift+P` → “重新加载窗口”）

### 验证安装

窗口重载后，右下角状态栏会出现 `MCP :3333` 字样；也可以执行健康检查：

```powershell
curl http://127.0.0.1:3333/health
# {"status":"ok","version":"1.0.0","connectedAgents":0,"port":3333}
```

> 端口默认 3333，如被占用会自动尝试 3333–3337。

---

## 使用一：本地智能体接入（同一台电脑）

给本机的 MCP 客户端（Claude Code、Cline、其它支持 MCP 的工具）配置：

| 端点 | 地址 | 说明 |
|---|---|---|
| Streamable HTTP（推荐） | `http://127.0.0.1:3333/mcp` | 纯请求-响应，兼容性最好 |
| SSE（经典） | `http://127.0.0.1:3333/sse` | 旧版传输，本地同样可用 |

配置示例（`~/.claude/mcp.json` 或支持 `mcpServers` 的客户端）：

```json
{
  "mcpServers": {
    "vscode": {
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

配置好后对智能体说“连接 MCP 并列出可用工具”，即可看到全部 27 个工具。

## 使用二：远程智能体接入（网页版/其它电脑）

1. **开启外网隧道**（三种方式任选）：
   - 设置中勾选 `mcpServer.enableCloudflareTunnel`（服务器启动时自动开启）
   - 点击状态栏「外网隧道」按钮一键开启/关闭
   - 命令面板运行「VS Code MCP 桥接：启动/停止外网隧道」
2. 首次使用需安装 cloudflared，扩展会提示 `winget` 自动安装或给出下载直链
3. 隧道建立后弹出通知，点击通知上的 **「打开面板」** 按钮
4. 在「MCP 桥接面板」中点击 **「📋 复制关键提示词」**，得到：

```
https://xxxx-xxxx-xxxx.trycloudflare.com/mcp

请你连接使用这个MCP，了解里面的可以用的工具，然后接下来所有对话都需要使用MCP里面的工具进行完成
```

5. 把上面内容直接粘贴给远程智能体（网页聊天、其它电脑上的模型）即可接入

> **⚠️ 远程必须使用 `/mcp` 端点。** 部分网络环境（含部分 Cloudflare 隧道线路）会缓冲 SSE 长连接的正文，表现为“`/sse` 返回 200 但收不到 endpoint 事件”；`/mcp` 是无状态纯请求-响应，可正常穿透。

> **注意**：临时隧道地址在每次重启（重载窗口/重启电脑/重启隧道）后都会变化，以「MCP 桥接面板」显示的当前地址为准。

### 「MCP 桥接面板」入口

- 命令面板运行「VS Code MCP 桥接：打开管理面板」
- 点击状态栏 `MCP :3333` → 「打开管理面板」
- 隧道开启通知上的「打开面板」按钮

面板内含：服务器/隧道状态、外网地址输入框（自动刷新）、「复制地址」「复制关键提示词」按钮、本地地址复制。

---

## 设置项

在 VS Code 设置中搜索 `mcpServer`：

| 设置 | 默认值 | 说明 |
|---|---|---|
| `mcpServer.port` | `3333` | HTTP 端口（占用时自动顺延到 3333–3337） |
| `mcpServer.authToken` | 空 | HTTP Bearer 令牌；留空不鉴权 |
| `mcpServer.enableContextPush` | `true` | 自动把活动文件/选区/诊断推送给已连接的智能体 |
| `mcpServer.enableCloudflareTunnel` | `false` | 服务器启动时自动开启外网隧道 |
| `mcpServer.terminalStrategy` | `childProcess` | 终端命令执行方式（`childProcess` 可靠捕获输出 / `shellIntegration` 在终端面板显示） |
| `mcpServer.allowedCommands` | `[]` | `execute_vscode_command` 工具允许执行的 VS Code 命令白名单（留空全部禁止） |

## 全部命令

| 命令 | 功能 |
|---|---|
| VS Code MCP 桥接：启动服务器 | 启动本地 HTTP 服务器 |
| VS Code MCP 桥接：停止服务器 | 停止服务器与隧道 |
| VS Code MCP 桥接：重启服务器 | 重启 |
| VS Code MCP 桥接：复制连接地址 | 复制本地 `/sse` 地址 |
| VS Code MCP 桥接：启动/停止外网隧道 | 一键开关公网隧道 |
| VS Code MCP 桥接：显示/复制外网地址 | 输入框显示当前公网地址，回车复制 |
| VS Code MCP 桥接：复制关键提示词 | 复制「地址 + 使用指令」提示词 |
| VS Code MCP 桥接：打开管理面板 | 打开 MCP 桥接面板 |
| VS Code MCP 桥接：查看状态 / 选项 | 状态栏菜单 |

---

## 工具列表（27 个）

| 类别 | 工具 |
|---|---|
| 上下文感知 | `get_active_file` `get_selection` `get_open_tabs` `get_diagnostics` `get_workspace_info` |
| 文件操作 | `read_file` `write_file` `create_file` `delete_file` `open_file` `close_file` `show_diff`（写入前可视化 Diff 预览） |
| LSP 导航 | `go_to_definition` `find_references` `get_hover` `get_document_symbols` `search_workspace_symbols` |
| 重构/快速修复 | `get_code_actions` `apply_code_action` `rename_symbol` |
| 终端（短命令） | `run_terminal_command`（带超时，捕获输出） |
| 终端（长进程） | `spawn_terminal` `list_terminals` `read_terminal` `write_terminal` `kill_terminal` |
| 其它 | `execute_vscode_command`（需白名单） |

## 安全须知

- **公网隧道 + 无鉴权 = 任何拿到地址的人都能操作你的 VS Code**（含执行终端命令）。强烈建议设置 `mcpServer.authToken`，并在远程客户端配置中携带请求头：`"Authorization": "Bearer <你的令牌>"`
- `execute_vscode_command` 默认全部禁止，仅执行 `allowedCommands` 白名单中的命令
- 临时隧道地址虽是随机词组，但一旦泄露给他人即等同交出控制权，请勿公开分享

## 常见问题

**Q：远程连 `/sse` 返回 200，却一直收不到 `endpoint` 事件？**
隧道线路缓冲了 SSE 正文。远程一律改用 `/mcp` 端点（无状态请求-响应），本地两种端点均可。

**Q：隧道地址变了，之前的地址失效？**
临时隧道（trycloudflare.com）每次启动生成新随机地址，属正常现象。打开「MCP 桥接面板」复制最新地址即可。

**Q：如何查看运行日志？**
输出面板（`Ctrl+Shift+U`）选择「MCP 桥接」频道，包含服务器、隧道、工具调用的详细日志。

**Q：端口被占用？**
自动顺延 3333–3337；`/health` 返回中的 `port` 字段是实际端口。

## 从源码构建

```bash
npm install
npm run typecheck                  # 类型检查
npm run build                      # esbuild 打包到 out/extension.js
npx vsce package --no-dependencies # 生成 VSIX
```

---

<a id="english"></a>

# vscode-mcp-api (VS Code MCP Bridge)

[中文](#vscode-mcp-apivs-code-mcp-桥接) | **English**

Expose your **running VS Code instance** to AI agents over MCP (Model Context Protocol): agents can read and write files, inspect LSP diagnostics, run terminal commands, work with git, and refactor — as if they were sitting at your computer.

## Features

- **27 MCP tools**: file I/O, visual diff, LSP (diagnostics / definition / references / hover / symbols), workspace-wide refactoring, terminal management, git status and more
- **Dual transport endpoints**: `/sse` (classic SSE for local use) and `/mcp` (stateless Streamable HTTP, recommended for remote or proxied setups)
- **Built-in Cloudflare tunnel**: expose your local VS Code to the public internet (trycloudflare.com) with one click, so web-based or remote agents can connect
- **MCP Bridge Panel**: shows the current public URL in a real input box (auto-refreshing) with one-click buttons to copy the URL or the starter prompt
- **Optional Bearer token auth** and a command allowlist to control the attack surface
- Starts automatically with VS Code — no manual startup needed

---

## Installation

### Option 1: Install the VSIX from the command line

```powershell
code --install-extension "vscode-mcp-api-1.0.0.vsix" --force
```

### Option 2: Install from the VS Code UI

1. Open the Extensions view (`Ctrl+Shift+X`)
2. Click `···` in the top-right corner → **Install from VSIX...**
3. Select `vscode-mcp-api-1.0.0.vsix`
4. **Reload the window** (`Ctrl+Shift+P` → "Reload Window")

### Verify the installation

After reloading, `MCP :3333` appears in the status bar. You can also run a health check:

```powershell
curl http://127.0.0.1:3333/health
# {"status":"ok","version":"1.0.0","connectedAgents":0,"port":3333}
```

> The default port is 3333. If it is taken, ports 3333–3337 are tried automatically.

---

## Usage 1: Local agents (same machine)

Configure your local MCP client (Claude Code, Cline, or any MCP-capable tool):

| Endpoint | URL | Notes |
|---|---|---|
| Streamable HTTP (recommended) | `http://127.0.0.1:3333/mcp` | Pure request-response, best compatibility |
| SSE (classic) | `http://127.0.0.1:3333/sse` | Legacy transport, also works locally |

Example config (`~/.claude/mcp.json` or any client supporting `mcpServers`):

```json
{
  "mcpServers": {
    "vscode": {
      "url": "http://127.0.0.1:3333/mcp"
    }
  }
}
```

Then tell the agent "connect to the MCP server and list available tools" — all 27 tools will show up.

## Usage 2: Remote agents (web UI / another machine)

1. **Start the public tunnel** (pick one):
   - Enable `mcpServer.enableCloudflareTunnel` in settings (starts with the server)
   - Click the "Public Tunnel" button in the status bar
   - Run "VS Code MCP Bridge: Start/Stop Public Tunnel" from the command palette
2. On first use you need `cloudflared`; the extension offers automatic `winget` install or a direct download link
3. Once the tunnel is up, a notification appears — click **"Open Panel"** on it
4. In the MCP Bridge Panel, click **"📋 Copy Starter Prompt"**:

```
https://xxxx-xxxx-xxxx.trycloudflare.com/mcp

Please connect to this MCP server, learn which tools it provides, and use those MCP tools for everything in this conversation.
```

5. Paste that text to the remote agent (web chat, a model on another machine) and it will connect

> **⚠️ Always use the `/mcp` endpoint remotely.** Some networks (including certain Cloudflare tunnel routes) buffer SSE response bodies, so `/sse` returns 200 but no `endpoint` event ever arrives. `/mcp` is stateless request-response and traverses fine.

> **Note:** the temporary tunnel URL changes on every restart (window reload / reboot / tunnel restart). Always use the URL currently shown in the MCP Bridge Panel.

### Opening the MCP Bridge Panel

- Run "VS Code MCP Bridge: Open Management Panel" from the command palette
- Click `MCP :3333` in the status bar → "Open Management Panel"
- Click "Open Panel" on the tunnel notification

The panel shows server/tunnel status, the public URL (auto-refreshing), buttons to copy the URL or the starter prompt, and local URL copy.

---

## Settings

Search for `mcpServer` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `mcpServer.port` | `3333` | HTTP port (auto-increments through 3333–3337 if taken) |
| `mcpServer.authToken` | empty | HTTP Bearer token; empty means no auth |
| `mcpServer.enableContextPush` | `true` | Push active file / selection / diagnostics to connected agents |
| `mcpServer.enableCloudflareTunnel` | `false` | Start the public tunnel automatically with the server |
| `mcpServer.terminalStrategy` | `childProcess` | How terminal commands run (`childProcess` captures output reliably / `shellIntegration` shows them in the terminal panel) |
| `mcpServer.allowedCommands` | `[]` | Allowlist of VS Code commands for `execute_vscode_command` (empty = all denied) |

## All commands

| Command | Description |
|---|---|
| VS Code MCP Bridge: Start Server | Start the local HTTP server |
| VS Code MCP Bridge: Stop Server | Stop server and tunnel |
| VS Code MCP Bridge: Restart Server | Restart |
| VS Code MCP Bridge: Copy Connection URL | Copy the local `/sse` URL |
| VS Code MCP Bridge: Start/Stop Public Tunnel | Toggle the public tunnel |
| VS Code MCP Bridge: Show/Copy Public URL | Show the current public URL, press Enter to copy |
| VS Code MCP Bridge: Copy Starter Prompt | Copy "URL + instructions" prompt |
| VS Code MCP Bridge: Open Management Panel | Open the MCP Bridge Panel |
| VS Code MCP Bridge: Show Status / Options | Status bar menu |

---

## Tool list (27 tools)

| Category | Tools |
|---|---|
| Context awareness | `get_active_file` `get_selection` `get_open_tabs` `get_diagnostics` `get_workspace_info` |
| File operations | `read_file` `write_file` `create_file` `delete_file` `open_file` `close_file` `show_diff` (visual diff preview before writing) |
| LSP navigation | `go_to_definition` `find_references` `get_hover` `get_document_symbols` `search_workspace_symbols` |
| Refactor / quick fix | `get_code_actions` `apply_code_action` `rename_symbol` |
| Terminal (short commands) | `run_terminal_command` (with timeout, captures output) |
| Terminal (long-running) | `spawn_terminal` `list_terminals` `read_terminal` `write_terminal` `kill_terminal` |
| Misc | `execute_vscode_command` (allowlist required) |

## Security notes

- **Public tunnel + no auth = anyone with the URL can control your VS Code** (including running terminal commands). Always set `mcpServer.authToken` and send the header from the remote client: `"Authorization": "Bearer <your-token>"`
- `execute_vscode_command` denies everything by default; only commands in `allowedCommands` run
- The temporary tunnel URL is a random phrase, but leaking it means handing over control — never share it publicly

## FAQ

**Q: `/sse` returns 200 remotely but the `endpoint` event never arrives?**
The tunnel buffers the SSE body. Use the `/mcp` endpoint remotely (stateless request-response). Both endpoints work locally.

**Q: My tunnel URL changed and the old one stopped working?**
Temporary tunnels (trycloudflare.com) generate a new random URL on every start. Open the MCP Bridge Panel and copy the latest one.

**Q: Where are the logs?**
Open the Output panel (`Ctrl+Shift+U`) and pick the "MCP 桥接" channel — it has detailed server, tunnel, and tool-call logs.

**Q: The port is already in use?**
It auto-increments through 3333–3337; the `port` field in `/health` shows the actual port.

## Build from source

```bash
npm install
npm run typecheck                  # type check
npm run build                      # bundle to out/extension.js with esbuild
npx vsce package --no-dependencies # produce the VSIX
```

---

本项目基于开源项目 [vscode-mcp-bridge](https://github.com/jhamama/vscode-mcp-bridge) 完成。
This project is based on the open-source project [vscode-mcp-bridge](https://github.com/jhamama/vscode-mcp-bridge).
