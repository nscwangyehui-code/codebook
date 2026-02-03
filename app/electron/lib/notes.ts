import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'

export type NoteSource =
  | {
      type: 'git'
      repo_root: string
      relative_path: string
      branch?: string
      head_commit?: string
      is_dirty_approx?: boolean
      label?: string
    }
  | {
      type: 'fingerprint'
      repo_root: string
      relative_path: string
      fingerprint: string
      label?: string
    }

export type NoteFrontmatter = {
  schema_version: 1
  id: string
  title: string
  tags: string[]
  created_at: string
  updated_at: string
  source: NoteSource
}

export type NoteSummary = {
  fileName: string
  title: string
  id: string
  updated_at: string
}

export type NoteDoc = {
  docId: string
  sourceRelativePath: string
  noteFileName: string
  title: string
  tags: string[]
  updated_at: string
  content: string
}

function nowIso() {
  return new Date().toISOString()
}

function pruneUndefined(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (Array.isArray(value)) {
    return value.map((v) => pruneUndefined(v))
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      const pruned = pruneUndefined(v)
      if (pruned === undefined) continue
      out[k] = pruned
    }
    return out
  }
  return value
}

function sanitizeForYaml<T>(obj: T): T {
  return pruneUndefined(obj) as T
}

function ensureSafeFileName(raw: string) {
  const trimmed = raw.trim()
  const noControl = Array.from(trimmed)
    .map((ch) => (ch.charCodeAt(0) < 32 ? '-' : ch))
    .join('')
  const replaced = noControl.replace(/[<>:"/\\|?*]/g, '-')
  const collapsed = replaced.replace(/-+/g, '-')
  const safe = collapsed.slice(0, 48).replace(/^[.\s-]+|[.\s-]+$/g, '')
  return safe || '未命名'
}

function ensureSafeNoteFileName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) throw new Error('文件名不能为空')
  if (trimmed.includes('/') || trimmed.includes('\\')) throw new Error('文件名不合法')
  if (!trimmed.toLowerCase().endsWith('.md')) throw new Error('仅支持删除 .md 笔记文件')
  return trimmed
}

function noteFolderPath(notesDir: string, sourceRelativePath: string) {
  return path.join(notesDir, ...sourceRelativePath.split('/'))
}

async function ensureDir(dirPath: string) {
  await fs.promises.mkdir(dirPath, { recursive: true })
}

// 原子写入：避免断电/崩溃导致笔记文件损坏
export async function writeTextFileAtomic(filePath: string, content: string) {
  const dir = path.dirname(filePath)
  await ensureDir(dir)

  const tempName = `${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`
  const tempPath = path.join(dir, tempName)

  await fs.promises.writeFile(tempPath, content, 'utf8')
  try {
    await fs.promises.rename(tempPath, filePath)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'EPERM' && err.code !== 'EEXIST' && err.code !== 'ENOTEMPTY') throw err
    await fs.promises.copyFile(tempPath, filePath)
    await fs.promises.unlink(tempPath).catch(() => {})
  }
}

// 原子写入（二进制）：用于图片等资源落盘
export async function writeBufferFileAtomic(filePath: string, buffer: Buffer) {
  const dir = path.dirname(filePath)
  await ensureDir(dir)

  const tempName = `${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`
  const tempPath = path.join(dir, tempName)

  await fs.promises.writeFile(tempPath, buffer)
  try {
    await fs.promises.rename(tempPath, filePath)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'EPERM' && err.code !== 'EEXIST' && err.code !== 'ENOTEMPTY') throw err
    await fs.promises.copyFile(tempPath, filePath)
    await fs.promises.unlink(tempPath).catch(() => {})
  }
}

export async function ensureMainNote(notesDir: string, sourceRelativePath: string, source: NoteSource) {
  const folder = noteFolderPath(notesDir, sourceRelativePath)
  await ensureDir(folder)

  const mainPath = path.join(folder, 'main.md')
  try {
    await fs.promises.access(mainPath)
    return
  } catch {
    const createdAt = nowIso()
    const fm: NoteFrontmatter = {
      schema_version: 1,
      id: crypto.randomUUID(),
      title: '主笔记',
      tags: [],
      created_at: createdAt,
      updated_at: createdAt,
      source,
    }
    const initialBody = ''
    const full = matter.stringify(initialBody, sanitizeForYaml(fm))
    await writeTextFileAtomic(mainPath, full)
  }
}

export async function listNotes(notesDir: string, sourceRelativePath: string): Promise<NoteSummary[]> {
  const folder = noteFolderPath(notesDir, sourceRelativePath)
  await ensureDir(folder)

  let fileNames: string[] = []
  try {
    fileNames = await fs.promises.readdir(folder)
  } catch {
    fileNames = []
  }

  const mdFiles = fileNames.filter((n) => n.toLowerCase().endsWith('.md'))
  const summaries: NoteSummary[] = []

  for (const fileName of mdFiles) {
    const filePath = path.join(folder, fileName)
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8')
      const parsed = matter(raw)
      const data = parsed.data as Partial<NoteFrontmatter>
      summaries.push({
        fileName,
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : fileName,
        id: typeof data.id === 'string' ? data.id : fileName,
        updated_at: typeof data.updated_at === 'string' ? data.updated_at : '',
      })
    } catch {
      summaries.push({ fileName, title: fileName, id: fileName, updated_at: '' })
    }
  }

  summaries.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
  return summaries
}

