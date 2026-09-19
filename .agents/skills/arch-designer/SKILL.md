---
name: arch-designer
description: 当需求已确认，需要讨论系统架构、模块职责、数据归属、分层依赖防腐规则、重大架构决策（ADR）或 C4 建模时使用。
---

# Arch Designer (Antigravity 专版)

[任务]
    **生成模式**：从已确认业务事件、责任边界与质量约束推导架构，生成并维护：
    1. `Architecture-Design.md` —— 模块划分、分层、C4 依赖拓扑、共享事实归属、关键决策与被拒绝方案。
    2. `.agents/harness/module-catalog.json` 架构防腐骨架 —— modules/layers/dependsOn/forbiddenDependencies，把架构立即变成自动化可执行护栏。
    3. `docs/adr/` 决策记录 —— 每条在世架构决策带 `Enforced-by:`，由架构门禁持续守护。

    **迭代模式**：Spec 变更或新增模块时，评估对模块边界、依赖方向与质量属性的影响，增量更新 `Architecture-Design.md`、catalog 与 ADR；未受影响的部分绝对保持不动。

[第一性原则]
    1. **用业务事件检验边界（先追演，再画模块）**：
       选一条核心业务路径，从发起者与触发事件开始：谁校验 → 谁判断 → 谁修改核心事实 → 谁订阅结果。先用业务动词画协作线，再映射到代码模块。部门、页面、数据库表与微服务都不天然等于模块。
    2. **确定事实归属与不可破坏的不变量**：
       共享业务事实必须指定单一权威写入模块（Single Writer）。两个模块使用同一数据绝对不代表都能直接写它。业务不变量（如并发预约不冲突、状态前置满足）必须有明确保护机制（事务、版本乐观锁或跨模块协议）。
    3. **断点异常与纠错追演**：
       在协作线上挑断点（请求重复、超时未响应、外部成功本地失败、半途失败）。区分“结果未知”、“已拒绝”与“已完成”；只有业务允许逆转的动作才安排自动补偿，不能用任意重试掩盖资料不足。
    4. **C4 分层与架构权衡（ATAM 原则）**：
       自顶向下呈现 Context 语境、Container 容器与 Component 拓扑（Mermaid 图形化）。指出敏感假设与跨属性代价（例如：为了高可用采用最终一致性对即时一致性的牺牲；为了低延迟引入缓存对失效风暴的风险）。
    5. **按需区分五类状态归属**：
       严格区分：业务权威事实、临时 UI 状态、视图偏好、请求/任务状态、资源资产。业务状态绝不能由 DOM 或请求是否结束代替。
    6. **七大设计原则（防腐信号）**：
       - 开闭原则：识别已确认变化轴，有实际第二种实现时再设扩展点。
       - 依赖倒置：业务层只依赖接口；在 `module-catalog.json` 用 `layers` + `forbiddenDependencies` 阻断逆向依赖。
       - 单一职责：按变化原因切分，杜绝万能 `Utils` / `Manager` 巨石文件。
       - 接口隔离：针对不同消费者定义窄接口契约。
       - 迪米特法则：模块只调用直接依赖，严禁跨层链式穿透。
       - 里氏替换：替换实现不收紧前置条件、不放松后置条件。
       - 合成复用：优先组合聚合，避免滥用深继承。

[文件结构]
    arch-designer/
    ├── SKILL.md
    ├── references/
    │   ├── collaboration-walkthrough.md   # 协作追演与候选方案淘汰
    │   └── decision-evaluation.md        # 驱动因素、质量场景、反证与决定
    ├── templates/
    │   └── architecture-design-template.md# Architecture-Design.md 输出模板
    └── examples/
        └── reservation-case-arch.md

[工作流程]
    1. **依赖检测**：读取 `Product-Spec.md`、既有架构文件与 `.agents/harness/module-catalog.json`。
    2. **追演核心流**：结合业务事件与异常断点，确定模块职责与共享事实写入权。
    3. **产出架构规格**：
       - 输出 `Architecture-Design.md`，包含 C4 拓扑图与组件职责表。
       - 同步配置 `.agents/harness/module-catalog.json`，声明 modules、layers、dependsOn 与 forbiddenDependencies。
       - 对重大技术选型在 `docs/adr/ADR-xxx.md` 输出决策记录，标注 `Enforced-by:` 检查规则。
    4. **运行防腐校验**：
       执行 `node .agents/harness/arch-checker.js`，验证是否存在循环依赖、分层越级或非法跨域引用。
    5. **同步记忆与交接**：
       将架构核心决策记录至 `progress.md` 的 Decisions 区域，引导进入 DFX 分析（`/dfx-designer`）或开发计划（`/dev-planner`）。
