import * as vscode from 'vscode'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

class Logger {
  private channel: vscode.OutputChannel | null = null
  private level: LogLevel = 'info'

  init(channel: vscode.OutputChannel, level?: LogLevel): void {
    this.channel = channel
    if (level) this.level = level
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  debug(component: string, message: string, data?: unknown): void {
    this.log('debug', component, message, data)
  }

  info(component: string, message: string, data?: unknown): void {
    this.log('info', component, message, data)
  }

  warn(component: string, message: string, data?: unknown): void {
    this.log('warn', component, message, data)
  }

  error(component: string, message: string, data?: unknown): void {
    this.log('error', component, message, data)
  }

  private log(level: LogLevel, component: string, message: string, data?: unknown): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return

    const timestamp = new Date().toISOString().slice(11, 23)
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${component}]`
    const line = data !== undefined
      ? `${prefix} ${message} ${JSON.stringify(data)}`
      : `${prefix} ${message}`

    this.channel?.appendLine(line)

    if (level === 'error') {
      console.error(`[MCP 桥接] ${line}`)
    }
  }
}

export const log = new Logger()
