import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VsCodeBridge } from '../bridge/VsCodeBridge.js'
import { TerminalManager } from '../terminal/TerminalManager.js'
import type { Settings } from '../config/Settings.js'
import { log } from '../utils/logger.js'

function symbolKindName(kind: number): string {
  const kinds = ['File','Module','Namespace','Package','Class','Method','Property','Field','Constructor',
    'Enum','Interface','Function','Variable','Constant','String','Number','Boolean','Array','Object',
    'Key','Null','EnumMember','Struct','Event','Operator','TypeParameter']
  return kinds[kind] ?? 'Unknown'
}

function serializeSymbols(symbols: Array<{ name: string; kind: number; range: { start: { line: number; character: number }; end: { line: number; character: number } }; detail?: string; children?: Array<unknown> }>): unknown {
  return symbols.map(s => ({
    name: s.name,
    kind: symbolKindName(s.kind),
    startLine: s.range.start.line,
    endLine: s.range.end.line,
    detail: s.detail ?? null,
    children: s.children ? serializeSymbols(s.children as Parameters<typeof serializeSymbols>[0]) : [],
  }))
}

// Wrap a tool handler with logging
function logged<T, R>(toolName: string, handler: (args: T) => Promise<R>): (args: T) => Promise<R> {
  return async (args: T) => {
    log.debug('工具', `${toolName} 被调用`, args)
    try {
      const result = await handler(args)
      log.debug('工具', `${toolName} 执行完成`)
      return result
    } catch (err) {
      log.error('工具', `${toolName} 执行失败`, (err as Error).message)
      throw err
    }
  }
}

