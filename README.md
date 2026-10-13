<div align="center">

<img src="assets/lumen-logo-generated.png" alt="Lumen" width="420">

# Lumen Markdown

**让想法自然流淌。**

一个轻量、专注、注重隐私的 Markdown 编辑器，支持实时预览与 Windows 桌面端使用。

<p>
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square" alt="Windows">
  <img src="https://img.shields.io/badge/runtime-Electron-47848F?style=flat-square" alt="Electron">
  <img src="https://img.shields.io/badge/format-Markdown-083FA1?style=flat-square" alt="Markdown">
</p>

</div>

![Lumen interface preview](assets/document-features-preview.png)

## 产品理念

Lumen 的名字来自“微光”。它不是一个试图占据注意力的复杂工作台，而是一盏放在文字旁边的小灯：足够清晰，却不会打扰思考。

我们希望编辑器做到三件事：

- **安静**：让工具退后，让内容向前。
- **可靠**：打开、编辑、预览和导出都保持简单直接。
- **私密**：文档默认只保存在本地，不要求登录，也不主动上传内容。

## 功能亮点

- 新建空白文档，直接进入 Markdown 编辑器
- 多文档标签切换，每份文档独立保存内容、名称和编码，重启后恢复
- 文档标签带关闭按钮，关闭后保留草稿，可恢复最近关闭的文档
- 启动软件默认打开预览页；打开已有文档进入预览，新建文档进入编辑
- Markdown 编辑与实时预览
- `flowchart` 代码块流程图预览
- Mermaid flowchart 预览
- 编辑、预览和并列模式切换；并列模式下左右滚动实时同步
- 粗体、斜体、标题、引用、行内代码和列表快捷工具栏
- 代码块、表格、任务列表、图片和链接等常用语法
- 图片工具栏插入，支持网络图片、嵌入图片以及桌面端的本地、相对路径和 `file://` 图片
- 支持有序列表和常用安全 HTML 标签
- 自动识别并渲染 `http://`、`https://`、`www.` 蓝色超链接
- 支持本地文件路径和相对路径链接，并使用系统默认应用打开
- UTF-8、GBK、GB18030、UTF-16 LE、UTF-16 BE 编码识别与切换
- 拖放或多选 `.md` / `.markdown` 文件，按顺序打开为独立文档
- 按当前编码导出 Markdown 文件
- 一键复制渲染后的 HTML
- Dawn Light / Midnight Glow 主题
- 自动保存、字符统计、行数统计和 Windows 文件关联

### 飞书导出 Markdown 兼容

可直接打开飞书「下载为 → Markdown」生成的 `.md` 文件，也支持第三方导出器常见的扩展格式：

- 多层混合列表、嵌套任务、引用内列表、段内换行、中文粗体及转义字符
- 引用式图片与链接、中文及空格附件路径、带查询参数的图片下载链接
- 表格对齐、单元格内代码与竖线、多行单元格，以及 HTML 表格的合并行列和行内 Markdown
- 下划线、上下标、文字颜色、背景色、折叠块和六类提示块
- `$...$` 行内公式、`$$...$$` 多行公式以及 `math` / `latex` / `tex` 代码块
- `[TOC]` 目录、标题跳转、脚注及返回引用，代码语言高亮
- 本地或网络音视频的播放器；本地 Markdown 链接在 Lumen 内打开，其他附件通过系统应用打开

公式、解析器及代码高亮资源均随应用打包，可离线使用。第三方素材文件夹须与 Markdown 文件一起保留；在线图片加载失败时会提供原链接，便于在浏览器中打开。只有素材编号、没有内容或地址的导出标签会显示说明。

