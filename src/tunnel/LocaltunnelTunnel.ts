import localtunnel = require('localtunnel')
import { log } from '../utils/logger.js'

/** 建立隧道的最长等待时间 */
const URL_TIMEOUT_MS = 45_000

/** 子域名规则：loca.lt 只接受字母、数字、连字符 */
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{2,62}$/i

/**
 * 请求的固定子域名未被接受时的重试参数。
 *
 * 实测（2025 实机）：loca.lt 在隧道连接关闭后，**约需 55–60 秒**才释放子域名；
 * 在此之前请求同名子域名不会报错，而是被**静默降级**成一个随机子域名。
 * 因此重试窗口必须覆盖这段释放时间：18 次 × 5 秒 ≈ 85 秒。
 */
const SUBDOMAIN_RETRIES = 18
const SUBDOMAIN_RETRY_DELAY_MS = 5_000

/** localtunnel 连接失败 / 固定子域名无法获得 */
export class LocaltunnelUnavailableError extends Error {
  /**
   * @param subdomainRejected 是否属于「请求的固定子域名拿不到」（上层可据此提供"先用随机地址"的退路）
   */
  constructor(
    message: string,
    public readonly subdomainRejected = false,
  ) {
    super(message)
    this.name = 'LocaltunnelUnavailableError'
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`连接超时（${ms / 1000} 秒）`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: Error) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 从公网地址中取出实际分配到的子域名 */
function subdomainOf(url: string): string {
  try {
    return new URL(url).hostname.split('.')[0] ?? ''
  } catch {
    return ''
  }
}

/**
 * localtunnel（loca.lt）隧道：零账号、零域名，可指定子域名得到固定地址，
 * 且不需要用户安装 cloudflared。
 *
 * ⚠️ 安全模型：loca.lt 的子域名是「公共先到先得」资源，**无法真正预留** ——
 * 隧道断开后别人可以抢注同名子域名，从而劫持该地址。因此本类要求调用方传入
 * 不可猜测的子域名（扩展默认自动生成随机子域名并持久化），把劫持风险降到可忽略。
 *
 * ⚠️ 两个必须处理的 loca.lt 行为：
 * 1. 请求的子域名**当下不可用**时，它不报错，而是**静默返回一个随机子域名** ——
 *    所以必须校验实际分配到的子域名，否则"固定地址"会悄悄失效。
 * 2. 连接关闭后子域名**约 55–60 秒**才释放（实测），所以刚重启时要重试足够久，
 *    否则会误判为"被别人占用"。
 */
export class LocaltunnelTunnel {
  private tunnel: localtunnel.Tunnel | null = null
  private _url: string | null = null
  private stopped = false

  /** 当前公网根地址（隧道未运行或尚未建立时为 null） */
  get url(): string | null {
    return this._url
  }

  /** 隧道是否正在运行 */
  get running(): boolean {
    return this.tunnel !== null
  }

  /**
   * 建立隧道并返回公网根地址。
   * @param port 本地 MCP 服务端口
   * @param subdomain 期望的固定子域名（留空则由 loca.lt 随机分配）
   */
  async start(port: number, subdomain = ''): Promise<string> {
    if (this.tunnel) this.stop()
    this.stopped = false

    const wanted = subdomain.trim()
    if (wanted && !SUBDOMAIN_RE.test(wanted)) {
      throw new Error('mcpServer.tunnelSubdomain 只能包含字母、数字和连字符，且长度 3–63（例如 my-mcp-7f3a）')
    }

    const attempts = wanted ? SUBDOMAIN_RETRIES : 1
    const windowSec = Math.round(((attempts - 1) * SUBDOMAIN_RETRY_DELAY_MS) / 1000)
    let lastAssigned = ''

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (attempt > 1) {
        log.warn(
          '隧道',
          `子域名 ${wanted} 暂不可用，${SUBDOMAIN_RETRY_DELAY_MS / 1000} 秒后重试（第 ${attempt}/${attempts} 次；` +
            `loca.lt 断开后约需 55–60 秒才释放，属正常现象）...`,
        )
        await delay(SUBDOMAIN_RETRY_DELAY_MS)
      }
      if (this.stopped) throw new Error('隧道已被主动停止')

      log.info('隧道', `正在启动 localtunnel 隧道（本地端口 ${port}${wanted ? `，子域名 ${wanted}` : '，随机子域名'}）...`)
      const created = await this.open(port, wanted)
      const assigned = subdomainOf(created.url)

      if (!wanted || assigned.toLowerCase() === wanted.toLowerCase()) {
        this.adopt(created)
        log.info('隧道', `外网地址：${this._url}${attempt > 1 ? `（等待 ${(attempt - 1) * SUBDOMAIN_RETRY_DELAY_MS / 1000} 秒后取得）` : ''}`)
        return this._url as string
      }

      // 没拿到请求的子域名：立刻关掉这条随机隧道，避免地址"看起来变了"
      lastAssigned = assigned
      log.warn('隧道', `loca.lt 未接受子域名 ${wanted}，返回了 ${assigned}`)
      try {
        created.close()
      } catch {
        // 连接可能已关闭
      }
    }

