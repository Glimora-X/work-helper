# PKMer 文档站（Highlightr 插件页）— Style Reference
> 淡紫灰画布上的温和技术文档气质，靛蓝导航与琥珀品牌点缀

**Theme:** light（默认阅读）；站点支持 `.theme-dark` 切换，深色 token 见 `variables.css` 中 `.theme-dark` 块。

该页是 PKMer 知识社区中一篇典型的 **Obsidian 插件说明文档**：外层为 Astro + Tailwind 驱动的全站导航与白底外壳，内层正文区域继承 Starlight 风格的 `theme.css`——大面积 **冷调淡紫灰背景**（`hsl(273, 37%, 93%)`）向近白 `#fdfeff` 垂坠渐变，正文使用 **系统无衬线** 与克制的 **灰阶层级**，强调色落在 **暖橙**（`--theme-accent`）与 **洋红紫次要强调** 之间切换。代码块沉入 **深紫灰底**（`hsl(257, 31%, 22%)`），与浅画布形成清晰「深浅分层」。与 Highlightr 插件直接相关的是正文 `<mark>`：**浅色**下半透明黄 `#ffff8fd1`、**不规则圆角**（`0.6em 0.3em`）；**深色**下半透明橙红 `#e95f44cc` 配白字——与插件「多色高亮」心智一致。导航区则切换到 **Tailwind Indigo**（`#4f46e5`）作为 active / 图标强调，与文档紫系背景形成「外壳靛蓝、内文紫灰」的 **双轨色彩系统**。品牌 SVG 使用 **琥珀与灰蓝** 填充，字标 `PKMer` 为 **超粗 + 宽字距大写**，是整站最具辨识度的节奏破点。

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Doc Canvas | `hsl(273, 37%, 93%)` | `--color-canvas` | 文档主背景（浅色） |
| Canvas Glow End | `#fdfeff` | `--color-canvas-gradient-end` | 垂直渐变底部，提亮长滚动 |
| Ink | `hsl(250, 14%, 10%)` | `--color-ink` | 正文主色 |
| Ink Muted | `hsl(250, 14%, 30%)` | `--color-ink-light` | 次级段落 |
| Ink Faint | `hsl(250, 14%, 40%)` | `--color-ink-lighter` | 辅助说明 |
| Accent Orange | `hsl(22, 100%, 50%)` | `--color-accent` | 链接、选中、强调（浅色默认） |
| Accent Magenta | `hsl(324, 75%, 38%)` | `--color-accent-secondary` | 次要强调、徽章类 |
| Hairline | `hsla(269, 79%, 54%, 0.1)` | `--color-hairline` | 细分隔、浅装饰边 |
| Code Canvas | `hsl(257, 31%, 22%)` | `--color-code-bg` | 代码块背景 |
| Code Tab Bar | `hsla(257, 38%, 32%, 1)` | `--color-code-tabs` | 代码块顶栏 |
| Code Text | `hsl(250, 14%, 95%)` | `--color-code-text` | 代码前景 |
| Mark Light | `#ffff8fd1` | `--color-mark-light` | 浅色模式 mark / 搜索高亮底 |
| Mark Dark | `#e95f44cc` | `--color-mark-dark` | 深色模式 mark 底 |
| Search Cyan | `#32c8f6` | `--color-search-hit` | Pagefind 结果标题色（内联样式） |
| Primary 600 | `#4f46e5` | `--color-primary-600` | 导航 active、图标 hover |
| Primary 500 | `#6366f1` | `--color-primary-500` | 次级靛蓝填充 |
| Muted 800 | `#1e293b` | `--color-muted-800` | 浅底上的标题字/高对比正文 |
| Muted 400 | `#94a3b8` | `--color-muted-400` | 图标、弱导航 |
| Shell White | `#ffffff` | `--color-shell-bg` | 顶栏、卡片、巨型菜单浅底 |
| Brand Amber | `#ffc170` | `--color-brand-amber` | Logo 主琥珀 |
| Brand Amber Deep | `#e1a05a` | `--color-brand-amber-deep` | Logo 暗部 |
| Brand Slate Blue | `#a0bdd4` | `--color-brand-slate` | Logo 装饰冷色 |

### Decorative / Gradient

| Name | Value | Token | Role |
|------|-------|-------|------|
| Doc vertical wash | `linear-gradient(180deg, hsl(273,37%,93%) 0%, hsl(273,37%,93%) calc(4rem+2.5rem), #fdfeff 100%)` | `--gradient-doc-bg` | 固定顶栏+移动 TOC 以下开始过渡到近白 |

**深色模式（`.theme-dark`）要点：** 画布变为 `rgb(10 16 31)`，正文灰阶整体提亮为 hsla 高亮条；强调橙在深色下略提亮以保对比（见源 `theme.css` `--color-orange` 覆盖）。未在本地截图逐像素校验渐变止点；若需印刷级精度请以浏览器计算样式为准。

## Tokens — Typography

