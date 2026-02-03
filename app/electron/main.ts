import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  createNote,
  deleteNote,
  ensureMainNote,
  listNotes,
  readNote,
  scanAllNoteDocs,
  saveImageFromDataUrl,
  saveNote,
} from './lib/notes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// 创建主窗口：仅加载渲染层页面，不暴露多余系统能力
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function toPosixRelativePath(baseDir: string, absolutePath: string) {
  return path.relative(baseDir, absolutePath).split(path.sep).join('/')
}

// 判断路径是否存在：避免抛异常导致主进程崩溃
async function exists(p: string) {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

// 从任意目录向上查找 Git 目录（支持 .git 目录或 .git 文件指向 gitdir）
async function findGitDir(startDir: string) {
  let current: string | null = path.resolve(startDir)
  while (current) {
    const dotGit = path.join(current, '.git')
    if (await exists(dotGit)) {
      const stat = await fs.promises.stat(dotGit)
      if (stat.isDirectory()) return dotGit

      if (stat.isFile()) {
        const content = await fs.promises.readFile(dotGit, 'utf8')
        const match = content.match(/gitdir:\s*(.+)\s*/i)
        if (match) {
          const gitDir = path.resolve(current, match[1].trim())
          if (await exists(gitDir)) return gitDir
        }
      }
    }

    const parent = path.dirname(current)
    if (parent === current) {
      current = null
      continue
    }
    current = parent
  }

  return null
}

// 解析 packed-refs：当 refs 被打包时，用它获取分支对应的 commit
async function readPackedRefsCommit(gitDir: string, refPath: string) {
  const packedRefsPath = path.join(gitDir, 'packed-refs')
  if (!(await exists(packedRefsPath))) return null

  const packed = await fs.promises.readFile(packedRefsPath, 'utf8')
  const lines = packed.split(/\r?\n/)
  for (const line of lines) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue
    const [commit, ref] = line.split(' ')
    if (ref === refPath) return commit
  }
  return null
}

// 获取当前 HEAD 的分支与 commit（尽量不依赖外部 git 命令，保证轻量与可控）
async function getGitHeadInfo(gitDir: string) {
  const headPath = path.join(gitDir, 'HEAD')
  const head = (await fs.promises.readFile(headPath, 'utf8')).trim()

  if (head.startsWith('ref:')) {
    const refPath = head.replace(/^ref:\s*/i, '').trim()
    const branch = refPath.startsWith('refs/heads/') ? refPath.slice('refs/heads/'.length) : refPath
    const refFile = path.join(gitDir, refPath.split('/').join(path.sep))
    let headCommit: string | undefined

    if (await exists(refFile)) {
      headCommit = (await fs.promises.readFile(refFile, 'utf8')).trim()
    } else {
      headCommit = (await readPackedRefsCommit(gitDir, refPath)) ?? undefined
    }

    return { branch, headCommit }
  }

  return { branch: undefined, headCommit: head }
}

// 非 Git 项目：快速生成“快照指纹”，用于笔记与代码的可追溯关联
async function computeFingerprintFast(dir: string) {
  const ignoreDirNames = new Set(['node_modules', '.git', '.vscode', 'dist', 'build', '__pycache__'])

  let fileCount = 0
  let maxMtimeMs = 0

  const stack: string[] = [dir]
  while (stack.length) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory() && ignoreDirNames.has(entry.name)) continue

      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(abs)
        continue
      }
      if (!entry.isFile()) continue

      fileCount += 1
      if (fileCount > 5000) break

      try {
        const stat = await fs.promises.stat(abs)
        maxMtimeMs = Math.max(maxMtimeMs, stat.mtimeMs)
      } catch {
        // ignore
      }
    }
  }

  const hash = crypto
    .createHash('sha256')
    .update(`${path.resolve(dir)}|${fileCount}|${maxMtimeMs}`)
    .digest('hex')
    .slice(0, 12)

  return hash
}

type CodeVersion =
  | {
      type: 'git'
      repoRoot: string
      relativePath?: string
      branch?: string
      headCommit?: string
      isDirtyApprox?: boolean
      label?: string
    }
  | {
      type: 'fingerprint'
      repoRoot: string
      relativePath?: string
      fingerprint: string
      label?: string
    }

