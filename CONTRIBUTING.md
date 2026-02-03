# 贡献指南（Contributing）

欢迎提交 Issue / PR，让《代码伴生笔记（CodeBook）》变得更好。

## 提交 Issue

建议包含：
- 你在做什么（操作路径）
- 预期行为 vs 实际行为
- 复现步骤（最好可复现）
- 环境信息（Windows 版本、是否使用 Ollama / 云端模型等）
- 截图/录屏（如涉及 UI/交互）

## 开发环境

前置要求：
- Node.js 18+（推荐 20+）
- npm

启动开发：
```bash
cd app
npm install
npm run dev
```

检查与构建：
```bash
cd app
npm run lint
npm run build
```

## PR 规范

- 尽量保持改动小而聚焦：一个 PR 解决一个问题
- UI/交互类改动请附截图或录屏
- 不要在日志里输出 API Key 或本地路径等敏感信息
- 若新增功能涉及安全边界（IPC/文件系统/网络请求），请在 PR 描述里说明安全考虑

## 代码结构速览

- `app/src/`：渲染进程（React UI）
- `app/electron/`：Electron 主进程 / preload（安全白名单 API）
- `app/electron/lib/notes.ts`：笔记读写/落盘/扫描

