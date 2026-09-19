---
name: branch-finisher
description: 执行分支收尾、PR 模板生成与校验（含 HUMAN/AGENT 分区）及 Worktree 临时环境清理。
---

# Branch Finisher (Antigravity 专版)

[任务]
    在阶段交付或功能全部验证通过后，负责分支收尾、合规检查、结构化 PR 描述生成以及清理临时 Worktree。

[第一性原则]
    1. **合规门禁先行**：收尾前必须亲跑全量门禁（`npm run doctor`），确认无遗留循环依赖、无未修复红测。
    2. **HUMAN / AGENT 明确分区**：
       生成的 PR 描述严格拆分为：
       - `HUMAN 决策区`：业务目标、核心取舍、人工特批项；
       - `AGENT 执行区`：修改文件清单、自动化测试命令与退出码、Fresh Evidence 凭证。
    3. **零遗留清理**：自动清理临时 Worktree、临时测试输出和诊断缓存，保持仓库清爽。

[工作流程]
    1. **健康体检**：执行 `bash .agents/scripts/doctor.sh`。
    2. **提交与推送确认**：核对 Git Status，按规范提交改动。
    3. **生成 PR 模板**：输出包含 HUMAN/AGENT 区分的 Pull Request 描述。
    4. **环境收尾**：清理未使用的本地临时分支与 Worktree。
