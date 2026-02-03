import { contextBridge, ipcRenderer } from 'electron'

type SelectDirectoryPurpose = 'source' | 'notes'

export type CodeVersion =
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

export type FsEntry = {
  absolutePath: string
  relativePath: string
  kind: 'file' | 'dir'
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

// 仅暴露白名单 API，避免渲染进程任意调用系统能力（隐私与安全红线）
contextBridge.exposeInMainWorld('api', {
  selectDirectory(purpose: SelectDirectoryPurpose) {
    return ipcRenderer.invoke('dialog:selectDirectory', { purpose }) as Promise<string | null>
  },
  joinPath(base: string, child: string) {
    return ipcRenderer.invoke('path:join', { base, child }) as Promise<string>
  },

  scanDirectory(sourceDir: string) {
    return ipcRenderer.invoke('fs:scanDirectory', { sourceDir }) as Promise<FsEntry[]>
  },
  readTextFile(filePath: string) {
    return ipcRenderer.invoke('fs:readTextFile', { filePath }) as Promise<string>
  },


  getCodeVersion(sourceDir: string, filePath?: string) {
    return ipcRenderer.invoke('source:getCodeVersion', { sourceDir, filePath }) as Promise<CodeVersion>
  },

  listNotes(sourceDir: string, notesDir: string, sourceRelativePath: string) {
    return ipcRenderer.invoke('notes:listNotes', { sourceDir, notesDir, sourceRelativePath }) as Promise<NoteSummary[]>
  },

  readNote(notesDir: string, sourceRelativePath: string, fileName: string) {
    return ipcRenderer.invoke('notes:readNote', { notesDir, sourceRelativePath, fileName }) as Promise<{
      frontmatter: unknown
      content: string
      raw: string
    }>
  },

  saveNote(
    sourceDir: string,
    notesDir: string,
    sourceRelativePath: string,
    fileName: string,
    content: string,
    patch: { title?: string; tags?: string[] },
  ) {
    return ipcRenderer.invoke('notes:saveNote', {
      sourceDir,
      notesDir,
      sourceRelativePath,
      fileName,
      content,
      ...patch,
    }) as Promise<{ ok: true }>
  },

  createNote(sourceDir: string, notesDir: string, sourceRelativePath: string, title: string) {
    return ipcRenderer.invoke('notes:createNote', {
      sourceDir,
      notesDir,
      sourceRelativePath,
      title,
    }) as Promise<{ fileName: string }>
  },

  deleteNote(sourceDir: string, notesDir: string, sourceRelativePath: string, fileName: string) {
    return ipcRenderer.invoke('notes:deleteNote', { sourceDir, notesDir, sourceRelativePath, fileName }) as Promise<{
      ok: true
    }>
  },

  saveImage(notesDir: string, dataUrl: string) {
    return ipcRenderer.invoke('notes:saveImage', { notesDir, dataUrl }) as Promise<{ relativePath: string }>
  },

  loadNoteDocs(notesDir: string) {
    return ipcRenderer.invoke('search:loadNoteDocs', { notesDir }) as Promise<NoteDoc[]>
  },

  explainSelectionWithAI(payload: {
    mode: 'ollama' | 'openai'
    endpoint: string
    model: string
    apiKey?: string
    sourceRelativePath: string
    selectedCode: string
  }) {
    return ipcRenderer.invoke('ai:explainSelection', payload) as Promise<{ text: string }>
  },

  loadNotesAssetDataUrl(notesDir: string, assetRelativePath: string) {
    return ipcRenderer.invoke('notes:readAssetDataUrl', { notesDir, assetRelativePath }) as Promise<string>
  },

  searchSourceText(sourceDir: string, query: string, limit = 20) {
    return ipcRenderer.invoke('search:sourceText', { sourceDir, query, limit }) as Promise<
      Array<{ relativePath: string; line: number; preview: string }>
    >
  },
})
