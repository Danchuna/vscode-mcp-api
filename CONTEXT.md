# VS Code MCP Server - Session Context

## What We Built
A VS Code extension that hosts an MCP (Model Context Protocol) HTTP server, exposing IDE features to AI coding agents. Built because Claude Code's VS Code extension has useful IDE features (active file tracking, LSP diagnostics, visual diffs) that aren't available without it.

## Current Status
- Extension is fully built and working
- Installed in Julian's current VS Code instance via VSIX
- Server runs on `http://127.0.0.1:3333`
- All 23 tools tested and confirmed working
- LSP diagnostics confirmed working (caught a `useAuth` TS error in $slug.tsx)
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

## Tools Exposed (23 total)
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
    tools/index.ts         # All 23 MCP tools registered here
    context/ContextPusher.ts # Auto-push events to agents
    config/Settings.ts     # VS Code settings wrapper
    types/git.d.ts         # Git extension type defs
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
- Add an `icon.png` (128x128px) for marketplace listing
- Create GitHub repo and push (gh CLI not installed, needs `brew install gh`)
- Update `package.json` repository URL to actual GitHub URL once created
- Publish to VS Code Marketplace (needs Microsoft publisher account + PAT)
- The `"publisher": "jhamama"` in package.json needs to match the actual marketplace publisher ID

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
