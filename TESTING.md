# Testing the VS Code MCP Extension

## Prerequisites

- VS Code installed
- Node.js 20+
- The extension built (`npm run build` in this folder)

---

## Step 1: Run the Extension in Dev Mode

1. Open this folder in VS Code:
   ```
   code /path/to/vscode-mcp
   ```

2. Press `F5` to launch the Extension Development Host (a new VS Code window opens).

3. In the new window, check the status bar (bottom right) — you should see:
   ```
   📡 MCP :3333
   ```
   If you see an error, check the Debug Console in the original window.

---

## Step 2: Verify the Server is Running

Run this in a terminal:

```bash
curl http://127.0.0.1:3333/health
```

**Expected response:**
```json
{"status":"ok","version":"0.1.0","connectedAgents":0,"port":3333}
```

If this fails, the server didn't start. Check the port setting in VS Code settings (`mcpServer.port`).

---

## Step 3: Test SSE Connection

Open a terminal and connect to the SSE endpoint. Keep this running in the background — it stays open:

```bash
curl -N -H "Accept: text/event-stream" http://127.0.0.1:3333/sse
```

**Expected:** You should see SSE handshake data printed (JSON with `sessionId`). Note the `sessionId` from the response — you need it for Step 4.

The status bar in the Extension Development Host window should now show:
```
📡 MCP :3333 | 1 agent
```

---

## Step 4: List Available Tools

In a new terminal, send the MCP `tools/list` request. Replace `SESSION_ID` with the value from Step 3:

```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**Expected:** A JSON response listing all 20 tools (`get_active_file`, `get_diagnostics`, `show_diff`, etc.)

---

## Step 5: Test Core Tools

For each test below, replace `SESSION_ID` with your session ID from Step 3.

### Test: get_workspace_info
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_workspace_info","arguments":{}}}'
```
**Expected:** JSON with workspace folder paths and name.

---

### Test: get_open_tabs
Open a file in the Extension Development Host window first, then:
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_open_tabs","arguments":{}}}'
```
**Expected:** Array of open files with path, language, isDirty, isActive.

---

### Test: get_active_file
Click on an open file in the Extension Development Host window, then:
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_active_file","arguments":{}}}'
```
**Expected:** JSON with the file path, content, language, lineCount.

---

### Test: get_diagnostics
Open a file with known errors (e.g. a TypeScript file with a type error) in the Extension Development Host, wait a few seconds for the language server, then:
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_diagnostics","arguments":{}}}'
```
**Expected:** Array of diagnostic objects with `severity`, `message`, `filePath`, line numbers.

---

### Test: run_terminal_command
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"run_terminal_command","arguments":{"command":"echo hello && pwd"}}}'
```
**Expected:** `{"stdout":"hello\n/your/workspace\n","stderr":"","exitCode":0}`

---

### Test: read_file
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"read_file","arguments":{"filePath":"/absolute/path/to/any/file.ts"}}}'
```
**Expected:** JSON with `content`, `lineCount`, `language`.

---

### Test: show_diff (visual)
This opens the VS Code diff editor in the Extension Development Host window:
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"show_diff","arguments":{"filePath":"/absolute/path/to/any/file.ts","newContent":"// Modified by MCP\nconsole.log(\"hello\")\n","title":"Test Diff"}}}'
```
**Expected:** The diff editor opens in the Extension Development Host window showing the original vs proposed content. No file is written.

---

### Test: get_git_status
Run in a folder that has a git repo open in the Extension Development Host:
```bash
curl -s -X POST "http://127.0.0.1:3333/messages?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_git_status","arguments":{}}}'
```
**Expected:** JSON with `branch`, `staged`, `unstaged`, `untracked` arrays.

---

## Step 6: Test Context Push (Auto-Push)

With the SSE connection open from Step 3, watch the terminal output while you:

1. **Switch files** in the Extension Development Host — you should see a `activeFile` push event appear in the SSE stream
2. **Change your selection** — you should see a `selection` push event
3. **Introduce a type error** in a TypeScript file — after a few seconds you should see a `diagnostics` push event

Push events look like:
```
data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","logger":"vscode-mcp","data":{"type":"activeFile","payload":{...}}}}
```

---

## Step 7: Test Auth (Optional)

Set `mcpServer.authToken` to `"testtoken"` in VS Code settings, then restart the server.

Without token (should fail):
```bash
curl http://127.0.0.1:3333/health  # health is unprotected, should still work
curl -N http://127.0.0.1:3333/sse  # should return 401
```

With token (should work):
```bash
curl -N -H "Authorization: Bearer testtoken" http://127.0.0.1:3333/sse
```

---

## Quick Smoke Test Script

Save as `test.sh` and run with your session ID: `bash test.sh SESSION_ID`

```bash
#!/bin/bash
SESSION=$1
BASE="http://127.0.0.1:3333"

echo "=== Health ==="
curl -s $BASE/health | python3 -m json.tool

echo -e "\n=== Tools List ==="
curl -s -X POST "$BASE/messages?sessionId=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python3 -c "import sys,json; tools=json.load(sys.stdin); [print('-', t['name']) for t in tools.get('result',{}).get('tools',[])]"

echo -e "\n=== Workspace Info ==="
curl -s -X POST "$BASE/messages?sessionId=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_workspace_info","arguments":{}}}' \
  | python3 -m json.tool

echo -e "\n=== Active File ==="
curl -s -X POST "$BASE/messages?sessionId=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_active_file","arguments":{}}}' \
  | python3 -m json.tool

echo -e "\n=== Terminal Command (echo test) ==="
curl -s -X POST "$BASE/messages?sessionId=$SESSION" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"run_terminal_command","arguments":{"command":"echo MCP_TEST_OK"}}}' \
  | python3 -m json.tool

echo -e "\nDone."
```

---

## Connecting to Claude Code or Another Agent

Add to your MCP config (e.g. `~/.claude/mcp.json` or `.mcp.json` in your project):

```json
{
  "mcpServers": {
    "vscode": {
      "url": "http://127.0.0.1:3333/sse"
    }
  }
}
```

Then the tools will be available as `mcp__vscode__get_active_file`, `mcp__vscode__get_diagnostics`, etc.