// 统一代码版本标记：Git 项目使用 branch/commit；非 Git 项目使用 fingerprint
async function getCodeVersion(sourceDir: string, filePath?: string): Promise<CodeVersion> {
  const gitDir = await findGitDir(sourceDir)
  if (!gitDir) {
    const fingerprint = await computeFingerprintFast(sourceDir)
    return {
      type: 'fingerprint' as const,
      repoRoot: path.resolve(sourceDir),
      relativePath: filePath ? toPosixRelativePath(sourceDir, filePath) : undefined,
      fingerprint,
      label: undefined,
    }
  }

  const repoRoot = path.dirname(gitDir)
  const { branch, headCommit } = await getGitHeadInfo(gitDir)

  // “是否未提交”在 MVP 阶段采用近似判断：文件修改时间晚于 .git/index 则标记为“可能未提交”
  let isDirtyApprox: boolean | undefined
  if (filePath) {
    try {
      const fileStat = await fs.promises.stat(filePath)
      const indexPath = path.join(gitDir, 'index')
      if (await exists(indexPath)) {
        const indexStat = await fs.promises.stat(indexPath)
        isDirtyApprox = fileStat.mtimeMs > indexStat.mtimeMs
      }
    } catch {
      // ignore
    }
  }

  return {
    type: 'git' as const,
    repoRoot,
    relativePath: filePath ? toPosixRelativePath(sourceDir, filePath) : undefined,
    branch,
    headCommit,
    isDirtyApprox,
    label: undefined,
  }
}

function resolveSafeChildPath(baseDir: string, posixRelativePath: string) {
  const candidate = path.resolve(baseDir, ...posixRelativePath.split('/'))
  const base = path.resolve(baseDir)
  if (candidate === base) return candidate
  if (!candidate.startsWith(base + path.sep)) throw new Error('路径不合法')
  return candidate
}

function ensureNotesOutsideSource(sourceDir: string, notesDir: string) {
  const source = path.resolve(sourceDir)
  const notes = path.resolve(notesDir)
  if (notes === source || notes.startsWith(source + path.sep)) {
    throw new Error('笔记目录必须位于源代码目录之外')
  }
}

function toNoteSource(codeVersion: Awaited<ReturnType<typeof getCodeVersion>>, sourceRelativePath: string) {
  if (codeVersion.type === 'git') {
    return {
      type: 'git' as const,
      repo_root: codeVersion.repoRoot,
      relative_path: sourceRelativePath,
      branch: codeVersion.branch,
      head_commit: codeVersion.headCommit,
      is_dirty_approx: codeVersion.isDirtyApprox,
      label: codeVersion.label,
    }
  }
  return {
    type: 'fingerprint' as const,
    repo_root: codeVersion.repoRoot,
    relative_path: sourceRelativePath,
    fingerprint: codeVersion.fingerprint,
    label: codeVersion.label,
  }
}

ipcMain.handle('dialog:selectDirectory', async (_event, payload: { purpose: 'source' | 'notes' }) => {
  const title = payload.purpose === 'source' ? '选择源代码目录' : '选择笔记存储目录'
  const result = await dialog.showOpenDialog({ title, properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0] ?? null
})

ipcMain.handle('path:join', async (_event, payload: { base: string; child: string }) => {
  return path.join(payload.base, payload.child)
})

ipcMain.handle('fs:scanDirectory', async (_event, payload: { sourceDir: string }) => {
  const sourceDir = path.resolve(payload.sourceDir)
  const ignoreDirNames = new Set(['node_modules', '.git', '.vscode', 'dist', 'build', '__pycache__'])
  const allowExt = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.java',
    '.rs',
    '.c',
    '.cc',
    '.cpp',
    '.h',
    '.hpp',
    '.md',
    '.txt',
    '.json',
    '.yml',
    '.yaml',
    '.toml',
    '.ini',
    '.css',
    '.html',
    '.xml',
    '.env',
    '.sh',
    '.bat',
    '.ps1',
    '.sql',
  ])
  const allowNoExt = new Set(['makefile', 'dockerfile', 'license', 'readme'])
  const results: Array<{ absolutePath: string; relativePath: string; kind: 'file' | 'dir' }> = []

  const stack: string[] = [sourceDir]
  while (stack.length) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory() && ignoreDirNames.has(entry.name)) continue
      const abs = path.join(current, entry.name)
      const kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : null
      if (!kind) continue
      if (kind === 'file') {
        const lower = entry.name.toLowerCase()
        const ext = path.extname(lower)
        if (ext) {
          if (!allowExt.has(ext)) continue
        } else {
          if (!allowNoExt.has(lower)) continue
        }
      }

      const rel = toPosixRelativePath(sourceDir, abs)
      results.push({ absolutePath: abs, relativePath: rel, kind })

      if (kind === 'dir') stack.push(abs)
    }
  }

  return results
})