### System UI — 文档正文与导航 UI · `--font-body`
- **Substitute:** Inter, Source Han Sans SC, Noto Sans SC
- **Weights:** 400（正文）、500（导航中粗）、600（小标题）、800（PKMer 字标）
- **Sizes:** `0.8125rem`–`1rem`（响应式 `--theme-text-xs/sm/base`）、`0.875rem`（巨型菜单标签）、`1.125rem`（字标 `text-lg`）
- **Line height：**正文约 `1.5`（leading-7 类在侧栏列表为 `1.75rem` 行盒）
- **Letter spacing：**字标 `tracking-widest`（约 `0.1em`）；正文默认接近 `0`
- **OpenType features：**未在源中强制要求；中文场景建议保留系统默认标点挤压
- **Role：**整页中文说明、表格、侧栏目录

### IBM Plex Mono — 代码与行内技术片段 · `--font-mono`
- **Substitute：**JetBrains Mono, ui-monospace, Menlo
- **Weights：**400
- **Sizes：**继承代码块字号（通常 `0.875rem` 量级，依 Starlight 内容样式为准）
- **Line height：**1.5（等宽栈注释）
- **Letter spacing：**0
- **Role：** fenced code、行内 `code`

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| doc-xs | 0.8125rem（≥72em 视口） | 1.5 | — | `--text-doc-xs` |
| doc-sm | 0.875rem（窄屏）/ 0.9375rem（≥50em） | 1.5 | — | `--text-doc-sm` |
| doc-base | 1rem | 1.5 | — | `--text-doc-base` |
| nav-label | 0.875rem | 1.75 | — | （Tailwind `text-sm leading-7`） |
| wordmark | 1.125rem | 1.25 | 0.1em | （`text-lg` + `tracking-widest`） |

## Tokens — Spacing & Shapes

**Base unit:** 4px（Tailwind 默认步进与 `theme.css` 中间距并存）

**Density:** comfortable（文档阅读向）

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| inline-min | 1rem（移动）/ 1.5rem（≥50em） | `--spacing-inline-min` |
| doc-block | 0.5rem（移动）/ 1rem（≥50em）/ 2rem（≥72em） | `--spacing-doc-block` |
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |

### Border Radius

| Name | Value | Token |
|------|-------|-------|
| md | 0.375rem | `--radius-md` |
| lg | 0.5rem | `--radius-lg` |
| 2xl | 1rem | `--radius-2xl` |
| pill | 9999px | `--radius-pill` |
| mark（不规则） | `0.6em 0.3em` | `--radius-mark-y` / `--radius-mark-x` |

| Element | Value |
|---------|-------|
| 巨型菜单容器 | 1rem（`rounded-2xl`） |
| 搜索按钮（移动） | 全圆（`rounded-full`） |
| mark 高亮 | 椭圆不对称圆角 |

### Shadows

| Name | Value | Token |
|------|-------|-------|
| nav-elevated | `0 10px 15px -3px rgba(148, 163, 184, 0.3), 0 4px 6px -4px rgba(148, 163, 184, 0.3)` | `--shadow-nav-scrolled` |
| megamenu | `0 25px 50px -12px rgba(100, 116, 139, 0.2)` | `--shadow-megamenu` |

深色下阴影 token 在 `variables.css` 的 `.theme-dark` 中改为更高对比黑色透明层。

### Layout

- **顶栏高度：**4rem（`--theme-navbar-height`）
- **左侧文档栏宽度：**18rem
- **右侧栏宽度：**23rem
- **正文 max-width（Starlight）：**窄屏 `100%`，≥50em 时 `46em` 量级（`--max-width`）

## Components

### 顶栏导航链接（桌面）
**Role：**分区导航、当前滚动 spy 高亮

- color：默认 `slate-500` / 深色 `slate-400`；active 为 `--color-primary-500` 文本 + 底边 `3px` 全宽 `rounded-t-full` 指示条
- padding：`py-3`，底部伪元素条
- font：`text-base font-sans`
- hover：`text-muted-700` / 深色 `hover:text-muted-100`
- transition：`transition-colors duration-300`

### 巨型下拉卡片
**Role：**「知识社区」「产品服务」聚合入口

- background：`#ffffff` / 深色 `muted-800`
- border：`1px` `muted-200` / 深色 `muted-700`
- border-radius：`1rem`
- shadow：`--shadow-megamenu`
- padding：`pt-12`（移动预留关闭钮）/ `p-3`（桌面）

### 文档 mark（Highlightr 对齐参考）
**Role：**正文高亮，导出为内联样式不丢色

- background（浅色）：`#ffff8fd1`
- background（深色）：`#e95f44cc`
- color（深色 mark）：`white`
- margin：`0 -0.05em`；padding：`0.1em 0.4em`
- border-radius：`0.6em 0.3em`
- box-decoration-break：`clone`

### 代码块容器
**Role：**技术命令、配置片段

- background：`--color-code-bg`
- 顶栏背景：`--color-code-tabs`
- 前景：`--color-code-text`
- 与正文之间保持 Starlight 默认纵向 rhythm（未在 HTML 中单点读取，实现时沿用内容区 gap）

### Pagefind 搜索命中
**Role：**全站搜索关键词

