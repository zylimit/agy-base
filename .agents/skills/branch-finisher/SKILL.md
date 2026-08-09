---
name: branch-finisher
description: 执行分支合并、PR 模板校验（包含 HUMAN/AGENT 分区）与 Worktree 清理。
---

# Branch Finisher Skill

## 1. 核心步骤
1. 跑通 `npm run doctor` 确认质量闸。
2. 生成带有 HUMAN/AGENT 分区与测试标记的 PR 摘要。
3. 清理临时 `.task/` 与临时分支。