ipcMain.handle('fs:readTextFile', async (_event, payload: { filePath: string }) => {
  const filePath = path.resolve(payload.filePath)
  const stat = await fs.promises.stat(filePath)
  const maxSizeBytes = 2 * 1024 * 1024
  if (stat.size > maxSizeBytes) throw new Error('文件过大，暂不支持直接预览')
  return fs.promises.readFile(filePath, 'utf8')
})

ipcMain.handle('source:getCodeVersion', async (_event, payload: { sourceDir: string; filePath?: string }) => {
  return getCodeVersion(payload.sourceDir, payload.filePath)
})

ipcMain.handle(
  'notes:listNotes',
  async (
    _event,
    payload: { sourceDir: string; notesDir: string; sourceRelativePath: string },
  ) => {
    ensureNotesOutsideSource(payload.sourceDir, payload.notesDir)
    const absSourceFile = resolveSafeChildPath(payload.sourceDir, payload.sourceRelativePath)
    const cv = await getCodeVersion(payload.sourceDir, absSourceFile)
    const source = toNoteSource(cv, payload.sourceRelativePath)
    await ensureMainNote(payload.notesDir, payload.sourceRelativePath, source)
    return listNotes(payload.notesDir, payload.sourceRelativePath)
  },
)

ipcMain.handle(
  'notes:readNote',
  async (_event, payload: { notesDir: string; sourceRelativePath: string; fileName: string }) => {
    return readNote(payload.notesDir, payload.sourceRelativePath, payload.fileName)
  },
)

ipcMain.handle(
  'notes:saveNote',
  async (
    _event,
    payload: {
      sourceDir: string
      notesDir: string
      sourceRelativePath: string
      fileName: string
      title?: string
      tags?: string[]
      content: string
    },
  ) => {
    ensureNotesOutsideSource(payload.sourceDir, payload.notesDir)
    const absSourceFile = resolveSafeChildPath(payload.sourceDir, payload.sourceRelativePath)
    const cv = await getCodeVersion(payload.sourceDir, absSourceFile)
    const source = toNoteSource(cv, payload.sourceRelativePath)
    await saveNote(payload.notesDir, payload.sourceRelativePath, payload.fileName, payload.content, {
      title: payload.title,
      tags: payload.tags,
      source,
    })
    return { ok: true }
  },
)

ipcMain.handle(
  'notes:createNote',
  async (
    _event,
    payload: { sourceDir: string; notesDir: string; sourceRelativePath: string; title: string },
  ) => {
    ensureNotesOutsideSource(payload.sourceDir, payload.notesDir)
    const absSourceFile = resolveSafeChildPath(payload.sourceDir, payload.sourceRelativePath)
    const cv = await getCodeVersion(payload.sourceDir, absSourceFile)
    const source = toNoteSource(cv, payload.sourceRelativePath)
    const fileName = await createNote(payload.notesDir, payload.sourceRelativePath, payload.title, source)
    return { fileName }
  },
)

ipcMain.handle(
  'notes:deleteNote',
  async (_event, payload: { sourceDir: string; notesDir: string; sourceRelativePath: string; fileName: string }) => {
    ensureNotesOutsideSource(payload.sourceDir, payload.notesDir)
    await deleteNote(payload.notesDir, payload.sourceRelativePath, payload.fileName)
    return { ok: true }
  },
)

ipcMain.handle('notes:saveImage', async (_event, payload: { notesDir: string; dataUrl: string }) => {
  return saveImageFromDataUrl(payload.notesDir, payload.dataUrl)
})

ipcMain.handle('notes:readAssetDataUrl', async (_event, payload: { notesDir: string; assetRelativePath: string }) => {
  const base = path.resolve(payload.notesDir)
  const target = path.resolve(base, ...payload.assetRelativePath.split('/'))
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error('路径不合法')
  const buf = await fs.promises.readFile(target)
  const ext = path.extname(target).toLowerCase()
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.gif'
          ? 'image/gif'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream'
  return `data:${mime};base64,${buf.toString('base64')}`
})

ipcMain.handle('search:loadNoteDocs', async (_event, payload: { notesDir: string }) => {
  return scanAllNoteDocs(payload.notesDir)
})

