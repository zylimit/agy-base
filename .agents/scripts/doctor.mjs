#!/usr/bin/env node
// .agents/scripts/doctor.mjs — Dual-mode health & integrity checker for agy-base v3.0.0.
// - Mode A (`--source-check` or inside `agy-base` source repo): validates `.agents/` rules (`cc-base-claude.md`,
//   `cc-base-agy-host.md` < 6KB), `skills.json`, `hooks.json` 5 blocks, core `.mjs` syntax, `FRAMEWORK-MANIFEST.json`
//   LF-SHA256 parity, and source installer components.
// - Mode B (downstream target project): validates all `.agents/` checks PLUS `.claude/` contract, `.agents/skills`
//   OS symlink/Junction -> `.claude/skills` enumerated SKILL.md count, and `.agents/agents/*.md` generated subagent
//   frontmatter & Antigravity canonical internal tool names (`view_file`, `write_to_file`, `replace_file_content`, `run_command`).
// Self-contained inside `.agents/scripts/` (Node >= 20 built-ins only). Supports `--json` and smart `selfRoot` fallback.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { areGeneratedAgentsCurrent } from './gen-agents.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAN_MAX_NAMED = 20;
const HOST_RULE_MAX_BYTES = 6 * 1024;
const INLINE_RULE_BUDGET_BYTES = 24000;

const CORE_AGENT_SCRIPTS = [
  '.agents/scripts/hook-adapter.mjs',
  '.agents/scripts/gen-agents.mjs',
  '.agents/scripts/ps-floor.mjs',
  '.agents/scripts/doctor.mjs',
];

const EXPECTED_HOOK_BLOCKS = [
  ['cc-base-session', 'SessionStart'],
  ['cc-base-prompt', 'PreInvocation'],
  ['cc-base-pre-tool', 'PreToolUse'],
  ['cc-base-post-tool', 'PostToolUse'],
  ['cc-base-stop', 'Stop'],
];

const VALID_AGY_INTERNAL_TOOLS = new Set([
  'view_file',
  'write_to_file',
  'replace_file_content',
  'run_command',
]);

const VALID_AGY_MODELS = new Set(['inherit', 'flash', 'pro']);
const AGY_CLI_CANDIDATES = ['agy', 'antigravity', 'antigravity-cli'];

function toPosix(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

function hashLfFile(fullPath) {
  const buf = fs.readFileSync(fullPath);
  let hasCr = false;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d) {
      hasCr = true;
      break;
    }
  }
  let norm = buf;
  if (hasCr) {
    const tmp = Buffer.allocUnsafe(buf.length);
    let n = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0x0d) tmp[n++] = buf[i];
    }
    norm = tmp.subarray(0, n);
  }
  return createHash('sha256').update(norm).digest('hex');
}

function resolveRealOrNull(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  }
}

function sameRealDir(a, b) {
  const ra = resolveRealOrNull(a);
  const rb = resolveRealOrNull(b);
  if (!ra || !rb) return false;
  const pa = toPosix(ra).replace(/\/+$/, '') || '/';
  const pb = toPosix(rb).replace(/\/+$/, '') || '/';
  return process.platform === 'win32' ? pa.toLowerCase() === pb.toLowerCase() : pa === pb;
}

