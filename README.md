# Antigravity Harness Development Scaffold (`agy-base`)

> **Antigravity (AGY) 级企业脚手架与架构防腐开发 Harness**
> 支持 600K+ LOC 代码规模 | 5-D DFX 质量Guardrails | 原生 Lifecycle Hooks & Rules 治理

---

## 🌟 核心特性与设计理念

`agy-base` 深度借鉴吸收了业界成熟 Harness（Codex-base, CC-base, Pi-base, Cursor-base, OpenCode-base）的优良实践，并严格基于 **Antigravity 官方原厂脚手架规范** 与机制构建：

1. **Antigravity 原生集成**：
   - 使用 `.agents/` 目录结构，支持 `.agents/rules/*.md`、`skills/<name>/SKILL.md` 与 `hooks.json`。
   - 利用 `hooks.json` 的 `PreToolUse`、`PostToolUse`、`PreInvocation` 与 `Stop` 生命周期钩子控制命令安全与代码门控。
   - 原生配置 `mcp_config.json` 挂载架构检查与 DFX 验证服务。
2. **五维 DFX 质量护栏 (5-Dimensional Quality Guardrails)**：
   - **韧性 (Resilience)**：自动风险识别与服务 Supervisor，支持指数退避拉起、健康探针与熔断保护。
   - **网络与信息安全 (Security)**：Hook 门控实时拦截密钥泄露与提权操作；数据加密与审计追踪。
   - **功能安全 (Safety)**： Fail-Safe 降级防护，物理/生产环境防护，高风险操作双重确认。
   - **隐私性 (Privacy)**：符合 GDPR 与 Privacy-by-Design，支持日志与敏感历史擦除 (`state prune`)。
   - **可靠性 (Reliability)**： lockfile 工具版本锁纪律、自动化验证矩阵 (`verification-matrix.json`) 与棘轮效应。
3. **架构看护与防腐 (Architecture Governance)**：
   - 依赖图校验：`npm run arch:check` 自动排查循环依赖与跨层越级调用。
   - 架构债务棘轮：`npm run arch:baseline` 锁死既有债务，新代码零容忍。
4. **600K+ LOC 大规模项目支持**：
   - 拓扑缩小：基于 `module-catalog.json` 快速定位影响面。
   - Context Budget Packing：通过 `npm run context:pack` 裁剪无关上下文，防止模型上下文爆表与幻觉。
5. **严密工程纪律**：
   - **Verification Before Completion**：无新鲜运行证据禁止 claim 成功。
   - **Red-Locks-The-Bug**：修 bug 前必先补失败测试（红转绿）。
   - **三文件同步**：`Product-Spec.md` + `Product-Spec-CHANGELOG.md` + `progress.md` 即时同步。

---

## 📁 目录结构

```text
agy-base/
├── AGENTS.md                          # SiteMaster 全局主控指令与编排契约
├── GEMINI.md                          # Antigravity 目录级规则入口
├── ARCHITECTURE.md                    # 脚手架系统架构与看护图谱
├── Product-Spec.md                    # 需求规格说明书
├── Product-Spec-CHANGELOG.md          # 需求变更历史
├── DEV-PLAN.md                        # 开发分阶段计划
├── progress.md                        # 项目状态与紧凑记忆
├── FRAMEWORK-MANIFEST.json           # harness 组件 SHA256 完整性清单
├── package.json                       # 快捷命令与 Node 工具集
├── setup.sh                           # Linux/macOS 环境初始化
├── setup.ps1                          # Windows PowerShell 环境初始化
└── .agents/                           # Antigravity Harness 核心
    ├── hooks.json                     # 原生生命周期钩子（安全闸/架构检查/停止控制）
    ├── mcp_config.json                # MCP 服务配置
    ├── EVOLUTION.md                   # 进化引擎说明
    ├── rules/                         # 领域规则
    │   ├── quality-attributes.md      # 5-D DFX 质量标准
    │   ├── harness-large-repo.md      # 600K+ LOC 大仓隔离规则
    │   ├── architecture-governance.md # 架构防腐细则
    │   ├── subagent-contracts.md      # 子角色派发契约
    │   └── anti-performativity.md     # 验证与红转绿协议
    ├── harness/                       # Harness 校验引擎 (Node.js)
    │   ├── arch-checker.js            # 架构循环依赖与分层校验
    │   ├── dfx-validator.js           # 5-D DFX 校验器
    │   ├── context-packer.js          # 600K LOC 上下文预算打包器
    │   ├── supervisor.js              # 服务韧性守护进程
    │   ├── fast-mode.js               # Fast Mode 状态管理器
    │   ├── module-catalog.json        # 模块拓扑 catalog 范本
    │   └── verification-matrix.json   # 验证矩阵配置
    ├── scripts/                       # Shell 辅助工具 (doctor/fast-mode)
    ├── feedback/                      # 经验教训与修正历史
    └── skills/                        # Antigravity Progressive Skills
        ├── product-spec-builder/
        ├── arch-designer/
        ├── dfx-designer/
        ├── dev-planner/
        ├── dev-builder/
        ├── bug-fixer/
        ├── code-review/
        ├── adversarial-review/
        ├── test-builder/
        ├── release-builder/
        ├── branch-finisher/
        ├── large-repo-harness/
        ├── skill-builder/
        ├── feedback-writer/
        ├── evolution-engine/
        └── progress-recorder/
```

---

## 🚀 快速上手与常用命令

### 1. 初始化框架环境
```bash
./setup.sh
```
或在 Windows PowerShell 中：
```powershell
.\setup.ps1
```

### 2. 执行环境诊断与完整性检查
```bash
npm run doctor
```

### 3. 架构依赖与循环检查
```bash
npm run arch:check
```

### 4. 锁定当前架构基线（建立债务棘轮）
```bash
npm run arch:baseline
```

### 5. 5-D DFX 质量过堂验证
```bash
npm run dfx:validate
```

### 6. 大仓 Context 预算打包
```bash
npm run context:pack -- --target=src/core --budget=4000
```

### 7. 切换 Fast Mode (跳过非关键 review)
```bash
node .agents/harness/fast-mode.js on 24
node .agents/harness/fast-mode.js status
node .agents/harness/fast-mode.js off
```

---

## 🛠 Workflow 与 Skill 路由

当你在 Antigravity 中向 SiteMaster 发出指令时，系统会自动激活相应的 Progressive Skill：

- **`/product-spec-builder`**：产品需求收集与修改。
- **`/arch-designer`**：架构设计、模块划分与 ADR 编写。
- **`/dfx-designer`**：5-D 质量属性（韧性/安全/功能安全/隐私/可靠性）评估与定量定档。
- **`/dev-planner`**：生成可执行的 DEV-PLAN.md 分阶段计划。
- **`/dev-builder`**：按 Spec + Plan 委派 implementer 编写代码。
- **`/bug-fixer`**：开启红转绿（Red-Locks-The-Bug）缺陷修复流程。
- **`/code-review`**：发起多维度代码审查与红蓝对抗审查。
- **`/test-builder`**：独立编写回归测试与系统测试。
- **`/release-builder`**：自动化打包、部署与冒烟验证。
- **`/large-repo-harness`**：大仓拓扑分析与上下文剪裁。

---

## 🛡 授权与安全

Antigravity Harness 使用 `hooks.json` 拦截高风险命令。在触发敏感操作（如网络发送、端口占用、文件删除）时，PreToolUse 钩子将强制进行确认与审计，确保整个开发过程可控防腐。
