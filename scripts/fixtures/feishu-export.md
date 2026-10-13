<!-- Representative compatibility fixture, assembled for tests; not an official Feishu export. -->
# 飞书导出兼容样例

[TOC]

## 文字与换行

这是**中文粗体**相邻文字、*强调*、~~删除线~~和 `行内代码`。

段内第一行
段内第二行

显式换行第一行  
显式换行第二行

反斜杠换行第一行\
反斜杠换行第二行

## 多层列表

3. 三级起点
   - 嵌套无序一
     1. 嵌套有序一
     2. 嵌套有序二
   - 嵌套无序二
4. 下一项

- [x] 已完成任务
  - [ ] 内层任务
- [ ] 待办任务

## 引用与提示

> 引用第一段
>
> 引用第二段
>
> - 引用列表一
> - 引用列表二
>
> > 嵌套引用

> [!NOTE]
> 飞书导出中的说明提示。

## 表格

| 左侧 | 居中 | 右侧 |
| :--- | :---: | ---: |
| 文字中的转义 \| 竖线 | `a|b` | **加粗单元格** |
| 第二行 | `a\|b` | 42 |

<table>
  <tr><th colspan="2">合并表头</th></tr>
  <tr><td rowspan="2">合并行</td><td>第一行内容</td></tr>
  <tr><td>第二行内容</td></tr>
  <tr><td colspan="2">[飞书参考][feishu] · [^explanation] · **单元格粗体** · $x^2$ · ![单元格引用图][reference-image]</td></tr>
</table>

## 富文本

<p><span style="color: #d32f2f; background-color: #fff4cc; font-weight: 600;">保留颜色和背景</span> <u>下划线内容</u> H<sub>2</sub>O 与 X<sup>2</sup></p>

<p style="text-align: center">居中段落</p>

<details open><summary>折叠块标题</summary><p>折叠块内容</p></details>

<h3 id="custom">自定义区域</h3>

[跳到自定义区域](#custom)

## A &amp; B

标题中的实体会显示为正常字符，并保持目录可跳转。

## 引用链接与附件

[飞书参考][feishu]

![引用图片][reference-image]

[本地附件](<附件/需求 文档 & (版本1).pdf>)

[编码附件](%E9%99%84%E4%BB%B6/%E9%9C%80%E6%B1%82%20%E6%96%87%E6%A1%A3%20%26%20%28%E7%89%88%E6%9C%AC1%29.pdf?download=1#page=2)

[父目录附件](../outside-note.txt)

[跳到数学](#数学)

## 图片

![中文空格图片](<assets/图片 空格 & (示意).png>)

![编码查询图片](assets/%E5%9B%BE%E7%89%87%20%E7%A9%BA%E6%A0%BC%20%26%20%28%E7%A4%BA%E6%84%8F%29.png?v=1#preview)

![签名在线图片](https://lumen-test.invalid/feishu-signed.png?token=test-signature&expires=1)

## 未导出的飞书素材

<image token="test-image-token" name="原图素材" />

<file token="test-file-token" name="原始附件" />

<whiteboard token="test-board-token" />

<bitable token="test-bitable-token" />

<sheet token="test-sheet-token" />

## 长代码围栏

~~~~javascript
const pipe = "a|b";
const literalMath = "$x^2$";
const literalTicks = "```";
// <img src="bad" onerror="window.__feishuUnsafe = true">
~~~~

## 数学

行内公式：$x^2 + y^2 = z^2$，金额 ￥20 与 $20 不应误解析。

$$
\begin{aligned}
a &= b + c \\
E &= mc^2
\end{aligned}
$$

代码中的美元 `\(code\)` 和 `$code^2$` 保留原文。

## 脚注

脚注第一次引用[^explanation]，第二次引用[^explanation]。

[^explanation]: 脚注正文第一段。

    脚注正文第二段，含 **强调**。

## 流程图

```flowchart
st=>start: 开始
e=>end: 结束
st->e
```

```mermaid
flowchart LR
  A[导出 Markdown] --> B[本地预览]
```

## 安全净化

<script>window.__feishuUnsafe = true</script>
<style>body { display: none }</style>
<iframe src="https://lumen-test.invalid/frame"></iframe>

<p id="evil-id" onclick="window.__feishuUnsafe = true" style="position: fixed; top: 0; left: 0; z-index: 999999; background-image: url(https://lumen-test.invalid/tracker); color: #123456;">危险样式内容</p>

[危险脚本](javascript:alert(1)) [危险数据](data:text/html,hello) [危险浏览器协议](chrome://settings)

<a href="java&#x73;cript:alert(1)" onmouseover="window.__feishuUnsafe = true">HTML 危险链接</a>

<img src="javascript:alert(1)" alt="危险图片" onerror="window.__feishuUnsafe = true">

[feishu]: https://www.feishu.cn/ "飞书"
[reference-image]: <assets/图片 空格 & (示意).png> "图片说明"