    const diagnosis = await this.diagnoseHolder(wanted)
    throw new LocaltunnelUnavailableError(
      `请求的固定子域名 ${wanted} 未被 loca.lt 接受（它返回了 ${lastAssigned || '随机子域名'}），` +
        `已重试 ${attempts} 次、等待约 ${windowSec} 秒。\n` +
        '实测：loca.lt 在隧道断开后约需 55–60 秒才释放子域名，刚重启时通常等一会儿就能拿回。\n' +
        diagnosis,
      true,
    )
  }

  /**
   * 诊断子域名占用者。
   * loca.lt 的 `/health` 是本扩展独有的端点：如果它返回本扩展的响应，
   * 说明占用者是**用户自己的另一个 VS Code 实例**，而不是别人。
   */
  private async diagnoseHolder(subdomain: string): Promise<string> {
    try {
      const res = await fetch(`https://${subdomain}.loca.lt/health`, {
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.text()
      if (res.ok && body.includes('"status":"ok"') && body.includes('connectedAgents')) {
        return (
          '诊断：该地址当前返回的是**本扩展的 /health 响应** —— 占用者是**你自己的另一个 VS Code 窗口/实例**' +
          '（或上一次未完全退出的实例）。请关闭其它窗口，或让每个窗口使用不同的 mcpServer.tunnelSubdomain。'
        )
      }
      return '诊断：该地址当前可访问，但响应不是本扩展 —— 这个名字被**别人**占用了，请换一个更独特的名字。'
    } catch {
      return '诊断：该地址当前无法访问，占用者可能是一条尚未超时释放的旧连接，稍后再试即可。'
    }
  }

  /** 建立一次连接（失败统一抛 LocaltunnelUnavailableError） */
  private async open(port: number, wanted: string): Promise<localtunnel.Tunnel> {
    let created: localtunnel.Tunnel
    try {
      created = await withTimeout(localtunnel({ port, subdomain: wanted || undefined }), URL_TIMEOUT_MS)
    } catch (err) {
      if (this.stopped) throw new Error('隧道已被主动停止')
      const message = err instanceof Error ? err.message : String(err)
      log.error('隧道', 'localtunnel 启动失败', message)
      throw new LocaltunnelUnavailableError(`localtunnel 连接失败：${message}`)
    }

    // 建立过程中被主动停止：立刻关掉，避免留下野连接
    if (this.stopped) {
      try {
        created.close()
      } catch {
        // 连接可能已关闭
      }
      throw new Error('隧道已被主动停止')
    }
    return created
  }

  /** 接管一条已建立的连接 */
  private adopt(created: localtunnel.Tunnel): void {
    this.tunnel = created
    this._url = created.url.replace(/\/+$/, '')
    created.on('close', () => {
      this.tunnel = null
      this._url = null
      log.info('隧道', 'localtunnel 连接已关闭')
    })
    created.on('error', (err: Error) => {
      log.error('隧道', 'localtunnel 错误', err.message)
    })
  }

  /** 停止隧道 */
  stop(): void {
    if (!this.tunnel) return
    this.stopped = true
    log.info('隧道', '正在停止 localtunnel 隧道...')
    const current = this.tunnel
    this.tunnel = null
    this._url = null
    try {
      current.close()
    } catch {
      // 连接可能已关闭
    }
  }

  dispose(): void {
    this.stop()
  }
}
