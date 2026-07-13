# Lumen Markdown

Lumen 是一个轻量、专注且注重隐私的 Markdown 编辑器。它基于 Electron 构建，支持在浏览器端和 Windows 桌面端运行；文档内容默认只保存在当前设备的本地存储中。

## 功能

- Markdown 编辑与实时预览
- 支持粗体、斜体、标题、引用、行内代码和无序列表快捷插入
- 支持代码块、表格、任务列表、链接、图片等常用 Markdown 语法
- 拖放或选择 `.md` / `.markdown` 文件导入
- 支持 UTF-8、GBK、GB18030、UTF-16 LE 和 UTF-16 BE 编码预览与导出
- 在窗口底部显示自动识别的文件编码，并支持手动切换
- 导出为 Markdown 文件
- 一键复制渲染后的 HTML
- Dawn Light / Midnight Glow 两种主题，并记住主题选择
- 自动保存编辑内容、文档名称和编辑状态
- 显示字符数、行数和编辑/预览滚动同步状态
- Windows 安装包支持 `.md` 和 `.markdown` 文件关联

## 环境要求

- Node.js 18 或更高版本
- npm

## 开发运行

```bash
npm install
npm start
```

## 构建 Windows 安装包

```bash
npm run dist
```

构建结果位于 `dist/` 目录，包括：

- NSIS 安装程序：`Lumen-1.0.0-setup-x64.exe`
- 免安装版本：`Lumen-1.0.0-portable-x64.exe`

安装程序会注册 `.md` 和 `.markdown` 文件关联。安装完成后，可在 Windows 的“默认应用”设置中将 Lumen 设置为默认打开方式。

## 项目结构

```text
├── assets/       应用图标与品牌资源
├── app.js        编辑器交互、Markdown 渲染与本地存储
├── index.html    应用界面
├── main.js       Electron 主进程与文件关联处理
├── preload.js    主进程与渲染进程之间的安全桥接
├── styles.css    界面样式与主题
└── package.json  项目配置与构建脚本
```

## 隐私说明

Lumen 不要求登录，也不会主动上传文档内容。编辑内容通过浏览器的 `localStorage` 保存在本机；使用“导出”或打开本地文件时，文件操作由当前设备完成。

## 许可证

当前项目尚未指定开源许可证。
