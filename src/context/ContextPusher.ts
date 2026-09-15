import * as vscode from 'vscode'
import { VsCodeBridge } from '../bridge/VsCodeBridge.js'

type PushCallback = (type: string, payload: unknown) => void

function debounce<T extends Array<unknown>>(fn: (...args: T) => void, ms: number): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: T) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export class ContextPusher {
  private disposables: Array<vscode.Disposable> = []
  private callbacks: Set<PushCallback> = new Set()

  constructor(private bridge: VsCodeBridge) {}

  start(): void {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(
        debounce(() => this.pushActiveFile(), 200)
      ),
      vscode.window.onDidChangeTextEditorSelection(
        debounce(() => this.pushSelection(), 300)
      ),
      vscode.languages.onDidChangeDiagnostics(
        debounce(() => this.pushDiagnostics(), 500)
      ),
      vscode.workspace.onDidSaveTextDocument(
        () => this.pushActiveFile()
      ),
    )
  }

  stop(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }

  onPush(cb: PushCallback): () => void {
    this.callbacks.add(cb)
    return () => this.callbacks.delete(cb)
  }

  private emit(type: string, payload: unknown): void {
    for (const cb of this.callbacks) {
      try { cb(type, payload) } catch { /* ignore */ }
    }
  }

  private pushActiveFile(): void {
    const snap = this.bridge.getActiveFileSnapshot()
    if (snap) this.emit('activeFile', snap)
  }

  private pushSelection(): void {
    const snap = this.bridge.getSelectionSnapshot()
    if (snap) this.emit('selection', snap)
  }

  private async pushDiagnostics(): Promise<void> {
    // Only push diagnostics for open files
    const tabs = this.bridge.getOpenTabs()
    const paths = tabs.map(t => t.path)
    const allDiags = await this.bridge.getDiagnostics()
    const filtered = allDiags.filter(d => paths.includes(d.filePath))
    this.emit('diagnostics', filtered)
  }
}
