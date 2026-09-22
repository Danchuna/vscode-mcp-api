import * as vscode from 'vscode'

export class Settings {
  get<T>(key: string): T | undefined {
    return vscode.workspace.getConfiguration('mcpServer').get<T>(key)
  }

  get port(): number {
    return this.get<number>('port') ?? 3333
  }

  get enableContextPush(): boolean {
    return this.get<boolean>('enableContextPush') ?? true
  }

  get authToken(): string {
    return this.get<string>('authToken') ?? ''
  }

  get enableCloudflareTunnel(): boolean {
    return this.get<boolean>('enableCloudflareTunnel') ?? false
  }

  get portFallback(): boolean {
    return this.get<boolean>('portFallback') ?? false
  }

  /** 隧道实现：cloudflare（cloudflared）或 localtunnel（loca.lt） */
  get tunnelProvider(): string {
    return this.get<string>('tunnelProvider') ?? 'cloudflare'
  }

  /** localtunnel 的固定子域名（留空 = 扩展自动生成随机子域名并持久化） */
  get tunnelSubdomain(): string {
    return this.get<string>('tunnelSubdomain') ?? ''
  }

  /** 令牌文件的路径（令牌本身存放在系统凭据库，不写入 settings.json） */
  get tunnelTokenFile(): string {
    return this.get<string>('tunnelTokenFile') ?? ''
  }

  get tunnelName(): string {
    return this.get<string>('tunnelName') ?? ''
  }

  get tunnelHostname(): string {
    return this.get<string>('tunnelHostname') ?? ''
  }

  onChange(cb: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('mcpServer')) cb()
    })
  }
}
