import * as http from 'http'
import { execFile } from 'child_process'
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

/** 固定端口被占用：携带占用方信息，让上层提示用户处理，而不是悄悄换端口 */
export class PortInUseError extends Error {
  constructor(
    public readonly port: number,
    public readonly owner: string,
  ) {
    super(`端口 ${port} 已被 ${owner} 占用`)
    this.name = 'PortInUseError'
  }
}

/** 执行子进程并返回 stdout（失败返回 null，避免干扰主流程） */
function runCapture(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })
}

/** 找出占用某端口的进程描述（尽力而为，失败返回「未知进程」） */
async function findPortOwner(port: number): Promise<string> {
  try {
    if (process.platform === 'win32') {
      const netstat = await runCapture('netstat', ['-ano'])
      if (!netstat) return '未知进程'
      for (const line of netstat.split(/\r?\n/)) {
        const m = line.match(/\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
        if (m && Number(m[2]) === port) {
          const pid = m[3]
          const tasklist = await runCapture('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
          const name = tasklist?.split(',')[0]?.replace(/"/g, '') ?? ''
          return name ? `${name}（PID ${pid}）` : `PID ${pid}`
        }
      }
      return '未知进程'
    }
    // macOS / Linux
    const lsof = await runCapture('lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'])
    if (!lsof) return '未知进程'
    for (const line of lsof.split(/\r?\n/).slice(1)) {
      const m = line.match(/^\S+\s+(\d+)\s+(\S+)/)
      if (m) return `${m[2]}（PID ${m[1]}）`
    }
    return '未知进程'
  } catch {
    return '未知进程'
  }
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

  /**
   * 启动 HTTP 服务器。
   *
   * 默认「固定端口」：始终绑定 preferredPort，本地地址 http://127.0.0.1:<preferredPort>/…
   * 跨重启保持稳定。被占用时先在同端口短重试（吸收扩展宿主重启/旧进程退出竞态），
   * 仍失败则抛出 PortInUseError（含占用进程信息），由上层提示用户处理，绝不悄悄改地址。
   *
   * 仅当 fallback = true（mcpServer.portFallback）时，才按旧行为顺延到相邻端口（会改变地址）。
   */
  async start(preferredPort: number, fallback = false): Promise<number> {
    const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

    // 1) 固定端口，短重试吸收竞态
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await delay(250)
      try {
        await this.listen(preferredPort)
        this.actualPort = preferredPort
        log.info('服务器', `已固定绑定端口 ${preferredPort}（地址保持稳定）`)
        return preferredPort
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
        log.warn('服务器', `端口 ${preferredPort} 被占用（第 ${attempt + 1} 次尝试），稍后重试...`)
      }
    }

    // 2) 定位占用方
    const owner = await findPortOwner(preferredPort)

    // 3) 兼容旧行为：显式开启 portFallback 时顺延端口（会改变地址）
    if (fallback) {
      for (let offset = 1; offset < 5; offset++) {
        const port = preferredPort + offset
        try {
          await this.listen(port)
          this.actualPort = port
          log.warn('服务器', `端口 ${preferredPort} 被占用（${owner}），已顺延到 ${port}（mcpServer.portFallback=true）`)
          return port
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
        }
      }
    }

    throw new PortInUseError(preferredPort, owner)
  }

  /** 在指定端口上监听（成功/失败均只结算一次） */
  private listen(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.httpServer.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        this.httpServer.removeListener('error', onError)
        resolve()
      }
      this.httpServer.once('error', onError)
      this.httpServer.once('listening', onListening)
      this.httpServer.listen(port, '127.0.0.1')
    })
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
        version: __EXT_VERSION__,
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
      { name: 'vscode-mcp-bridge', version: __EXT_VERSION__ },
      { instructions: MCP_INSTRUCTIONS },
    )
    registerTools(mcpServer, this.bridge, this.settings, this.terminalManager)
    return mcpServer
  }
}
