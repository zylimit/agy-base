---
name: feedback-writer
description: 记录用户针对 AI 行为的修正与教训到 .agents/feedback/。
---

# Feedback Writer Skill

## 1. 核心步骤
当用户提出修正时，派发 `feedback-observer` 将修正原因与行为规则记录至 `.agents/feedback/` 并更新 `FEEDBACK-INDEX.md`。
