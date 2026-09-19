---
name: dev-planner
description: 当需求、架构与 DFX 已确认，需要安排可体验的交付顺序、拆分垂直业务切片 Task、先行研究任务，或需求设计变更后更新开发计划时使用。
---

# Dev Planner (Antigravity 专版)

[任务]
    承接实际需求（`Product-Spec.md`）、架构（`Architecture-Design.md`）、DFX 规格（`DFX-Spec.md`）与设计稿，处理影响方向的关键未知，按业务价值与真实依赖形成端到端可执行的开发计划 `DEV-PLAN.md`。
    需求、设计或业务理解变化时，执行**迭代与纠正传播**，更新受影响工作，撤销旧假设对下游任务的有效性。

[第一性原则]
    1. **垂直业务切片（Vertical Slicing）**：
       按“端到端可体验的完整业务结果”组织 Task（如“用户完成下单并扣减库存”），严禁按纯技术层（先建全部表、再写全部后台、最后画全部界面）拆成无法独立验证的横切碎片。
    2. **先行研究任务（带明确退出条件）**：
       对高风险技术选型、未验证的外部接口或大数据量性能未知，单设先行研究 Task。研究任务必须有明确的“退出条件（Exit Criteria）”——旨在推翻或确认某种方案，研究结束即关闭未知，不伪装成业务功能。
    3. **派单字段完整契约化**：
       每个 Task 严格具备：
       - `Goal`: 交付的具体业务行为；
       - `Scope`: 明确触碰的文件与路径；
       - `Out of Scope`: 严禁改动的范围；
       - `Existing Pattern / Business context`: 为谁解决什么、业务规则来源、区分性正反例子；
       - `Verification`: 实际观察入口、确切测试命令与预期输出；
       - `Escalation`: 遇到阻塞或未决时的升级汇报条件。
    4. **写测严格独立（Separation of Duties）**：
       Task 的验收产生者必须由独立的 fresh `tester` 或 `code-reviewer` 承担，严禁由 `implementer` 自编自导自演。
    5. **迭代与纠正传播（Correction Propagation）**：
       需求或业务理解纠正时，从当前来源定位旧/新含义，更新受影响 Task 的目标、Business context 与验收标准；保留已完成历史，但对结论被推翻的任务注上“需按新规则修正”，杜绝旧验收直接套用在新代码上。

[文件结构]
    dev-planner/
    ├── SKILL.md
    ├── references/
    │   └── acceptance-and-dependencies.md # 业务切片、验收产生者、依赖图与研究退出
    └── templates/
        └── dev-plan-template.md

[工作流程]
    1. **还原交付范围**：读取 `Product-Spec.md`、`Architecture-Design.md`、`DFX-Spec.md` 及设计产物。
    2. **切片与排序**：
       - 识别先行研究任务，制定退出条件；
       - 按价值、真实依赖与风险收敛顺序排列垂直业务切片；
       - 仅在有复杂交付组时划分 Phase。
    3. **产出派发 Task**：
       按 `templates/dev-plan-template.md` 输出 `DEV-PLAN.md`，每个 Task 填满完整派单契约。
    4. **就绪校准**：
       核对每一个 Task 是否拥有具体的行动、文件职责、验收命令与独立验收角色。
    5. **同步记忆与交接**：
       将开发阶段规划同步至 `progress.md`，引导进入编码实现（`/dev-builder`）。