ipcMain.handle(
  'search:sourceText',
  async (_event, payload: { sourceDir: string; query: string; limit: number }) => {
    const q = payload.query.trim()
    if (!q) return []

    const root = path.resolve(payload.sourceDir)
    const ignoreDirNames = new Set(['.git', '.vscode', 'node_modules', 'dist', 'build', 'out', '.next', '.turbo'])
    const allowExt = new Set([
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.py',
      '.go',
      '.java',
      '.rs',
      '.md',
      '.txt',
      '.json',
      '.yml',
      '.yaml',
      '.toml',
      '.css',
      '.html',
      '.xml',
      '.env',
      '.sh',
      '.bat',
      '.ps1',
    ])

    const results: Array<{ relativePath: string; line: number; preview: string }> = []
    const stack: string[] = [root]
    const qLower = q.toLowerCase()

    while (stack.length && results.length < payload.limit) {
      const current = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (results.length >= payload.limit) break
        const abs = path.join(current, entry.name)
        if (entry.isDirectory()) {
          if (ignoreDirNames.has(entry.name)) continue
          stack.push(abs)
          continue
        }
        if (!entry.isFile()) continue

        const ext = path.extname(entry.name).toLowerCase()
        if (ext && !allowExt.has(ext)) continue

        let st: fs.Stats
        try {
          st = await fs.promises.stat(abs)
        } catch {
          continue
        }
        if (st.size > 512 * 1024) continue

        let buf: Buffer
        try {
          buf = await fs.promises.readFile(abs)
        } catch {
          continue
        }
        if (buf.includes(0)) continue

        const text = buf.toString('utf8')
        const idx = text.toLowerCase().indexOf(qLower)
        if (idx < 0) continue

        const before = text.lastIndexOf('\n', idx)
        const after = text.indexOf('\n', idx)
        const lineText = text.slice(before < 0 ? 0 : before + 1, after < 0 ? text.length : after).trim()
        const line = (text.slice(0, idx).match(/\n/g) ?? []).length + 1
        const relativePath = path.relative(root, abs).split(path.sep).join('/')
        results.push({ relativePath, line, preview: lineText })
      }
    }

    return results
  },
)

type FetchInit = {
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}

async function fetchJsonWithTimeout(url: string, init: FetchInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) {
      const body = await res
        .text()
        .then((t) => t.trim())
        .catch(() => '')
      const tail = body ? ` - ${body.slice(0, 240)}` : ''
      throw new Error(`请求失败：${res.status} ${res.statusText}${tail}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

function normalizeOpenAIChatCompletionsUrl(endpoint: string) {
  const base = endpoint.replace(/\/+$/g, '')
  if (base.includes('/chat/completions')) return base
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

ipcMain.handle(
  'ai:explainSelection',
  async (
    _event,
    payload: {
      mode: 'ollama' | 'openai'
      endpoint: string
      model: string
      apiKey?: string
      sourceRelativePath: string
      selectedCode: string
    },
  ) => {
    const selected = payload.selectedCode.trim()
    if (!selected) throw new Error('未选择任何代码')

    if (!payload.endpoint || !payload.model) throw new Error('AI 配置不完整（endpoint/model）')

    if (payload.mode === 'ollama') {
      const url = payload.endpoint.replace(/\/+$/g, '') + '/api/generate'
      const prompt =
        `你是“代码伴生笔记”的代码阅读助手。\\n` +
        `请用中文解释下面代码片段的具体作用、关键变量含义、可能的边界情况。\\n` +
        `文件：${payload.sourceRelativePath}\\n` +
        `代码：\\n\\n${selected}\\n`
      const json = await fetchJsonWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: payload.model, prompt, stream: false }),
        },
        60_000,
      )
      const response = typeof json?.response === 'string' ? json.response : JSON.stringify(json)
      return { text: response }
    }

    const url = normalizeOpenAIChatCompletionsUrl(payload.endpoint)
    const apiKey = payload.apiKey?.trim()
    if (!apiKey) throw new Error('未提供 API Key')

    const json = await fetchJsonWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: payload.model,
          messages: [
            {
              role: 'system',
              content: '你是代码阅读助手。输出请尽量结构化，便于直接插入 Markdown 笔记。',
            },
            {
              role: 'user',
              content:
                `请用中文解释下面代码片段的具体作用、关键变量含义、可能的边界情况。\\n` +
                `文件：${payload.sourceRelativePath}\\n` +
                `代码：\\n\\n${selected}\\n`,
            },
          ],
          temperature: 0.2,
        }),
      },
      60_000,
    )

    const text = json?.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error('AI 返回格式不正确')
    return { text }
  },
)

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  createWindow()
})
