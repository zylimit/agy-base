---
name: adversarial-review
description: 对高风险或核心架构变更发起红蓝对抗审查（红队攻击，蓝队防守，主 Agent 裁决）。
---

# Adversarial Review Skill

## 1. 流程
1. **红队角色 (Red Team)**：寻找边缘并发、异常边界与注入攻破手段。
2. **蓝队角色 (Blue Team)**：根据架构设计与 Spec 为实现辩护或提出补丁。
3. **主 Agent 裁决**：依据复现步骤与质量门控决定是否接受修改。
