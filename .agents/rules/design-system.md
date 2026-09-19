# Design System & UI Quality Floor Guardrails (Antigravity)

## 1. 设计参照与真相顺序
当代码实现涉及界面或交互时，按以下优先顺序对齐，发生冲突时前者为准：
1. **真实设计稿**（由 `design-maker` 产生的可交互 HTML `demo/index.html`）
2. **`DESIGN.md`**（按 Google DESIGN.md 开放标准编写的视觉身份：YAML Tokens + 8段 prose）
3. **`Design-Brief.md`**（行为脊柱：信息架构、八态、交互原语、文案与无障碍）
4. **`Product-Spec.md`**（业务需求与逻辑边界）

## 2. 核心底线（MUST / NEVER）
- **禁止随意散写 Hex 色值**：界面样式中的颜色、间距步进（4px 标度）、字重、圆角必须 100% 引用 `DESIGN.md` 中声明的 Design Tokens。
- **状态完备（必须覆盖八态）**：每个核心界面必须覆盖：
  - 空态（Empty）
  - 加载态（Loading）
  - 成功态（Success）
  - 错误态（Error，必须带恢复动作）
  - 冲突态（Conflict）
  - 离线态（Offline）
  - 无权限态（Forbidden）
  - AI工作中（Working/Streaming）
- **无障碍底线（Accessibility Floor）**：
  - 所有交互控件焦点可见（Focus Visible）；
  - 文本对比度符合 WCAG AA（正文 ≥ 4.5:1，大字 ≥ 3:1）；
  - 遵循 `prefers-reduced-motion`，避免非必要的眩晕动效；
  - 最小可点击区（Touch Target）≥ 44×44px（移动端）或 32×32px（桌面端）。

## 3. 防范 AI 界面通病
- 严禁千篇一律的卡片套卡片（Cardception）；
- 严禁滥用深色渐变紫/蓝作为万能背景；
- 严禁无业务含义的浮动发光动效；
- “大胆放一处，其余皆安静”。