function whichCmd(exe) {
  if (!exe) return null;
  if (exe.includes('/') || exe.includes('\\')) {
    return fs.existsSync(exe) ? exe : null;
  }
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.PS1').split(';').map((s) => s.trim()).filter(Boolean)
    : [''];
  for (const d of dirs) {
    if (process.platform === 'win32') {
      const direct = path.join(d, exe);
      try {
        if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
      } catch {
        /* ignore */
      }
    }
    for (const ext of exts) {
      const cand = path.join(d, exe + ext);
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function findExecutableInDir(dir, name) {
  if (!dir) return null;
  if (process.platform === 'win32') {
    for (const ext of ['.exe', '.cmd', '.bat', '']) {
      const cand = path.join(dir, name + ext);
      try {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
      } catch {
        /* ignore */
      }
    }
    return null;
  }
  const cand = path.join(dir, name);
  try {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      fs.accessSync(cand, fs.constants.X_OK);
      return cand;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveAgyCli() {
  for (const name of AGY_CLI_CANDIDATES) {
    const hit = whichCmd(name);
    if (hit) return { name, bin: hit };
  }
  let home = '';
  try {
    home = os.homedir();
  } catch {
    home = process.env.HOME || process.env.USERPROFILE || '';
  }
  const fallbackDirs = [];
  if (home) {
    fallbackDirs.push(path.join(home, '.local', 'bin'));
    fallbackDirs.push(path.join(home, '.gemini', 'antigravity-cli', 'bin'));
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || (home ? path.join(home, 'AppData', 'Local') : '');
    if (localAppData) {
      fallbackDirs.push(path.join(localAppData, 'Programs', 'Antigravity', 'bin'));
      fallbackDirs.push(path.join(localAppData, 'Programs', 'antigravity-cli', 'bin'));
    }
  }
  for (const d of fallbackDirs) {
    for (const name of AGY_CLI_CANDIDATES) {
      const hit = findExecutableInDir(d, name);
      if (hit) return { name, bin: hit };
    }
  }
  return null;
}

function hasAgentsDir(dirPath) {
  try {
    return fs.statSync(path.join(dirPath, '.agents')).isDirectory();
  } catch {
    return false;
  }
}

// F-06: Smart fallback to `selfRoot` when invoked with no target argument from an unrelated external cwd
function resolveDefaultDoctorRoot() {
  const cwd = process.cwd();
  if (hasAgentsDir(cwd)) return '.';
  const selfRoot = path.resolve(SCRIPT_DIR, '..', '..');
  if (hasAgentsDir(selfRoot)) return selfRoot;
  return '.';
}

function parseDoctorArgs(argv) {
  let jsonMode = false;
  let sourceCheck = false;
  let rootArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      jsonMode = true;
    } else if (a === '--source-check') {
      sourceCheck = true;
    } else if (a === '--root') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        process.stderr.write('doctor: --root requires a directory path\n');
        process.exit(2);
      }
      rootArg = next;
    } else if (a.startsWith('--root=')) {
      const val = a.slice(7);
      if (!val) {
        process.stderr.write('doctor: --root= requires a non-empty directory path\n');
        process.exit(2);
      }
      rootArg = val;
    } else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: node .agents/scripts/doctor.mjs [target-dir] [--root <dir>] [--source-check] [--json]\n');
      process.exit(0);
    } else if (a.startsWith('-')) {
      process.stderr.write(`doctor: unknown option: ${a}\n`);
      process.exit(2);
    } else if (rootArg === null) {
      rootArg = a;
    } else {
      process.stderr.write(`doctor: unexpected extra argument: ${a}\n`);
      process.exit(2);
    }
  }
  return {
    jsonMode,
    sourceCheck,
    rootArg: rootArg !== null ? rootArg : resolveDefaultDoctorRoot(),
  };
}

function readJsonNoBom(fullPath) {
  const buf = fs.readFileSync(fullPath);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    throw new Error('包含禁止的 UTF-8 BOM');
  }
  return JSON.parse(buf.toString('utf8'));
}

