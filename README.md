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
code --install-extension "vscode-mcp-api-1.0.1.vsix" --force
```

### 方式二：VS Code 界面安装

1. 打开扩展面板（`Ctrl+Shift+X`）
2. 点击面板右上角 `···` → **从 VSIX 安装**
3. 选择 `vscode-mcp-api-1.0.1.vsix`
4. **重新加载窗口**（`Ctrl+Shift+P` → “重新加载窗口”）

### 验证安装

窗口重载后，右下角状态栏会出现 `MCP :3333` 字样；也可以执行健康检查：

```powershell
curl http://127.0.0.1:3333/health
# {"status":"ok","version":"1.0.1","connectedAgents":0,"port":3333}
```

> 端口默认 3333，默认「固定端口」策略：地址 `http://127.0.0.1:3333` 重启后保持不变。若端口被占用会给出明确报错（含占用进程），不会悄悄顺延；如需旧版顺延行为，可开启 `mcpServer.portFallback`。

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

> **注意**：trycloudflare 临时隧道地址在每次重启后都会变化，以「MCP 桥接面板」显示的当前地址为准。

### 固定公网地址（给多个用户分发时必读）

trycloudflare 快速隧道是 Cloudflare 的**匿名临时隧道**，子域名每次启动随机生成，**代码层面无法固定**。要让地址永久不变，必须使用**令牌/命名隧道 + 固定域名**。

给几百人分发时，**不能让每个用户各自买域名或注册账号**。正确做法是：**由你（插件作者）持有 1 个域名 + 1 个 Cloudflare 账号，为每个用户预置一条隧道并发放令牌**。

| 模式 | 配置方式 | 用户端要求 | 地址是否固定 |
|---|---|---|---|
| **令牌隧道（推荐）** | 令牌存系统凭据库 + `mcpServer.tunnelHostname` | 只装 cloudflared，**无需账号 / 域名 / 登录** | ✅ 永久固定 `https://<hostname>/mcp` |
| 命名隧道（用户自建） | `mcpServer.tunnelName` + `mcpServer.tunnelHostname` | 自己完成 `cloudflared tunnel login / create / route dns` | ✅ 固定 |
| **localtunnel（零账号）** | `mcpServer.tunnelProvider=localtunnel` | 免安装 cloudflared，**无需账号 / 域名** | ✅ 固定 `https://<子域名>.loca.lt/mcp` |
| 临时隧道（默认） | 无 | 无 | ❌ 每次随机 |

**发号方（你）的一次性准备：**

1. 把一个域名托管到 Cloudflare（免费版即可）
2. 在 Cloudflare Zero Trust → Networks → Tunnels 为每个用户创建一条隧道：公网主机名填 `用户ID.mcp.你的域名`，服务指向 `http://127.0.0.1:3333`
3. 复制该隧道的**令牌**，连同主机名一起发给对应用户

**用户侧配置（令牌不写入 settings.json）：**

1. 命令面板运行「VS Code MCP 桥接：设置隧道令牌」（或点面板上的 🔑 按钮），粘贴令牌 —— 保存进**系统凭据库**
2. 在设置里填两项：

```json
{
  "mcpServer.tunnelHostname": "用户ID.mcp.你的域名",
  "mcpServer.enableCloudflareTunnel": true
}
```

> 批量/脚本部署可改用 `mcpServer.tunnelTokenFile`：把令牌写进**仓库之外**的文件（如 `~/.vscode-mcp/token`），设置里只填这个路径，令牌同样不进 settings.json。

之后地址永远是 `https://用户ID.mcp.你的域名/mcp`，重启、重装都不变。

#### 🔐 令牌安全（务必读完）

**开源本身不会泄露令牌**：仓库里只有设置项的**名字**，令牌是每个用户运行时的本地数据，不进代码、不进仓库。但下面这些才是真正的泄露途径：

| 泄露途径 | 后果 | 本项目的防范 |
|---|---|---|
| 用户把令牌写进**工作区** `.vscode/settings.json` 并提交 | 令牌随仓库公开 | 扩展**不提供 settings 里的令牌字段**，只走凭据库 / 仓库外文件 |
| 用户设置被 **Settings Sync** 同步到云端 | 令牌上传到账号云同步 | 令牌存**系统凭据库**（OS 钥匙串），默认路径 |
| 令牌出现在**日志 / 截图**里 | 被旁观者获取 | 扩展已对 cloudflared 输出做**令牌脱敏** |
| **你的 Cloudflare API Token** 被打进插件 | 整个账号沦陷 → 几百用户全泄 | 主凭据**只放在发号服务端**（如 Cloudflare Worker 的 secret），**绝不进插件代码** |

