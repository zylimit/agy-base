#!/usr/bin/env node
// hook-adapter.mjs — Antigravity Lifecycle Hooks <-> cc-base .claude/hooks/*.mjs 双向协议适配器（v3.0.0）。
//
// 核心职责（完全自包含于 .agents/scripts/，零外部 npm 依赖，Windows PowerShell + POSIX 一等公民）：
//   1. 解析项目根并实施外层父目录 `.git` 串仓防护（F-03：未独立 git init 且未被跟踪时注入 GIT_CEILING_DIRECTORIES）；
//   2. `SessionStart` 毫秒级自愈：自动补建/修复 `.agents/skills -> .claude/skills` 软链/Junction，
//      并按联合 SHA-256 指纹（`.agents/.runtime/agents-gen.sha256`）按需刷新 `.agents/agents/*.md`；
//   3. `PreInvocation` 补位 `/release-builder` 发布卡点：检查 `.claude/.needs-review` 未清零时经 `injectSteps` 注入醒目阻断警告；
//   4. `PreToolUse(run_command)` 双壳安全地板（F-05/F-05.1）：先跑 `ps-floor.mjs` 的 `checkDangerousCommand` 与
//      `checkSecretExfil`，命中直接 `decision: "deny"`；`isSafePowerShellEnvCommand` 命中安全 PowerShell `.env` 操作时
//      跳过 POSIX 专用 `secret-exfil-guard` 防误杀；`win32` 自动补齐 `<root>/node_modules/.bin` PATH；
//   5. `PreToolUse / PostToolUse` 写路径归一化（F-04/F-08）：转为相对 `root` 的 POSIX 路径，且 `.agents/` 自身免标 `.needs-review`。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isatty } from 'node:tty';
import { fileURLToPath } from 'node:url';
import {
  areGeneratedAgentsCurrent,
  generateAgents,
} from './gen-agents.mjs';
import {
  checkDangerousCommand,
  checkSecretExfil,
  isSafePowerShellEnvCommand,
} from './ps-floor.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STDIN_WAIT_MAX_MS = 3000;
const STDIN_RETRY_MS = 5;
const PROMPT_CACHE_TTL_MS = 24 * 3600 * 1000;
const PROMPT_CACHE_MAX = 50;
const STOP_MAX_EXECUTIONS = 3;

const RELEASE_REMINDER_CTX = '📋 发布前置提醒（agy-release-gate）：① 打包前必过全量测试卡点并附真实运行输出；② fast 档绝不豁免发布卡点；③ 部署后独立核查部署三件套（构建时间戳+tag / 健康检查端点 / live 冒烟）。';

function toPosix(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function resolveRealOrSelf(p) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
  } catch {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(String(p));
    }
  }
}

function normDirKey(p) {
  if (!p) return '';
  const real = resolveRealOrSelf(p);
  const posix = toPosix(real).replace(/\/+$/, '') || '/';
  return process.platform === 'win32' ? posix.toLowerCase() : posix;
}

function sameDir(a, b) {
  if (!a || !b) return false;
  return normDirKey(a) === normDirKey(b);
}

