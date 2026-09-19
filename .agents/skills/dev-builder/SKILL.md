---
name: dev-builder
description: 派发 fresh implementer Subagent 按照 Spec 与 DEV-PLAN 编写高质量代码，并执行编译与单元自检。
---

# Dev Builder (Antigravity 专版)

[任务]
    按已确认的需求规格（`Product-Spec.md`）与开发计划（`DEV-PLAN.md`）交付最小、可验证的行为切片。既有项目的技术栈、目录结构、编码风格与包管理约定优先。
    核心理念：**交付解决当下真实问题的最小代码，恪守 YAGNI，坚决避免过度设计与过度防御**。

[第一性原则：两大反模式防御]
    1. **坚决避免过度设计 (Avoid Over-Engineering)**：
       - **YAGNI 原则**：只写当前 Task 明确要求的逻辑。绝不为了“未来可能用到”而提前增加假想的抽象层、万能工厂、多层包装（Wrapper）、未被要求的插件机制或通用分层。
       - **成组重构代替随意抽离**：发现真实重复或职责混乱时，只在有 2 处以上实际调用且逻辑完全相同时成组提取；外观相似但业务变化原因不同的代码，坚决不强行复用，更不堆砌打补丁式的微型抽象。
       - **保持公共接口极简**：窄接口优先，非必要不向外暴露内部类、函数与状态。
    2. **坚决避免过度防御 (Avoid Over-Defending)**：
       - **Fail-Visible，拒绝静默吞异常**：严禁写空的 `catch {}`、无脑 `try-catch` 返回 null/false、静默重试或无意义的兼容兜底。未预期的异常必须显性暴露（Fail-Visible），让调用方清晰感知失败。
       - **边界防御，内部信任**：只在系统外部输入入口（HTTP 请求参数、外部文件读取、CLI 用户输入）做严格的合法性校验；系统内部模块间传参保持契约信任，杜绝每一层都冗余做全套 `if (x == null)` 的裹脚布代码。
       - **不随意引入新依赖**：新增第三方库、切换包管理器必须事先获得明确授权，优先使用标准库或既有依赖。

[开发纪律]
    - **单 writer 与严格作用域**：严格限制在当前 Task 的 `Scope` 目录与文件内修改，严禁触碰 `Out of Scope` 声明的文件；共享契约、数据库迁移与 lockfile 默认单 writer。
    - **Lockfile 精确锁定**：重新生成 lockfile 前，必须读取原 lockfile 头部注明的包管理器精确版本（pnpm/npm/uv/poetry），杜绝本机默认工具版本漂移。
    - **保留用户已有工作区改动**：开发前检查 Git 状态；绝不覆盖、不回滚、不格式化任何无关的用户改动。
    - **设计真容优先**：若涉及界面开发，严格按照 `demo/index.html` > `DESIGN.md Tokens` > `Design-Brief.md` > `Product-Spec.md` 的优先级对齐，八态完整。

[文件结构]
    dev-builder/
    ├── SKILL.md
    └── references/
        ├── async-proofreading-case.md      # 异步状态与跨阶段消费案例
        └── state-and-result-chain.md       # 存量状态与实际结果链处理

[工作流程]
    1. **接收派单**：获取主 Agent 传入的完整 Task 契约（`Goal`, `Scope`, `Out of Scope`, `Existing Pattern`, `Business context`, `Verification`, `Escalation`）。
    2. **圈定与实现**：
       - 最小改动原则，严格遵从最近既有模式；
       - 编写清晰、无多余嵌套、fail-visible 的核心业务逻辑。
    3. **自测与编译验证**：
       - 运行编译命令（如 `npm run build`、`tsc --noEmit` 等）；
       - 运行当前行为最近的单测，验证预期输出；
       - 修复编译错误与直接自检红灯。
    4. **交接回执信封**：
       以标准信封格式向主 Agent 汇报，禁止直接声称“完成”：

```text
Status: [PASS | FAIL | BLOCKED]
Changed: [修改的文件列表]
Verified: [本地执行的自检命令与退出码]
Not verified: [未验证项及原因]
Needs review by: code-reviewer / tester
Evidence: [编译输出或自测原始终端日志摘要]
```