**为什么令牌这么敏感**：拿到隧道令牌的人可以自己起一个 connector 加入这条隧道；Cloudflare 会在多个 connector 间负载均衡，于是他就能**明文收到**该用户的 MCP 请求（含源码、终端命令，甚至 `Authorization` 里的 `authToken`）。所以必须：**一人一令牌**、可单独吊销、泄露后立刻在控制台删掉该隧道并重新签发。

> ⚠️ 令牌隧道下公网入口由你在 Cloudflare 侧配置（指向 `http://127.0.0.1:3333`），因此用户应**保持默认端口 3333**。
> 📌 Cloudflare 免费版的「隧道数量」与「单域名 DNS 记录数」都有配额上限，规模上到几百人前请先在账号内实测确认。
> 📌 若你的用户多数只是在本机用智能体（Claude Code / Cline 等），**根本不需要公网隧道**：本地固定地址 `http://127.0.0.1:3333/mcp` 永远不变、零成本、零暴露风险。

#### 📊 免费域名 / 隧道服务实机实测

在真实网络环境下逐个测试（DNS 解析 + TLS 握手 + HTTP 请求）：

| 平台 | 实测 | 能否固定地址 | 结论 |
|---|---|---|---|
| `*.trycloudflare.com` | ✅ 通 | ❌ 每次随机 | 默认方案 |
| **`*.loca.lt`（localtunnel）** | ✅ 通（GET / POST 均 200，**无拦截页**） | ✅ 可指定子域名 | **零账号可用（已内置）** |
| `*.serveo.net` | ✅ 通 | ⚠️ 可指定但不保证 | 备用 |
| `*.ngrok-free.app` | ✅ 通 | ✅ 免费含 1 个静态域名 | 需每人注册 |
| `*.devtunnels.ms` | ✅ 通 | ✅ 持久隧道 | 需每人注册（GitHub 登录） |
| `*.pages.dev` | ✅ 通 | ✅ 每项目永久子域名 | 只能托管发号 API，不能承载中继 |
| **`*.workers.dev`** | ❌ **SNI 直接被重置** | — | **国内不可用** |
| `vercel.app` / `fly.dev` / `onrender.com` / `ngrok.io` / `cpolar.top` / `vicp.net`（花生壳） | ❌ 超时 | — | 不可用 |

> **workers.dev 的判定依据**：先用 `--resolve` 绕过 DNS 直连真实 Cloudflare 边缘 IP，同一 IP 换 `cloudflare.com` SNI 返回 `200`，换 `workers.dev` SNI **立即失败** → 证明是 **SNI 阻断**（而非单纯 DNS 污染），所以 DoH / hosts 绕过无效。

#### ⚖️ localtunnel 模式的风险与取舍

- ✅ **优点**：零账号、零域名、免安装 cloudflared，地址固定，国内实测可用
- ⚠️ **子域名无法预留**：loca.lt 是先到先得的公共资源，隧道断开后别人可能抢注。**因此扩展默认自动生成不可猜测的随机子域名**（`mcp-<10 位随机>`，持久保存），把劫持风险降到实际不可行
- ⚠️ **第三方免费服务**：无 SLA、延迟约 1–3 秒/请求、可能限流。**给几百人做正式产品时，仍建议用上面的令牌隧道 + 自有域名**
- 🎯 **推荐定位**：个人自用、快速验证，或用户确实无法获得域名时的兜底方案