function verifyManifestFile(root, relManifestPath, { ok, bad, note }) {
  const fullManifest = path.join(root, relManifestPath);
  let data;
  try {
    data = readJsonNoBom(fullManifest);
  } catch (e) {
    bad(`FRAMEWORK-MANIFEST.json 校验失败（${e.message}）`);
    return;
  }
  if (!data || data.version !== 1 || data.engine !== 'agy-base' || !Array.isArray(data.files)) {
    bad('FRAMEWORK-MANIFEST.json 结构不合法（期望 version=1, engine="agy-base", files=[]）');
    return;
  }
  if (Array.isArray(data.seeded) && data.seeded.length > 0) {
    bad(`FRAMEWORK-MANIFEST.json 违反零根文件侵入契约（seeded 非空：${data.seeded.length}）`);
  }
  let checked = 0;
  let missing = 0;
  let mismatch = 0;
  for (const item of data.files) {
    if (!item || typeof item.path !== 'string' || typeof item.sha256 !== 'string') continue;
    const rel = toPosix(item.path);
    const full = path.join(root, rel);
    if (!fs.existsSync(full) || !fs.lstatSync(full).isFile()) {
      missing++;
      if (missing <= MAN_MAX_NAMED) {
        bad(`FRAMEWORK-MANIFEST.json 缺件：${rel} 已登记但本地缺失（期望 ${item.sha256.slice(0, 8)}）`);
      }
      continue;
    }
    checked++;
    const actual = hashLfFile(full);
    if (actual !== item.sha256) {
      mismatch++;
      if (mismatch <= MAN_MAX_NAMED) {
        bad(`FRAMEWORK-MANIFEST.json 漂移/篡改：${rel} 期望 ${item.sha256.slice(0, 8)} 实际 ${actual.slice(0, 8)}`);
      }
    }
  }
  if (checked === 0 && missing === 0) {
    note('FRAMEWORK-MANIFEST.json 包含 0 条受管文件记录');
  } else if (mismatch === 0 && missing === 0) {
    ok(`FRAMEWORK-MANIFEST.json 全量比对 ${checked} 条 LF-SHA256 一致（engine=agy-base, seeded=0）`);
  } else {
    if (mismatch > 0) bad(`FRAMEWORK-MANIFEST.json 全量比对 ${checked} 条，${mismatch} 条 LF-SHA256 不符`);
    if (missing > 0) bad(`FRAMEWORK-MANIFEST.json 另有 ${missing} 条登记文件在本地缺失`);
  }
}

function inspectGeneratedAgentMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  if (lines[0] !== '---') return { ok: false, reason: '缺少起始 YAML frontmatter ---' };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { ok: false, reason: '缺少闭合 YAML frontmatter ---' };

  let name = '';
  let subagent = '';
  let model = '';
  const tools = [];
  let inTools = false;

  for (const line of lines.slice(1, end)) {
    if (inTools) {
      const tm = /^\s*-\s*(\S+)\s*$/.exec(line);
      if (tm) {
        tools.push(tm[1]);
        continue;
      }
      inTools = false;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, vRaw] = kv;
    const v = vRaw.trim();
    if (k === 'name') name = v;
    else if (k === 'subagent') subagent = v;
    else if (k === 'model') model = v;
    else if (k === 'tools' && v === '') inTools = true;
  }

  if (!name) return { ok: false, reason: '缺少 name 字段' };
  if (subagent !== 'true') return { ok: false, reason: `subagent 必须为 true（当前 ${subagent || '空'}）` };
  if (!VALID_AGY_MODELS.has(model)) {
    return { ok: false, reason: `model "${model}" 非法（Antigravity 仅支持 inherit / flash / pro）` };
  }
  if (tools.length === 0) return { ok: false, reason: 'tools 列表为空' };
  for (const t of tools) {
    if (!VALID_AGY_INTERNAL_TOOLS.has(t)) {
      return { ok: false, reason: `tools 含非法工具名 "${t}"（仅允许 view_file / write_to_file / replace_file_content / run_command）` };
    }
  }
  return { ok: true, name, model, tools };
}

