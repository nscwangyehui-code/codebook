# 代码伴生笔记（CodeBook）开发说明

项目介绍与使用说明见仓库根目录 [README.md](../README.md)。

## 开发运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 打包（Windows）

```bash
npm run package
```

> 如果在 Windows 上遇到“创建符号链接权限”相关报错：开启开发者模式或使用管理员权限运行。

## 目录说明

- `src/`：渲染进程（React UI）
- `electron/`：主进程与 preload（安全 IPC 白名单）
- `electron/lib/notes.ts`：笔记落盘/读取/扫描
- `electron/main.ts`：搜索、AI、文件系统等 handler
