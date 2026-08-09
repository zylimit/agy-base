---
name: bug-fixer
description: 执行 Red-Locks-The-Bug 红转绿缺陷修复流程。
---

# Bug Fixer Skill

## 1. 红转绿修复协议
1. 派发 `tester` Subagent 编写体现缺陷的失败测试（红）。
2. 主 Agent 校验测试输出处于 Fail 状态。
3. 派发 `implementer` Subagent 修复缺陷逻辑。
4. 主 Agent 校验测试转为 Pass（绿）。