- 标题 color：`#32c8f6`
- mark 背景（浅色 UI）：`#ffff8fd1`；深色 UI：`#e95f44cc`（与正文 mark 同源策略）

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Doc Canvas | `hsl(273, 37%, 93%)` | 阅读主画布 |
| 1 | Shell / Card | `#ffffff` | 导航、菜单、浮层 |
| 2 | Code | `hsl(257, 31%, 22%)` | 代码沉面 |
| 3 | Dark Canvas | `rgb(10 16 31)` | `.theme-dark` 文档底 |

## Do's and Don'ts

### Do
- 在长文档区使用 `--color-canvas` 与 `--gradient-doc-bg`，保持 Starlight 式「上紫灰、下近白」的垂直呼吸感。
- 正文链接与关键交互使用 `--color-accent`（暖橙），与紫灰底形成互补对比。
- 代码块始终使用 `--color-code-bg` 与 `--color-code-text` 配对，避免把代码放在 `--color-canvas` 上造成层次坍塌。
- 高亮摘录复用 `--color-mark-light` / `--color-mark-dark` 两套值，与 Highlightr 内联导出策略一致。
- 导航 active 态同时改变字色与 `3px` 下划线宽度动画，保留 `duration-300` 与 `after:w-full` 的现有动效语言。
- 巨型菜单使用 `--shadow-megamenu` + `1rem` 圆角，和 `border-muted-200` 共同定义「浮层卡片」。
- 字标使用 `font-extrabold` + `tracking-widest` + `uppercase`，维持 PKMer 品牌辨识度。

### Don't
- 勿将 `--color-primary-600` 大面积铺进正文段落背景，它属于外壳交互轨，会破坏文档轨的柔和灰紫调。
- 勿在浅色文档底上直接使用纯白 `#fff` 作为大段正文背景块（除导航/卡片）；会破坏渐变建立的深度。
- 勿删除 mark 的 `box-decoration-break: clone`，多行高亮会断裂为错误几何。
- 勿把 `--color-mark-dark` 用于浅色模式正文（对比不足且与源站不符）。
- 勿用低于 `0.8125rem` 的正文作为默认（小视口 `--theme-text-xs` 已是最小可读边界）。
- 勿为导航链接使用小于 `3px` 的 active 指示条，会弱于当前设计下的「当前位置」可读性。
- 勿混用其他色相的 Indigo（非 `#4f46e5` / `#6366f1` 家族）作为 primary，避免与编译 Tailwind 主题漂移。

## Imagery

截图与插图以 **Obsidian 界面**、插件设置面板为主，外框通常带 **浅灰圆角窗口** 或 **深色编辑器内嵌**，与文档紫灰底形成冷暖对照。图标体系以 **Iconify / Phosphor** 线性或 duotone 为主，在巨型菜单中与 **浅色 hex 背景块**（`bg-*-100`）组合使用；插图密度中等，文字仍为信息主角。

## Layout

整页为 **顶栏固定 + 下方主布局网格**：左侧文档树（`18rem`）、中间 Markdown 正文（`max-width` 约束）、右侧可选 TOC / 附属信息（`23rem`）。移动端 TOC 占 `2.5rem` 高横条；正文区 `--doc-padding-block` 随断点增大。导航在滚动后叠加 **浅阴影与白底**（或深色 `muted-800/900`），与内容区分离。

## Agent Prompt Guide

1. 「用 PKMer 文档浅色主题做一个插件说明区块：背景 `hsl(273,37%,93%)`，正文 `hsl(250,14%,10%)`，H2 使用 `1.5rem` 粗体，代码块背景 `hsl(257,31%,22%)`、字 `hsl(250,14%,95%)`，段落间距 `1rem`。」
2. 「实现与 pkmer `theme.css` 一致的 mark：浅色 `#ffff8fd1`、`padding:0.1em 0.4em`、`border-radius:0.6em 0.3em`。」
3. 「复制 PKMer 顶栏：滚动后 `background:#fff`，`box-shadow: 0 10px 15px -3px rgba(148,163,184,.3)`，active 链接色 `#6366f1`，底条 `3px` 圆角顶。」

## Similar Brands

- **Starlight 默认主题** — 同为文档渐变 + 紫系灰阶与独立 code surface。
- **Vite 文档** — 技术文档信息密度与系统字体栈相近。
- **Tailwind UI Marketing** — 共享 slate/indigo 导航与卡片阴影语言。
- **Obsidian Publish** — 阅读向长文与侧栏 TOC 结构类似（色板不同）。

## Quick Start

### CSS Custom Properties

将 `variables.css` 复制到项目后按需引入；浅色根选 `:root`，深色在根元素附加 `.theme-dark`。

### Tailwind v4

将 `theme.css` 中 `@theme` 块合并到你的入口 CSS，或使用 PostCSS 管道按官方文档合并。

### 源 URL

- 页面：https://pkmer.cn/Pkmer-Docs/10-obsidian/obsidian%E7%A4%BE%E5%8C%BA%E6%8F%92%E4%BB%B6/highlightr-plugin/
- 主题变量：https://pkmer.cn/theme.css
