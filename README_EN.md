# CodeBook — Code-Adjacent Notes

<!--
Replace all <OWNER>/<REPO> below with your GitHub repository, e.g. wangyexxx/codebook
-->

[![CI](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml/badge.svg)](https://github.com/<OWNER>/<REPO>/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/<OWNER>/<REPO>?display_name=tag&sort=semver)](https://github.com/<OWNER>/<REPO>/releases)
[![Downloads](https://img.shields.io/github/downloads/<OWNER>/<REPO>/total)](https://github.com/<OWNER>/<REPO>/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/<OWNER>/<REPO>?style=social)](https://github.com/<OWNER>/<REPO>/stargazers)

A local desktop note tool designed for **reading / learning / maintaining real-world codebases**:
project tree on the left, read-only code in the middle, and Markdown notes on the right — **one-to-one mapped to source files** (images supported).

> 中文说明: [README.md](./README.md)

---

## Quick Start

1. Download the Windows installer from Releases: `*-Setup.exe`
2. First launch:
   - Set “Notes Root” (outside your source directory)
   - Select “Source Directory”

---

## Screenshots / Demo

Put screenshots under `docs/screenshots/` and replace the filenames below.

- 3-pane workspace (tree / code / notes)  
  ![Workspace](./docs/screenshots/workspace.png)
- Ctrl+P global keyword search  
  ![Ctrl+P](./docs/screenshots/ctrlp.png)
- Ctrl+K in-file find (Prev/Next)  
  ![Ctrl+K](./docs/screenshots/ctrlk.png)
- Paste images into notes (auto-saved to assets/)  
  ![Paste Image](./docs/screenshots/paste-image.png)
- Select code → AI explain → insert into note  
  ![AI Explain](./docs/screenshots/ai-explain.png)

## Why it exists

- Comments inside code can’t hold your full understanding: long explanations, screenshots, comparisons, “why” reasoning, pitfalls, etc.
- General note apps don’t map well to code: notes drift away from files, paths change, multi-project context gets messy.
- AI/vibe-coding creates new problems: chat context is ephemeral, hard to search, and sending entire files wastes tokens.

---

## What it solves

- Notes mirror the project tree: you always know which note belongs to which file.
- Notes live **outside** the source directory: no repo pollution, no noisy PRs.
- Image-friendly: paste images directly into notes; saved to `assets/` automatically.
- Two-stage search flow:
  - `Ctrl+P`: global keyword search (find which **code files / notes** contain the keyword)
  - `Ctrl+K`: in-file find (current code / current note) with Prev/Next navigation
- AI “Explain Selection”: send only the selected snippet to your configured endpoint (Ollama local or OpenAI-compatible) and insert results into notes.
- Code version traceability: shows `branch@commit` (or a fingerprint for non-git projects).

---

## Usage (detailed)

### First run
1. Set **Notes Root** (recommended)  
   Open menu from the top-left badge → “Set Notes Root”.  
   A per-project folder will be created under this directory.

2. Select **Source Directory**  
   Menu → “Select Source Directory” (any project folder).

3. Start taking notes
   - Click files from the left tree to open read-only code
   - Use “+ New Note” to create notes for the current file

### Global keyword search (Ctrl+P)
1. Press `Ctrl+P`
2. Type a keyword (2+ chars recommended)
3. Click results:
   - `🔎` code match: opens the file
   - `📝` note match: opens the file and switches to the note

### In-file find (Ctrl+K)
1. Open a file or note, press `Ctrl+K`
2. Choose scope: Code / Note
3. Type keyword → press “Find”
4. Use Prev/Next (or `Enter` / `Shift+Enter`) to navigate occurrences

### AI explain selection
1. Select code in the code pane → right click → “AI explain selection”
2. Configure endpoint/model:
   - Ollama: local endpoint + model name
   - OpenAI-compatible: endpoint + model + API key
3. Insert the explanation into current note if needed

---

## Privacy & Security

- Local-first: notes and images are stored on your disk.
- AI sends only the selected snippet to your configured endpoint.
- API keys are saved locally; no telemetry by default.

---

## Build

```bash
cd app
npm install
npm run dev
```

Build (no packaging):
```bash
cd app
npm run build
```

Package (Windows):
```bash
cd app
npm run package
```

---

## License

MIT — see [LICENSE](./LICENSE).

## Releases & Changelog

- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- Release notes template: [.github/RELEASE_TEMPLATE.md](./.github/RELEASE_TEMPLATE.md)
