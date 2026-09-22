import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import { exec } from 'child_process'
import { randomBytes } from 'crypto'
import { VsCodeBridge } from './bridge/VsCodeBridge.js'
import { ContextPusher } from './context/ContextPusher.js'
import { HttpServer, PortInUseError } from './server/HttpServer.js'
import { TerminalManager } from './terminal/TerminalManager.js'
import { CloudflareTunnel, CloudflaredNotInstalledError, TunnelAbortedError } from './tunnel/CloudflareTunnel.js'
import { LocaltunnelTunnel, LocaltunnelUnavailableError } from './tunnel/LocaltunnelTunnel.js'
import { Settings } from './config/Settings.js'
import { log } from './utils/logger.js'

const CLOUDFLARED_DOWNLOAD_PAGE = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
const CLOUDFLARED_DIRECT_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
const WINGET_INSTALL_CMD = 'winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements'

/**
 * 隧道令牌的存放位置：VS Code 系统凭据库（SecretStorage）。
 * 绝不写入 settings.json —— 用户设置会被 Settings Sync 同步、工作区设置会被 git 提交，
 * 令牌一旦进仓库就等于把该用户的 VS Code 控制权公开。
 */
const TUNNEL_TOKEN_SECRET_KEY = 'mcpServer.tunnelToken'

/** 展开路径开头的 ~（凭据文件路径通常写在用户目录下） */
function expandHome(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(1))
  }
  return p
}

/** 关键提示词：外网地址 + 内部使用指令，复制后直接发给远程智能体 */
const KEY_PROMPT_INSTRUCTION = '请你连接使用这个MCP，了解里面的可以用的工具，然后接下来所有对话都需要使用MCP里面的工具进行完成'

function keyPrompt(mcpUrl: string): string {
  return `${mcpUrl}\n\n${KEY_PROMPT_INSTRUCTION}`
}

/** 把当前服务器/隧道状态推送到管理面板（面板未打开时为空操作） */
function postPanelState(): void {
  if (!panel) return
  const publicUrl = tunnel?.url ? `${tunnel.url}/mcp` : ''
  const localUrl = httpServer && httpServer.port > 0 ? `http://127.0.0.1:${httpServer.port}/sse` : ''
  void panel.webview.postMessage({
    type: 'state',
    serverRunning: !!httpServer && httpServer.port > 0,
    port: httpServer?.port ?? 0,
    agents: httpServer?.connectionCount ?? 0,
    tunnelRunning: !!tunnel?.running,
    tunnelTokenSet: !!tunnelToken,
    publicUrl,
    localUrl,
    promptText: publicUrl ? keyPrompt(publicUrl) : '',
  })
}

/** 打开「MCP 桥接面板」：真输入框显示当前外网地址 + 复制按钮 */
function openPanel(): void {
  if (panel) {
    panel.reveal()
    postPanelState()
    return
  }
  panel = vscode.window.createWebviewPanel(
    'mcpServerPanel',
    'MCP 桥接面板',
    vscode.ViewColumn.Active,
    { enableScripts: true },
  )
  panel.webview.html = getPanelHtml()
  panel.webview.onDidReceiveMessage(async (msg: { type?: string; btn?: string }) => {
    switch (msg.type) {
      case 'ready':
        postPanelState()
        break
      case 'setTunnelToken':
        await vscode.commands.executeCommand('mcpServer.setTunnelToken')
        break
      case 'copyPublicUrl':
        if (tunnel?.url) {
          await vscode.env.clipboard.writeText(`${tunnel.url}/mcp`)
          void panel?.webview.postMessage({ type: 'copied', btn: msg.btn ?? '' })
        }
        break
      case 'copyKeyPrompt':
        if (tunnel?.url) {
          await vscode.env.clipboard.writeText(keyPrompt(`${tunnel.url}/mcp`))
          void panel?.webview.postMessage({ type: 'copied', btn: msg.btn ?? '' })
        }
        break
      case 'copyLocalUrl':
        if (httpServer && httpServer.port > 0) {
          await vscode.env.clipboard.writeText(`http://127.0.0.1:${httpServer.port}/sse`)
          void panel?.webview.postMessage({ type: 'copied', btn: msg.btn ?? '' })
        }
        break
    }
  })
  panel.onDidDispose(() => { panel = undefined })
  postPanelState()
}

function getPanelHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); padding: 18px 22px; color: var(--vscode-foreground); }
  h2 { margin: 0 0 2px; font-weight: 600; font-size: 16px; }
  .status { color: var(--vscode-descriptionForeground); font-size: 12.5px; margin-bottom: 18px; }
  .label { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 14px 0 6px; }
  .row { display: flex; gap: 8px; align-items: center; }
  input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 6px 9px; font-size: 13px; font-family: var(--vscode-editor-font-family, monospace); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px; padding: 7px 16px; font-size: 13px; cursor: pointer; white-space: nowrap; }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: .45; cursor: default; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
  .prompt-preview { margin-top: 8px; padding: 8px 10px; background: var(--vscode-textCodeBlock-background); border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; white-space: pre-wrap; word-break: break-all; color: var(--vscode-textPreformat-foreground, var(--vscode-foreground)); }
  .tunnel-off { color: var(--vscode-descriptionForeground); font-size: 12.5px; margin-top: 6px; }
</style>
</head>
<body>
<h2>MCP 桥接面板</h2>
<div class="status" id="status">加载中…</div>

<div class="label">外网地址（Streamable HTTP，发给远程智能体）</div>
<div class="row">
  <input id="publicUrl" readonly placeholder="外网隧道未开启">
  <button id="btnCopyUrl">复制地址</button>
</div>
<div class="row" style="margin-top:8px">
  <button id="btnCopyPrompt" style="flex:1">📋 复制关键提示词（地址 + 使用指令）</button>
</div>
<div class="row" style="margin-top:8px">
  <button id="btnSetToken" class="secondary" style="flex:1">🔑 设置隧道令牌（固定公网地址用，存系统凭据库）</button>
</div>
<div class="prompt-preview" id="promptPreview"></div>

<div class="label">本地地址（同一台电脑上的客户端使用）</div>
<div class="row">
  <input id="localUrl" readonly placeholder="服务器未运行">
  <button id="btnCopyLocal" class="secondary">复制</button>
</div>
<div class="tunnel-off">提示：本地端口默认固定为 mcpServer.port（默认 3333），重启后不变。固定公网地址有三种方式：① 设 mcpServer.tunnelProvider=localtunnel（零账号、零域名，地址固定为 https://&lt;子域名&gt;.loca.lt/mcp）；② 点上方「设置隧道令牌」+ 配置 mcpServer.tunnelHostname（令牌隧道）；③ 配置 mcpServer.tunnelName + mcpServer.tunnelHostname（自建命名隧道）。令牌保存在系统凭据库，不写入 settings.json。</div>