export function registerTools(server: McpServer, bridge: VsCodeBridge, settings: Settings, terminalManager: TerminalManager): void {
  log.info('工具', '正在注册工具')

  // --- Active File ---
  server.tool('get_active_file', '获取 VS Code 中当前活动/打开的文件', {}, async () => {
    const snap = bridge.getActiveFileSnapshot()
    return { content: [{ type: 'text', text: JSON.stringify(snap) }] }
  })

  // --- Selection ---
  server.tool('get_selection', '获取当前文本选区和光标位置', {}, async () => {
    const snap = bridge.getSelectionSnapshot()
    return { content: [{ type: 'text', text: JSON.stringify(snap) }] }
  })

  // --- Open Tabs ---
  server.tool('get_open_tabs', '获取 VS Code 中当前打开的所有文件标签页', {}, async () => {
    const tabs = bridge.getOpenTabs()
    return { content: [{ type: 'text', text: JSON.stringify(tabs) }] }
  })

  // --- Diagnostics ---
  server.tool(
    'get_diagnostics',
    '获取 VS Code 语言服务器提供的 LSP 诊断信息（错误、警告、提示）',
    {
      filePath: z.string().optional().describe('指定文件的绝对路径，不传则返回所有打开的文件'),
      severity: z.enum(['error', 'warning', 'information', 'hint']).optional().describe('按最低严重级别过滤'),
    },
    async ({ filePath, severity }) => {
      let diags = await bridge.getDiagnostics(filePath)
      if (severity) {
        const levels = ['hint', 'information', 'warning', 'error']
        const minLevel = levels.indexOf(severity)
        diags = diags.filter(d => levels.indexOf(d.severity) >= minLevel)
      }
      return { content: [{ type: 'text', text: JSON.stringify(diags) }] }
    }
  )

  // --- Show Diff ---
  server.tool(
    'show_diff',
    '在应用文件更改之前，先在 VS Code 中展示可视化差异。不会写入文件。',
    {
      filePath: z.string().describe('要对比的文件的绝对路径'),
      newContent: z.string().describe('要在差异视图中展示的新内容'),
      title: z.string().optional().describe('差异编辑器标签页的标题'),
    },
    async ({ filePath, newContent, title }) => {
      await bridge.showDiff(filePath, newContent, title)
      return { content: [{ type: 'text', text: JSON.stringify({ shown: true, filePath }) }] }
    }
  )

  // --- Read File ---
  server.tool(
    'read_file',
    '读取文件内容',
    {
      filePath: z.string().describe('文件的绝对路径'),
      startLine: z.number().int().min(0).optional().describe('起始行（从 0 开始，含）'),
      endLine: z.number().int().min(0).optional().describe('结束行（从 0 开始，含）'),
    },
    async ({ filePath, startLine, endLine }) => {
      const result = await bridge.readFile(filePath, startLine, endLine)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )

  // --- Write File ---
  server.tool(
    'write_file',
    '向文件写入内容。与 VS Code 撤销历史集成。',
    {
      filePath: z.string().describe('文件的绝对路径'),
      content: z.string().describe('要写入的完整内容'),
      createIfMissing: z.boolean().optional().default(true).describe('文件不存在时创建该文件'),
    },
    async ({ filePath, content, createIfMissing }) => {
      const result = await bridge.writeFile(filePath, content, createIfMissing)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )

  // --- Create File ---
  server.tool(
    'create_file',
    '创建新文件',
    {
      filePath: z.string().describe('新文件的绝对路径'),
      content: z.string().optional().default('').describe('初始内容'),
    },
    async ({ filePath, content }) => {
      await bridge.createFile(filePath, content)
      return { content: [{ type: 'text', text: JSON.stringify({ created: true, filePath }) }] }
    }
  )

  // --- Delete File ---
  server.tool(
    'delete_file',
    '删除文件',
    {
      filePath: z.string().describe('要删除的文件的绝对路径'),
      useTrash: z.boolean().optional().default(true).describe('移入回收站而不是永久删除'),
    },
    async ({ filePath, useTrash }) => {
      await bridge.deleteFile(filePath, useTrash)
      return { content: [{ type: 'text', text: JSON.stringify({ deleted: true, filePath }) }] }
    }
  )

  // --- Open File ---
  server.tool(
    'open_file',
    '在 VS Code 编辑器中打开文件',
    {
      filePath: z.string().describe('文件的绝对路径'),
      line: z.number().int().min(0).optional().describe('要跳转到的行（从 0 开始）'),
      character: z.number().int().min(0).optional().describe('字符位置'),
      preview: z.boolean().optional().default(false).describe('是否以预览模式打开'),
    },
    async ({ filePath, line, character, preview }) => {
      await bridge.openFile(filePath, line, character, preview)
      return { content: [{ type: 'text', text: JSON.stringify({ opened: true, filePath }) }] }
    }
  )

  // --- Close File ---
  server.tool(
    'close_file',
    '关闭 VS Code 中的文件标签页',
    {
      filePath: z.string().describe('要关闭的文件的绝对路径'),
    },
    async ({ filePath }) => {
      const result = await bridge.closeFile(filePath)
      return { content: [{ type: 'text', text: JSON.stringify({ ...result, filePath }) }] }
    }
  )

  // --- Run Terminal Command ---
  server.tool(
    'run_terminal_command',
    '运行 shell 命令并捕获其输出',
    {
      command: z.string().describe('要运行的 shell 命令'),
      cwd: z.string().optional().describe('工作目录（默认为工作区根目录）'),
      timeoutMs: z.number().int().min(1000).optional().default(30000).describe('超时时间（毫秒）'),
    },
    async ({ command, cwd, timeoutMs }) => {
      const strategy = settings.get<string>('terminalStrategy') ?? 'childProcess'
      const result = await bridge.runCommand(command, cwd, timeoutMs, strategy)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    }
  )

  // --- Find References ---
  server.tool(
    'find_references',
    '使用 LSP 查找指定位置处符号的所有引用',
    {
      filePath: z.string().describe('文件的绝对路径'),
      line: z.number().int().min(0).describe('行号（从 0 开始）'),
      character: z.number().int().min(0).describe('字符位置（从 0 开始）'),
      includeDeclaration: z.boolean().optional().default(true),
    },
    async ({ filePath, line, character, includeDeclaration }) => {
      const refs = await bridge.getReferences(filePath, line, character, includeDeclaration)
      const serialized = (refs ?? []).map(r => ({
        filePath: r.uri.fsPath,
        startLine: r.range.start.line,
        startChar: r.range.start.character,
        endLine: r.range.end.line,
        endChar: r.range.end.character,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(serialized) }] }
    }
  )

  // --- Go To Definition ---
  server.tool(
    'go_to_definition',
    '使用 LSP 获取指定位置处符号的定义位置',
    {
      filePath: z.string().describe('文件的绝对路径'),
      line: z.number().int().min(0).describe('行号（从 0 开始）'),
      character: z.number().int().min(0).describe('字符位置（从 0 开始）'),
    },
    async ({ filePath, line, character }) => {
      const defs = await bridge.getDefinition(filePath, line, character)
      const serialized = (defs ?? []).map(d => {
        if ('uri' in d) {
          return { filePath: d.uri.fsPath, startLine: d.range.start.line, startChar: d.range.start.character, endLine: d.range.end.line, endChar: d.range.end.character }
        }
        return { filePath: d.targetUri.fsPath, startLine: d.targetRange.start.line, startChar: d.targetRange.start.character, endLine: d.targetRange.end.line, endChar: d.targetRange.end.character }
      })
      return { content: [{ type: 'text', text: JSON.stringify(serialized) }] }
    }
  )

  // --- Get Hover ---
  server.tool(
    'get_hover',
    '获取指定位置处符号的悬停信息（类型信息、文档）',
    {
      filePath: z.string().describe('文件的绝对路径'),
      line: z.number().int().min(0).describe('行号（从 0 开始）'),
      character: z.number().int().min(0).describe('字符位置（从 0 开始）'),
    },
    async ({ filePath, line, character }) => {
      const hovers = await bridge.getHover(filePath, line, character)
      const contents = (hovers ?? []).flatMap(h => {
        const c = h.contents
        if (Array.isArray(c)) {
          return c.map(item => (typeof item === 'string' ? item : (item as { value: string }).value))
        }
        return [typeof c === 'string' ? c : (c as { value: string }).value]
      })
      return { content: [{ type: 'text', text: JSON.stringify({ contents }) }] }
    }
  )

  // --- Get Document Symbols ---
  server.tool(
    'get_document_symbols',
    '获取文件中的所有符号（函数、类、变量等）',
    {
      filePath: z.string().describe('文件的绝对路径'),
    },
    async ({ filePath }) => {
      const symbols = await bridge.getDocumentSymbols(filePath)
      const serialized = serializeSymbols((symbols ?? []) as Parameters<typeof serializeSymbols>[0])
      return { content: [{ type: 'text', text: JSON.stringify(serialized) }] }
    }
  )

  // --- Search Workspace Symbols ---
  server.tool(
    'search_workspace_symbols',
    '在整个工作区中搜索符号',
    {
      query: z.string().describe('要搜索的符号名称'),
    },
    async ({ query }) => {
      const symbols = await bridge.getWorkspaceSymbols(query)
      const serialized = (symbols ?? []).map(s => ({
        name: s.name,
        kind: symbolKindName(s.kind),
        filePath: s.location.uri.fsPath,
        startLine: s.location.range.start.line,
        containerName: s.containerName ?? null,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(serialized) }] }
    }
  )

  // --- Get Code Actions ---
  server.tool(
    'get_code_actions',
    '获取文件中指定范围内可用的代码操作（快速修复、重构）',
    {
      filePath: z.string().describe('文件的绝对路径'),
      startLine: z.number().int().min(0),
      startChar: z.number().int().min(0),
      endLine: z.number().int().min(0),
      endChar: z.number().int().min(0),
    },
    async ({ filePath, startLine, startChar, endLine, endChar }) => {
      const actions = await bridge.getCodeActions(filePath, startLine, startChar, endLine, endChar)
      type AnyAction = { title: string; kind?: { value: string }; isPreferred?: boolean }
      const serialized = (actions ?? []).map((a, i) => {
        const action = a as AnyAction
        return {
          index: i,
          title: action.title,
          kind: action.kind?.value ?? null,
          isPreferred: action.isPreferred ?? false,
        }
      })
      return { content: [{ type: 'text', text: JSON.stringify(serialized) }] }
    }
  )

  // --- Apply Code Action ---
  server.tool(
    'apply_code_action',
    '按索引应用代码操作（索引来自 get_code_actions 的结果）',
    {
      filePath: z.string().describe('文件的绝对路径'),
      startLine: z.number().int().min(0),
      startChar: z.number().int().min(0),
      endLine: z.number().int().min(0),
      endChar: z.number().int().min(0),
      actionIndex: z.number().int().min(0).describe('get_code_actions 结果中的索引'),
    },
    async ({ filePath, startLine, startChar, endLine, endChar, actionIndex }) => {
      const actions = await bridge.getCodeActions(filePath, startLine, startChar, endLine, endChar)
      const action = (actions ?? [])[actionIndex]
      if (!action) throw new Error(`索引 ${actionIndex} 处不存在代码操作`)

      let applied = false
      if ('edit' in action && action.edit) {
        await import('vscode').then(vscode => vscode.workspace.applyEdit(action.edit!))
        applied = true
      } else if ('command' in action && action.command) {
        const cmd = typeof action.command === 'string' ? action.command : action.command.command
        await import('vscode').then(vscode => vscode.commands.executeCommand(cmd))
        applied = true
      }

      return { content: [{ type: 'text', text: JSON.stringify({ applied, title: 'title' in action ? action.title : '' }) }] }
    }
  )

  // --- Rename Symbol ---
  server.tool(
    'rename_symbol',
    '重命名符号及其在整个工作区中的所有引用',
    {
      filePath: z.string().describe('文件的绝对路径'),
      line: z.number().int().min(0).describe('行号（从 0 开始）'),
      character: z.number().int().min(0).describe('字符位置（从 0 开始）'),
      newName: z.string().describe('符号的新名称'),
    },
    async ({ filePath, line, character, newName }) => {
      const edit = await bridge.getRenameEdits(filePath, line, character, newName)
      if (!edit) throw new Error('该位置不支持重命名')
      const vscode = await import('vscode')
      await vscode.workspace.applyEdit(edit)
      const filesChanged = new Set(edit.entries().map(([uri]) => uri.fsPath)).size
      const editsApplied = edit.entries().reduce((sum, [, edits]) => sum + edits.length, 0)
      return { content: [{ type: 'text', text: JSON.stringify({ filesChanged, editsApplied }) }] }
    }
  )

  // --- Workspace Info ---
  server.tool('get_workspace_info', '获取当前 VS Code 工作区的信息', {}, async () => {
    const info = bridge.getWorkspaceInfo()
    return { content: [{ type: 'text', text: JSON.stringify(info) }] }
  })

  // --- Execute VS Code Command ---
  server.tool(
    'execute_vscode_command',
    '执行任意 VS Code 命令。要求该命令已在 allowedCommands 设置的白名单中。',
    {
      command: z.string().describe('要执行的 VS Code 命令 ID'),
      args: z.array(z.unknown()).optional().default([]).describe('传递给命令的参数'),
    },
    async ({ command, args }) => {
      const allowedCommands = settings.get<Array<string>>('allowedCommands') ?? []
      const result = await bridge.executeCommand(command, args as Array<unknown>, allowedCommands)
      return { content: [{ type: 'text', text: JSON.stringify({ result }) }] }
    }
  )

  // --- Managed Terminals (long-running processes) ---

  server.tool(
    'spawn_terminal',
    '在 VS Code 终端中启动一个长时间运行的进程（开发服务器、watch 模式等）并捕获输出。短命令请改用 run_terminal_command。',
    {
      name: z.string().describe('终端的显示名称（如 "dev-server"、"tests-watch"）'),
      command: z.string().optional().describe('启动后立即运行的命令（如 "npm run dev"）。不传则只打开一个 shell。'),
      cwd: z.string().optional().describe('工作目录（默认为工作区根目录）'),
    },
    logged('spawn_terminal', async ({ name, command, cwd }) => {
      const result = terminalManager.spawn(name, command, cwd)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    })
  )

  server.tool(
    'list_terminals',
    '列出所有托管终端及其状态（存活/已退出、日志大小）',
    {},
    logged('list_terminals', async () => {
      const terminals = terminalManager.list()
      return { content: [{ type: 'text', text: JSON.stringify(terminals) }] }
    })
  )

  server.tool(
    'read_terminal',
    '读取托管终端的最近输出。返回输出缓冲区的末尾内容。',
    {
      id: z.string().describe('终端 ID（来自 spawn_terminal 或 list_terminals）'),
      lines: z.number().int().min(1).optional().describe('从末尾返回的行数（默认：返回全部缓冲输出）'),
    },
    logged('read_terminal', async ({ id, lines }) => {
      const result = terminalManager.readOutput(id, lines)
      if (!result) throw new Error(`终端 '${id}' 不存在`)
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    })
  )

  server.tool(
    'write_terminal',
    '向托管终端发送输入/文本（例如回答提示、发送命令）',
    {
      id: z.string().describe('终端 ID'),
      input: z.string().describe('发送到终端标准输入的文本'),
      addNewline: z.boolean().optional().default(true).describe('输入后是否追加换行（默认：true）。交互式提示需要进程直接读取输入时请设为 false。'),
    },
    logged('write_terminal', async ({ id, input, addNewline }) => {
      const ok = terminalManager.write(id, input, addNewline)
      if (!ok) throw new Error(`终端 '${id}' 不存在或已退出`)
      return { content: [{ type: 'text', text: JSON.stringify({ sent: true }) }] }
    })
  )

  server.tool(
    'kill_terminal',
    '终止托管终端及其进程',
    {
      id: z.string().describe('终端 ID'),
    },
    logged('kill_terminal', async ({ id }) => {
      const ok = terminalManager.kill(id)
      if (!ok) throw new Error(`终端 '${id}' 不存在`)
      return { content: [{ type: 'text', text: JSON.stringify({ killed: true }) }] }
    })
  )
}
