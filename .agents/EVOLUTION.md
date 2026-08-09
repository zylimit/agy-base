# Antigravity Harness Self-Evolution Engine

## 1. 触发与原则
当用户给出行动修正、习惯纠正或发现反复出现的缺陷时，通过派发 `feedback-observer` 和 `evolution-runner` Subagent 触发自我进化。进化引擎遵循：
- **客观事实归因**：基于用户具体的纠正提示（如："不要在无测试时 claim PASS"）归纳规律。
- **渐进性修改**：优先在 `.agents/feedback/` 增量添加经验规则，经用户确认后再升阶更新 `.agents/rules/` 或 `.agents/skills/`。

## 2. 进化流程
1. **反馈观察 (Observer)**：抓取用户修正并写入 `.agents/feedback/` 对应 topic。
2. **进化扫描 (Runner)**：扫描近期积累的 feedback，分析频次与冲突。
3. **提案生成 (Proposer)**：拟定修改建议并向用户汇报，获批后合入规则库。
