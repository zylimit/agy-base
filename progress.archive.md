# Progress Archive (v2.2.0-legacy)

2026-11-24 重建为 cc-base 全量 + Antigravity 薄适配层之前，旧独立引擎时代（tag `v2.2.0-legacy`）的 progress.md 原样留档于此。

---

# Project Progress & Memory State

## 当前状态
- **阶段**: 全生命周期精益工程体系顶规重构完成 (Full Lifecycle Lean Engineering Complete)
- **最新里程碑**: 融合 `cc-base` 与 `codex-base` 全流程精华，落地“五大避免过度（过度设计、过度测试、过度检视、过度防御、过度可信）”精益防线。

## 已完成事项
- [x] **前半流程（需求、设计、架构、DFX、规划、领域治理）顶规重构**：
  - 需求工程 `product-spec-builder`（四种话标注、交互四档、业务四条线、纠正传播）；
  - 视觉与交互 `design-brief-builder` & `design-maker`（Google DESIGN.md Tokens、双遍法、八态、单文件零依赖离线 HTML 原型）；
  - 架构与 DFX `arch-designer` & `dfx-designer`（业务事件检验边界、STRIDE 威胁建模、FMEA 故障模式分析、module-catalog 分层防腐）；
  - 开发规划 `dev-planner`（端到端垂直切片、先行研究任务退出条件）；
  - 领域知识分诊 `domain-rulings`（四象限分诊法则、入库两问门槛、项目根 domain/ 库）。
- [x] **后半流程（开发、测试、检视、缺陷修复、发布、收尾）精益工程重构**：
  - **编码实现 (`dev-builder`)**：恪守 YAGNI，坚决避免过度设计（不写假想抽象层与多余包装，真重复才提取）与过度防御（Fail-Visible、严禁空 catch 与静默吞异常）；
  - **独立写测 (`test-builder`)**：坚决避免过度测试（破除覆盖率虚荣、P0/P1/P2 风险定级、不测简单透传、用例老化退休）与镜像测试陷阱（预期值来源于独立规则或独立 Fixture）；
  - **代码审查 (`code-review`)**：坚决避免过度检视（首审一次全量覆盖、单轮集中收敛、严格区分 Blocker 与建议、审查轮次上限 reviewRounds ≤ 2）；
  - **对抗审查 (`adversarial-review`)**：落实 Blue（自证靶子）→ Red（四视角证伪攻击）→ Judge（主 Agent 凭证据裁决）红蓝对抗机制；
  - **缺陷修复 (`bug-fixer`)**：严格执行 Red-Locks-The-Bug（红测先行锁定、亲见 fail、最小根因修复变绿、修根因不搞顺带重构、三次熔断防盲试）；
  - **发布冒烟 (`release-builder`)**：坚决避免过度可信（构建成功 ≠ 系统存活，独立核验真实进程启动时间戳与 HTTP 冒烟探针）；
  - **分支收尾 (`branch-finisher`)**：PR 模板规范（HUMAN/AGENT 明确分区）与 Worktree 零遗留清理。
- [x] **全局规则与完整性验证**：
  - 制定 `.agents/rules/lean-engineering.md`，将“五大避免过度”升格为团队硬规则；
  - 升级 `AGENTS.md` 与 `GEMINI.md`，注入精益工程防线；
  - 全量重新计算 `FRAMEWORK-MANIFEST.json`（93 个组件 SHA-256 认证）；
  - 运行 `npm run doctor` 验证 100% PASS。

## 活跃硬约束
- 铁律 1：所有 Subagent 派发必须走 fresh 实例，禁止 Subagent 再拉 Subagent（扁平编排）。
- 铁律 2：任何修复必须遵循 Red-Locks-The-Bug（先加失败测试再修复）。
- 铁律 3：客观证据优先，没有新鲜运行证据（Verification Evidence）严禁宣称完成。
- 铁律 4：四种话严格分开标，未经证实的业务逻辑只能标 `[推断]` 或 `[待定]`。
- 铁律 5：设计参照优先级：HTML 真实原型 > DESIGN.md > Design-Brief.md > Product-Spec.md。
- 铁律 6：架构变更零容忍新增循环依赖，锁死架构 baseline。
- 铁律 7：精益工程五大防线：避免过度设计、避免过度测试、避免过度检视、避免过度防御、避免过度可信。