> 🐞 **已知坑（已修）**：loca.lt 在请求的子域名**当下不可用**时（被占用，或刚重启 VS Code 时上一条隧道还没在服务端释放）**不会报错，而是静默返回一个随机子域名**（形如 `brave-otter-12`），导致"固定地址"悄悄失效。
>
> **实测数据**：loca.lt 在隧道断开后**约 55–60 秒**才释放子域名（逐 5 秒探测：+5s…+50s 全部返回随机名，+55s 才拿回原名）。所以"刚重启就报子域名被占用"是**正常现象**，不是被别人抢了。
>
> **现在的行为**：扩展会**校验实际分配到的子域名**，不一致就关掉随机隧道并**每 5 秒重试、最多 18 次（约 85 秒，完整覆盖释放窗口）**，期间显示进度通知；仍拿不到才报错，并会**探测 `https://<子域名>.loca.lt/health` 判断占用者是谁**：
> - 返回本扩展的 `/health` → 是**你自己的另一个 VS Code 窗口**在占用（关掉它，或让每个窗口用不同子域名）
> - 返回别的内容 → 被**别人**占用，换名字
> - 无法访问 → 旧连接尚未超时释放，稍后再试
>
> 报错时还提供「**用随机地址启动**」按钮作为退路，绝不会把随机地址当成你的固定地址展示。

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
| `mcpServer.port` | `3333` | HTTP 端口。默认固定使用该端口，重启后地址不变；被占用时报错并提示占用进程 |
| `mcpServer.tunnelProvider` | `cloudflare` | 隧道实现：`cloudflare`（cloudflared）/ `localtunnel`（loca.lt，零账号零域名、免安装 cloudflared） |
| `mcpServer.tunnelSubdomain` | 空 | localtunnel 的固定子域名；留空 = 自动生成随机子域名并持久化（不可猜测，避免被抢注劫持） |
| `mcpServer.portFallback` | `false` | 端口被占用时顺延到相邻端口（会改变地址，仅需旧版行为时开启） |
| `mcpServer.tunnelTokenFile` | 空 | 令牌文件的路径（令牌本身存**系统凭据库**；批量部署可把令牌写到仓库外的文件，此处只填路径） |
| `mcpServer.tunnelName` | 空 | 命名隧道名称（用户自建）；与 `tunnelHostname` 一起设置后公网地址固定（需先在 `~/.cloudflared` 配置好） |
| `mcpServer.tunnelHostname` | 空 | 固定公网域名（如 `mcp.example.com`），外网地址固定为 `https://<hostname>/mcp` |
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
| VS Code MCP 桥接：设置隧道令牌 | 把隧道令牌存进系统凭据库（不写 settings.json） |
| VS Code MCP 桥接：清除隧道令牌 | 从系统凭据库删除隧道令牌 |
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
trycloudflare 临时隧道每次启动生成新随机地址，属正常现象。打开「MCP 桥接面板」复制最新地址即可。**要让地址永久固定**：推荐用令牌隧道（令牌存系统凭据库 + `mcpServer.tunnelHostname`，用户端无需账号/域名）；也可用户自建命名隧道（`mcpServer.tunnelName` + `mcpServer.tunnelHostname`，需先在 `~/.cloudflared` 完成 `cloudflared tunnel login / create <name> / route dns <name> <hostname>`）。

**Q：每次启动 MCP 本地地址都不一样？**
默认端口策略是「固定端口」：始终使用 `mcpServer.port`（默认 3333），不再自动顺延，重启后地址保持 `http://127.0.0.1:3333/…`。若端口被占用导致之前地址漂移，现在会弹出明确错误（含占用进程 PID），处理占用后地址即恢复固定。

**Q：如何查看运行日志？**
输出面板（`Ctrl+Shift+U`）选择「MCP 桥接」频道，包含服务器、隧道、工具调用的详细日志。

**Q：端口被占用？**
默认固定端口：启动失败时会提示占用进程（PID），可「打开端口设置 / 复制占用信息 / 重试」。如需旧版自动顺延行为，开启 `mcpServer.portFallback`；`/health` 返回中的 `port` 字段是实际端口。

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
code --install-extension "vscode-mcp-api-1.0.1.vsix" --force
```

### Option 2: Install from the VS Code UI

1. Open the Extensions view (`Ctrl+Shift+X`)
2. Click `···` in the top-right corner → **Install from VSIX...**
3. Select `vscode-mcp-api-1.0.1.vsix`
4. **Reload the window** (`Ctrl+Shift+P` → "Reload Window")

### Verify the installation

After reloading, `MCP :3333` appears in the status bar. You can also run a health check:

```powershell
curl http://127.0.0.1:3333/health
# {"status":"ok","version":"1.0.1","connectedAgents":0,"port":3333}
```

> The default port is 3333. By default the port is **pinned**: the URL `http://127.0.0.1:3333` stays stable across restarts. If the port is busy you get a clear error (with the offending process/PID) instead of a silent drift. Enable `mcpServer.portFallback` for the old auto-increment behavior.

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

> **Note:** the temporary trycloudflare tunnel URL changes on every restart (window reload / reboot / tunnel restart). Always use the URL currently shown in the MCP Bridge Panel.

### Fixed public URL (required reading when distributing to many users)

A trycloudflare quick tunnel is Cloudflare's **anonymous temporary tunnel**: the subdomain is random on every start and **cannot be pinned in code**. A permanent URL requires a **token/named tunnel + a fixed hostname**.

When distributing to hundreds of users, **you cannot ask every user to buy a domain or create an account**. The correct model is: **you (the extension author) hold one domain + one Cloudflare account, and pre-provision one tunnel per user, handing each user a token**.

