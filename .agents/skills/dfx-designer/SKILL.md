---
name: dfx-designer
description: 针对 Resilience, Security, Safety, Privacy, Reliability 五维质量进行过堂分析，制定定量指标与验证策略。
---

# DFX Designer Skill

## 1. 核心流程
1. **五维定档**：审查模块的 DFX 级别 (LOW, MEDIUM, HIGH, CRITICAL)。
2. **生成 DFX-Spec.md**：定义具体防护与降级指标。
3. **关联校验引擎**：通过 `npm run dfx:validate` 确保质量护栏可测试、可验收。
