---
trigger: always_on
description: Antigravity 宿主适配协议与差异说明（agy-base v3.0.0 纯软链零根侵入版）
---

# Antigravity 宿主适配补充协议（agy-base v3.0.0）

本文件仅记录 Antigravity（`agy` CLI / Antigravity App / IDE）相对于 Claude Code（`cc-base`）的宿主差异与桥接约定。人设、核心铁律、全流程技能与角色职责唯一真源位于 `.claude/CLAUDE.md`（已由 `.agents/rules/cc-base-claude.md` 通过 `@[CLAUDE.md](../../.claude/CLAUDE.md)` 自动内联；若发现未生效或被截断，先完整读取 `.claude/CLAUDE.md` 再行事）。

## 1. 纯软链架构与根目录零文件侵入

- **零根文件侵入**：宿主说明自 v3.0.0 起内聚于 `.agents/rules/cc-base-agy-host.md`，安装器不再向项目根目录写入 `GEMINI.md` / `AGENTS.md` / `CLAUDE.md`。同一目标项目可同时安装并使用 Claude Code（`cc-base`）、Cursor（`cursor-base`）、CodeAgent（`cac-base-link`）与 Antigravity（`agy-base`）四端共存、零冲突。
- **开场零盲探与目录硬边界**：刚初始化的新项目根目录可能仅含隐藏目录 `.claude/` 与 `.agents/`。首轮寒暄/问路结合 `SessionStart` 注入信息直接回复，不盲跑探测命令，严禁向上越界翻阅外层父目录或兄弟仓库。
- **技能双保险挂载（`.claude/skills/*`）**：同时通过 `.agents/skills`（POSIX 相对软链 `../.claude/skills` / Windows 免管理员 NTFS Junction）与 `.agents/skills.json` 指向 `.claude/skills`，零拷贝、永不漂移；标记 `disable-model-invocation: true` 的技能（`release-builder` / `branch-finisher`）原生隐藏，仅限用户亲自触发。若个别技能软链跳出工作区边界，启动加 `agy --add-dir <外部路径>`。

## 2. 工具名映射与子代理契约

- **主对话工具映射**：`Bash` → `run_command`、`Read` → `read_file`、`Write` → `write_file`、`Edit` → `edit_file`、`Agent|Task` → `invoke_subagent`。
- **子代理定义与规范内部工具名**：`.agents/agents/*.md` 由 `.agents/scripts/gen-agents.mjs` 从 `.claude/agents/*.md` 按需生成，并在 `SessionStart` 按联合 SHA-256 指纹毫秒级自愈，**禁止手改**。
  - YAML frontmatter `tools:` 必须使用 Antigravity 规范内部名（`view_file` / `write_to_file` / `replace_file_content` / `run_command`），写错会导致子代理启动失败或挂起；
  - `disallowedTools` 含 `Bash` 的记录员（`progress-recorder` / `feedback-observer` / `domain-recorder`）自动移除 `run_command`；所有子代理不给 `invoke_subagent` 硬禁二次嵌套；
  - 默认 `model: inherit`，如需为特定角色钉模型写 `.agents/agents-models.json`（如 `{"code-reviewer":"pro"}`，支持 `inherit` / `flash` / `pro`）。
- **无原生 `fork` 继承**：`invoke_subagent` 始终拉起 fresh 上下文；派发 `feedback-observer`、`progress-recorder` 等角色时，主 Agent 必须把本轮用户原话、决策依据与改动摘要完整写入 `Prompt`。

## 3. 缺失的 5 个宿主事件与自觉补位

Antigravity 宿主不提供 `UserPromptExpansion`、`PreCompact`、`PostCompact`、`Notification`、`SubagentStop` 五个事件：

1. **发布前置卡点（补位 `release-gate`）**：用户触发 `/release-builder` 时，`hook-adapter.mjs` 在 `PreInvocation` 自动检查 `.claude/.needs-review` 并在未清零时注入阻断警告；主 Agent 亦须先核查 `.claude/.needs-review` 为 `clean` 且测试全绿后再进入发布流程。
2. **上下文压缩前后（补位 `PreCompact` / `PostCompact`）**：压缩前先把关键决策与进展落入 `progress.md`，压缩后先执行 `/recap-project` 恢复上下文再继续。
3. **子代理回执验收（补位 `SubagentStop`）**：主 Agent 收到子代理回执后主动核对信封字段与客观命令证据，不依赖自动提醒钩子。

## 4. Hook 桥接、跨平台安全地板与运行边界

- **生命周期桥接**：`.agents/hooks.json` 经 `.agents/scripts/hook-adapter.mjs` 桥接 `.claude/hooks/*.mjs`，自动识别未独立 `git init` 的外层父目录 `.git` 并注入 `GIT_CEILING_DIRECTORIES` 防止串仓误报。
- **双壳安全地板闸**：`PreToolUse(run_command)` 前置运行 `ps-floor.mjs`（覆盖 Bash / PowerShell / CMD 高危破坏命令与密钥读取外传拦截），并对 `gh release` / `npm publish` / `docker push` 返回 `force_ask`；`read_file` / `write_file` / `edit_file` 就地硬拦 `.env`、私钥与凭据路径。
- **子代理识别与 `Stop` 熔断**：Antigravity payload 无 `agent_id`；实测主 Agent 在 `PreInvocation` / `PreToolUse` / `PostToolUse` / `Stop` 上 `lastUserInput` 恒非空，子代理恒为 `""`，适配器据此为子代理注入 `agent_id` 并放行子代理 `Stop`。`Stop` 在 `strict` 档真拦续跑（设 `executionNum < 3` 硬熔断防死循环），`standard` / `fast` 档仅记账提醒不空耗轮次。
- **同步 `PostToolUse` 与已知边界**：`PostToolUse` 同步阻塞且不回注上下文，不接 `harness-async-verify.mjs`（按需手工跑 `node .claude/harness/harness.mjs verify`）。主 Agent 若在 `run_command` 用 shell 重定向写源码可绕过 `no-direct-code-guard`——这是闸的边界而非许可，写业务源码一律派 `implementer`。

## 5. 安装、升级与自检

- **Windows PowerShell**：`pwsh -File .\setup.ps1 -Target D:\your-project`（升级加 `upgrade` / 联升上游加 `-WithCc` / 卸载加 `-Uninstall`）
- **Linux / macOS / WSL**：`./setup.sh /path/to/your-project`（兼容 `./setup-agy.sh /path/to/your-project`）
- **健康自检**：`node .agents/scripts/doctor.mjs`