| Mode | Configuration | User-side requirements | Stable URL? |
|---|---|---|---|
| **Token tunnel (recommended)** | token in the OS credential store + `mcpServer.tunnelHostname` | cloudflared only — **no account, no domain, no login** | ✅ permanently `https://<hostname>/mcp` |
| Named tunnel (user-managed) | `mcpServer.tunnelName` + `mcpServer.tunnelHostname` | user runs `cloudflared tunnel login / create / route dns` | ✅ fixed |
| **localtunnel (no account)** | `mcpServer.tunnelProvider=localtunnel` | no cloudflared install, **no account, no domain** | ✅ fixed `https://<subdomain>.loca.lt/mcp` |
| Quick tunnel (default) | none | none | ❌ random every start |

**One-time setup on your side (the issuer):**

1. Put a domain on Cloudflare (the free plan is enough)
2. In Cloudflare Zero Trust → Networks → Tunnels, create one tunnel per user: public hostname `user-id.mcp.your-domain`, service `http://127.0.0.1:3333`
3. Copy that tunnel's **token** and send it to the user together with the hostname

**User-side configuration (the token never goes into settings.json):**

1. Run "VS Code MCP Bridge: Set Tunnel Token" from the command palette (or click the 🔑 button in the panel) and paste the token — it is stored in the **OS credential store**
2. Set these two settings:

```json
{
  "mcpServer.tunnelHostname": "user-id.mcp.your-domain",
  "mcpServer.enableCloudflareTunnel": true
}
```

> For scripted/bulk deployment use `mcpServer.tunnelTokenFile` instead: write the token to a file **outside the repository** (e.g. `~/.vscode-mcp/token`) and put only that path in settings — the token still never enters settings.json.

From then on the URL is always `https://user-id.mcp.your-domain/mcp` — across restarts and reinstalls.

#### 🔐 Token security (please read)

**Open-sourcing does not leak tokens**: the repository only contains the *names* of settings; a token is per-user runtime data that never enters the code or the repo. These are the real leak vectors:

| Leak vector | Impact | Mitigation in this project |
|---|---|---|
| A user puts the token in **workspace** `.vscode/settings.json` and commits it | Token becomes public with the repo | The extension **no longer offers a token setting**; tokens go to the credential store or an out-of-repo file |
| User settings are synced by **Settings Sync** | Token uploaded to cloud sync | Token lives in the **OS credential store** (default path here) |
| Token shows up in **logs / screenshots** | Bystanders obtain it | cloudflared output is **redacted** before logging |
| **Your Cloudflare API token** ends up in the extension | Whole account compromised → every user leaked | The master credential lives **only server-side** (e.g. a Cloudflare Worker secret), **never in the extension code** |

**Why a tunnel token is so sensitive**: anyone holding it can run their own connector and join that tunnel. Cloudflare load-balances across connectors, so they can receive that user's MCP requests **in plaintext** — source code, terminal commands, even the `authToken` header. Therefore: **one token per user**, individually revocable, and on any leak delete that tunnel in the dashboard and re-issue.

> ⚠️ In token mode the public entry is configured on your Cloudflare side (pointing at `http://127.0.0.1:3333`), so users should **keep the default port 3333**.
> 📌 Cloudflare's free plan has quota limits on both the number of tunnels and DNS records per zone — verify in your account before scaling to hundreds of users.
> 📌 If most of your users only run agents locally (Claude Code, Cline, …), **no public tunnel is needed at all**: the local URL `http://127.0.0.1:3333/mcp` never changes and costs/exposes nothing.

#### 📊 Measured results for free domain / tunnel services

Tested one by one on a real network (DNS + TLS handshake + HTTP request):

| Platform | Result | Stable URL? | Verdict |
|---|---|---|---|
| `*.trycloudflare.com` | ✅ reachable | ❌ random each start | default |
| **`*.loca.lt` (localtunnel)** | ✅ reachable (GET/POST both 200, **no interstitial**) | ✅ custom subdomain | **usable with no account (built in)** |
| `*.serveo.net` | ✅ reachable | ⚠️ requestable, not guaranteed | fallback |
| `*.ngrok-free.app` | ✅ reachable | ✅ 1 free static domain | per-user signup |
| `*.devtunnels.ms` | ✅ reachable | ✅ persistent tunnel | per-user signup (GitHub) |
| `*.pages.dev` | ✅ reachable | ✅ permanent per-project subdomain | can host the issuer API only, not a relay |
| **`*.workers.dev`** | ❌ **SNI reset immediately** | — | **unusable in mainland China** |
| `vercel.app` / `fly.dev` / `onrender.com` / `ngrok.io` / `cpolar.top` / `vicp.net` | ❌ timeout | — | unusable |

