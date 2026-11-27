# Progress

agy-base 的项目记忆。本仓自 v3.0.0 起升级为 cc-base 的**纯软链（Zero-Copy Link）跨平台 Antigravity 发行版**：上游 `.claude/` 唯一真源由 `cc-base` 维护，本仓只维护极薄的 `.agents/` 运行时适配层与 `scripts/` 跨平台事务安装器。`v2.2.0-legacy`（早期独立引擎时代）的记忆原样留在 `progress.archive.md`，内置 `.claude/` 拷贝时代的最终快照留在 tag `v2.3.0-bundled-backup`。

## Pinned（必守）

- **单一真源、零拷贝 `.claude/`**：本仓不再拷贝 `.claude/` 下的 500+ 个原件文件，也不再使用 `sync-from-cc-base.sh`；上游能力契约统一由 `cc-base-contract.json` 声明并由 `scripts/lib/cc-dep.mjs` 校验。
- **根目录零文件侵入（`seeded: []`）**：宿主差异说明自 v3.0.0 起内聚于 `.agents/rules/cc-base-agy-host.md`（`trigger: always_on`，`< 6 KB`），安装器绝不向目标项目根写入 `GEMINI.md` / `AGENTS.md` / `CLAUDE.md`，实现 Claude Code + Cursor + CodeAgent + Antigravity 四端零冲突共存。
- **零外部依赖与 Windows PowerShell 一等公民**：全仓仅使用 Node.js `>= 20.0.0` 内置模块；子进程调用一律 `shell: false, windowsHide: true`；`setup.ps1` 保持纯 7-bit ASCII 无 UTF-8 BOM。
- **软链/Junction 绝对安全**：`.agents/skills` 在 Windows 用免管理员 NTFS Junction、在 POSIX 用相对软链 `../.claude/skills`，与 `.agents/skills.json` 构成双保险；拆链与卸载严禁递归删除目标，确保 `.claude/` 100% 毫发无损。
- **子代理按需生成与毫秒级指纹自愈**：`.agents/agents/*.md` 由 `.agents/scripts/gen-agents.mjs` 按需生成（`model: inherit` + Antigravity 规范内部工具名 `view_file` / `write_to_file` / `replace_file_content` / `run_command`）并记录 `.agents/.runtime/agents-gen.sha256`；源仓不跟踪生成物，下游由安装器与 `SessionStart` 自动自愈。
- 新增任何适配层控制之前先在本机实测证明它会响；所有测试写操作均在临时目录隔离执行，不污染工作树。

## Done

- 2026-11-27 **原地升级为 v3.0.0 纯软链（Zero-Copy Link）跨平台发行版**：
  - 备份打标 `v2.3.0-bundled-backup` 并移除 521 个 `.claude/` 拷贝文件、`docs/`、`GEMINI.md`、`make-release.sh` 与 `sync-from-cc-base.sh`，切换为标准 `.gitignore` / `.gitattributes` / `.editorconfig` / `package.json`（v3.0.0）与 `cc-base-contract.json`；
  - 落地零依赖跨平台安装器内核 `scripts/agy-base.mjs` 与 `scripts/lib/{path-guard,link-manager,cc-dep,hooks-merge,manifest}.mjs`，配齐纯 ASCII 无 BOM `setup.ps1`（含 `COMMON_TYPO_SUBCOMMANDS` 裸词误输退 2 守卫）、POSIX `setup.sh` 及向后兼容薄壳 `setup-agy.sh`；
  - 实现三层解耦 `cc-base` 自动寻源联装（Tier 1 已有合规 `.claude/` 直接复用或 `--with-cc` 升级；Tier 2 按 `--cc-base` -> `.bundled-cc-base` -> `$CC_BASE_DIR` -> `../cc-base` 自动联装；Tier 3 `--no-auto-cc` 延迟安装退 0）及 `release <ver> --bundle-cc <dir>` 单包离线制品能力；
  - 根级 `GEMINI.md` 迁入 `.agents/rules/cc-base-agy-host.md`（`< 6 KB`）实现零根文件侵入，安装器对旧版 v2 框架生成的 `GEMINI.md` 自动平滑归档至 `.agents/.runtime/migrated-v2-<ts>/GEMINI.md`（用户手写 `GEMINI.md` 绝不触碰）；
  - 加固 `.agents/scripts/{hook-adapter,gen-agents,ps-floor,doctor}.mjs`：接入 F-01..F-11 全部防御项（外层父目录 `.git` `GIT_CEILING_DIRECTORIES` 串仓隔离、`SessionStart` 软链与 `agents-gen.sha256` 毫秒级自愈、`PreInvocation` `/release-builder` 待审阻断警告补位、`ps-floor.mjs` 双壳安全地板与 F-05.1 `isSafePowerShellEnvCommand` 防误杀、写路径 POSIX 相对归一化与 `.agents/` 免标 `.needs-review`、双模 `doctor.mjs` 智能 `selfRoot` 回退），替换 `.github/workflows/gate.yml` 为自包含 Ubuntu + Windows 跨平台门禁，并通过 `pack-check` 与 `/tmp` 全生命周期实测。
