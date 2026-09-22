# VS Code MCP Server - Session Context

## What We Built
A VS Code extension that hosts an MCP (Model Context Protocol) HTTP server, exposing IDE features to AI coding agents. Built because Claude Code's VS Code extension has useful IDE features (active file tracking, LSP diagnostics, visual diffs) that aren't available without it.

## Current Status
- Extension is fully built and working
- Installed locally via VSIX for development and testing
- Server runs on `http://127.0.0.1:3333` (port is pinned by default — the address stays stable across restarts; a busy port now raises a clear error with the offending PID instead of silently drifting)
- Public tunnel: trycloudflare quick tunnels change URL every start (anonymous temporary tunnels — cannot be pinned in code). For a fixed public URL there are two supported modes: (a) **token tunnel** — the scalable option for distributing to hundreds of users, since the user needs no Cloudflare account, no domain and no login; the author owns one domain/account and issues one tunnel token per user. The token is stored in the **OS credential store** (command "Set Tunnel Token") or in an out-of-repo file referenced by `mcpServer.tunnelTokenFile`, and paired with `mcpServer.tunnelHostname`. It is deliberately **not** a settings field, so it can never be committed or Settings-Synced; cloudflared output is redacted before logging. (b) named tunnel (`mcpServer.tunnelName` + `mcpServer.tunnelHostname`) — user-managed, requires their own `cloudflared tunnel login / create / route dns`. (c) **localtunnel** (`mcpServer.tunnelProvider=localtunnel`) — zero account, zero domain, no cloudflared install; gives a fixed `https://<subdomain>.loca.lt/mcp`. loca.lt subdomains cannot be reserved, so the extension auto-generates an unguessable random subdomain persisted in `globalState` (stable across restarts, impractical to hijack). Measured end-to-end from a real network: GET and POST both return 200 with no interstitial. Also measured: `*.workers.dev` is **SNI-blocked** in mainland China (it fails even when DNS is bypassed via `--resolve` to a real Cloudflare edge IP, while the same IP returns 200 with a `cloudflare.com` SNI), so the workers.dev relay idea was rejected; `vercel.app` / `fly.dev` / `onrender.com` / `ngrok.io` / `cpolar.top` / `vicp.net` also timed out, while `loca.lt` / `serveo.net` / `ngrok-free.app` / `devtunnels.ms` / `pages.dev` are reachable
- All 27 tools tested and confirmed working
- LSP diagnostics confirmed working (caught a real TypeScript error during testing)
- Visual diff confirmed working via `show_diff` tool (opens native VS Code diff editor before writing)
- Claude Code connected via `~/.claude/mcp.json`

## MCP Config (already set up)
`~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "vscode": {
      "url": "http://127.0.0.1:3333/sse"
    }
  }
}
```

## Tools Exposed (27 total)
- `get_active_file` - current file path, content, language
- `get_selection` - current selection + cursor position
- `get_open_tabs` - all open tabs
- `get_diagnostics` - LSP errors/warnings (TS, ESLint etc)
- `show_diff` - opens native VS Code diff editor before writing (key feature)
- `read_file` / `write_file` / `create_file` / `delete_file` / `open_file`
- `run_terminal_command` - shell commands with stdout/stderr capture
- `find_references` / `go_to_definition` / `get_hover`
- `get_document_symbols` / `search_workspace_symbols`
- `get_code_actions` / `apply_code_action`
- `rename_symbol`
- `get_workspace_info`
- `get_git_status` / `get_git_diff`
- `execute_vscode_command` (requires allowlist in settings)

## Context Push (auto-push)
When enabled, automatically pushes `activeFile`, `selection`, and `diagnostics` events to connected SSE agents on change. Configured via `mcpServer.enableContextPush` setting.

## File Structure
```
vscode-mcp/
  src/
    extension.ts          # Entry point, activate/deactivate
    bridge/VsCodeBridge.ts # All VS Code API access
    server/HttpServer.ts   # HTTP + SSE transport
    tools/index.ts         # All 27 MCP tools registered here
    context/ContextPusher.ts # Auto-push events to agents
    config/Settings.ts     # VS Code settings wrapper
    tunnel/CloudflareTunnel.ts  # cloudflared 隧道（临时/令牌/命名）
    tunnel/LocaltunnelTunnel.ts # localtunnel（loca.lt）隧道
    types/git.d.ts         # Git extension type defs
    types/localtunnel.d.ts # localtunnel 类型声明
  .vscode/
    launch.json            # F5 dev mode config
    tasks.json             # Build task
  out/extension.js         # Built output (esbuild bundles to CJS)
  package.json
  tsconfig.json
  esbuild.config.js
  TESTING.md               # How to test the extension
  LICENSE
```

## Key Technical Details
- Uses `@modelcontextprotocol/sdk` SSE transport
- One McpServer instance per SSE connection (SDK design requirement)
- esbuild bundles everything to CJS (`format: 'cjs'`, `external: ['vscode']`)
- In-memory FS provider (`vscode-mcp-preview:` scheme) for diff previews
- Git integration via VS Code's built-in `vscode.git` extension API
- Terminal commands run via `child_process.exec` by default (captures output)

## What's Left To Do
- Publish to the VS Code Marketplace (needs a Microsoft publisher account + PAT)
- The `"publisher"` field in package.json must match the actual marketplace publisher ID

## How to Rebuild & Reinstall After Moving
```bash
cd /new/location/vscode-mcp
npm install
npm run build
npx vsce package --no-dependencies
# Then in VS Code: Cmd+Shift+P > Extensions: Install from VSIX
```

## How to Test
See TESTING.md for full curl-based test suite.
Quick health check: `curl http://127.0.0.1:3333/health`
