# agy-base (v3.0.0 Zero-Copy Link)

`cc-base` 的 **Antigravity（`agy` CLI / Antigravity App / IDE）纯软链（Zero-Copy Link）跨平台发行版**，原生支持 Windows PowerShell、WSL、Linux 与 macOS。

自 `v3.0.0` 起，`agy-base` 彻底告别在仓库中重复拷贝 500+ 个 `.claude/` 文件与手工运行 `sync-from-cc-base.sh` 的旧模式，升级为对齐 `cac-base-link` 的**零拷贝桥接 + 三层解耦自动联装 + 零根文件侵入**架构：

```text
agy-base/
├── .agents/
│   ├── rules/
│   │   ├── cc-base-claude.md     # always_on：通过 @[CLAUDE.md](../../.claude/CLAUDE.md) 原生内联主控宪法
│   │   └── cc-base-agy-host.md   # always_on：Antigravity 宿主差异与桥接协议（< 6 KB，零截断、零根文件侵入）
│   ├── skills.json               # 指向 .claude/skills（与 .agents/skills OS 软链/Junction 构成双保险）
│   ├── hooks.json                # Antigravity 生命周期钩子，无损合并保留用户自定义非 cc-base-* 块
│   ├── scripts/
│   │   ├── hook-adapter.mjs      # 双向协议适配器（SessionStart 自愈、外层 .git 隔离、/release-builder 补位）
│   │   ├── gen-agents.mjs        # 按需从 .claude/agents/*.md 生成子代理并写 agents-gen.sha256 指纹
│   │   ├── ps-floor.mjs          # Bash + PowerShell + CMD 双壳危险命令与密钥外传地板闸
│   │   └── doctor.mjs            # 双模健康体检（--source-check 源仓 / 下游目标项目，支持 --json）
│   └── FRAMEWORK-MANIFEST.json   # 受管文件 LF-SHA256 清单（engine: "agy-base", seeded: []）
├── scripts/
│   ├── agy-base.mjs              # 零依赖跨平台事务安装器 CLI 内核（install/upgrade/uninstall/doctor/manifest/pack-check/release）
│   └── lib/                      # path-guard / link-manager / cc-dep / hooks-merge / manifest
├── cc-base-contract.json         # 对上游 cc-base (.claude/) 的能力契约声明
├── setup.ps1                     # Windows PowerShell 5.1+ / pwsh 7+ 薄壳入口（纯 7-bit ASCII 无 BOM）
├── setup.sh                      # WSL / Linux / macOS / Git Bash 薄壳入口
└── setup-agy.sh                  # 向后兼容薄壳（透传至 setup.sh）
```

## 环境要求

- **Node.js >= 20.0.0**（零 npm 外部依赖，纯内置模块）
- **Git**
- **Antigravity CLI（`agy`）** 或 **Antigravity App / IDE**

## 快速安装到目标项目

### Linux / macOS / WSL / Git Bash

```sh
./setup.sh /path/to/your-project
# 向后兼容旧命令：
./setup-agy.sh /path/to/your-project
```

### Windows PowerShell

```powershell
pwsh -File .\setup.ps1 -Target D:\path\to\your-project
```

### 三层解耦 `cc-base` 自动寻源联装

安装器内置三层上游 `cc-base` 协调策略，无需手工分两步拷贝：

1. **Tier 1（复用 / 按需同升）**：若目标目录已有满足 `cc-base-contract.json` 的 `.claude/`，直接零拷贝复用并建立桥接；传 `--with-cc`（PowerShell `-WithCc`）可同步升级 `.claude/`。
2. **Tier 2（一步自动联装）**：若目标缺少 `.claude/` 且未传 `--no-auto-cc`，按优先级 `--cc-base <dir>` → `<agy-base>/.bundled-cc-base` → `$CC_BASE_DIR` → `../cc-base` 自动寻源并调用上游 `setup.ps1` / `setup.sh` 一步装齐 `.claude/` + `.agents/`。
3. **Tier 3（延迟自愈）**：若传 `--no-auto-cc`（或 `AGY_NO_AUTO_CC=1`）或当前环境暂无 `cc-base` 源，先干净装入 `.agents/` 桥接壳（退出码 `0`）；后续装好 `cc-base` 后启动 `agy`，`SessionStart` 钩子自动毫秒级补建 `.agents/skills` 软链/Junction 并生成 `.agents/agents/*.md`。

### 常用维护与发布命令

```sh
# 预览安装计划（零文件写入）
./setup.sh /path/to/your-project --dry-run

# 升级适配层（连带升级上游 cc-base 加 --with-cc；强制覆盖本地冲突加 --force）
./setup.sh upgrade /path/to/your-project

# 下游项目健康体检
node /path/to/your-project/.agents/scripts/doctor.mjs

# 安全卸载（仅摘除 .agents/ 受管内容与软链，绝不触碰 .claude/ 一字节！）
./setup.sh --uninstall /path/to/your-project

# 源仓自检门禁
node scripts/agy-base.mjs pack-check

# 打单包离线合包制品（内置 .bundled-cc-base，内网离线机器一键双装）
node scripts/agy-base.mjs release v3.0.0 --bundle-cc ../cc-base --out /tmp/agy-base-v3.0.0-offline.tar.gz
```

## 四端同仓零冲突共存与 v2 平滑迁移

- **根目录零文件侵入**：宿主适配说明已由根级 `GEMINI.md` 迁入 `.agents/rules/cc-base-agy-host.md`（`trigger: always_on`）。同一目标项目可同时挂载 Claude Code（`cc-base`）、Cursor（`cursor-base`）、CodeAgent（`cac-base-link`）与 Antigravity（`agy-base`），根目录干干净净、互不干扰。
- **旧版 v2 自动平滑迁移**：在装过 `agy-base` v2.x 的项目上运行 `setup`，若检测到旧版框架生成的 `GEMINI.md`，会自动归档至 `.agents/.runtime/migrated-v2-<ts>/GEMINI.md` 并清理 `.agents/cc-base-*.txt`；用户自己手写的 `GEMINI.md` 绝不触碰。

## 可选：接通 CLI 状态栏

如需在 Antigravity CLI 底栏常驻显示当前档位（tier）、待审文件数与上下文占比，可在 `~/.gemini/antigravity-cli/settings.json` 配置：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node .claude/scripts/statusline.mjs"
  }
}
```

## 历史版本留档

- `v2.3.0-bundled-backup`：升级为 `v3.0.0` 纯软链架构前的最后一版内置 `.claude/` 拷贝快照。
- `v2.2.0-legacy`：2026-11-24 前的早期独立重写引擎留档。