- 2026-11-25 **同步 `cc-base ce100eb` + 修复跨仓 `git commit` 误触发**：拉入 `readable-docs` 第四期（`page-shots.mjs`、`readable/structure.mjs`、`collect-feedback-docs.mjs` 等 521 文件），自动重生成 `.agents/agents/implementer.md`；`hook-adapter.mjs` 新增 `resolveGitCommitRoot` 识别 `cd <dir> && git commit` / `git -C <dir> commit`，避免误在当前会话仓库跑 `pre-commit-check` / `auto-push`（自测 35/35 PASS）。
- 2026-11-24 **补充跨仓软链技能说明**：实测指向 `workspaceDirs` 之外的 `.claude/skills/<名>` 软链默认被工作区边界跳过，启动带 `agy --add-dir <外部仓库>` 原生生效，已记入宿主说明。
- 2026-11-24 **验收通过**：`.agents/tests/test-adapter.sh` 34/34 PASS（0 FAIL / 0 SKIP）；`setup-agy.sh` 装到空项目后真机 `agy -p` 端到端验证通过：自动内联 `.claude/CLAUDE.md`（SiteMaster 中文 + 七字段派单）✓；`SessionStart` 注入 `tier: standard` + 「🔒 CC框架核心铁律」✓；`.agents/skills.json` 挂载 cc-base 技能且原生隐藏 `release-builder` / `branch-finisher` ✓；`read_file .env` 被 `agy-secret-guard` 拦截 ✓；主 Agent `write_file src/main.ts` 被 `no-direct-code-guard` 拦截 ✓；`implementer` 子代理拉起并成功写入 `src/sub.ts` + 跑通 `node --check`（exit 0）+ `PostToolUse` 登记进 `.claude/.needs-review` ✓。
- 2026-11-24 **彻底淘汰旧版独立引擎并 100% 基于最新 cc-base 重建**：旧版打 tag `v2.2.0-legacy` 留档、旧 `progress.md` 归档至 `progress.archive.md`；同步基线 `cc-base 8e13f6c`（514 文件 + 8 生成子代理）；落地薄适配层（`GEMINI.md`、`.agents/rules/cc-base-claude.md`、`.agents/skills.json`、`.agents/hooks.json`、`.agents/scripts/gen-agents.mjs`、`.agents/scripts/hook-adapter.mjs`、`setup-agy.sh`、`sync-from-cc-base.sh`、`.agents/tests/test-adapter.sh`）。

## Decisions

