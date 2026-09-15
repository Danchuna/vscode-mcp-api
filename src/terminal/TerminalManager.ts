import * as vscode from 'vscode'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { log } from '../utils/logger.js'

const MAX_READ_SIZE = 128 * 1024 // Read last 128 KB from log file

interface ManagedTerminal {
  id: string
  name: string
  terminal: vscode.Terminal
  logFile: string
  cwd: string
  createdAt: number
  alive: boolean
  disposeListener: vscode.Disposable
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>()
  private nextId = 1
  private logDir: string

  constructor() {
    this.logDir = path.join(os.tmpdir(), 'vscode-mcp-terminals')
    fs.mkdirSync(this.logDir, { recursive: true })
    this.cleanupStaleLogFiles()
  }

  private cleanupStaleLogFiles(): void {
    try {
      const files = fs.readdirSync(this.logDir)
      for (const file of files) {
        const filePath = path.join(this.logDir, file)
        fs.unlinkSync(filePath)
        log.debug('终端', `已清理残留日志文件：${file}`)
      }
      if (files.length > 0) {
        log.info('终端', `已清理上次会话遗留的 ${files.length} 个日志文件`)
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  dispose(): void {
    for (const [, t] of this.terminals) {
      t.disposeListener.dispose()
      t.terminal.dispose()
      this.cleanupLogFile(t.logFile)
    }
    this.terminals.clear()
  }

  spawn(name: string, command?: string, cwd?: string): { id: string; name: string } {
    const id = `term_${this.nextId++}`
    const workingDir = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
    const logFile = path.join(this.logDir, `${id}.log`)
    const displayName = name || `任务 ${id}`

    // Launch script directly as the terminal shell so setup is invisible
    const isLinux = os.platform() === 'linux'
    const shell = process.env.SHELL || '/bin/zsh'

    // Use bash -c to set up trap and run script, which spawns the user's shell
    const setupCmd = isLinux
      ? `trap 'rm -f "${logFile}"' EXIT HUP TERM; script -q -f "${logFile}" -c "${shell}"`
      : `trap 'rm -f "${logFile}"' EXIT HUP TERM; script -q -F "${logFile}" "${shell}"`

    const terminal = vscode.window.createTerminal({
      name: displayName,
      cwd: workingDir,
      shellPath: '/bin/bash',
      shellArgs: ['-c', setupCmd],
    })
    terminal.show(true)

    // If a command was provided, wait for the shell to be ready before sending
    if (command) {
      this.waitForReady(logFile, () => {
        terminal.sendText(command, true)
      })
    }

    // Listen for terminal close
    const disposeListener = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        const managed = this.terminals.get(id)
        if (managed) {
          managed.alive = false
          log.info('终端', `终端已关闭：${id}`)
          this.cleanupLogFile(managed.logFile)
        }
      }
    })

    const managed: ManagedTerminal = {
      id,
      name: displayName,
      terminal,
      logFile,
      cwd: workingDir,
      createdAt: Date.now(),
      alive: true,
      disposeListener,
    }

    this.terminals.set(id, managed)
    log.info('终端', `已创建终端：${id}（日志：${logFile}）`)

    return { id, name: displayName }
  }

  list(): Array<{
    id: string
    name: string
    alive: boolean
    cwd: string
    createdAt: number
    logSize: number
  }> {
    return Array.from(this.terminals.values()).map(t => ({
      id: t.id,
      name: t.name,
      alive: t.alive,
      cwd: t.cwd,
      createdAt: t.createdAt,
      logSize: this.getLogSize(t.logFile),
    }))
  }

  readOutput(id: string, lines?: number): { output: string; alive: boolean; totalBytes: number } | null {
    const managed = this.terminals.get(id)
    if (!managed) return null

    let output = ''
    let totalBytes = 0

    try {
      const stats = fs.statSync(managed.logFile)
      totalBytes = stats.size

      if (totalBytes === 0) {
        return { output: '', alive: managed.alive, totalBytes: 0 }
      }

      // Read the last MAX_READ_SIZE bytes
      const readSize = Math.min(totalBytes, MAX_READ_SIZE)
      const buffer = Buffer.alloc(readSize)
      const fd = fs.openSync(managed.logFile, 'r')
      fs.readSync(fd, buffer, 0, readSize, totalBytes - readSize)
      fs.closeSync(fd)

      output = this.stripAnsi(buffer.toString('utf-8'))

      if (lines !== undefined && lines > 0) {
        const allLines = output.split('\n')
        output = allLines.slice(-lines).join('\n')
      }
    } catch (err) {
      log.debug('终端', `无法读取终端 ${id} 的日志`, (err as Error).message)
    }

    return { output, alive: managed.alive, totalBytes }
  }

  write(id: string, input: string, addNewline = true): boolean {
    const managed = this.terminals.get(id)
    if (!managed || !managed.alive) return false
    managed.terminal.sendText(input, addNewline)
    return true
  }

  kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const managed = this.terminals.get(id)
    if (!managed) return false

    log.info('终端', `正在终止终端：${id}`)

    // Send exit to the script session, then dispose the terminal
    if (managed.alive) {
      managed.terminal.sendText('exit', true)
      // Give script a moment to clean up, then force dispose
      setTimeout(() => {
        managed.terminal.dispose()
        this.cleanupLogFile(managed.logFile)
      }, 1000)
      managed.alive = false
    }

    managed.disposeListener.dispose()
    this.terminals.delete(id)
    return true
  }

  // Poll the log file until content appears (shell has started), then fire callback
  private waitForReady(logFile: string, callback: () => void, attempt = 0): void {
    const maxAttempts = 50 // 50 * 100ms = 5s max wait
    setTimeout(() => {
      if (this.getLogSize(logFile) > 0) {
        callback()
      } else if (attempt < maxAttempts) {
        this.waitForReady(logFile, callback, attempt + 1)
      } else {
        log.warn('终端', `Shell 在 5 秒内未就绪，仍将发送命令`)
        callback()
      }
    }, 100)
  }

  private getLogSize(logFile: string): number {
    try {
      return fs.statSync(logFile).size
    } catch {
      return 0
    }
  }

  private cleanupLogFile(logFile: string): void {
    try {
      fs.unlinkSync(logFile)
      log.debug('终端', `已清理日志文件：${logFile}`)
    } catch {
      // File may already be cleaned up by trap
    }
  }

  // Strip ANSI escape sequences and control characters from terminal output
  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[=>]|\x08.|\r/g, '')
  }
}
