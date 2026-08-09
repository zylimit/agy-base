# 600K+ LOC Large Repo Harness Rule

## 1. 拓扑与隔离
- 大型项目禁止全仓上下文灌入。活动范围必须缩小至具体的模块及受影响的依赖链。
- 所有模块关系必须记录在 `.agents/harness/module-catalog.json` 中。
- 未映射 (Unmapped)、跨域交叠 (Overlap) 或循环 (Cycle) 的代码块必须通过 `context-packer.js` 进行拓扑展开。

## 2. Context Packing 预算控制
- 每个 Task 分配最大上下文 Token 预算（默认 4,000 Token）。
- 打包内容严格限制为：目标文件 + 直接 Interface 契约 + 依赖关系 + 对应单元测试 + 当前 Diff。
- 超出预算时优先剪裁非关键实现细节，仅保留接口定义。

## 3. 并行与串行调度纪律
- 只读广度任务（代码搜索、多维 review、测试套件构建）允许 Workflow 并行 fan-out。
- 编码修改任务默认**串行**，防止多个子 Agent 在独立上下文中破坏共享接口规范或造成 Git 冲突。