[飞书官方说明](https://www.feishu.cn/content/article/7644456827538820052)明确：原生导出保留正文基础结构及图片、附件链接，不导出评论。合并表格、公式、颜色和提示块等扩展支持也覆盖[第三方转换器](https://github.com/riba2534/feishu-cli/blob/main/internal/converter/block_to_markdown.go)与 [HTML 表格导出](https://github.com/leemysw/feishu-docx/blob/main/feishu_docx/utils/render_table.py)的输出。导出时已丢失的内容或布局无法从 `.md` 恢复；音视频是否可播放也取决于素材格式和访问权限。

离线渲染资源可用 `npm run build:markdown` 从锁定依赖重新生成。第三方许可证在 `assets/vendor-licenses/`；兼容性验证样例在 `scripts/fixtures/feishu-export.md`，为测试构造的代表性内容。

### Flowchart 语法

使用 `flowchart` 围栏代码块即可实时预览流程图：

```flowchart
st=>start: 开始
op=>operation: 处理内容
cond=>condition: 是否完成？
e=>end: 结束

st->op->cond
cond(yes)->e
cond(no)->op
```

也支持 Mermaid flowchart：

```mermaid
flowchart TD
  A[开始] --> B{是否完成?}
  B -->|是| C[结束]
  B -->|否| A
```

## 快速开始

### 开发运行

```bash
npm install
npm start
```

### 验证文档功能

```bash
npm test
```

验证会使用独立的临时数据目录和隐藏的 Electron 窗口，检查文档编辑、切换、持久保存、图片显示与启动预览。

### 构建 Windows 安装包

```bash
npm run dist
```

构建结果位于 `dist/`：

- `Lumen-1.0.0-setup-x64.exe`：安装程序
- `Lumen-1.0.0-portable-x64.exe`：免安装版本

安装程序支持 `.md` 和 `.markdown` 文件关联，也可以在 Windows“默认应用”设置中将 Lumen 设为默认打开方式。

## 使用小贴士

| 操作 | 说明 |
| --- | --- |
| `Ctrl + N` | 新建空白文档并进入编辑 |
| `Ctrl + O` | 选择并打开一个或多个文档 |
| `Ctrl + S` | 导出当前文档 |
| `Ctrl + W` | 关闭当前文档标签 |
| `Ctrl + Shift + T` | 恢复最近关闭的文档及草稿 |
| `Ctrl + B` | 粗体 |
| `Ctrl + I` | 斜体 |
| `Tab` | 在编辑器中插入两个空格 |
| 拖放多个文件 | 每个 Markdown 文件分别打开为一个标签 |
| 点击文档标签 | 切换查看或编辑文档，草稿分别自动保存 |
| 点击标签旁的 `×` | 关闭该文档；关闭当前文档后切换到相邻标签 |
| 点击「恢复关闭」 | 重新打开最近关闭的文档，恢复内容、名称和编码 |
| 点击编辑工具栏的图片按钮 | 插入图片；桌面端记录本地路径，浏览器端嵌入不超过 2 MB 的图片 |
| 点击底部“读取编码” | 按所选编码重新读取文件 |
| 点击文档名称 | 重命名当前文档 |

桌面端的图片相对路径以所在 Markdown 文件的目录为基准，例如 `![示意图](images/example.png)`。含空格的路径可以写成 `![示意图](<images/example image.png>)`。新建文档可通过图片按钮插入本地图片，或使用绝对路径；需要使用相对路径时，先导出并重新打开该 Markdown 文件。无法读取的图片会显示提示。

自动保存保留的是本机草稿；点击「导出 .md」将当前内容保存为 Markdown 文件。升级后的首次启动会保留旧版本的单文档草稿。

关闭标签会保留本机草稿，不会删除原文件。关闭最后一个标签后显示空预览页，可以新建、打开或恢复文档；重启软件不会自动打开已经关闭的标签。重新打开同一路径的文档时，会恢复之前关闭的草稿。

## 项目结构

```text
├── assets/       Logo、图标与 README 视觉资源
├── app.js        编辑器交互、Markdown 渲染与本地存储
├── markdown-renderer.js  Markdown、目录、脚注与数学公式解析
├── index.html    应用界面
├── main.js       Electron 主进程、文件关联与系统打开方式
├── preload.js    主进程与渲染进程之间的安全桥接
├── styles.css    界面样式与主题
└── package.json  项目配置与构建脚本
```

## 隐私说明

Lumen 不要求登录，也不会主动上传文档内容。编辑内容默认通过浏览器 `localStorage` 保存在本机；导入、导出和本地文件打开均由当前设备完成。

## 许可证

当前项目尚未指定开源许可证。

<div align="center">

Made for focused writing · Lumen

</div>