export function runDoctor(rawTarget, { jsonMode = false, sourceCheck = false } = {}) {
  const segs = String(rawTarget).split(/[\\/]+/);
  if (segs.includes('..')) {
    process.stderr.write(`doctor: 路径不安全（含 '..'）：${rawTarget}\n`);
    process.exit(2);
  }
  const root = path.resolve(rawTarget);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    process.stderr.write(`doctor: 目标目录不存在：${rawTarget}\n`);
    process.exit(2);
  }

  const isSourceRepo =
    Boolean(sourceCheck) ||
    (fs.existsSync(path.join(root, 'scripts', 'agy-base.mjs')) &&
      fs.existsSync(path.join(root, 'cc-base-contract.json')) &&
      !fs.existsSync(path.join(root, '.claude', 'CLAUDE.md')));

  const mode = isSourceRepo ? 'source' : 'downstream';
  const items = [];
  const errors = [];
  const warnings = [];
  let okCount = 0;
  let badCount = 0;
  let noteCount = 0;
  let skillsCount = 0;
  let agentsCount = 0;

  const ok = (msg) => {
    okCount++;
    items.push({ level: 'ok', message: msg });
    if (!jsonMode) process.stdout.write(`✓ ${msg}\n`);
  };
  const bad = (msg) => {
    badCount++;
    errors.push(msg);
    items.push({ level: 'bad', message: msg });
    if (!jsonMode) process.stderr.write(`✗ ${msg}\n`);
  };
  const note = (msg) => {
    noteCount++;
    warnings.push(msg);
    items.push({ level: 'note', message: msg });
    if (!jsonMode) process.stderr.write(`! ${msg}\n`);
  };

  // 1. Transaction marker check
  const markerPath = path.join(root, '.agents', '.runtime', 'install.marker');
  if (fs.existsSync(markerPath)) {
    let rawMarker = '';
    try {
      rawMarker = fs.readFileSync(markerPath, 'utf8');
    } catch {
      rawMarker = 'interrupted';
    }
    if (rawMarker.includes('interrupted')) {
      bad('上次安装未完成（.agents/.runtime/install.marker 状态为 interrupted）：请重跑 setup 补装');
    } else {
      note('存在 .agents/.runtime/install.marker（可能有安装进程正在执行）');
    }
  } else {
    ok('安装事务状态干净（无残留 install.marker）');
  }

  // 2. Rules check (`cc-base-claude.md` + `cc-base-agy-host.md`)
  const claudeRulePath = path.join(root, '.agents', 'rules', 'cc-base-claude.md');
  if (fs.existsSync(claudeRulePath) && fs.statSync(claudeRulePath).isFile()) {
    const text = fs.readFileSync(claudeRulePath, 'utf8');
    if (!/trigger:\s*always_on/.test(text)) {
      bad('.agents/rules/cc-base-claude.md 缺少 trigger: always_on');
    } else if (!text.includes('@[CLAUDE.md](../../.claude/CLAUDE.md)')) {
      bad('.agents/rules/cc-base-claude.md 缺少 @[CLAUDE.md](../../.claude/CLAUDE.md) 内联指令');
    } else {
      ok('.agents/rules/cc-base-claude.md 存在且内联指令正确');
    }
  } else {
    bad('.agents/rules/cc-base-claude.md 缺失');
  }

  const hostRulePath = path.join(root, '.agents', 'rules', 'cc-base-agy-host.md');
  if (fs.existsSync(hostRulePath) && fs.statSync(hostRulePath).isFile()) {
    const buf = fs.readFileSync(hostRulePath);
    const text = buf.toString('utf8');
    if (!/trigger:\s*always_on/.test(text)) {
      bad('.agents/rules/cc-base-agy-host.md 缺少 trigger: always_on');
    } else if (buf.length >= HOST_RULE_MAX_BYTES) {
      bad(`.agents/rules/cc-base-agy-host.md 体积超限（${buf.length}B >= ${HOST_RULE_MAX_BYTES}B 上限）`);
    } else if (buf.length === 0) {
      bad('.agents/rules/cc-base-agy-host.md 内容为空');
    } else {
      ok(`.agents/rules/cc-base-agy-host.md 存在且体积合规（${buf.length}B < ${HOST_RULE_MAX_BYTES}B）`);
    }
  } else {
    bad('.agents/rules/cc-base-agy-host.md 缺失');
  }

  // 3. `.agents/skills.json` check
  const skillsJsonPath = path.join(root, '.agents', 'skills.json');
  if (!fs.existsSync(skillsJsonPath)) {
    bad('.agents/skills.json 缺失');
  } else {
    try {
      const sj = readJsonNoBom(skillsJsonPath);
      const hasClaudeSkills = Array.isArray(sj?.entries) && sj.entries.some((e) => e && e.path === '.claude/skills');
      if (!hasClaudeSkills) {
        bad('.agents/skills.json entries 未指向 .claude/skills');
      } else {
        ok('.agents/skills.json 合法且指向 .claude/skills');
      }
    } catch (e) {
      bad(`.agents/skills.json 非法（${e.message}）`);
    }
  }

  // 4. Core `.agents/scripts/*.mjs` syntax check
  let syntaxBad = 0;
  let checkedJs = 0;
  for (const rel of CORE_AGENT_SCRIPTS) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      bad(`${rel} 缺失`);
      continue;
    }
    checkedJs++;
    const r = spawnSync(process.execPath, ['--check', full], {
      cwd: root,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) {
      syntaxBad++;
      bad(`语法校验失败：${rel}`);
    }
  }
  if (checkedJs === CORE_AGENT_SCRIPTS.length && syntaxBad === 0) {
    ok(`核心适配脚本齐全且语法校验通过（共 ${checkedJs} 个 .mjs 文件）`);
  }

  // 5. `.agents/hooks.json` check
  const hooksJsonPath = path.join(root, '.agents', 'hooks.json');
  if (!fs.existsSync(hooksJsonPath)) {
    bad('.agents/hooks.json 缺失');
  } else {
    try {
      const hj = readJsonNoBom(hooksJsonPath);
      const missingBlocks = [];
      for (const [blockKey, evName] of EXPECTED_HOOK_BLOCKS) {
        const block = hj?.[blockKey];
        const entries = block && Array.isArray(block[evName]) ? block[evName] : null;
        if (!entries || entries.length === 0) {
          missingBlocks.push(`${blockKey}.${evName}`);
          continue;
        }
        const rawJson = JSON.stringify(entries);
        if (!rawJson.includes(`scripts/hook-adapter.mjs ${evName}`)) {
          missingBlocks.push(`${blockKey}.${evName}(command)`);
        }
      }
      if (missingBlocks.length > 0) {
        bad(`.agents/hooks.json 缺少核心钩子注册：${missingBlocks.join(', ')}`);
      } else {
        ok(`.agents/hooks.json 合法且全部 ${EXPECTED_HOOK_BLOCKS.length} 组生命周期钩子注册齐全`);
      }
    } catch (e) {
      bad(`.agents/hooks.json 非法（${e.message}）`);
    }
  }

  // 6. `.agents/FRAMEWORK-MANIFEST.json` parity check
  const manifestPath = path.join(root, '.agents', 'FRAMEWORK-MANIFEST.json');
  if (!fs.existsSync(manifestPath)) {
    bad('.agents/FRAMEWORK-MANIFEST.json 缺失');
  } else {
    verifyManifestFile(root, '.agents/FRAMEWORK-MANIFEST.json', { ok, bad, note });
  }

  // 7. Legacy root GEMINI.md notice
  const rootGemini = path.join(root, 'GEMINI.md');
  if (fs.existsSync(rootGemini) && fs.lstatSync(rootGemini).isFile()) {
    const gText = fs.readFileSync(rootGemini, 'utf8');
    if (gText.startsWith('# agy-base') && gText.includes('本仓是 cc-base（Claude Code 产品开发框架）的 Antigravity')) {
      note('根目录仍留有旧版 v2 框架生成的 GEMINI.md（重跑 setup upgrade 将自动归档至 .agents/.runtime/migrated-v2-*）');
    }
  }

  // 8. Mode-specific checks
  if (mode === 'source') {
    const sourceRequired = [
      'setup.ps1',
      'setup.sh',
      'setup-agy.sh',
      'cc-base-contract.json',
      'package.json',
      'scripts/agy-base.mjs',
      'scripts/lib/path-guard.mjs',
      'scripts/lib/link-manager.mjs',
      'scripts/lib/cc-dep.mjs',
      'scripts/lib/hooks-merge.mjs',
      'scripts/lib/manifest.mjs',
    ];
    for (const rel of sourceRequired) {
      const fp = path.join(root, rel);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        ok(`源仓组件 ${rel} 存在`);
      } else {
        bad(`源仓组件 ${rel} 缺失`);
      }
    }
    try {
      readJsonNoBom(path.join(root, 'cc-base-contract.json'));
      ok('cc-base-contract.json 是合法 JSON');
    } catch (e) {
      bad(`cc-base-contract.json 非法（${e.message}）`);
    }
  } else {
    // Mode B: Downstream `.claude/` + `.agents/skills` OS link + `.agents/agents/*.md` verification
    const ccClaudeMd = path.join(root, '.claude', 'CLAUDE.md');
    const ccRulesDir = path.join(root, '.claude', 'rules');
    const ccSkillsDir = path.join(root, '.claude', 'skills');
    const ccAgentsDir = path.join(root, '.claude', 'agents');
    const ccHooksDir = path.join(root, '.claude', 'hooks');

    if (fs.existsSync(ccClaudeMd) && fs.statSync(ccClaudeMd).isFile() && fs.statSync(ccClaudeMd).size > 0) {
      const claudeSize = fs.statSync(ccClaudeMd).size;
      const ruleSize = fs.existsSync(claudeRulePath) ? fs.statSync(claudeRulePath).size : 0;
      const expandedEst = claudeSize + ruleSize;
      if (expandedEst > INLINE_RULE_BUDGET_BYTES) {
        note(`.claude/CLAUDE.md 展开预估 ${expandedEst}B 超过 ${INLINE_RULE_BUDGET_BYTES}B 槽位上限，留意宿主截断`);
      }
      ok(`.claude/CLAUDE.md 主控宪法存在（${claudeSize}B）`);
    } else {
      bad('.claude/CLAUDE.md 缺失（尚未安装上游 cc-base 或安装不完整）');
    }

    for (const [label, dirPath] of [
      ['.claude/rules', ccRulesDir],
      ['.claude/skills', ccSkillsDir],
      ['.claude/agents', ccAgentsDir],
      ['.claude/hooks', ccHooksDir],
    ]) {
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        ok(`${label} 目录存在`);
      } else {
        bad(`${label} 目录缺失`);
      }
    }

    // Verify `.agents/skills -> .claude/skills` OS link & enumerate SKILL.md count
    const agySkillsLink = path.join(root, '.agents', 'skills');
    let skillsLst = null;
    try {
      skillsLst = fs.lstatSync(agySkillsLink);
    } catch {
      skillsLst = null;
    }
    if (!skillsLst) {
      bad('.agents/skills 软链/Junction 不存在（请重跑 setup 或触发 SessionStart 自动修复）');
    } else if (!skillsLst.isSymbolicLink()) {
      bad('.agents/skills 是实体目录而非符号链接/Junction（请重跑 setup 自动迁移为纯软链）');
    } else if (!fs.existsSync(ccSkillsDir) || !sameRealDir(agySkillsLink, ccSkillsDir)) {
      bad('.agents/skills 链接损坏或未指向当前项目的 .claude/skills');
    } else {
      const skillDirs = fs.readdirSync(agySkillsLink, { withFileTypes: true })
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      for (const s of skillDirs) {
        const skMd = path.join(agySkillsLink, s, 'SKILL.md');
        if (fs.existsSync(skMd) && fs.statSync(skMd).size > 0) skillsCount++;
      }
      if (skillsCount < 15) {
        bad(`.agents/skills -> .claude/skills 枚举到的有效 SKILL.md 数量不足（${skillsCount} < 15）`);
      } else {
        ok(`.agents/skills -> .claude/skills 联接正常（可枚举 ${skillsCount} 套技能 SKILL.md，与 skills.json 双保险）`);
      }
    }

    // Verify `.agents/agents/*.md` generated roles & internal tool names (with lstat symlink guard!)
    let agyRootLst = null;
    try {
      agyRootLst = fs.lstatSync(path.join(root, '.agents'));
    } catch {
      agyRootLst = null;
    }
    if (agyRootLst?.isSymbolicLink()) {
      bad('.agents 目录本身是符号链接/Junction（违反隔离边界，严禁软链穿透）');
    }
    const agyAgentsDir = path.join(root, '.agents', 'agents');
    let agyAgentsLst = null;
    try {
      agyAgentsLst = fs.lstatSync(agyAgentsDir);
    } catch {
      agyAgentsLst = null;
    }
    if (!agyAgentsLst) {
      bad('.agents/agents 目录不存在（请运行 node .agents/scripts/gen-agents.mjs 或触发 SessionStart 自动生成）');
    } else if (agyAgentsLst.isSymbolicLink()) {
      bad('.agents/agents 是符号链接/Junction 而非独立生成目录（严禁软链穿透 .claude/agents，请重跑 gen-agents.mjs 或触发 SessionStart 自动拆链重生成）');
    } else if (!agyAgentsLst.isDirectory()) {
      bad('.agents/agents 不是合法目录');
    } else {
      const genFiles = fs.readdirSync(agyAgentsDir).filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort();
      let invalidAgents = 0;
      for (const gf of genFiles) {
        const gfPath = path.join(agyAgentsDir, gf);
        let gfLst = null;
        try {
          gfLst = fs.lstatSync(gfPath);
        } catch {
          gfLst = null;
        }
        if (!gfLst || gfLst.isSymbolicLink() || !gfLst.isFile()) {
          invalidAgents++;
          bad(`.agents/agents/${gf} 是符号链接或非普通文件（严禁软链穿透源角色文件）`);
          continue;
        }
        const res = inspectGeneratedAgentMarkdown(gfPath);
        if (!res.ok) {
          invalidAgents++;
          bad(`.agents/agents/${gf} 契约校验失败：${res.reason}`);
        } else {
          agentsCount++;
        }
      }
      if (agentsCount === 0 && invalidAgents === 0) {
        bad('.agents/agents 下未发现任何子代理 .md 文件');
      } else if (invalidAgents === 0) {
        const fpState = areGeneratedAgentsCurrent(root);
        if (fpState.applicable && !fpState.current) {
          bad('.agents/agents/*.md 与 .claude/agents/*.md 联合指纹不一致（需重跑 gen-agents.mjs 或触发 SessionStart 自愈）');
        } else {
          ok(`.agents/agents/*.md 子代理齐全且内部工具名合法（共 ${agentsCount} 个角色，指纹同步）`);
        }
      }
    }
  }

  // 9. Runtime checks (node >= 20, git, agy CLI note-only)
  const nodeMajor = parseInt(String(process.versions.node || '0').split('.')[0], 10);
  if (Number.isInteger(nodeMajor) && nodeMajor >= 20) {
    ok(`node 运行时可用（${process.version} >= v20）`);
  } else {
    bad(`node 版本过低（当前 ${process.version}，要求 >= v20.0.0）`);
  }

  if (whichCmd('git')) {
    ok('git 可用');
  } else {
    note('未检测到 git；git 相关治理与提交钩子能力受限');
  }

  const agyCli = resolveAgyCli();
  if (agyCli) {
    let ver = '';
    const vr = spawnSync(agyCli.bin, ['--version'], {
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 5000,
    });
    if (!vr.error && vr.stdout) {
      ver = String(vr.stdout).trim().split(/\r?\n/)[0] || '';
    }
    ok(`Antigravity CLI 可用（${agyCli.name}${ver ? ': ' + ver : ''}）`);
  } else {
    note('未检测到 agy CLI（按序探测 agy / antigravity / antigravity-cli，可能仅使用 Antigravity App/IDE）；仅提示不判红');
  }

  const code = badCount > 0 ? 1 : 0;
  const status = badCount > 0 ? 'violation' : 'ok';
  const summary = badCount > 0
    ? `doctor(${mode}): 自检失败（${badCount} 项错误，${noteCount} 项提示）`
    : noteCount > 0
      ? `doctor(${mode}): 通过（${okCount} 项正常，有 ${noteCount} 项告警提示）`
      : `doctor(${mode}): 通过（${okCount} 项全部正常）`;

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({
        status,
        code,
        ok: code === 0,
        mode,
        summary,
        detail: {
          root: toPosix(root),
          mode,
          counts: { ok: okCount, bad: badCount, note: noteCount },
          skillsCount,
          agentsCount,
          errors,
          warnings,
        },
      }) + '\n',
    );
  } else {
    process.stdout.write(`${summary}\n`);
  }

  return code;
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const { jsonMode, sourceCheck, rootArg } = parseDoctorArgs(process.argv.slice(2));
  const exitCode = runDoctor(rootArg, { jsonMode, sourceCheck });
  process.exit(exitCode);
}
