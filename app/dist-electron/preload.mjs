"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  selectDirectory(purpose) {
    return electron.ipcRenderer.invoke("dialog:selectDirectory", { purpose });
  },
  joinPath(base, child) {
    return electron.ipcRenderer.invoke("path:join", { base, child });
  },
  scanDirectory(sourceDir) {
    return electron.ipcRenderer.invoke("fs:scanDirectory", { sourceDir });
  },
  readTextFile(filePath) {
    return electron.ipcRenderer.invoke("fs:readTextFile", { filePath });
  },
  getCodeVersion(sourceDir, filePath) {
    return electron.ipcRenderer.invoke("source:getCodeVersion", { sourceDir, filePath });
  },
  listNotes(sourceDir, notesDir, sourceRelativePath) {
    return electron.ipcRenderer.invoke("notes:listNotes", { sourceDir, notesDir, sourceRelativePath });
  },
  readNote(notesDir, sourceRelativePath, fileName) {
    return electron.ipcRenderer.invoke("notes:readNote", { notesDir, sourceRelativePath, fileName });
  },
  saveNote(sourceDir, notesDir, sourceRelativePath, fileName, content, patch) {
    return electron.ipcRenderer.invoke("notes:saveNote", {
      sourceDir,
      notesDir,
      sourceRelativePath,
      fileName,
      content,
      ...patch
    });
  },
  createNote(sourceDir, notesDir, sourceRelativePath, title) {
    return electron.ipcRenderer.invoke("notes:createNote", {
      sourceDir,
      notesDir,
      sourceRelativePath,
      title
    });
  },
  deleteNote(sourceDir, notesDir, sourceRelativePath, fileName) {
    return electron.ipcRenderer.invoke("notes:deleteNote", { sourceDir, notesDir, sourceRelativePath, fileName });
  },
  saveImage(notesDir, dataUrl) {
    return electron.ipcRenderer.invoke("notes:saveImage", { notesDir, dataUrl });
  },
  loadNoteDocs(notesDir) {
    return electron.ipcRenderer.invoke("search:loadNoteDocs", { notesDir });
  },
  explainSelectionWithAI(payload) {
    return electron.ipcRenderer.invoke("ai:explainSelection", payload);
  },
  loadNotesAssetDataUrl(notesDir, assetRelativePath) {
    return electron.ipcRenderer.invoke("notes:readAssetDataUrl", { notesDir, assetRelativePath });
  },
  searchSourceText(sourceDir, query, limit = 20) {
    return electron.ipcRenderer.invoke("search:sourceText", { sourceDir, query, limit });
  }
});