> **How workers.dev was判定 / determined**: using `--resolve` to bypass DNS and connect straight to a real Cloudflare edge IP, the same IP returns `200` with a `cloudflare.com` SNI but fails **instantly** with a `workers.dev` SNI — i.e. **SNI blocking**, not merely DNS poisoning, so DoH/hosts workarounds do not help.

> ⚖️ **localtunnel trade-off**: zero account/domain/install and reachable, but loca.lt subdomains are first-come-first-served and cannot be reserved — hence the extension auto-generates an unguessable random subdomain by default. It is a free third-party service (no SLA, ~1–3 s per request), so for a product serving hundreds of users the token tunnel with your own domain is still the recommendation.

> 🐞 **Known pitfall (fixed)**: when the requested subdomain is not currently available (taken, or the previous tunnel has not been released server-side right after a VS Code restart), loca.lt does **not** error — it silently returns a random subdomain (e.g. `brave-otter-12`), which silently breaks the "fixed address" promise.
>
> **Measured**: loca.lt takes **about 55–60 s** to release a subdomain after the tunnel disconnects (probing every 5 s: +5 s…+50 s all returned random names, +55 s finally returned the original). So "subdomain busy right after a restart" is expected behaviour, not someone stealing your name.
>
> **Current behaviour**: the extension **verifies the assigned subdomain**, closes a mismatched tunnel, then **retries every 5 s up to 18 times (~85 s, fully covering the release window)** with a progress notification, and only then fails — after **probing `https://<subdomain>.loca.lt/health` to identify the holder**: our own `/health` means it is **your other VS Code window**, other content means **someone else**, and unreachable means an old connection has not timed out yet. The error also offers a **"start with a random address"** fallback button, and it never presents a random address as your fixed one.

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
| `mcpServer.port` | `3333` | HTTP port. Pinned by default — the address stays stable across restarts; a busy port raises a clear error with the offending process |
| `mcpServer.tunnelProvider` | `cloudflare` | Tunnel implementation: `cloudflare` (cloudflared) or `localtunnel` (loca.lt — no account, no domain, no cloudflared install) |
| `mcpServer.tunnelSubdomain` | empty | Fixed subdomain for localtunnel; empty = auto-generate a random one and persist it (unguessable, so it cannot be hijacked) |
| `mcpServer.portFallback` | `false` | Auto-increment to adjacent ports when busy (changes the address; enable only for legacy behavior) |
| `mcpServer.tunnelTokenFile` | empty | Path to a file holding the tunnel token (the token itself lives in the **OS credential store**; for scripted deployment keep the file outside the repo and set only its path) |
| `mcpServer.tunnelName` | empty | Named tunnel name (user-managed); together with `tunnelHostname` it gives a fixed public URL (requires a pre-configured named tunnel in `~/.cloudflared`) |
| `mcpServer.tunnelHostname` | empty | Fixed public hostname (e.g. `mcp.example.com`); the public URL becomes `https://<hostname>/mcp` |
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
| VS Code MCP Bridge: Set Tunnel Token | Store the tunnel token in the OS credential store (never in settings.json) |
| VS Code MCP Bridge: Clear Tunnel Token | Remove the tunnel token from the OS credential store |
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
Temporary tunnels (trycloudflare.com) generate a new random URL on every start. Open the MCP Bridge Panel and copy the latest one. **For a permanent URL**, use a token tunnel (token in the OS credential store + `mcpServer.tunnelHostname` — no account or domain needed on the user side), or a user-managed named tunnel (`mcpServer.tunnelName` + `mcpServer.tunnelHostname`, after `cloudflared tunnel login / create <name> / route dns <name> <hostname>`).

**Q: My local MCP address changes on every startup?**
The default port policy is pinned: the server always uses `mcpServer.port` (3333) and no longer auto-increments, so `http://127.0.0.1:3333/…` stays stable across restarts. If the port is busy you now get a clear error with the offending PID instead of a silent address change.

**Q: Where are the logs?**
Open the Output panel (`Ctrl+Shift+U`) and pick the "MCP 桥接" channel — it has detailed server, tunnel, and tool-call logs.

**Q: The port is already in use?**
The port is pinned by default: on failure the extension reports the blocking process (PID) with actions to open the port setting / copy the details / retry. Enable `mcpServer.portFallback` for the old auto-increment behavior; the `port` field in `/health` shows the actual port.

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
