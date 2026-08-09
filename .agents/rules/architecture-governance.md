# Architecture Governance & Anti-Rot Rule

## 1. 依赖图约束
- 依赖方向仅能从外层指向内层：`Infrastructure -> Domain <- Application <- Presentation`。
- 严禁模块间的循环依赖 (Circular Dependency)。
- 跨模块调用必须通过公共 Facade / Interface 进行，禁止直接私有路径相对引用。

## 2. 静态与动态防腐检查
- 修改代码后，`PostToolUse` 钩子或 `npm run arch:check` 将会自动扫描依赖关联。
- 若发现任何新增的非法跨层或循环依赖，系统将阻止任务标记完成。

## 3. 架构债务棘轮 (Baseline Ratchet)
- 历史存量债务记录于 `arch-baseline.json` 中。
- 新增任何违反架构规范的代码属于**零容忍**行为，必须在提交前修复。
