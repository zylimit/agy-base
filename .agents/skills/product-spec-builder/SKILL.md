---
name: product-spec-builder
description: 收集并分析用户需求，产出格式化的 Product-Spec.md 与 Product-Spec-CHANGELOG.md，建立项目需求基线。
---

# Product Spec Builder Skill

## 1. 激活与触发
当用户提出新功能想法、修改界面或变更逻辑时激活本 Skill。

## 2. 执行流程
1. **需求访谈**：澄清核心业务目标与边界，追问 1-2 个未确定问题。
2. **生成 Spec 规范**：产出 `Product-Spec.md`，明确 Functional Requirements (FRs) 与 Non-Functional Requirements (DFX)。
3. **记录变更**：若为需求变更，在 `Product-Spec-CHANGELOG.md` 增量记录版本号与修改细节。
4. **同步记忆**：同步合并关键决策至 `progress.md`。