function readStdinRaw() {
  if (isatty(0)) return '';
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let waited = 0;
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      const again = e && (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK');
      if (again && waited < STDIN_WAIT_MAX_MS) {
        Atomics.wait(sleeper, 0, 0, STDIN_RETRY_MS);
        waited += STDIN_RETRY_MS;
        continue;
      }
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseStdinJson(raw) {
  if (!String(raw ?? '').trim()) return {};
  try {
    const v = JSON.parse(raw);
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
  } catch {
    return null;
  }
}

function emit(obj) {
  fs.writeSync(1, JSON.stringify(obj) + '\n');
}

function say(text) {
  fs.writeSync(2, String(text) + '\n');
}

function findNearestScaffoldRoot(startDir) {
  if (!startDir) return null;
  const homeKey = normDirKey(os.homedir());
  const tmpKey = normDirKey(os.tmpdir());
  let cur = path.resolve(String(startDir));
  for (;;) {
    const curKey = normDirKey(cur);
    if (curKey === homeKey || curKey === tmpKey) break;
    try {
      if (
        (fs.existsSync(path.join(cur, '.agents')) && fs.statSync(path.join(cur, '.agents')).isDirectory()) ||
        (fs.existsSync(path.join(cur, '.claude')) && fs.statSync(path.join(cur, '.claude')).isDirectory())
      ) {
        return cur;
      }
    } catch {
      // ignore
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function resolveProjectRoot(ev) {
  const safeEv = ev && typeof ev === 'object' ? ev : {};
  if (typeof process.env.CLAUDE_PROJECT_DIR === 'string' && process.env.CLAUDE_PROJECT_DIR.trim()) {
    const p = process.env.CLAUDE_PROJECT_DIR.trim();
    if (fs.existsSync(p)) return path.resolve(p);
  }
  const ws0 = Array.isArray(safeEv.workspacePaths) ? safeEv.workspacePaths[0] : '';
  if (typeof ws0 === 'string' && ws0.trim() && fs.existsSync(ws0)) {
    return findNearestScaffoldRoot(ws0) || path.resolve(ws0);
  }
  if (typeof safeEv.cwd === 'string' && safeEv.cwd.trim() && fs.existsSync(safeEv.cwd)) {
    return findNearestScaffoldRoot(safeEv.cwd) || path.resolve(safeEv.cwd);
  }
  return path.resolve(SCRIPT_DIR, '..', '..');
}

// ---------------------------------------------------------------------------
// F-03: Outer Parent `.git` Cross-Repo Pollution Guard
// ---------------------------------------------------------------------------

function inspectGitState(root) {
  const rev = spawnSync('git', ['-c', 'core.quotePath=false', 'rev-parse', '--show-toplevel', '--show-prefix'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 3000,
  });
  if (rev.status !== 0) {
    return { inGit: false, ownRepo: false, trackedSubdir: false, inheritedParentGit: false, topLevel: null };
  }
  const lines = String(rev.stdout || '').replace(/\r/g, '').split('\n');
  const topLevel = (lines[0] || '').trim() || null;
  if (!topLevel) {
    return { inGit: false, ownRepo: false, trackedSubdir: false, inheritedParentGit: false, topLevel: null };
  }
  const ownRepo = sameDir(topLevel, root) || fs.existsSync(path.join(root, '.git'));
  let trackedSubdir = false;
  if (!ownRepo) {
    const tr = spawnSync('git', ['ls-files', '--error-unmatch', '.'], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 3000,
    });
    trackedSubdir = tr.status === 0;
  }
  const inheritedParentGit = Boolean(!ownRepo && !trackedSubdir);
  return { inGit: true, ownRepo, trackedSubdir, inheritedParentGit, topLevel };
}

function applyGitCeilingIfInherited(root, gs) {
  if (!gs || !gs.inheritedParentGit) return '';
  const ceiling = path.dirname(resolveRealOrSelf(root));
  const prior = process.env.GIT_CEILING_DIRECTORIES
    ? `${process.env.GIT_CEILING_DIRECTORIES}${path.delimiter}`
    : '';
  const combined = `${prior}${ceiling}`;
  process.env.GIT_CEILING_DIRECTORIES = combined;
  return combined;
}

// ---------------------------------------------------------------------------
// SessionStart Millisecond Self-Healer (.agents/skills link + gen-agents sha256)
// ---------------------------------------------------------------------------

function detachSymlinkOnly(absLink) {
  const lst = lstatOrNull(absLink);
  if (!lst) return;
  if (!lst.isSymbolicLink()) {
    throw new Error(`拒绝拆除物理非链接路径：${absLink}`);
  }
  if (process.platform === 'win32') {
    try {
      fs.rmdirSync(absLink);
      return;
    } catch {
      fs.unlinkSync(absLink);
      return;
    }
  }
  fs.unlinkSync(absLink);
}

function createOsDirLink(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(absTarget, absLink, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(absLink), absTarget), absLink, 'dir');
  }
}

function selfHealSkillsLink(root) {
  const absTarget = path.join(root, '.claude', 'skills');
  const absLink = path.join(root, '.agents', 'skills');
  try {
    if (!fs.existsSync(absTarget) || !fs.statSync(absTarget).isDirectory()) {
      return 'missing-target';
    }
    if (lstatOrNull(path.dirname(absLink))?.isSymbolicLink()) {
      return 'blocked-parent-symlink';
    }
    const lst = lstatOrNull(absLink);
    if (!lst) {
      createOsDirLink(absLink, absTarget);
      return 'created';
    }
    if (lst.isSymbolicLink()) {
      try {
        const st = fs.statSync(absLink);
        if (st.isDirectory() && sameDir(absLink, absTarget)) {
          return 'unchanged';
        }
      } catch {
        // dangling link -> repair
      }
      detachSymlinkOnly(absLink);
      createOsDirLink(absLink, absTarget);
      return 'repaired';
    }
    // Physical non-link directory: guard against same realpath before archiving to .runtime
    if (sameDir(absLink, absTarget)) {
      return 'blocked-same-realpath';
    }
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    let backupDest = path.join(root, '.agents', '.runtime', `migrated-v2-${stamp}`, 'skills');
    let seq = 1;
    while (fs.existsSync(backupDest)) {
      backupDest = path.join(root, '.agents', '.runtime', `migrated-v2-${stamp}-${seq}`, 'skills');
      seq++;
    }
    fs.mkdirSync(path.dirname(backupDest), { recursive: true });
    fs.renameSync(absLink, backupDest);
    createOsDirLink(absLink, absTarget);
    return 'migrated';
  } catch {
    return 'error';
  }
}

function selfHealGeneratedAgents(root) {
  try {
    const state = areGeneratedAgentsCurrent(root);
    if (!state.applicable || state.current) return 'unchanged';
    const res = generateAgents(root, { quiet: true });
    return res.ok ? 'regenerated' : 'error';
  } catch {
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Child Hook Execution & Helpers
// ---------------------------------------------------------------------------

function buildChildHookEnv(targetRoot, ceilingValue) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: targetRoot };
  if (ceilingValue) {
    env.GIT_CEILING_DIRECTORIES = ceilingValue;
  }
  // F-05/F-11: Prepend `<targetRoot>/node_modules/.bin` on win32 (and POSIX if present) so tsc/linters resolve cleanly
  const localBin = path.join(targetRoot, 'node_modules', '.bin');
  if (fs.existsSync(localBin)) {
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    const curPath = String(env[pathKey] || '');
    const entries = curPath.split(path.delimiter).filter(Boolean);
    const hasLocalBin = entries.some((e) => (
      process.platform === 'win32'
        ? e.toLowerCase() === localBin.toLowerCase()
        : e === localBin
    ));
    if (!hasLocalBin) {
      env[pathKey] = curPath ? `${localBin}${path.delimiter}${curPath}` : localBin;
    }
  }
  return env;
}

function isSubagentEvent(ev) {
  return !(ev && typeof ev.lastUserInput === 'string' && ev.lastUserInput.trim() !== '');
}

function parseJsonLines(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object') out.push(v);
    } catch {
      /* ignore non-JSON lines */
    }
  }
  return out;
}