export async function readNote(notesDir: string, sourceRelativePath: string, fileName: string) {
  const folder = noteFolderPath(notesDir, sourceRelativePath)
  const filePath = path.join(folder, fileName)
  const raw = await fs.promises.readFile(filePath, 'utf8')
  const parsed = matter(raw)
  return {
    frontmatter: parsed.data as NoteFrontmatter,
    content: parsed.content,
    raw,
  }
}

export async function saveNote(
  notesDir: string,
  sourceRelativePath: string,
  fileName: string,
  content: string,
  patch: { title?: string; tags?: string[]; source?: NoteSource },
) {
  const folder = noteFolderPath(notesDir, sourceRelativePath)
  const filePath = path.join(folder, fileName)

  let frontmatter: NoteFrontmatter
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8')
    const parsed = matter(raw)
    const data = parsed.data as Partial<NoteFrontmatter>
    const source = (data.source as NoteSource | undefined) ?? patch.source
    if (!source) throw new Error('笔记缺少 source 信息，无法保存')
    frontmatter = {
      schema_version: 1,
      id: typeof data.id === 'string' && data.id ? data.id : crypto.randomUUID(),
      title: typeof data.title === 'string' && data.title ? data.title : '主笔记',
      tags: Array.isArray(data.tags) ? (data.tags as unknown[]).filter((x) => typeof x === 'string') as string[] : [],
      created_at: typeof data.created_at === 'string' && data.created_at ? data.created_at : nowIso(),
      updated_at: nowIso(),
      source,
    }
  } catch {
    if (!patch.source) throw new Error('未提供 source 信息，无法创建笔记')
    const createdAt = nowIso()
    frontmatter = {
      schema_version: 1,
      id: crypto.randomUUID(),
      title: '主笔记',
      tags: [],
      created_at: createdAt,
      updated_at: createdAt,
      source: patch.source,
    }
  }

  if (patch.title) frontmatter.title = patch.title
  if (patch.tags) frontmatter.tags = patch.tags
  if (patch.source) frontmatter.source = patch.source

  const full = matter.stringify(content, sanitizeForYaml(frontmatter))
  await writeTextFileAtomic(filePath, full)
}

export async function createNote(notesDir: string, sourceRelativePath: string, title: string, source: NoteSource) {
  const folder = noteFolderPath(notesDir, sourceRelativePath)
  await ensureDir(folder)

  const createdAt = nowIso()
  const id = crypto.randomUUID()
  const safeTitle = ensureSafeFileName(title)
  const fileName = `${safeTitle}-${id.slice(0, 8)}.md`

  const fm: NoteFrontmatter = {
    schema_version: 1,
    id,
    title: title.trim() || safeTitle,
    tags: [],
    created_at: createdAt,
    updated_at: createdAt,
    source,
  }

  const full = matter.stringify('', sanitizeForYaml(fm))
  await writeTextFileAtomic(path.join(folder, fileName), full)
  return fileName
}

export async function deleteNote(notesDir: string, sourceRelativePath: string, fileName: string) {
  const folder = noteFolderPath(notesDir, sourceRelativePath)
  const safeFileName = ensureSafeNoteFileName(fileName)
  const filePath = path.join(folder, safeFileName)

  await fs.promises.unlink(filePath)

  const root = path.resolve(notesDir)
  let current = path.resolve(folder)
  while (current !== root && current.startsWith(root + path.sep)) {
    try {
      const items = await fs.promises.readdir(current)
      if (items.length) break
      await fs.promises.rmdir(current)
    } catch {
      break
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}

export async function saveImageFromDataUrl(notesDir: string, dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) throw new Error('图片数据格式不正确')

  const mime = match[1].toLowerCase()
  const base64 = match[2]
  const buffer = Buffer.from(base64, 'base64')

  const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
  const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16)
  const fileName = `${hash}.${ext}`

  const assetsDir = path.join(notesDir, 'assets')
  await ensureDir(assetsDir)

  const absPath = path.join(assetsDir, fileName)
  const alreadyExists = await fs.promises
    .access(absPath)
    .then(() => true)
    .catch(() => false)
  if (!alreadyExists) await writeBufferFileAtomic(absPath, buffer)

  return { relativePath: `assets/${fileName}` }
}

function toPosixPath(p: string) {
  return p.split(path.sep).join('/')
}

// 扫描整个笔记库并返回可索引的文档集合（用于全局搜索与命令面板）
export async function scanAllNoteDocs(notesDir: string): Promise<NoteDoc[]> {
  const root = path.resolve(notesDir)
  const ignoreDirNames = new Set(['assets', '.git', '.vscode', 'node_modules'])

  const docs: NoteDoc[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (ignoreDirNames.has(entry.name)) continue
        stack.push(abs)
        continue
      }

      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith('.md')) continue

      const folder = path.dirname(abs)
      const sourceRelativePath = toPosixPath(path.relative(root, folder))
      const noteFileName = entry.name
      const docId = `${sourceRelativePath}::${noteFileName}`

      try {
        const raw = await fs.promises.readFile(abs, 'utf8')
        const parsed = matter(raw)
        const data = parsed.data as Partial<NoteFrontmatter>
        const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : noteFileName
        const tags = Array.isArray(data.tags) ? (data.tags as unknown[]).filter((x) => typeof x === 'string') as string[] : []
        const updated_at = typeof data.updated_at === 'string' ? data.updated_at : ''
        docs.push({ docId, sourceRelativePath, noteFileName, title, tags, updated_at, content: parsed.content || '' })
      } catch {
        docs.push({ docId, sourceRelativePath, noteFileName, title: noteFileName, tags: [], updated_at: '', content: '' })
      }
    }
  }

  docs.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
  return docs
}
