---
name: test-builder
description: 派发 fresh tester Subagent 独立编写单元测试、集成测试与回归测试。
---

# Test Builder Skill

## 1. 写测独立性
- `tester` 必须是全新的 Subagent 实例，独立于实现作者。
- 测试结果必须附带包含真实命令行输出的验证凭据 (Evidence)。
