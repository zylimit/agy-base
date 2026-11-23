# agy-base

本仓是 cc-base（Claude Code 产品开发框架）的 Antigravity（AGY CLI / App / IDE）发行版：`.claude/` 整套就是 cc-base 的原件，`.agents/`、`GEMINI.md`、`setup-agy.sh`、`sync-from-cc-base.sh` 是适配层。人设、铁律、流程、技能、子代理全在 `.claude/CLAUDE.md` 和它指向的 `.claude/rules/`、`.claude/skills/`、`.claude/agents/`——`.agents/rules/cc-base-claude.md` 已通过 `@[CLAUDE.md](../../.claude/CLAUDE.md)` 自动内联 `.claude/CLAUDE.md`；如未生效或因超过 24 KB 被截断，**先完整读 `.claude/CLAUDE.md`，再按它办事**。本文件只写 Antigravity 这个宿主跟 Claude Code 不一样的地方。

## Antigravity 里照常的（通过薄适配层原生生效）

- **主控规则**：`.agents/rules/cc-base-claude.md`（`trigger: always_on`）自动内联 `.claude/CLAUDE.md`；本文件叫 `GEMINI.md` 不叫 `AGENTS.md`，与 `cursor-base` 装进同一个目标项目时不冲突，支持 Claude Code + Cursor + Antigravity 三端共存。
- **技能（`.claude/skills/*`）**：`.agents/skills.json` 直接指向 `.claude/skills`，零复制、永不漂移；`/技能名` 可调，`disable-model-invocation: true` 的（`release-builder` / `branch-finisher`）在 Antigravity 下原生隐藏、不进模型 `<skills>` 列表，照样只许用户亲自敲。
- **子代理（`.claude/agents/*`）**：由 `.agents/scripts/gen-agents.mjs` 生成到 `.agents/agents/*.md`，`invoke_subagent` 派发，fresh 上下文、可并行、工具白名单不含 `invoke_subagent`（单层嵌套由运行时硬约束）。
- **核心生命周期 Hooks**：`.agents/hooks.json` 经 `.agents/scripts/hook-adapter.mjs` 桥接到 `.claude/hooks/*.mjs`（含三档 `tier` 与地板闸），以下事件经本机 `agy -p` 实测生效：
  - `SessionStart` → `check-evolution` / `session-rules-banner` / `recap-on-dirty`（经 `injectSteps` 注入上下文）；
  - `PreInvocation` → 按 `(conversationId, lastUserInput)` 去重映射 `UserPromptSubmit`，触发 `detect-feedback-signal`；
  - `PreToolUse` → `run_command` 跑 `secret-exfil-guard` / `dangerous-pkill-guard` / `pre-commit-check` / `kill-dev-ports`，并对 `gh release` / `npm publish` / `docker push` 返回 `force_ask`；`read_file` / `write_file` / `edit_file` 硬拦密钥与凭据路径（对齐 cc-base `permissions.deny`）；`write_file|edit_file` 跑 `no-direct-code-guard`；`invoke_subagent` 跑 `tdd-gate`；
  - `PostToolUse` → `run_command` 跑 `auto-push`；`write_file|edit_file` 跑 `mark-review-needed` / `record-authorship`；
  - `Stop` → 仅主 Agent 且 `fullyIdle` 且 `NO_TOOL_CALL` 时跑 `stop-gate` / `three-file-sync-gate`，`block`（strict 档或 fail-closed）转 `decision: "continue"` 重新进入循环。
- **独立工具链**：`.claude/githooks/`、`.claude/scripts/`、`.claude/harness/` 不依赖宿主，照常运行。

## Antigravity 里不一样的

- **工具名映射**：`Bash` → `run_command`、`Read` → `read_file`、`Write` → `write_file`、`Edit` → `edit_file`、`Agent|Task` → `invoke_subagent`。注意 `.agents/agents/*.md` 的 YAML frontmatter `tools:` 使用 Antigravity 规范内部名（`view_file` / `write_to_file` / `replace_file_content` / `run_command`），写错名会导致子代理启动失败或挂起；该目录由 `gen-agents.mjs` 生成，别手改。
- **五个事件 Antigravity 没有**：`UserPromptExpansion`（`release-gate.mjs`）、`PreCompact`（`precompact-gate.mjs`）、`PostCompact`（`postcompact-reinject.mjs`）、`Notification`（`notify.mjs`）、`SubagentStop`（`subagent-acceptance-reminder.mjs`）。
  - 发布前（用户敲 `/release-builder` 前）：主 Agent 自己先查 `.claude/.needs-review` 是不是 clean、待审清单清完才进发布流程；
  - 上下文压缩前后：`/compact` 前先把决策/完成落进 `progress.md`，压缩后先 `/recap-project` 再继续；
  - 子代理完成后：主 Agent 收到回执主动走客观验收，不依赖 `subagent-acceptance-reminder`。
