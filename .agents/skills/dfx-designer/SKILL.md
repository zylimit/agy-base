---
name: dfx-designer
description: 当架构或需求确认后，需要定义 5-D DFX 质量属性（韧性、安全、功能安全、隐私、可靠性/性能）、威胁建模、故障模式分析，并绑定自动化验证矩阵时使用。
---

# DFX Designer (Antigravity 专版)

[任务]
    **生成模式**：从已确认需求、业务故障后果与架构设计出发，将非功能质量诉求转化为可定量度量、可自动化验证的工程指标，生成并维护：
    1. `DFX-Spec.md` —— 核心维度的定量指标、设计防护手段、验证命令与不适用理由。
    2. `.agents/harness/module-catalog.json` 的 `attributes` 分层 —— 为各核心模块打标 `critical / high / medium / low`，接入五维质量门。
    3. `.agents/harness/verification-matrix.json` 检查定义 —— 确保每个 `critical / high` 维度至少具备一个声明对应 `attributes` 的可执行检查命令（check id）。

    **迭代模式**：需求或架构变更后，重新评估受影响维度的指标与防护，更新 `DFX-Spec.md` 与验证矩阵；未受影响的维度严格保持稳定。

[第一性原则]
    1. **从业务损失推导目标（绝不空喊口号）**：
       杜绝“高可用、高性能”等模糊措辞。从具体的失效情境推导：谁受影响、业务停摆多长时间、直接资金或声誉损失多大、现行如何补救。以“在什么负载/环境下 → 发生什么故障刺激 → 哪项业务结果必须保持 → 用什么观察证明”编写可判定规格。
    2. **威胁建模（STRIDE & MAESTRO）**：
       对网络与信息安全（Security）执行系统性威胁分析：
       - Spoofing（仿冒身份）：鉴权与凭证安全；
       - Tampering（篡改数据）：传输加密与防篡改哈希；
       - Repudiation（抵赖行为）：安全审计日志；
       - Information Disclosure（信息泄露）：数据脱敏与密钥隔离；
       - Denial of Service（拒绝服务）：限流、熔断与过载保护；
       - Elevation of Privilege（特权提升）：RBAC 最小权限与命令护栏；
       - Agent 专属安全：MAESTRO 针对工具滥用、Prompt 注入与记忆投毒的安全护栏。
    3. **故障模式与影响分析（FMEA / 韧性与功能安全）**：
       对外部依赖与关键断点分析：失效模式 → 潜在后果 → 严酷度 → 自动隔离降级机制（Safe Fallback / Circuit Breaker）。确保任何外部组件宕机时系统 fail-visible 并安全降级，严禁静默雪崩。
    4. **反证优先与真实证据承接**：
       每个 critical/high 维度必须绑定可运行的验证命令。没有全新、真实的 PASS 命令回执与输出，严禁宣称质量达标。FAIL、缺检查、未运行和目标尚未确定分别明确报告。
    5. **诚实降级原则**：
       不适用的维度显式写 `N/A + 理由`；当前做不到的目标明确写“当前不达标 + 差距 + 补齐计划”，严禁把目标暗改写成现状。

[12 维软件 DFX 与 5-D 守护映射]
    | # | DFX 维度 | 软件语境核心含义 | 典型度量指标 | 5-D 属性映射 |
    |---|---|---|---|---|
    | 1 | **可靠性 Reliability** | 规定条件和时间内持续稳定无故障执行 | MTBF、崩溃率、错误预算、数据一致性 | reliability |
    | 2 | **韧性 Resilience** | 突发故障、依赖宕机与流量洪峰下的自愈与降级 | 自动拉起耗时、熔断生效时延、健康探测 | resilience |
    | 3 | **安全性 Security** | 防未授权访问、窃听、篡改与特权提升 | 密钥泄漏拦截、鉴权覆盖率、漏洞扫描 | security |
    | 4 | **功能安全 Safety** | 系统失效时不破坏生产/物理环境与核心资产 | 破坏性命令拦截、Safe Fallback 生效 | safety |
    | 5 | **隐私性 Privacy** | 个人与敏感数据合规收集、使用、脱敏与清理 | 敏感字段脱敏率、日志保留期清理 | privacy |
    | 6 | **性能 Performance** | 时延、吞吐量与计算资源效率达标 | P95/P99 时延、QPS、CPU/内存预算 | performance |
    | 7 | **可测试性 Testability** | 可自动化断言，边界可注入、状态可观测 | 自动化测试覆盖率、Mock/Fixture 成本 | reliability |
    | 8 | **可服务性 Serviceability** | 可观测、可诊断、可排障与可运维 | 结构化日志覆盖、分布式追踪 Trace 完整度 | resilience |
    | 9 | **可安装性 Installability** | 安装、升级与迁移确定，失败有回滚/前向修复 | 一键安装脚本耗时、迁移回退成功率 | reliability |
    | 10 | **可制造性 Manufacturability** | CI 一键可复现构建打包 | 构建时长、哈希可复现性、产物一致性 | reliability |
    | 11 | **可维修性 Repairability** | 缺陷可快速定位修复且不引发回归 | MTTR 修复耗时、Red-Lock 覆盖率 | maintainability |
    | 12 | **可扩展性 Modifiability** | 业务变化时扩展成本低、修改扩散半径小 | 单变更触改文件数、扩展点复用率 | maintainability |

[文件结构]
    dfx-designer/
    ├── SKILL.md
    ├── references/
    │   └── measurement-methods.md     # 场景推导、度量方法、采集与反证
    ├── templates/
    │   └── dfx-spec-template.md       # DFX-Spec.md 输出模板
    └── examples/
        └── reservation-case-dfx.md

[工作流程]
    1. **依赖检测**：读取 `Product-Spec.md`、`Architecture-Design.md` 与 `.agents/harness/module-catalog.json`。
    2. **损失推导与场景量化**：提取业务停摆风险，编写故障场景并确定数字化指标。
    3. **产出 DFX 规范**：
       - 输出 `DFX-Spec.md`，明确 12 维评估、指标、STRIDE 威胁分析与 FMEA 韧性方案。
       - 更新 `.agents/harness/module-catalog.json` 中各模块的 `attributes` 评级（critical / high / medium / low）。
       - 更新 `.agents/harness/verification-matrix.json`，补充对应指标的自动化校验脚本与 check id。
    4. **运行 DFX 自检**：
       执行 `node .agents/harness/dfx-validator.js`，核验关键模块是否已全量覆盖验证检查。
    5. **同步记忆与交接**：
       将关键 DFX 约束写入 `progress.md` 的 Pinned 区域，引导进入开发计划拆解（`/dev-planner`）。
