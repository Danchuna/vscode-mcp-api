import * as http from 'http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { VsCodeBridge } from '../bridge/VsCodeBridge.js'
import { ContextPusher } from '../context/ContextPusher.js'
import { TerminalManager } from '../terminal/TerminalManager.js'
import { registerTools } from '../tools/index.js'
import type { Settings } from '../config/Settings.js'
import { log } from '../utils/logger.js'

const MCP_INSTRUCTIONS = `你已连接到一个实时运行的 VS Code 实例。以下建议可帮助你充分利用这些工具：

写入文件：
- 在调用 write_file 或 create_file 之前，可先调用 show_diff，让用户在更改真正应用之前先在 VS Code 中可视化审查。

理解上下文：
- 当用户询问代码问题时，可调用 get_active_file 和 get_selection 查看用户当前正在查看的内容。
- 诊断错误时，get_diagnostics 提供的 LSP 错误往往比凭空猜测更准确。

浏览代码：
- go_to_definition 可定位符号的定义位置，通常比文本搜索更快。
- find_references 可帮助你评估一次更改的影响范围。
- get_document_symbols 可提供文件的结构概览。
- search_workspace_symbols 可在整个项目中定位类型、函数或类。

进行更改：
- rename_symbol 是重构安全且全工作区生效的——对标识符而言通常优于查找替换。
- 更改完成后，可再次调用 get_diagnostics 确认没有引入新错误。

运行命令：
- run_terminal_command 适合短命令（构建、测试、lint、安装）。

长时间运行的进程：
- spawn_terminal 专为持续运行的进程设计——开发服务器、watch 模式、docker compose、tail -f 等。
- list_terminals 显示所有托管终端以及它们是否仍在运行。
- read_terminal 可稍后查看输出，可只请求最后 N 行而不必读取整个缓冲区。
- write_terminal 向运行中的进程发送输入（例如回答提示、输入命令）。
- kill_terminal 停止进程并清理。
- 注意：run_terminal_command 在长时间运行的进程上会超时——请改用 spawn_terminal。

通用：
- 如果不清楚工作区根目录或技术栈，可在会话开始时调用 get_workspace_info 了解概况。
- VS Code 的原生工具（LSP、git、符号）通常比原始文件搜索更快、语义理解更强。`

interface SessionEntry {
  transport: SSEServerTransport
  unsubscribePush: () => void
}

export class HttpServer {
  private httpServer: http.Server
  private sessions = new Map<string, SessionEntry>()
  private actualPort = 0

  constructor(
    private bridge: VsCodeBridge,
    private pusher: ContextPusher,
    private settings: Settings,
    private terminalManager: TerminalManager,
  ) {
    this.httpServer = http.createServer(this.handleRequest.bind(this))
  }

  get connectionCount(): number {
    return this.sessions.size
  }

  get port(): number {
    return this.actualPort
  }

  async start(preferredPort: number): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const port = preferredPort + attempt
      try {
        await new Promise<void>((resolve, reject) => {
          this.httpServer.listen(port, '127.0.0.1', () => resolve())
          this.httpServer.once('error', reject)
        })
        this.actualPort = port
        return port
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      }
    }
    throw new Error(`无法绑定 ${preferredPort}-${preferredPort + 4} 范围内的任何端口`)
  }

  async stop(): Promise<void> {
    for (const [, session] of this.sessions) {
      session.unsubscribePush()
    }
    this.sessions.clear()
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()))
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    const token = this.settings.authToken
    if (!token) return true
    const header = req.headers['authorization'] ?? ''
    return header === `Bearer ${token}`
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        version: '0.2.8',
        connectedAgents: this.sessions.size,
        port: this.actualPort,
      }))
      return
    }

    if (!this.checkAuth(req)) {
      log.warn('服务器', `未授权的请求：${req.url}`)
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '未授权' }))
      return
    }

    if (req.url === '/sse' && req.method === 'GET') {
      await this.handleSse(req, res)
      return
    }

    if (req.url?.startsWith('/messages') && req.method === 'POST') {
      await this.handleMessages(req, res)
      return
    }

    if (req.url === '/mcp') {
      if (req.method === 'POST') {
        await this.handleMcp(req, res)
        return
      }
      // 无状态模式：不提供服务端推送流，也没有会话需要终止
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method Not Allowed：/mcp 仅支持 POST（无状态 Streamable HTTP）' },
        id: null,
      }))
      return
    }

    res.writeHead(404)
    res.end()
  }

  private async handleSse(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const transport = new SSEServerTransport('/messages', res)
    const sessionId = transport.sessionId

    // Create a new McpServer per connection (SDK design requires this)
    const mcpServer = this.createMcpServer()

    // Wire context push events, but gate on initialization
    let initialized = false
    const unsubscribePush = this.settings.enableContextPush
      ? this.pusher.onPush((type, payload) => {
          if (!initialized) return
          try {
            transport.send({
              jsonrpc: '2.0',
              method: 'notifications/message',
              params: {
                level: 'info',
                logger: 'vscode-mcp',
                data: { type, payload },
              },
            }).catch(() => undefined)
          } catch { /* connection may have closed */ }
        })
      : () => undefined

    this.sessions.set(sessionId, { transport, unsubscribePush })
    log.info('服务器', `SSE 会话已连接：${sessionId}（当前连接数：${this.sessions.size}）`)

    req.on('close', () => {
      const session = this.sessions.get(sessionId)
      if (session) {
        session.unsubscribePush()
        this.sessions.delete(sessionId)
        log.info('服务器', `SSE 会话已断开：${sessionId}（当前连接数：${this.sessions.size}）`)
      }
    })

    // Start connection — enable push notifications after a delay to allow handshake to complete
    setTimeout(() => { initialized = true }, 2000)
    await mcpServer.connect(transport)
  }

  private async handleMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let parsedBody: unknown
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    } catch {
      log.warn('服务器', '/mcp 收到非法 JSON 请求体')
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error: Invalid JSON' }, id: null }))
      return
    }

    // 无状态模式：每个请求独立 transport + McpServer，请求结束即销毁。
    // enableJsonResponse 强制 JSON 响应，不建立 SSE 流——可穿透缓冲长连接正文的网络环境（如部分 Cloudflare 隧道）。
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const mcpServer = this.createMcpServer()
    res.on('close', () => {
      void transport.close().catch(() => undefined)
      void mcpServer.close().catch(() => undefined)
    })

    try {
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, parsedBody)
    } catch (err) {
      log.error('服务器', '/mcp 请求处理失败', err)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }))
      } else {
        res.end()
      }
    }
  }

  private async handleMessages(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://localhost`)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const session = this.sessions.get(sessionId)

    if (!session) {
      log.warn('服务器', `未知会话的消息：${sessionId}`)
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '会话不存在' }))
      return
    }

    await session.transport.handlePostMessage(req, res)
  }

  /** 每个连接/请求创建一个 McpServer 实例（SDK 设计要求），/sse 与 /mcp 共用同一套工具注册 */
  private createMcpServer(): McpServer {
    const mcpServer = new McpServer(
      { name: 'vscode-mcp-bridge', version: '0.2.8' },
      { instructions: MCP_INSTRUCTIONS },
    )
    registerTools(mcpServer, this.bridge, this.settings, this.terminalManager)
    return mcpServer
  }
}