- **`PostToolUse` 同步且不回注上下文**：Antigravity 所有 hook 都是同步阻塞且 `PostToolUse` 只能返回 `{}`，因此 `harness-async-verify.mjs`（`asyncRewake: true`）不接入 `.agents/hooks.json`，避免每次编辑卡顿；需要时手工跑 `node .claude/harness/harness.mjs verify`。
- **子代理识别口径**：Antigravity 的 hook payload 不提供 `agent_id` 字段。实测主 Agent 在 `PreInvocation` / `PreToolUse` / `PostToolUse` / `Stop` 上 `lastUserInput` 恒非空，子代理恒为空串 `""`。`hook-adapter.mjs` 据此在子代理调用工具时注入 `agent_id`（放行 `no-direct-code-guard` 并记进 `record-authorship`），并在子代理的 `Stop` 与 `PreInvocation` 上直接放行。
- **`Stop` 的 `advise` 档不强制续跑**：`standard` / `fast` 档下 `stop-gate` 与 `three-file-sync-gate` 照常判定、记 `.claude/evidence/gate-block.log` 并打印到 stderr，但不返回 `decision: "continue"` 以免空耗一轮模型调用；`strict` 档（含改家底自动升档）真拦并强制续跑（适配器设 `executionNum < 3` 熔断防死循环）。
- **子代理模型与能力约束**：`.agents/agents/` 由 `.agents/scripts/gen-agents.mjs` 生成，默认 `model: inherit` 跟主 Agent 走；要给某个角色钉模型写 `.agents/agents-models.json`（形如 `{"code-reviewer": "pro"}`，Antigravity 支持 `inherit` / `flash` / `pro`）。`disallowedTools` 含 `Bash` 的角色（`progress-recorder` / `feedback-observer` / `domain-recorder`）直接从 `tools:` 去掉 `run_command`，由运行时硬禁。定制角色复制一份改名即可，生成器只清理注释里源名等于自己文件名的失源文件。
- **子代理无原生 `fork` 继承**：`feedback-observer`、`progress-recorder` 经 `invoke_subagent` 启动时始终是 fresh 上下文，主 Agent 派发时须把本轮用户原话、决策、约束或改动摘要完整写入 `Prompt`。
- **权限与状态栏**：Antigravity 全局权限在 `~/.gemini/antigravity-cli/settings.json`（`Deny > Ask > Allow`）；仓库级密钥读写拦截由 `hook-adapter.mjs` 在 `PreToolUse` 就地守住，不依赖本机全局配置。如需底栏治理状态，可在 `~/.gemini/antigravity-cli/settings.json` 配置 `statusLine` 指向 `node .claude/scripts/statusline.mjs`。
- **已知口子**：主 Agent 用 `run_command` 里的 shell 重定向写文件（`> file`、`tee`、`sed -i`）绕得过 `no-direct-code-guard`。这是闸的漏洞，不是许可：写业务代码一律派 `implementer`。

## 装到目标项目

`./setup-agy.sh <目标目录>`：先跑 cc-base 的 `setup.sh <目标目录>`（不强改目标已有的 hook 形态，兼容 Claude Code 与 Cursor），再铺 `.agents/agents/`、`.agents/scripts/`、`.agents/rules/`、`.agents/skills.json`、`.agents/hooks.json`（有 `agents-models.json` 也带上）与本文件 `GEMINI.md`；目标已有同名配置文件且内容不同不覆盖，落 `<文件>.framework-new`。`.agents/tests/` 与同步清单不装进目标。装完在目标项目里启动 `agy` 应自动内联 `.claude/CLAUDE.md`、发现全部 cc-base 技能与 8 个子代理，并看到 SessionStart 核心铁律注入。详见 README.md。

## 跟 cc-base 同步

`./sync-from-cc-base.sh <cc-base 仓路径>`：按 cc-base **HEAD** 的 git 清单覆盖本仓的 cc-base 原件（cc-base 工作树必须干净，明知脏仍同步 HEAD 加 `--allow-dirty`），保持 `.claude/settings.json` 原样，重新生成 `.agents/agents/`，并写 `.agents/cc-base-files.txt` 与 `.agents/cc-base-version.txt`。不碰的：README.md、progress.md、progress.archive.md、.gitignore、GEMINI.md、`.agents/`、两个适配脚本。本仓 `.gitignore` 从 `/*` 起到 `# === Antigravity 适配层 ===` 之前那段必须与 cc-base 的 `.gitignore` 逐字相同，不同时同步退 1，手工对齐后再跑。同步后跑 `bash .claude/tests/cases/run-all.sh` 与 `bash .agents/tests/test-adapter.sh` 再提交。