- 2026-11-27 **原地升级为 v3.0.0 纯软链（Zero-Copy Link）+ 三层解耦 `cc-base` 自动联装 + 零根文件侵入架构**。依据：在 `agy-base` 内重复拷贝 521 个 `.claude/` 文件造成跨仓手工同步负担与双份维护成本；改为三层解耦寻源联装（复用已有 `.claude/` / 自动发现同级或环境变量或 `.bundled-cc-base` 一键联装 / `--no-auto-cc` 延迟自愈）兼顾新老用户一键体验与零拷贝纯洁性；同时将原根级 `GEMINI.md` 迁入 `.agents/rules/cc-base-agy-host.md`（`trigger: always_on`），彻底释放项目根目录，支持四端工具链零冲突共存。适用范围：全仓 `scripts/`、`.agents/`、`setup.{ps1,sh}`。取代：v2.3.0 内置 `.claude/` 全量拷贝、`sync-from-cc-base.sh` 与根级 `GEMINI.md` 投放方案。
- 2026-11-27 **`.agents/skills` OS 软链/Junction 与 `.agents/skills.json` 双保险并存，子代理按 `agents-gen.sha256` 动态自愈**。依据：Windows Junction + POSIX 相对软链提供标准文件系统级目录映射，`.agents/skills.json` 确保即使团队成员 Git 克隆未还原软链也能开箱加载技能；`.agents/agents/*.md` 需转换为 Antigravity 专属内部工具名白名单，不宜直接软链 `.claude/agents`，故采用安装时生成 + `SessionStart` 联合 SHA-256 指纹毫秒级自愈。适用范围：`link-manager.mjs`、`gen-agents.mjs`、`hook-adapter.mjs`。取代：源仓静态提交 `.agents/agents/*.md` 方案。
- 2026-11-24 **用 `GEMINI.md` 而非 `AGENTS.md` 作为宿主说明，用 `.agents/rules/cc-base-claude.md` 内联 `.claude/CLAUDE.md`**（注：2026-11-27 v3.0.0 起根级 `GEMINI.md` 已进一步迁入 `.agents/rules/cc-base-agy-host.md` 实现零根文件侵入，`.agents/rules/cc-base-claude.md` 内联机制保持不变）。
- 2026-11-24 **`.agents/skills.json` 直接指向 `.claude/skills`，零复制**。依据：2026-11-24 `agy -p` 实测挂载全部 20 个模型可调技能，且原生遵守 `disable-model-invocation: true`（自动隐藏 `release-builder` 与 `branch-finisher`）。适用范围：`.agents/skills.json`。取代：旧版复制改写 18 个 skill（含多个 300B 空壳）。
- 2026-11-24 **子代理 `tools:` 使用 Antigravity 规范内部工具名，并按 `disallowedTools` 硬裁剪**。依据：2026-11-24 `agy -p` 实测：① 不写 `tools:` 时子代理仅拿到只读工具；② 写 `create_file` 报 tool not found、写 CLI 展示名 `write_file`/`edit_file` 触发已知挂起 bug；③ 写 `view_file` / `write_to_file` / `replace_file_content` / `run_command` 稳定映射为 CLI 的 `read_file` / `write_file` / `edit_file` / `run_command` + `manage_task`；④ 含 `Bash` 禁令的 3 个记录员直接去掉 `run_command`，且所有子代理不给 `start_subagent`/`invoke_subagent`，由运行时硬禁。适用范围：`.agents/scripts/gen-agents.mjs`。取代：无（旧版无 `.agents/agents/`）。
- 2026-11-24 **通过薄适配器 `hook-adapter.mjs` 桥接真 `.claude/hooks/*.mjs`，按 `lastUserInput` 区分主 Agent 与子代理**。依据：2026-11-24 `agy -p` 实测：Antigravity 全部 6 个事件均触发但 payload 无 `agent_id`，主 Agent 在工具/调用/停止事件中 `lastUserInput` 恒非空而子代理恒为 `""`；据此放行子代理的 `no-direct-code-guard` 与 `Stop`；`Stop` 同时校验 `fullyIdle !== false`、`terminationReason === 'NO_TOOL_CALL'` 与 `executionNum < 3`；`PreToolUse` 就地补齐仓库级密钥读写拦截与发布命令 `force_ask`。适用范围：`.agents/hooks.json` 与 `.agents/scripts/hook-adapter.mjs`。取代：旧版 77 行空壳 `hook-handlers.js`。
- 2026-11-24 **不接入 `harness-async-verify.mjs`（同步阻塞限制）**。依据：Antigravity `hooks.md` 明确所有 hook 均同步阻塞且 `PostToolUse` 不支持回注上下文，接入 300s 校验会卡死每次文件编辑。适用范围：`.agents/hooks.json`。取代：无。

## 当前断点（2026-11-27）

`agy-base` v3.0.0 纯软链跨平台升级核心实现、`FRAMEWORK-MANIFEST.json` 清单生成、`pack-check` 自检与 `/tmp` 全生命周期验证已完成，待独立 `cac-tester` 编写 `.agents/tests/` 测试套件并由 `cac-reviewer` 完成独立代码审查。

## TODO

- [ ] #1 P3 交互模式（TUI）下确认 `SessionStart` 首次启动时 `lastUserInput` 与状态栏 `statusLine` 的实际显示效果。
- [x] #2 P3 Windows（PowerShell）下的 `setup.ps1` 跨平台安装器（已在 v3.0.0 通过纯 ASCII 无 BOM `setup.ps1` + 零依赖 `scripts/agy-base.mjs` 完整落地）。

## In Progress

- 无。

## 明确不做（防过度工程）

- 不在本仓拷贝或手改 `.claude/` 原件。
- 不为 Antigravity 另写一套 skills / rules / feedback / 独立治理引擎。
- 不复活旧 `v2.2.0-legacy` 的任何空壳部件（`arch-checker.js`、`dfx-validator.js`、`mcp_config.json`、`hook-handlers.js`）。
