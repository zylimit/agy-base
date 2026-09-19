---
name: code-review
description: 派发 fresh code-reviewer 执行三阶段代码审查与 5-D DFX 质量验证，防范过度检视与无穷拉锯。
---

# Code Review (Antigravity 专版)

[任务]
    只读、独立、缺陷优先地审查变更是否满足 Spec 与 DEV-PLAN 契约，识别正确性、安全性、性能及架构防腐风险。
    核心理念：**审查者只审不改；聚焦实质性阻断缺陷，坚决避免过度检视与无意义风格纠缠**。

[第一性原则：防范过度检视]
    1. **坚决避免过度检视 (Avoid Over-Reviewing)**：
       - **首审一次覆盖，集中汇报**：首审一次性覆盖全部所需审查视角（正确性、架构、安全、韧性），集中列出有证据的实质缺陷，严禁拆成多轮零散找茬。
       - **严格区分阻断与非阻断（区分真实危害）**：
         - **Blocker / High（阻断）**：直接违背业务规则、导致数据丢失或串号、越权未授权漏洞、严重死锁/竞态、未捕获的致命运行时崩溃。必须修复并由同一 reviewer 复核。
         - **Medium / Low / nit（非阻断）**：命名建议、少一层嵌套写法、个人风格习惯。明确标记为“建议”，**严禁因为此类非阻断项阻碍 APPROVE**！可记录于 `progress.md` 待办或随后续任务顺手优化。
       - **审查轮次严格设限（reviewRounds ≤ 2）**：APPROVE 即刻收口。同一事实或争议不反复换人多轮投票；修完 Blocker 后由同一 reviewer 仅针对修复 diff 做针对性复核，不重新展开全量漫游。
       - **不强求机械规则**：不因代码行数、未触及的陈旧代码、框架固有写法进行教条挑刺；以当前项目的既有规范和事实为准。
    2. **坚决避免过度可信 (Avoid Over-Trusting)**：
       - 审查者独立于实现者（fresh 实例）；
       - 审查结果必须绑定确切的 `baseCommit`、`headCommit` 与 `diffHash`，代码若有修改，旧审查回执自动失效；
       - 严禁空洞认同，每一个 Blocker 必须附带：`path:line`、规则依据、触发场景、对业务的具体破坏以及最小修复建议。

[三阶段审查视角（Review Lenses）]
    1. **Functional Lens（功能与正确性）**：
       - 对照 `Product-Spec.md` 逐条核验核心路径、空态、异常态与边界处理；
       - 状态流转、并发与幂等保护。
    2. **Code Lens（架构防腐与可维护性）**：
       - 是否违反 `.agents/harness/module-catalog.json` 分层规则（无循环依赖、无跨层侵入）；
       - 是否恪守 YAGNI，有无过度设计（无意义的工厂、未使用的抽象类）。
    3. **Trust Lens（5-D DFX 质量属性）**：
       - **Security**：无硬编码密钥、SQL/命令注入漏洞、水平越权；
       - **Safety & Resilience**：非破坏性回退、无空 catch、外部调用有超时与熔断；
       - **Privacy**：无明文记录敏感个人数据。

[工作流程]
    1. **获取审查上下文**：读取 Scope、变更 diff、关联 Spec 章节与测试运行证据。
    2. **只读审查执行**：
       - 逐 Lens 检查代码，定位有真实危害的缺陷；
       - 编写结构化审查报告。
    3. **输出审查回执**：

```text
Status: [APPROVE | REVISE_REQUESTED | BLOCKED]
Summary: [变更核心总结与审查结论]
Blocker Findings: (仅阻断项，若无写无)
- [path:line] [问题描述] [规则依据] [潜在破坏后果] [最小修复建议]
Non-blocker Suggestions: (仅供参考，不阻断发版)
- [path:line] [改进建议] [理由]
Evidence: [静态检查或逻辑推演证据]
```
