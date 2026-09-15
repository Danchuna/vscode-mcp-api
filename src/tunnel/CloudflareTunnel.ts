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
   * 启动 cloudflared 临时（quick）隧道，返回公网根地址。
   * 地址从 cloudflared 输出中解析；超时未获取到则终止进程并抛错。
   */
  async start(port: number): Promise<string> {
    if (this.proc) this.stop()

    const bin = resolveCloudflared()
    if (!bin) {
      log.error('隧道', '未找到 cloudflared，请先安装')
      throw new CloudflaredNotInstalledError()
    }

    log.info('隧道', `正在启动 cloudflared 临时隧道（本地端口 ${port}）...`)

    const proc = spawn(
      bin,
      // --protocol http2：QUIC(UDP) 在部分网络（尤其国内）会被丢弃，导致边缘连接失败、公网访问 530；固定走 TCP 兼容性最好
      ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    )
    this.proc = proc
    this._url = null

    return await new Promise<string>((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        fn()
      }

      const feed = (chunk: Buffer) => {
        for (const line of chunk.toString('utf-8').split(/\r?\n/)) {
          const m = line.match(URL_RE)
          if (m && !this._url) {
            this._url = m[0]
            log.info('隧道', `外网地址：${this._url}`)
            finish(() => resolve(this._url as string))
          }
        }
      }
      proc.stdout?.on('data', feed)
      proc.stderr?.on('data', feed)

      proc.on('error', (err: NodeJS.ErrnoException) => {
        log.error('隧道', 'cloudflared 启动失败', err.message)
        this.proc = null
        finish(() => reject(
          err.code === 'ENOENT'
            ? new CloudflaredNotInstalledError()
            : new Error(`cloudflared 启动失败：${err.message}`),
        ))
      })

      proc.on('exit', (code) => {
        const killedByUs = this.killed.has(proc)
        this.killed.delete(proc)
        this.proc = null
        if (!settled) {
          finish(() => reject(
            killedByUs
              ? new TunnelAbortedError()
              : new Error(`cloudflared 提前退出（退出码 ${code}）`),
          ))
        } else {
          log.info('隧道', `cloudflared 进程已退出（退出码 ${code}${killedByUs ? '，主动停止' : ''}）`)
        }
      })

      timer = setTimeout(() => {
        finish(() => {
          this.stop()
          reject(new Error(`等待外网地址超时（${URL_TIMEOUT_MS / 1000} 秒），请检查网络或代理设置`))
        })
      }, URL_TIMEOUT_MS)
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
