# System Architecture & Governance Specification (`agy-base`)

## 1. 架构总览 (Architectural Blueprint)

`agy-base` 是 Antigravity (AGY) 平台专用的 Enterprise Harness 治理脚手架。它的核心使命是在支持 **600K+ LOC 大规模代码库** 的同时，实现 **架构防腐**、**五维 DFX 守护** 与 **自动化质量门控**。

```text
+-----------------------------------------------------------------------------------+
|                              Antigravity Platform                                 |
|         (AGY CLI / IDE / Desktop 2.0 - Skills, Rules, Lifecycle Hooks)            |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                        SiteMaster Orchestration Core                              |
|                          (AGENTS.md & GEMINI.md)                                  |
+-----------------------------------------------------------------------------------+
        |                                |                                 |
        v                                v                                 v
+------------------+           +-------------------+             +------------------+
| Progressive      |           | Lifecycle Hooks   |             | 5-D DFX & Arch   |
| Skills (.agents) |           | (hooks.json)      |             | Engine (Node.js) |
+------------------+           +-------------------+             +------------------+
| - spec-builder   |           | - PreToolUse      |             | - arch-checker   |
| - arch-designer  |           |   (Security Gate) |             | - dfx-validator  |
| - dfx-designer   |           | - PostToolUse     |             | - context-packer |
| - dev-builder    |           |   (Arch Audit)    |             | - supervisor     |
| - code-review    |           | - PreInvocation   |             | - fast-mode      |
| - test-builder   |           |   (Context Inject)|             +------------------+
+------------------+           | - Stop            |                      |
        |                      |   (Evidence Gate) |                      v
        |                      +-------------------+             +------------------+
        |                                                        | module-catalog   |
        |                                                        | & verification   |
        |                                                        | matrix.json      |
        |                                                        +------------------+
        v
+-----------------------------------------------------------------------------------+
|                     Fresh Subagent Execution Layer                                |
|        (implementer | code-reviewer | tester | deployer | progress-recorder)       |
+-----------------------------------------------------------------------------------+
```

---

## 2. 五维 DFX 架构看护矩阵

脚手架针对五大核心非功能需求（NFRs）进行了制度化与工程化固化：

| DFX 维度 | 核心目标 | 脚手架固化机制 | 验证与防腐校验命令 |
|---|---|---|---|
| **韧性 (Resilience)** | 应对高并发冲击、主动识别风险、故障与攻击下快速拉起恢复 | 服务 Supervisor（指数退避、健康检查探针、重启风暴熔断）、`risk scan` 机制 | `node .agents/harness/supervisor.js` |
| **网络与信息安全 (Security)** | 保护敏感数据与凭证，防御未授权访问、窃听与篡改 | `PreToolUse` Hook 强行检查敏感密钥泄露、未授权高危命令拦截、防篡改日志链 | `node .agents/harness/hook-handlers.js pre-tool-check` |
| **功能安全 (Safety)** | 环境与人身安全保护，发生失效时安全降级 (Fail-Safe) | 安全隔离 profile、生产环境与破坏性指令二级授权手势 | `npm run dfx:validate` (Safety Check) |
| **隐私性 (Privacy)** | GDPR / Privacy-by-Design 规约，敏感数据收集、使用、销毁透明 | 数据自动脱敏机制、`state prune` 策略化自动化历史及上下文清理 | `node .agents/harness/dfx-validator.js prune` |
| **可靠性 (Reliability)** | 预期时间内稳定无故障持续运行 | 工具 Lockfile 版本精确锁控制度、`verification-matrix.json` 自动化全链路回归矩阵、Red-Locks-The-Bug | `npm run doctor` & `npm run dfx:validate` |

---

## 3. 架构看护与防腐机制 (Architecture Anti-Rot)

为防止大项目在演进过程中发生代码腐化与分层混乱，`agy-base` 建立了两大看护防线：

### 3.1 显式拓扑结构 (`module-catalog.json`)
所有的核心模块、接口边界、分层依赖关系与 DFX 级别要求必须在 `.agents/harness/module-catalog.json` 中声明。

### 3.2 依赖静态/动态检查 (`arch-checker.js`)
- **禁止循环依赖**：在模块图中运行 Tarjan 强连通分量算法，秒级拦截任何 Cycle。
- **禁止跨层与逆向依赖**：严格校验 `presentation -> application -> domain -> infrastructure` 的单向依赖链。
- **架构债务棘轮 (`arch baseline`)**：通过生成 `arch-baseline.json` 记录遗留违规。后续开发只许减少违规，新增违规直接导致 CI/Hook 报错拦截。

---

## 4. 600K+ LOC 代码规模适配设计 (Large Scale Adaptations)

大仓开发的痛点在于 Context Window 爆炸、上下文污染以及并发修改冲突。`agy-base` 的解决策略：

1. **Context Packing 算法 (`context-packer.js`)**：
   根据 `module-catalog.json` 与 git diff 自动计算受影响模块及直接消费者，仅将该拓扑范围内的接口与 Spec 打包给模型，裁剪无关文件。
2. **Subagent 隔离与串/并行原则**：
   - 只读任务（审查、搜索、批量写测试）可使用 Workflow 执行并行 fan-out。
   - 编码实现任务强制**串行**，防止多个 Subagent 在缺乏共享状态下破坏类型与命名契约。
3. **Fast Mode 机制**：
   允许在紧急迭代或小修改时显式开启 Fast Mode，合理跳过非安全相关的重度 review，但保持所有 Safety/Security 闸门硬生效。