function extractContext(objs) {
  const msgs = [];
  for (const o of objs) {
    if (o.hookSpecificOutput && typeof o.hookSpecificOutput.additionalContext === 'string' && o.hookSpecificOutput.additionalContext.trim()) {
      msgs.push(o.hookSpecificOutput.additionalContext.trim());
    } else if (typeof o.additionalContext === 'string' && o.additionalContext.trim()) {
      msgs.push(o.additionalContext.trim());
    }
  }
  return msgs;
}

function runClaudeHook(targetRoot, hookName, payload, timeoutMs = 10000, ceilingValue = '') {
  const hookFile = path.join(targetRoot, '.claude', 'hooks', `${hookName}.mjs`);
  if (!fs.existsSync(hookFile)) {
    return { missing: true, status: 0, stdout: '', stderr: '', json: [] };
  }
  const r = spawnSync(process.execPath, [hookFile], {
    shell: false,
    windowsHide: true,
    cwd: targetRoot,
    env: buildChildHookEnv(targetRoot, ceilingValue),
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const status = (r.status === null || r.status === undefined) ? -1 : r.status;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  return { missing: false, status, stdout, stderr, error: r.error || null, json: parseJsonLines(stdout) };
}

function appendGateBlockLog(root, hookName, reason) {
  try {
    const firstLine = String(reason ?? '').split(/\r?\n/)[0];
    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const line = `${ts}\t${hookName}\t${firstLine}\n`;
    const claudeDir = path.join(root, '.claude');
    if (fs.existsSync(claudeDir) && fs.statSync(claudeDir).isDirectory()) {
      for (const sub of ['.runtime', 'evidence']) {
        const d = path.join(claudeDir, sub);
        fs.mkdirSync(d, { recursive: true });
        fs.appendFileSync(path.join(d, 'gate-block.log'), line, 'utf8');
      }
    } else {
      const agyRuntime = path.join(root, '.agents', '.runtime');
      fs.mkdirSync(agyRuntime, { recursive: true });
      fs.appendFileSync(path.join(agyRuntime, 'gate-block.log'), line, 'utf8');
    }
  } catch {
    /* sidecar log failure never alters gate decision */
  }
}

function cleanReason(primary, fallback) {
  const s = String(primary || '').trim();
  return s || fallback;
}

// ---------------------------------------------------------------------------
// F-04 / F-08: Cross-Platform Write Path Normalization & Secret Path Guards
// ---------------------------------------------------------------------------

/**
 * Normalize raw tool file path to a clean POSIX path relative to `root` when inside `root`,
 * preventing ancestor directory names (e.g. `/services/` or `C:\Users\dev\app\`) from triggering
 * false-positive `SOURCE` matches in `no-direct-code-guard` and enabling `.agents/` self-exemption.
 */
export function normalizeWriteTarget(rawPath, root) {
  const posixRaw = toPosix(String(rawPath || '').trim());
  if (!posixRaw) return '';
  const isWinAbs = /^[A-Za-z]:\//.test(posixRaw);
  const isPosixAbs = posixRaw.startsWith('/');
  if (isPosixAbs || isWinAbs) {
    const foldedAbs = isWinAbs
      ? posixRaw.slice(0, 2) + path.posix.normalize(posixRaw.slice(2))
      : path.posix.normalize(posixRaw);
    const rootCandidates = [toPosix(path.resolve(root)).replace(/\/+$/, '')];
    const realRoot = toPosix(resolveRealOrSelf(root)).replace(/\/+$/, '');
    if (!rootCandidates.includes(realRoot)) rootCandidates.push(realRoot);
    for (const cand of rootCandidates) {
      const cmpRoot = isWinAbs ? cand.toLowerCase() : cand;
      const cmpTarget = isWinAbs ? foldedAbs.toLowerCase() : foldedAbs;
      if (cmpTarget === cmpRoot) return '.';
      if (cmpTarget.startsWith(`${cmpRoot}/`)) return foldedAbs.slice(cand.length + 1);
    }
    return foldedAbs;
  }
  return path.posix.normalize(posixRaw).replace(/^(?:\.\/)+/, '');
}

const FOUR_HOST_HIDDEN_DIR_RE = /^\.(?:claude|cac|agents|cursor)(?:\/|$)/;

function isHostFrameworkPath(normPath) {
  return FOUR_HOST_HIDDEN_DIR_RE.test(normPath);
}

function normalizeForSecretCheck(rawPath, root) {
  return normalizeWriteTarget(rawPath, root);
}

function isSecretReadPath(rawPath, root) {
  const p = normalizeForSecretCheck(rawPath, root);
  if (!p) return false;
  if (/(^|\/)\.env($|\.(?!example$|sample$|template$|schema$|dist$))/i.test(p)) return true;
  if (/(^|\/)secrets\//i.test(p)) return true;
  if (/(^|\/)(id_rsa|id_ed25519)($|\.|_)/i.test(p)) return true;
  if (/(^|\/)\.ssh\//i.test(p)) return true;
  if (/(^|\/)\.aws\/credentials$/i.test(p)) return true;
  if (/(^|\/)\.?credentials\.json$/i.test(p)) return true;
  if (/\.(pem|ppk|p12|pfx|key)$/i.test(p)) return true;
  return false;
}

function isSecretWritePath(rawPath, root) {
  const p = normalizeForSecretCheck(rawPath, root);
  if (!p) return false;
  if (/(^|\/)\.env($|\.(?!example$|sample$|template$|schema$|dist$))/i.test(p)) return true;
  if (/(^|\/)secrets\//i.test(p)) return true;
  if (/(^|\/)\.ssh\//i.test(p)) return true;
  if (/(^|\/)\.aws\/credentials$/i.test(p)) return true;
  if (/\.(pem|ppk|p12|pfx|key)$/i.test(p)) return true;
  return false;
}

// 对齐 cc-base settings.json permissions.ask（发布类 HIGH 档命令）
const ASK_PUBLISH_RE = /(^|[\s;&|()])(gh\s+release\b|npm\s+publish\b|docker\s+push\b)/;

function unquoteShellArg(raw) {
  const s = String(raw || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function expandHome(p) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (p === '~') return home || p;
  if ((p.startsWith('~/') || p.startsWith('~\\')) && home) return path.join(home, p.slice(2));
  return p;
}

function resolveGitCommitRoot(cmd, defaultRoot) {
  const s = String(cmd || '');
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(s)) return defaultRoot;

  let candidate = '';
  const gitCMatch = /(?:^|[\s;&|()])git\s+-C\s+("[^"]+"|'[^']+'|\S+)[\s\S]*?\bcommit\b/.exec(s);
  if (gitCMatch) {
    candidate = unquoteShellArg(gitCMatch[1]);
  } else {
    const beforeCommit = s.split(/\bgit\b[\s\S]*?\bcommit\b/)[0] || '';
    const cdRe = /(?:^|[\n;&|()])\s*cd\s+("[^"]+"|'[^']+'|[^;&|()\n]+?)\s*(?=$|[\n;&|()])/g;
    let m;
    while ((m = cdRe.exec(beforeCommit)) !== null) {
      candidate = unquoteShellArg(m[1]);
    }
  }

  if (!candidate) return defaultRoot;
  const resolved = path.resolve(defaultRoot, expandHome(candidate));
  if (!fs.existsSync(resolved)) return defaultRoot;

  const top = spawnSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 3000,
  });
  if (top.status === 0 && String(top.stdout || '').trim()) {
    return path.resolve(String(top.stdout).trim());
  }
  return resolved;
}

function readPendingReviewFiles(root) {
  const file = path.join(root, '.claude', '.needs-review');
  try {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && l !== 'clean');
  } catch {
    return [];
  }
}

// PreInvocation 去重：同一 conversationId 同一条 lastUserInput 只触发一次 detect-feedback-signal
function shouldRunPromptCheck(root, conversationId, prompt) {
  const cid = String(conversationId || 'default');
  const sig = crypto.createHash('sha256').update(prompt).digest('hex');
  const runtimeSub = fs.existsSync(path.join(root, '.claude')) ? ['.claude', '.runtime'] : ['.agents', '.runtime'];
  const cacheFile = path.join(root, ...runtimeSub, 'agy-last-prompt.json');
  const now = Date.now();
  let cache = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cache = parsed;
  } catch {
    /* first run or corrupt cache */
  }

  if (cache[cid] && cache[cid].sig === sig) return false;

  const next = {};
  const entries = Object.entries(cache)
    .filter(([, v]) => v && typeof v.ts === 'number' && (now - v.ts) < PROMPT_CACHE_TTL_MS)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, PROMPT_CACHE_MAX - 1);
  for (const [k, v] of entries) next[k] = v;
  next[cid] = { sig, ts: now };

  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(next) + '\n', 'utf8');
  } catch {
    /* fail-open */
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lifecycle Event Handlers
// ---------------------------------------------------------------------------

function handleSessionStart(root, gs, ceilingValue) {
  const msgs = [];

  if (fs.existsSync(path.join(root, '.agents', '.runtime', 'install.marker'))) {
    msgs.push('⚠️ 上次 agy-base 安装未完成（存在 .agents/.runtime/install.marker）：请重跑 setup.ps1 或 setup.sh 补装。');
  }

  // Millisecond self-healing: repair `.agents/skills -> .claude/skills` link & regenerate `.agents/agents/*.md` on drift
  selfHealSkillsLink(root);
  selfHealGeneratedAgents(root);

  const hasCcHooks = fs.existsSync(path.join(root, '.claude', 'hooks'));
  if (!hasCcHooks) {
    msgs.push('⚠️ 当前项目尚未安装上游 cc-base（缺失 .claude/hooks），已加载 .agents/ 桥接壳；装入 cc-base 后下次会话将自动完成链接与子代理自愈。');
  } else {
    for (const [name, timeout] of [
      ['check-evolution', 10000],
      ['session-rules-banner', 5000],
    ]) {
      const r = runClaudeHook(root, name, { source: 'startup' }, timeout, ceilingValue);
      msgs.push(...extractContext(r.json));
    }

    if (gs.inheritedParentGit) {
      msgs.push(
        'ℹ️ Git 边界提示：当前目录尚未独立执行 git init（检测到外层父目录存在 Git 仓库，已启用 GIT_CEILING_DIRECTORIES 隔离防串仓）。后续如需提交，请先在当前项目根目录执行 git init。',
      );
    } else {
      const r = runClaudeHook(root, 'recap-on-dirty', { source: 'startup' }, 5000, ceilingValue);
      msgs.push(...extractContext(r.json));
    }
  }

  if (msgs.length) {
    emit({
      injectSteps: [
        { systemMessage: { systemMessage: msgs.join('\n\n') } },
      ],
    });
  } else {
    emit({});
  }
}

function handlePreInvocation(root, ev, ceilingValue) {
  if (isSubagentEvent(ev)) {
    emit({});
    return;
  }
  const prompt = String(ev.lastUserInput || '');

  // ③ Compensate missing `UserPromptExpansion` (`release-gate.mjs`) on `/release-builder` BEFORE prompt dedup!
  if (/(?:^|\s)\/release-builder(?:\s|$)/.test(prompt)) {
    const pending = readPendingReviewFiles(root);
    if (pending.length > 0) {
      const blockMsg = [
        `⛔ [agy-release-gate] 发布前置阻断警告：检测到 .claude/.needs-review 仍有 ${pending.length} 个待审文件未清零（${pending.slice(0, 10).join('、')}${pending.length > 10 ? ' 等' : ''}）！`,
        'Antigravity 无 UserPromptExpansion 硬拦截事件，主 Agent 严禁在待审未清时推进 /release-builder 发布流程：请立即停止发布，先派独立 code-reviewer 完成审查闭环（通过后写入 clean），再重新执行 /release-builder。',
      ].join('\n');
      appendGateBlockLog(root, 'agy-release-gate', blockMsg);
      emit({
        injectSteps: [
          { systemMessage: { systemMessage: blockMsg } },
        ],
      });
      return;
    }
    emit({
      injectSteps: [
        { systemMessage: { systemMessage: RELEASE_REMINDER_CTX } },
      ],
    });
    return;
  }

  if (!shouldRunPromptCheck(root, ev.conversationId, prompt)) {
    emit({});
    return;
  }
  const r = runClaudeHook(root, 'detect-feedback-signal', { prompt }, 5000, ceilingValue);
  const msgs = extractContext(r.json);
  if (msgs.length) {
    emit({
      injectSteps: [
        { systemMessage: { systemMessage: msgs.join('\n\n') } },
      ],
    });
  } else {
    emit({});
  }
}

function handlePreToolUse(root, ev, rawStdin, gs, ceilingValue) {
  if (rawStdin.trim() && ev === null) {
    const why = '⛔ [agy-safety-floor] Hook stdin 非空但 JSON 解析失败（疑似管道截断），安全地板阻断执行。';
    appendGateBlockLog(root, 'agy-safety-floor', why);
    emit({ decision: 'deny', reason: why });
    return;
  }

  const tc = (ev && ev.toolCall && typeof ev.toolCall === 'object') ? ev.toolCall : {};
  const toolName = String(tc.name || '');
  const args = (tc.args && typeof tc.args === 'object') ? tc.args : {};
  const subagent = isSubagentEvent(ev);
  const agentFields = subagent ? { agent_id: String(ev.conversationId || 'subagent') } : {};

  if (toolName === 'read_file' || toolName === 'view_file') {
    const filePath = String(args.Path || args.path || args.file_path || args.AbsolutePath || '');
    if (isSecretReadPath(filePath, root)) {
      const reason = `⛔ [agy-secret-guard] 密钥/凭据文件禁止读取（对齐 cc-base permissions.deny）：${filePath}`;
      appendGateBlockLog(root, 'agy-secret-guard', reason);
      emit({ decision: 'deny', reason });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  if (
    toolName === 'write_file' || toolName === 'edit_file' ||
    toolName === 'write_to_file' || toolName === 'replace_file_content'
  ) {
    const rawFilePath = String(args.Path || args.path || args.file_path || args.TargetFile || '');
    if (isSecretWritePath(rawFilePath, root)) {
      const reason = `⛔ [agy-secret-guard] 密钥/凭据文件禁止写入（对齐 cc-base 权限红线）：${rawFilePath}`;
      appendGateBlockLog(root, 'agy-secret-guard', reason);
      emit({ decision: 'deny', reason });
      return;
    }
    const normPath = normalizeWriteTarget(rawFilePath, root);
    if (isHostFrameworkPath(normPath)) {
      emit({ decision: 'allow' });
      return;
    }
    const payload = {
      tool_name: (toolName === 'write_file' || toolName === 'write_to_file') ? 'Write' : 'Edit',
      tool_input: { file_path: normPath || rawFilePath },
      ...agentFields,
    };
    const r = runClaudeHook(root, 'no-direct-code-guard', payload, 5000, ceilingValue);
    if (r.status === 2) {
      emit({ decision: 'deny', reason: cleanReason(r.stderr || r.stdout, 'no-direct-code-guard 拦截') });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  if (toolName === 'run_command') {
    const cmd = String(args.CommandLine || args.command || '');

    // ④ Unconditional cross-platform Bash + PowerShell + CMD safety floor (F-05)
    const dangerHit = checkDangerousCommand(cmd);
    if (dangerHit) {
      const reason = `⛔ [dangerous-command-guard] ${dangerHit}`;
      appendGateBlockLog(root, 'dangerous-command-guard', dangerHit);
      emit({ decision: 'deny', reason });
      return;
    }

    const secretHit = checkSecretExfil(cmd);
    if (secretHit) {
      const reason = `⛔ [secret-exfil-guard] ${secretHit}`;
      appendGateBlockLog(root, 'secret-exfil-guard', secretHit);
      emit({ decision: 'deny', reason });
      return;
    }

    // F-05.1: Skip POSIX-only `secret-exfil-guard.mjs` when verified safe PowerShell `.env` metadata/sample-copy
    const skipPosixSecretGuard = isSafePowerShellEnvCommand(cmd);

    const payload = {
      tool_name: 'Bash',
      tool_input: { command: cmd },
      ...agentFields,
    };
    const commitRoot = resolveGitCommitRoot(cmd, root);
    const commitCeiling = commitRoot === root ? ceilingValue : '';

    // F-03: Block accidental `git commit` into an unowned outer parent `.git`
    if (commitRoot === root && gs.inheritedParentGit && /(?:^|[\s;&|()])git(?:\.exe)?(?:\s+-\S+(?:\s+\S+)?)*\s+commit(?:\s|$)/i.test(cmd)) {
      const reason = `⛔ [git-boundary-guard] 当前目录（${root}）尚未独立执行 git init，直接 git commit 会越界提交到外层父仓库（${gs.topLevel}）。请先在当前项目根目录执行 git init。`;
      appendGateBlockLog(root, 'git-boundary-guard', reason);
      emit({ decision: 'deny', reason });
      return;
    }

    const bashHooks = [
      ...(skipPosixSecretGuard ? [] : [['secret-exfil-guard', root, 5000, ceilingValue]]),
      ['dangerous-pkill-guard', root, 5000, ceilingValue],
      ['pre-commit-check', commitRoot, 30000, commitCeiling],
      ['kill-dev-ports', root, 10000, ceilingValue],
    ];
    for (const [name, targetRoot, timeout, ceil] of bashHooks) {
      if (targetRoot !== root && !fs.existsSync(path.join(targetRoot, '.claude', 'hooks', `${name}.mjs`))) {
        continue;
      }
      const r = runClaudeHook(targetRoot, name, payload, timeout, ceil);
      const blockedJson = r.json.find((o) => o.decision === 'block');
      if (r.status === 2 || blockedJson) {
        emit({
          decision: 'deny',
          reason: cleanReason((blockedJson && blockedJson.reason) || r.stderr || r.stdout, `${name} 拦截`),
        });
        return;
      }
    }

    if (ASK_PUBLISH_RE.test(cmd)) {
      emit({
        decision: 'force_ask',
        reason: 'HIGH 档发布命令（gh release / npm publish / docker push），对齐 cc-base permissions.ask，须用户显式批准。',
      });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  if (toolName === 'invoke_subagent') {
    const payload = {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: String(args.TypeName || args.subagent_type || ''),
        prompt: String(args.Prompt || args.prompt || ''),
        description: String(args.Role || args.description || ''),
      },
    };
    const r = runClaudeHook(root, 'tdd-gate', payload, 5000, ceilingValue);
    if (r.status === 2) {
      emit({ decision: 'deny', reason: cleanReason(r.stderr || r.stdout, 'tdd-gate 拦截') });
      return;
    }
    emit({ decision: 'allow' });
    return;
  }

  emit({ decision: 'allow' });
}

function handlePostToolUse(root, ev, gs, ceilingValue) {
  const tc = (ev && ev.toolCall && typeof ev.toolCall === 'object') ? ev.toolCall : {};
  const toolName = String(tc.name || '');
  const args = (tc.args && typeof tc.args === 'object') ? tc.args : {};
  const subagent = isSubagentEvent(ev);
  const agentFields = subagent ? { agent_id: String(ev.conversationId || 'subagent') } : {};

  if (toolName === 'run_command') {
    const cmd = String(args.CommandLine || args.command || '');
    const commitRoot = resolveGitCommitRoot(cmd, root);
    if (commitRoot === root && gs.inheritedParentGit) {
      emit({});
      return;
    }
    const commitCeiling = commitRoot === root ? ceilingValue : '';
    if (commitRoot === root || fs.existsSync(path.join(commitRoot, '.claude', 'hooks', 'auto-push.mjs'))) {
      runClaudeHook(commitRoot, 'auto-push', {
        tool_name: 'Bash',
        tool_input: { command: cmd },
        ...agentFields,
      }, 15000, commitCeiling);
    }
  } else if (
    toolName === 'write_file' || toolName === 'edit_file' ||
    toolName === 'write_to_file' || toolName === 'replace_file_content'
  ) {
    const rawFilePath = String(args.Path || args.path || args.file_path || args.TargetFile || '');
    const normPath = normalizeWriteTarget(rawFilePath, root);
    const payload = {
      tool_name: (toolName === 'write_file' || toolName === 'write_to_file') ? 'Write' : 'Edit',
      tool_input: { file_path: normPath || rawFilePath },
      ...agentFields,
    };
    // ⑤ `.agents/` self paths never mark `.claude/.needs-review` (F-08)
    if (!isHostFrameworkPath(normPath)) {
      runClaudeHook(root, 'mark-review-needed', payload, 3000, ceilingValue);
    }
    runClaudeHook(root, 'record-authorship', payload, 10000, ceilingValue);
  }

  emit({});
}

function handleStop(root, ev, gs, ceilingValue) {
  if (isSubagentEvent(ev)) {
    emit({ decision: 'allow' });
    return;
  }
  if (ev && ev.fullyIdle === false) {
    emit({ decision: 'allow' });
    return;
  }
  if (ev && ev.terminationReason && ev.terminationReason !== 'NO_TOOL_CALL') {
    emit({ decision: 'allow' });
    return;
  }
  if (Number((ev && ev.executionNum) || 0) >= STOP_MAX_EXECUTIONS) {
    emit({ decision: 'allow' });
    return;
  }

  const stopHooks = gs.inheritedParentGit
    ? ['stop-gate']
    : ['stop-gate', 'three-file-sync-gate'];
  const blockReasons = [];
  for (const name of stopHooks) {
    const r = runClaudeHook(root, name, {}, 5000, ceilingValue);
    for (const o of r.json) {
      if (o.decision === 'block' && o.reason) {
        blockReasons.push(String(o.reason));
      } else if (o.systemMessage) {
        say(`[agy-stop-advise] ${o.systemMessage}`);
      }
    }
  }

  if (blockReasons.length > 0) {
    emit({ decision: 'continue', reason: blockReasons.join('\n') });
  } else {
    emit({ decision: 'allow' });
  }
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const rawStdin = readStdinRaw();
  const ev = parseStdinJson(rawStdin);
  const safeEv = ev || {};
  const mode = process.argv[2] || String(safeEv.hookEventName || '');
  const root = resolveProjectRoot(safeEv);
  const gs = inspectGitState(root);
  const ceilingValue = applyGitCeilingIfInherited(root, gs);

  switch (mode) {
    case 'SessionStart':
      handleSessionStart(root, gs, ceilingValue);
      break;
    case 'PreInvocation':
      handlePreInvocation(root, safeEv, ceilingValue);
      break;
    case 'PreToolUse':
      handlePreToolUse(root, ev, rawStdin, gs, ceilingValue);
      break;
    case 'PostToolUse':
      handlePostToolUse(root, safeEv, gs, ceilingValue);
      break;
    case 'Stop':
      handleStop(root, safeEv, gs, ceilingValue);
      break;
    default:
      emit({});
      break;
  }
}
