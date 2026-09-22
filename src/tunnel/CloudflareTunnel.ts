import { spawn, execSync, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { log } from '../utils/logger.js'

// cloudflared 临时隧道输出的公网地址（https://xxx.trycloudflare.com）
const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i
const URL_TIMEOUT_MS = 30_000

/** cloudflared 未安装（常见安装位置与 PATH 中均未找到） */
export class CloudflaredNotInstalledError extends Error {
  constructor() {
    super('未找到 cloudflared，请先安装')
    this.name = 'CloudflaredNotInstalledError'
  }
}

/** 隧道被主动停止（stop()/dispose() 杀掉了启动中的进程，并非故障） */
export class TunnelAbortedError extends Error {
  constructor() {
    super('隧道已被主动停止')
    this.name = 'TunnelAbortedError'
  }
}

/** 解析 cloudflared 可执行文件：先查常见安装位置，再查 PATH */
function resolveCloudflared(): string | null {
  const candidates: Array<string> = []
  const pf86 = process.env['ProgramFiles(x86)']
  const pf = process.env['ProgramFiles']
  const la = process.env['LOCALAPPDATA']
  if (pf86) candidates.push(path.join(pf86, 'cloudflared', 'cloudflared.exe'))
  if (pf) candidates.push(path.join(pf, 'cloudflared', 'cloudflared.exe'))
  if (la) candidates.push(path.join(la, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'))

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch { /* 忽略 */ }
  }

  try {
    const cmd = process.platform === 'win32' ? 'where cloudflared' : 'command -v cloudflared'
    const out = execSync(cmd, { windowsHide: true, timeout: 5000 }).toString().trim()
    const first = out.split(/\r?\n/)[0]
    if (first) return first
  } catch {
    // PATH 中也没有，视为未安装
  }
  return null
}

export class CloudflareTunnel {
  private proc: ChildProcess | null = null
  private _url: string | null = null
  // 记录被我们主动 kill 的进程，用于区分「主动停止」与「真实崩溃」
  private killed = new Set<ChildProcess>()

  /** 当前获取到的公网根地址（隧道未运行或尚未获取到时为 null） */
  get url(): string | null {
    return this._url
  }

  /** 隧道进程是否正在运行 */
  get running(): boolean {
    return this.proc !== null
  }

  /**
   * 启动隧道，返回公网根地址。三种模式（优先级从上到下）：
   *
   * 1. 令牌隧道（opts.token + opts.hostname）—— 推荐用于「一人一个固定地址」的分发场景：
   *    运行 `cloudflared tunnel run --token <token>`。隧道由发号方（你的 Cloudflare 账号）
   *    预先创建并配置好公网入口，用户端无需登录、无需 Cloudflare 账号、无需域名，
   *    公网地址永久固定为 https://<hostname>。
   * 2. 命名隧道（opts.name + opts.hostname）：运行 `cloudflared tunnel run <name>`，
   *    需要用户自己完成 cloudflared tunnel login / create / route dns 并配好 config.yml，
   *    公网地址固定为 https://<hostname>。
   * 3. 临时隧道（默认）：trycloudflare.com 快速隧道，地址每次启动随机生成、无法固定。
   */
  async start(port: number, opts: { name?: string; hostname?: string; token?: string } = {}): Promise<string> {
    if (this.proc) this.stop()

    const bin = resolveCloudflared()
    if (!bin) {
      log.error('隧道', '未找到 cloudflared，请先安装')
      throw new CloudflaredNotInstalledError()
    }

    const name = opts.name?.trim() ?? ''
    const hostname = opts.hostname?.trim() ?? ''
    const token = opts.token?.trim() ?? ''
    const isToken = !!token
    const isNamed = !isToken && !!(name && hostname)

    // 令牌/命名隧道的公网地址由发号方在 Cloudflare 侧配置，无法从 cloudflared 输出推断，必须显式提供
    if ((isToken || isNamed) && !hostname) {
      throw new Error(
        isToken
          ? '已设置 mcpServer.tunnelToken，但缺少 mcpServer.tunnelHostname：令牌隧道的公网地址无法自动推断，请填写发号方给你的固定域名'
          : '已设置 mcpServer.tunnelName，但缺少 mcpServer.tunnelHostname：请填写命名隧道绑定的固定域名',
      )
    }

    // --no-autoupdate 是 cloudflared 全局参数，放在最前避免与 run 子命令的参数解析冲突
    const args = isToken
      ? ['--no-autoupdate', 'tunnel', 'run', '--token', token]
      : isNamed
        ? ['--no-autoupdate', 'tunnel', 'run', name]
        : // --protocol http2：QUIC(UDP) 在部分网络（尤其国内）会被丢弃，导致边缘连接失败、公网访问 530；固定走 TCP 兼容性最好
          ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate']

    log.info('隧道', isToken
      ? `正在启动令牌隧道（本地端口 ${port}，固定域名 ${hostname}）...`
      : isNamed
        ? `正在启动命名隧道 ${name}（本地端口 ${port}，固定域名 ${hostname}）...`
        : `正在启动 cloudflared 临时隧道（本地端口 ${port}）...`)

    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    this.proc = proc
    this._url = isToken || isNamed ? `https://${hostname}` : null

    return await new Promise<string>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn()
      }

      // 令牌等同凭据：所有 cloudflared 输出先脱敏再进日志，避免令牌被记录
      const redact = (text: string) => (token ? text.split(token).join('***') : text)

      const feed = (chunk: Buffer) => {
        for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
          if (line.trim()) log.info('隧道', redact(line.trim()))
          if (!isToken && !isNamed) {
            const m = line.match(URL_RE)
            if (m && !this._url) {
              this._url = m[0]
              log.info('隧道', `外网地址：${this._url}`)
              finish(() => resolve(this._url as string))
            }
          }
        }
      }
      proc.stdout?.on('data', feed)
      proc.stderr?.on('data', feed)

      proc.on('error', (err: NodeJS.ErrnoException) => {
        const message = redact(err.message)
        log.error('隧道', 'cloudflared 启动失败', message)
        this.proc = null
        this._url = null
        finish(() => reject(
          err.code === 'ENOENT'
            ? new CloudflaredNotInstalledError()
            : new Error(`cloudflared 启动失败：${message}`),
        ))
      })

      proc.on('exit', (code) => {
        const killedByUs = this.killed.has(proc)
        this.killed.delete(proc)
        this.proc = null
        this._url = null
        if (!settled) {
          finish(() => reject(
            killedByUs
              ? new TunnelAbortedError()
              : new Error(
                  isToken
                    ? `令牌隧道启动失败（退出码 ${code}）：请确认 mcpServer.tunnelToken 有效（令牌失效需向发号方重新索取），且 mcpServer.tunnelHostname 与隧道配置一致`
                    : isNamed
                      ? `命名隧道 ${name} 启动失败（退出码 ${code}）：请确认已在 ~/.cloudflared 完成 cloudflared tunnel login / create / route dns 配置`
                      : `cloudflared 提前退出（退出码 ${code}）`,
                ),
          ))
        } else {
          log.info('隧道', `cloudflared 进程已退出（退出码 ${code}${killedByUs ? '，主动停止' : ''}）`)
        }
      })

      if (isToken || isNamed) {
        // 公网地址由配置决定、已知，等待一小段时间确认进程稳定（令牌/配置无效时 cloudflared 会快速退出）
        timer = setTimeout(() => finish(() => resolve(this._url as string)), 2000)
      } else {
        timer = setTimeout(() => {
          finish(() => {
            this.stop()
            reject(new Error(`等待外网地址超时（${URL_TIMEOUT_MS / 1000} 秒），请检查网络或代理设置`))
          })
        }, URL_TIMEOUT_MS)
      }
    })
  }

  /** 停止隧道进程 */
  stop(): void {
    if (!this.proc) return
    log.info('隧道', '正在停止 cloudflared 隧道...')
    const proc = this.proc
    this.killed.add(proc)
    try {
      proc.kill()
    } catch {
      // 进程可能已退出
    }
    this.proc = null
    this._url = null
  }

  dispose(): void {
    this.stop()
  }
}