<script>
(function () {
  var vscode = acquireVsCodeApi();
  function on(id, fn) { document.getElementById(id).addEventListener('click', fn); }
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (m.type === 'state') {
      document.getElementById('status').textContent =
        '服务器：' + (m.serverRunning ? '运行中（端口 ' + m.port + '）' : '未运行')
        + ' · 外网隧道：' + (m.tunnelRunning ? '已开启' : '未开启')
        + ' · 已连接智能体：' + m.agents
        + ' · 隧道令牌：' + (m.tunnelTokenSet ? '已设置' : '未设置');
      document.getElementById('publicUrl').value = m.publicUrl || '';
      document.getElementById('localUrl').value = m.localUrl || '';
      document.getElementById('btnCopyUrl').disabled = !m.publicUrl;
      document.getElementById('btnCopyPrompt').disabled = !m.publicUrl;
      document.getElementById('btnCopyLocal').disabled = !m.localUrl;
      document.getElementById('promptPreview').textContent = m.promptText
        ? m.promptText
        : '提示：先开启外网隧道，再复制提示词发给远程智能体。';
    } else if (m.type === 'copied') {
      var btn = document.getElementById(m.btn);
      if (btn) {
        var old = btn.textContent;
        btn.textContent = '✓ 已复制';
        setTimeout(function () { btn.textContent = old; }, 1500);
      }
    }
  });
  on('btnCopyUrl', function () { vscode.postMessage({ type: 'copyPublicUrl', btn: 'btnCopyUrl' }); });
  on('btnCopyPrompt', function () { vscode.postMessage({ type: 'copyKeyPrompt', btn: 'btnCopyPrompt' }); });
  on('btnSetToken', function () { vscode.postMessage({ type: 'setTunnelToken' }); });
  on('btnCopyLocal', function () { vscode.postMessage({ type: 'copyLocalUrl', btn: 'btnCopyLocal' }); });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`
}

let httpServer: HttpServer | undefined
let statusBarItem: vscode.StatusBarItem | undefined
let tunnelStatusBarItem: vscode.StatusBarItem | undefined
let contextPusher: ContextPusher | undefined
let terminalManager: TerminalManager | undefined
let tunnel: CloudflareTunnel | LocaltunnelTunnel | undefined
let panel: vscode.WebviewPanel | undefined
/** 已解析的隧道令牌（凭据库优先，其次 tunnelTokenFile），仅驻留内存，不落任何配置文件 */
let tunnelToken = ''

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('MCP 桥接')
  context.subscriptions.push(outputChannel)
  log.init(outputChannel, 'debug')
  log.info('扩展', '正在激活 MCP 桥接扩展')

  const settings = new Settings()
  const bridge = new VsCodeBridge()

  // Register in-memory FS for diff previews
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('vscode-mcp-preview', bridge.memFs, {
      isCaseSensitive: true,
      isReadonly: true,
    })
  )

  // Context pusher (auto-push events to connected agents)
  contextPusher = new ContextPusher(bridge)
  if (settings.enableContextPush) {
    contextPusher.start()
  }

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  statusBarItem.command = 'mcpServer.showStatus'
  context.subscriptions.push(statusBarItem)

  // 外网隧道一键按钮（状态栏）
  tunnelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
  tunnelStatusBarItem.command = 'mcpServer.toggleTunnel'
  context.subscriptions.push(tunnelStatusBarItem)

  // Terminal manager for long-running processes
  terminalManager = new TerminalManager()
  log.info('扩展', '终端管理器已初始化')

  // Start HTTP server
  httpServer = new HttpServer(bridge, contextPusher, settings, terminalManager)

  // 外网隧道：由 mcpServer.tunnelProvider 选择实现（cloudflare / localtunnel）
  function createTunnel(): CloudflareTunnel | LocaltunnelTunnel {
    return settings.tunnelProvider === 'localtunnel' ? new LocaltunnelTunnel() : new CloudflareTunnel()
  }
  tunnel = createTunnel()

  // localtunnel 子域名：优先用户配置；留空则自动生成随机子域名并持久化到 globalState，
  // 使地址跨重启稳定，且子域名不可猜测（避免被抢注后劫持）。
  const LOCALTUNNEL_SUBDOMAIN_KEY = 'mcpServer.localtunnelSubdomain'
  /** 一次性忽略用户配置的子域名（用户在"子域名拿不到"时选择先用随机地址启动） */
  let ignoreSubdomainOnce = false
  function resolveLocaltunnelSubdomain(): string {
    if (ignoreSubdomainOnce) {
      ignoreSubdomainOnce = false
      return ''
    }
    const configured = settings.tunnelSubdomain.trim()
    if (configured) return configured
    const cached = context.globalState.get<string>(LOCALTUNNEL_SUBDOMAIN_KEY)
    if (cached) return cached
    const generated = `mcp-${randomBytes(5).toString('hex')}`
    void context.globalState.update(LOCALTUNNEL_SUBDOMAIN_KEY, generated)
    log.info('隧道', `已生成固定 localtunnel 子域名：${generated}（持久保存，重启不变）`)
    return generated
  }

  // 隧道令牌：优先系统凭据库（SecretStorage），其次 mcpServer.tunnelTokenFile 指定的仓库外文件。
  // 两条路径都不经过 settings.json，避免令牌被 Settings Sync 同步或被 git 提交。
  async function resolveTunnelToken(): Promise<string> {
    const fromSecret = (await context.secrets.get(TUNNEL_TOKEN_SECRET_KEY))?.trim()
    if (fromSecret) return fromSecret
    const file = settings.tunnelTokenFile.trim()
    if (!file) return ''
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(expandHome(file)))
      return Buffer.from(raw).toString('utf-8').trim()
    } catch (err) {
      log.warn('隧道', `读取 mcpServer.tunnelTokenFile 失败（${file}）：${err}`)
      return ''
    }
  }

  async function refreshTunnelToken(): Promise<void> {
    tunnelToken = await resolveTunnelToken()
  }
  await refreshTunnelToken()

  async function startServer(): Promise<void> {
    try {
      log.info('服务器', `正在端口 ${settings.port} 上启动 HTTP 服务器`)
      const port = await httpServer!.start(settings.port, settings.portFallback)
      updateStatusBar(port, 0)
      log.info('服务器', `HTTP 服务器已在端口 ${port} 上监听`)
      vscode.window.showInformationMessage(`MCP 服务器已启动：http://127.0.0.1:${port}`)

      if (settings.enableCloudflareTunnel) {
        void startTunnel(port)
      }
    } catch (err) {
      log.error('服务器', 'HTTP 服务器启动失败', err)
      if (err instanceof PortInUseError) {
        const pick = await vscode.window.showErrorMessage(
          `MCP 服务器启动失败：${err.message}。地址固定为 http://127.0.0.1:${err.port}，需要先释放该端口才能保持地址不变。`,
          '打开端口设置',
          '复制占用信息',
          '重试',
        )
        if (pick === '打开端口设置') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'mcpServer.port')
        } else if (pick === '复制占用信息') {
          await vscode.env.clipboard.writeText(`端口 ${err.port} 被 ${err.owner} 占用（MCP 桥接）`)
          vscode.window.showInformationMessage(`已复制占用信息：端口 ${err.port} 被 ${err.owner} 占用`)
        } else if (pick === '重试') {
          void startServer()
        }
      } else {
        vscode.window.showErrorMessage(`MCP 服务器启动失败：${err}`)
      }
      updateStatusBar(0, 0, true)
    }
  }

  async function stopServer(): Promise<void> {
    if (httpServer) {
      log.info('服务器', '正在停止 HTTP 服务器')
      tunnel?.stop()
      updateTunnelStatusBar()
      await httpServer.stop()
      updateStatusBar(0, 0)
      vscode.window.showInformationMessage('MCP 服务器已停止。')
    }
  }

  // 开启外网隧道；cloudflared 未安装时引导安装（命令 / 下载链接 / 自动安装）
  function startTunnel(port: number): Promise<void> {
    const active = tunnel
    if (!active) return Promise.resolve()
    // 子域名只解析一次：它会消费"用随机地址"的一次性开关，重复调用会让退路失效
    let started: Promise<string>
    if (active instanceof LocaltunnelTunnel) {
      const subdomain = resolveLocaltunnelSubdomain()
      started = Promise.resolve(
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `正在建立 localtunnel 隧道${subdomain ? `（子域名 ${subdomain}）` : '（随机子域名）'}…若刚重启过，loca.lt 释放子域名约需 60 秒`,
            cancellable: false,
          },
          () => active.start(port, subdomain),
        ),
      )
    } else {
      started = active.start(port, {
        name: settings.tunnelName,
        hostname: settings.tunnelHostname,
        token: tunnelToken,
      })
    }
    return started.then(
      (publicUrl) => {
        updateTunnelStatusBar()
        postPanelState()
        void vscode.window
          .showInformationMessage(`外网隧道已开启：${publicUrl}/mcp`, '复制关键提示词', '打开面板')
          .then(async (picked) => {
            if (picked === '复制关键提示词') {
              await vscode.env.clipboard.writeText(keyPrompt(`${publicUrl}/mcp`))
              void vscode.window.showInformationMessage('已复制关键提示词（外网地址 + 使用指令），可直接发给远程智能体。')
            } else if (picked === '打开面板') {
              openPanel()
            }
          })
        if (!settings.authToken) {
          vscode.window.showWarningMessage('安全提示：外网隧道已开启，但未设置 mcpServer.authToken，任何人都可以访问你的 VS Code。建议在设置中配置 Bearer 令牌。')
        }
      },
      (err: unknown) => {
        if (err instanceof TunnelAbortedError) {
          // 被主动停止（如设置变更触发重启），不是故障，无需提示
          log.info('隧道', '启动过程被主动中止（忽略）')
          return
        }
        if (err instanceof CloudflaredNotInstalledError) {
          void promptCloudflaredInstall(port)
        } else if (err instanceof LocaltunnelUnavailableError) {
          const buttons = err.subdomainRejected ? ['用随机地址启动', '打开隧道设置'] : ['打开隧道设置']
          void vscode.window
            .showErrorMessage(`外网隧道启动失败：${err.message}`, ...buttons)
            .then(async (picked) => {
              if (picked === '用随机地址启动') {
                // 本次临时放弃固定子域名，让 loca.lt 随机分配（地址会变，但至少隧道能用）
                ignoreSubdomainOnce = true
                await startTunnel(port)
              } else if (picked === '打开隧道设置') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'mcpServer.tunnelSubdomain')
              }
            })
        } else {
          vscode.window.showErrorMessage(`外网隧道启动失败：${err}`)
        }
      },
    )
  }

  function promptCloudflaredInstall(port: number): Thenable<void> {
    return vscode.window
      .showWarningMessage(
        '未找到 cloudflared，无法开启外网隧道。请选择安装方式：',
        '使用 winget 自动安装',
        '复制安装命令',
        '复制直链下载地址',
        '打开下载页面',
      )
      .then(async (choice) => {
        if (!choice) return
        if (choice === '使用 winget 自动安装') {
          const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '正在通过 winget 安装 cloudflared（可能需要几分钟）...' },
            () => new Promise<{ ok: boolean; output: string }>((resolve) => {
              exec(
                WINGET_INSTALL_CMD,
                { timeout: 300_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
                (err, stdout, stderr) => resolve({ ok: !err, output: `${stdout ?? ''}\n${stderr ?? ''}` }),
              )
            }),
          )
          if (result.ok) {
            vscode.window.showInformationMessage('cloudflared 安装完成，正在开启外网隧道...')
            await startTunnel(port)
          } else {
            const open = await vscode.window.showErrorMessage(
              `winget 安装失败：${result.output.trim().slice(-300) || '未知错误'}`,
              '打开下载页面',
            )
            if (open) void vscode.env.openExternal(vscode.Uri.parse(CLOUDFLARED_DOWNLOAD_PAGE))
          }
        } else if (choice === '复制安装命令') {
          await vscode.env.clipboard.writeText(WINGET_INSTALL_CMD)
          vscode.window.showInformationMessage(`已复制安装命令，请在终端（PowerShell）中运行：\n${WINGET_INSTALL_CMD}`)
        } else if (choice === '复制直链下载地址') {
          await vscode.env.clipboard.writeText(CLOUDFLARED_DIRECT_URL)
          vscode.window.showInformationMessage(`已复制下载直链（cloudflared-windows-amd64.exe）。下载后可直接放到固定目录（扩展会自动识别常见安装位置）：\n${CLOUDFLARED_DIRECT_URL}`)
        } else {
          void vscode.env.openExternal(vscode.Uri.parse(CLOUDFLARED_DOWNLOAD_PAGE))
        }
      })
  }

  function updateStatusBar(port: number, agents: number, error = false): void {
    if (!statusBarItem) return
    if (error) {
      statusBarItem.text = '$(error) MCP 错误'
      statusBarItem.tooltip = 'MCP 服务器启动失败。点击查看选项。'
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
    } else if (port === 0) {
      statusBarItem.text = '$(circle-slash) MCP 已停止'
      statusBarItem.tooltip = 'MCP 服务器已停止。点击启动。'
      statusBarItem.backgroundColor = undefined
    } else {
      statusBarItem.text = `$(radio-tower) MCP :${port}${agents > 0 ? ` | ${agents} 个智能体` : ''}`
      statusBarItem.tooltip = `MCP 服务器正在端口 ${port} 上运行。点击查看选项。${tunnel?.url ? `\n外网隧道：${tunnel.url}/mcp` : ''}`
      statusBarItem.backgroundColor = undefined
    }
    statusBarItem.show()
  }

  function updateTunnelStatusBar(): void {
    if (!tunnelStatusBarItem) return
    if (tunnel?.running) {
      tunnelStatusBarItem.text = '$(link) 外网隧道'
      tunnelStatusBarItem.tooltip = tunnel.url
        ? `外网隧道运行中：${tunnel.url}/mcp（点击停止）`
        : '外网隧道正在建立…（点击停止）'
    } else {
      tunnelStatusBarItem.text = '$(unlink) 外网隧道'
      tunnelStatusBarItem.tooltip = '外网隧道未开启。点击一键开启（未安装 cloudflared 时会提示安装命令或下载链接）。'
    }
    tunnelStatusBarItem.show()
  }

  // Update agent count / tunnel state
  setInterval(() => {
    if (httpServer && httpServer.port > 0) {
      updateStatusBar(httpServer.port, httpServer.connectionCount)
    }
    updateTunnelStatusBar()
    postPanelState()
  }, 2000)

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpServer.start', startServer),
    vscode.commands.registerCommand('mcpServer.stop', stopServer),
    vscode.commands.registerCommand('mcpServer.restart', async () => {
      await stopServer()
      await startServer()
    }),
    vscode.commands.registerCommand('mcpServer.copyConnectionUrl', async () => {
      if (!httpServer || httpServer.port === 0) {
        vscode.window.showWarningMessage('MCP 服务器未运行。')
        return
      }
      const url = `http://127.0.0.1:${httpServer.port}/sse`
      await vscode.env.clipboard.writeText(url)
      vscode.window.showInformationMessage(`已复制：${url}`)
    }),
    // 在输入框中展示当前生成的外网地址，回车即复制（也可手动选中复制）
    vscode.commands.registerCommand('mcpServer.showTunnelUrl', async () => {
      if (!tunnel?.url) {
        vscode.window.showWarningMessage('外网隧道未开启：请先点击状态栏「外网隧道」按钮，或运行「VS Code MCP 桥接：启动/停止外网隧道」。')
        return
      }
      const url = `${tunnel.url}/mcp`
      const picked = await vscode.window.showInputBox({
        value: url,
        prompt: '当前外网 MCP 地址（Streamable HTTP）——回车复制到剪贴板，也可手动选中复制',
        ignoreFocusOut: true,
      })
      if (picked !== undefined) {
        await vscode.env.clipboard.writeText(picked)
        vscode.window.showInformationMessage(`已复制：${picked}`)
      }
    }),
    // 一键复制「外网地址 + 内部使用指令」关键提示词
    vscode.commands.registerCommand('mcpServer.copyKeyPrompt', async () => {
      if (!tunnel?.url) {
        vscode.window.showWarningMessage('外网隧道未开启：请先点击状态栏「外网隧道」按钮，或运行「VS Code MCP 桥接：启动/停止外网隧道」。')
        return
      }
      await vscode.env.clipboard.writeText(keyPrompt(`${tunnel.url}/mcp`))
      vscode.window.showInformationMessage('已复制关键提示词（外网地址 + 使用指令），可直接发给远程智能体。')
    }),
    // 隧道令牌：存进系统凭据库，不写 settings.json —— 开源仓库/工作区设置都不会泄露
    vscode.commands.registerCommand('mcpServer.setTunnelToken', async () => {
      const value = await vscode.window.showInputBox({
        prompt: '粘贴发号方给你的隧道令牌（保存到系统凭据库，不会写入 settings.json）',
        placeHolder: 'eyJhIjoi...（留空回车 = 清除已保存的令牌）',
        password: true,
        ignoreFocusOut: true,
      })
      if (value === undefined) return
      const trimmed = value.trim()
      if (trimmed) {
        await context.secrets.store(TUNNEL_TOKEN_SECRET_KEY, trimmed)
      } else {
        await context.secrets.delete(TUNNEL_TOKEN_SECRET_KEY)
      }
      await refreshTunnelToken()
      postPanelState()
      vscode.window.showInformationMessage(trimmed ? '隧道令牌已保存到系统凭据库。' : '已清除隧道令牌。')

      // 令牌变化后按需重启隧道以立即生效
      if (httpServer && httpServer.port > 0) {
        if (tunnel?.running) {
          tunnel.stop()
          updateTunnelStatusBar()
        }
        if (trimmed) {
          await startTunnel(httpServer.port)
        }
      }
    }),
    vscode.commands.registerCommand('mcpServer.clearTunnelToken', async () => {
      await context.secrets.delete(TUNNEL_TOKEN_SECRET_KEY)
      await refreshTunnelToken()
      postPanelState()
      vscode.window.showInformationMessage('已清除系统凭据库中的隧道令牌。')
    }),
    vscode.commands.registerCommand('mcpServer.openPanel', () => openPanel()),
    vscode.commands.registerCommand('mcpServer.toggleTunnel', async () => {
      if (!httpServer || httpServer.port === 0) {
        const pick = await vscode.window.showQuickPick(['启动服务器并开启外网隧道'], {
          placeHolder: 'MCP 服务器未运行，开启外网隧道需要先启动本地服务器',
        })
        if (pick !== '启动服务器并开启外网隧道') return
        await startServer()
        if (!httpServer || httpServer.port === 0) return
      }
      if (tunnel?.running) {
        if (!tunnel.url) {
          vscode.window.showInformationMessage('外网隧道正在建立中，请稍候（地址出来会弹通知）...')
          return
        }
        tunnel.stop()
        updateTunnelStatusBar()
        vscode.window.showInformationMessage('外网隧道已停止。')
        return
      }
      await startTunnel(httpServer.port)
    }),
    vscode.commands.registerCommand('mcpServer.showStatus', async () => {
      if (!httpServer || httpServer.port === 0) {
        const choice = await vscode.window.showQuickPick(['启动服务器'], { placeHolder: 'MCP 服务器已停止' })
        if (choice === '启动服务器') await startServer()
        return
      }
      const url = `http://127.0.0.1:${httpServer.port}/sse`
      const options = ['打开管理面板（外网地址 / 复制按钮）', `已连接智能体数：${httpServer.connectionCount}`, '复制连接地址']
      if (tunnel?.url) {
        options.push('复制外网地址')
        options.push('复制关键提示词')
      }
      options.push('停止服务器')
      const choice = await vscode.window.showQuickPick(
        options,
        { placeHolder: `MCP 服务器端口：${httpServer.port}` }
      )
      if (choice === '打开管理面板（外网地址 / 复制按钮）') {
        openPanel()
      } else if (choice === '复制连接地址') {
        await vscode.env.clipboard.writeText(url)
        vscode.window.showInformationMessage(`已复制：${url}`)
      } else if (choice === '复制外网地址' && tunnel?.url) {
        const publicUrl = `${tunnel.url}/mcp`
        await vscode.env.clipboard.writeText(publicUrl)
        vscode.window.showInformationMessage(`已复制：${publicUrl}`)
      } else if (choice === '复制关键提示词' && tunnel?.url) {
        await vscode.env.clipboard.writeText(keyPrompt(`${tunnel.url}/mcp`))
        vscode.window.showInformationMessage('已复制关键提示词（外网地址 + 使用指令），可直接发给远程智能体。')
      } else if (choice === '停止服务器') {
        await stopServer()
      }
    }),
  )

  // Restart server if settings change
  context.subscriptions.push(
    settings.onChange(async () => {
      await refreshTunnelToken()
      await stopServer()
      // 隧道实现可能被切换（mcpServer.tunnelProvider），重建实例
      if ((settings.tunnelProvider === 'localtunnel') !== (tunnel instanceof LocaltunnelTunnel)) {
        tunnel?.dispose()
        tunnel = createTunnel()
        updateTunnelStatusBar()
      }
      if (settings.enableContextPush) {
        contextPusher?.start()
      } else {
        contextPusher?.stop()
      }
      await startServer()
    })
  )

  // Auto-start
  await startServer()
}

export async function deactivate(): Promise<void> {
  log.info('扩展', '正在停用 MCP 桥接扩展')
  tunnel?.dispose()
  terminalManager?.dispose()
  contextPusher?.stop()
  await httpServer?.stop()
}
