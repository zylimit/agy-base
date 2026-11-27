#!/usr/bin/env node
// scripts/lib/cc-dep.mjs — Upstream cc-base (.claude/) contract verifier, 3-tier source resolver,
// cross-platform co-installer, and `--bundle-cc` offline bundler for agy-base v3.0.0.
// Zero npm dependencies (Node >= 20 built-ins only).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './path-guard.mjs';
import { walkRegularFiles } from './manifest.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FW_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
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
  if (!a || !b) return false;
  const ra = resolveRealOrNull(a);
  const rb = resolveRealOrNull(b);
  if (!ra || !rb) return false;
  const pa = toPosix(ra).replace(/\/+$/, '') || '/';
  const pb = toPosix(rb).replace(/\/+$/, '') || '/';
  return process.platform === 'win32' ? pa.toLowerCase() === pb.toLowerCase() : pa === pb;
}

/**
 * Load and validate `<fwRoot>/cc-base-contract.json`.
 * @param {string} [fwRoot]
 */
export function loadCcBaseContract(fwRoot = DEFAULT_FW_ROOT) {
  const contractPath = path.join(fwRoot, 'cc-base-contract.json');
  if (!fs.existsSync(contractPath)) {
    throw new Error(`缺少上游契约文件：${contractPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  if (!raw || raw.contractVersion !== 1 || raw.upstream !== 'cc-base') {
    throw new Error(`cc-base-contract.json 结构非法（期望 contractVersion=1, upstream="cc-base"）`);
  }
  return raw;
}

/**
 * Verify whether `dir` contains a compliant `.claude/` tree matching `cc-base-contract.json`.
 * When `opts.requireInstaller` is true, also requires `setup.ps1` or `setup.sh` at `<dir>/`.
 *
 * @param {string} dir
 * @param {Record<string, any>} [contract]
 * @param {{ requireInstaller?: boolean }} [opts]
 */
export function verifyCcBaseDir(dir, contract = null, opts = {}) {
  const spec = contract || loadCcBaseContract();
  const absDir = path.resolve(String(dir || '.'));
  const missing = [];

  const dirSt = statOrNull(absDir);
  if (!dirSt || !dirSt.isDirectory()) {
    return {
      ok: false,
      dir: absDir,
      skillsCount: 0,
      agentsCount: 0,
      hooksCount: 0,
      missing: [`directory-not-found: ${absDir}`],
    };
  }

  for (const relFile of spec.requiredFiles || ['.claude/CLAUDE.md']) {
    const fp = path.join(absDir, relFile);
    const st = statOrNull(fp);
    if (!st || !st.isFile() || st.size === 0) {
      missing.push(`file:${relFile}`);
    }
  }

  for (const relDir of spec.requiredDirs || ['.claude/rules', '.claude/skills', '.claude/agents', '.claude/hooks']) {
    const dp = path.join(absDir, relDir);
    const st = statOrNull(dp);
    if (!st || !st.isDirectory()) {
      missing.push(`dir:${relDir}`);
    }
  }

  let skillsCount = 0;
  const skillsDir = path.join(absDir, spec.skills?.dir || '.claude/skills');
  const entryFile = spec.skills?.entryFile || 'SKILL.md';
  const minSkills = Number(spec.skills?.minCount ?? 15);
  if (statOrNull(skillsDir)?.isDirectory()) {
    let entries = [];
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const skFile = path.join(skillsDir, e.name, entryFile);
      const st = statOrNull(skFile);
      if (st && st.isFile() && st.size > 0) skillsCount++;
    }
  }
  if (skillsCount < minSkills) {
    missing.push(`skills:count(${skillsCount}<${minSkills})`);
  }

  let agentsCount = 0;
  const agentsDir = path.join(absDir, spec.agents?.dir || '.claude/agents');
  const requiredRoles = spec.agents?.requiredRoles || [];
  if (statOrNull(agentsDir)?.isDirectory()) {
    for (const role of requiredRoles) {
      const rp = path.join(agentsDir, `${role}.md`);
      const st = statOrNull(rp);
      if (st && st.isFile() && st.size > 0) agentsCount++;
      else missing.push(`agent:${role}.md`);
    }
  } else {
    for (const role of requiredRoles) missing.push(`agent:${role}.md`);
  }

  let hooksCount = 0;
  const hooksDir = path.join(absDir, spec.hooks?.dir || '.claude/hooks');
  const requiredScripts = spec.hooks?.requiredScripts || [];
  if (statOrNull(hooksDir)?.isDirectory()) {
    for (const script of requiredScripts) {
      const hp = path.join(hooksDir, script);
      const st = statOrNull(hp);
      if (st && st.isFile() && st.size > 0) hooksCount++;
      else missing.push(`hook:${script}`);
    }
  } else {
    for (const script of requiredScripts) missing.push(`hook:${script}`);
  }

  if (opts.requireInstaller) {
    const posixInst = path.join(absDir, spec.installers?.posix || 'setup.sh');
    const winInst = path.join(absDir, spec.installers?.win32 || 'setup.ps1');
    const hasPosix = Boolean(statOrNull(posixInst)?.isFile());
    const hasWin = Boolean(statOrNull(winInst)?.isFile());
    if (process.platform === 'win32' && !hasWin) {
      missing.push(`installer:${spec.installers?.win32 || 'setup.ps1'}`);
    } else if (process.platform !== 'win32' && !hasPosix) {
      missing.push(`installer:${spec.installers?.posix || 'setup.sh'}`);
    }
  }

  return {
    ok: missing.length === 0,
    dir: absDir,
    skillsCount,
    agentsCount,
    hooksCount,
    missing,
  };
}

/**
 * Discover upstream `cc-base` source directory following strict 4-step priority:
 *   1. `--cc-base <dir>` (`opts.ccBase` — explicit error if invalid!)
 *   2. `<fwRoot>/.bundled-cc-base`
 *   3. `$CC_BASE_DIR` (`opts.envCcBaseDir ?? process.env.CC_BASE_DIR`)
 *   4. `<fwRoot>/../cc-base`
 *
 * @param {string} fwRoot
 * @param {{ ccBase?: string, targetDir?: string, envCcBaseDir?: string, contract?: any }} [opts]
 */
export function discoverCcBaseSource(fwRoot = DEFAULT_FW_ROOT, opts = {}) {
  const contract = opts.contract || loadCcBaseContract(fwRoot);
  const checked = [];

  // 1. Explicit `--cc-base <dir>`
  if (opts.ccBase && String(opts.ccBase).trim()) {
    const explicitPath = path.resolve(String(opts.ccBase).trim());
    const v = verifyCcBaseDir(explicitPath, contract, { requireInstaller: true });
    checked.push({ source: 'cc-base-flag', path: explicitPath, ok: v.ok, missing: v.missing });
    if (!v.ok) {
      return {
        found: false,
        explicitError: true,
        code: 2,
        checked,
        message: `--cc-base 指定的目录不满足 cc-base 契约（${explicitPath}）：缺失 ${v.missing.slice(0, 6).join(', ')}`,
      };
    }
    return { found: true, source: 'cc-base-flag', path: explicitPath, verification: v, checked };
  }

  const envVal = opts.envCcBaseDir !== undefined ? opts.envCcBaseDir : (process.env.CC_BASE_DIR || '');
  const autoCandidates = [
    ['bundled', path.join(fwRoot, '.bundled-cc-base')],
    ...(String(envVal).trim() ? [['env', path.resolve(String(envVal).trim())]] : []),
    ['sibling', path.resolve(fwRoot, '..', 'cc-base')],
  ];

  for (const [source, candPath] of autoCandidates) {
    if (opts.targetDir && sameRealDir(candPath, opts.targetDir)) continue;
    const v = verifyCcBaseDir(candPath, contract, { requireInstaller: true });
    checked.push({ source, path: candPath, ok: v.ok, missing: v.missing });
    if (v.ok) {
      return { found: true, source, path: candPath, verification: v, checked };
    }
  }

  return { found: false, explicitError: false, checked };
}

function findPowerShellBin() {
  for (const cand of ['pwsh', 'powershell', 'powershell.exe']) {
    const r = spawnSync(cand, ['-NoProfile', '-Command', 'exit 0'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (!r.error || r.error.code !== 'ENOENT') return cand;
  }
  return null;
}

function findBashBin() {
  for (const cand of ['bash', '/bin/bash', '/usr/bin/bash']) {
    const r = spawnSync(cand, ['-c', 'exit 0'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (!r.error || r.error.code !== 'ENOENT') return cand;
  }
  return null;
}

/**
 * Invoke upstream `cc-base` installer (`setup.ps1` on win32, `setup.sh` on POSIX) into `targetDir`.
 * Note: NEVER forwards `-Force` / `--force` to upstream `cc-base/setup.ps1` (`[HIGH-01]`: upstream `-Force`
 * overwrites `.claude/settings.json` wholesale and resets `string` hook form to `exec` form; `--force` only
 * applies to `.agents/` managed files).
 *
 * @param {string} ccSourceDir
 * @param {string} targetDir
 * @param {{ dryRun?: boolean, contract?: any }} [opts]
 */
export function invokeCcBaseInstaller(ccSourceDir, targetDir, opts = {}) {
  const contract = opts.contract || loadCcBaseContract();
  const absCc = path.resolve(ccSourceDir);
  const absTarget = path.resolve(targetDir);

  if (process.platform === 'win32') {
    const psBin = findPowerShellBin();
    if (!psBin) {
      return {
        ok: false,
        code: 3,
        error: 'Windows 环境未找到 pwsh 或 powershell，无法调用上游 cc-base/setup.ps1',
      };
    }
    const psScript = path.join(absCc, contract.installers?.win32 || 'setup.ps1');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript, '-Target', absTarget];
    if (opts.dryRun) args.push('-DryRun');
    const r = spawnSync(psBin, args, {
      cwd: absCc,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: false,
      windowsHide: true,
    });
    if (r.error || r.status !== 0) {
      return {
        ok: false,
        code: r.status || 1,
        stdout: r.stdout || '',
        stderr: r.stderr || '',
        error: `cc-base setup.ps1 失败 (exit ${r.status ?? -1}): ${String(r.stderr || r.stdout || r.error?.message || '').trim().split(/\r?\n/).slice(-3).join(' | ')}`,
      };
    }
    return { ok: true, code: 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  const bashBin = findBashBin();
  if (!bashBin) {
    return {
      ok: false,
      code: 3,
      error: 'POSIX 环境未找到 bash，无法调用上游 cc-base/setup.sh',
    };
  }
  const shScript = path.join(absCc, contract.installers?.posix || 'setup.sh');
  const args = [shScript];
  if (opts.dryRun) args.push('--dry-run');
  args.push(absTarget);
  const r = spawnSync(bashBin, args, {
    cwd: absCc,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) {
    return {
      ok: false,
      code: r.status || 1,
      stdout: r.stdout || '',
      stderr: r.stderr || '',
      error: `cc-base setup.sh 失败 (exit ${r.status ?? -1}): ${String(r.stderr || r.stdout || r.error?.message || '').trim().split(/\r?\n/).slice(-3).join(' | ')}`,
    };
  }
  return { ok: true, code: 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/**
 * 3-Tier decoupled `cc-base` upstream coordinator:
 * - Tier 1: Target already has compliant `.claude/` -> reuse directly (or upgrade when `withCc` / `ccBase` set).
 * - Tier 2: Target lacks `.claude/` and `!noAutoCc` -> auto-discover source (`--cc-base` -> `.bundled-cc-base` -> `$CC_BASE_DIR` -> `../cc-base`) and co-install.
 * - Tier 3: `--no-auto-cc` or no source available -> return `deferred` (`ok: true`, exit 0) for later self-healing!
 * - When `opts.dryRun === true`, short-circuits purely in memory after validating source contract (zero subprocesses spawned).
 *
 * @param {string} fwRoot
 * @param {string} targetDir
 * @param {{
 *   dryRun?: boolean,
 *   force?: boolean,
 *   withCc?: boolean,
 *   noAutoCc?: boolean,
 *   ccBase?: string,
 *   envCcBaseDir?: string
 * }} [opts]
 */
export function ensureUpstreamCcBase(fwRoot, targetDir, opts = {}) {
  const contract = loadCcBaseContract(fwRoot);
  const existing = verifyCcBaseDir(targetDir, contract, { requireInstaller: false });

  // Tier 1: Compliant `.claude/` already present in target
  if (existing.ok) {
    if (!opts.withCc && !opts.ccBase) {
      return {
        ok: true,
        tier: 1,
        action: 'reused',
        pendingCcBase: false,
        verification: existing,
      };
    }
    const disc = discoverCcBaseSource(fwRoot, {
      ccBase: opts.ccBase,
      targetDir,
      envCcBaseDir: opts.envCcBaseDir,
      contract,
    });
    if (disc.explicitError) {
      return { ok: false, code: disc.code || 2, error: disc.message };
    }
    if (!disc.found) {
      return {
        ok: false,
        code: 2,
        error: '已指定 --with-cc 但未找到可用的 cc-base 源目录（可通过 --cc-base <dir> 或 CC_BASE_DIR 指定）',
      };
    }
    if (opts.dryRun) {
      return {
        ok: true,
        tier: 1,
        action: 'dry-run-upgrade',
        source: disc.path,
        sourceKind: disc.source,
        pendingCcBase: false,
        verification: disc.verification,
      };
    }
    const inst = invokeCcBaseInstaller(disc.path, targetDir, { contract });
    if (!inst.ok) return inst;
    const after = verifyCcBaseDir(targetDir, contract, { requireInstaller: false });
    return {
      ok: true,
      tier: 1,
      action: 'upgraded',
      source: disc.path,
      sourceKind: disc.source,
      pendingCcBase: false,
      verification: after,
    };
  }

  // Tier 3 (explicit `--no-auto-cc`): defer upstream cc-base installation
  if (opts.noAutoCc) {
    return {
      ok: true,
      tier: 3,
      action: 'deferred',
      reason: 'no-auto-cc',
      pendingCcBase: true,
    };
  }

  // Tier 2: Auto-discover upstream `cc-base` and co-install
  const disc = discoverCcBaseSource(fwRoot, {
    ccBase: opts.ccBase,
    targetDir,
    envCcBaseDir: opts.envCcBaseDir,
    contract,
  });
  if (disc.explicitError) {
    return { ok: false, code: disc.code || 2, error: disc.message };
  }
  if (disc.found) {
    if (opts.dryRun) {
      return {
        ok: true,
        tier: 2,
        action: 'dry-run-install',
        source: disc.path,
        sourceKind: disc.source,
        pendingCcBase: false,
        verification: disc.verification,
      };
    }
    const inst = invokeCcBaseInstaller(disc.path, targetDir, { contract });
    if (!inst.ok) return inst;
    const after = verifyCcBaseDir(targetDir, contract, { requireInstaller: false });
    if (!after.ok) {
      return {
        ok: false,
        code: 1,
        error: `上游 cc-base 安装执行后目标 .claude/ 仍不满足契约：缺失 ${after.missing.slice(0, 6).join(', ')}`,
      };
    }
    return {
      ok: true,
      tier: 2,
      action: 'installed',
      source: disc.path,
      sourceKind: disc.source,
      pendingCcBase: false,
      verification: after,
    };
  }

  // Tier 3 (no source available): fail only if `--with-cc` was explicitly demanded; else defer gracefully (exit 0)
  if (opts.withCc) {
    return {
      ok: false,
      code: 2,
      error: '已指定 --with-cc 但未找到可用的 cc-base 源目录（可通过 --cc-base <dir> 或 CC_BASE_DIR 指定）',
    };
  }

  return {
    ok: true,
    tier: 3,
    action: 'deferred',
    reason: 'source-not-found',
    checked: disc.checked,
    pendingCcBase: true,
  };
}

function isExcludedFromCcBundle(relInClaude) {
  const p = toPosix(relInClaude).replace(/^\/+/, '');
  if (!p) return true;
  if (
    p === 'EVOLUTION.md' ||
    p === 'settings-windows.json' ||
    p === 'settings.local.json' ||
    p === '.credentials.json' ||
    p === '.needs-review' ||
    p === '.needs-review.lock' ||
    p === '.last-review' ||
    p === '.tdd-exempt' ||
    p === '.red-verified' ||
    p === '.static-gate' ||
    p === '.degraded-review' ||
    p === '.fast-mode' ||
    p === '.subagent-reminded' ||
    p === '.three-file-sync-advised' ||
    p === '.tdd-gate-advised' ||
    p === '.stop-gate-strikes' ||
    p === '.stop-gate-advised' ||
    p === '.precompact-block-epoch' ||
    p === '.async-verify-last' ||
    p.startsWith('.runtime/') ||
    p.startsWith('local/') ||
    p.startsWith('evidence/') ||
    p.startsWith('agent-memory/') ||
    p.startsWith('worktrees/') ||
    p.startsWith('tests/') ||
    p.startsWith('research/') ||
    /^harness\/(?:receipts|state|waivers|trend|evidence|ext)\//.test(p)
  ) {
    return true;
  }
  if (p.startsWith('feedback/') && !p.startsWith('feedback/templates/')) {
    return true;
  }
  if (/(?:^|\/)(?:signals\.jsonl|\.DS_Store|Thumbs\.db|settings\.local\.json|settings-windows\.json|\.credentials\.json)$/.test(p)) {
    return true;
  }
  if (/\.(?:bak|framework-new|agy-new|cac-link-new|cac-base-new|swp)$/.test(p) || /\.bak-/.test(p)) {
    return true;
  }
  return false;
}

/**
 * Bundle clean distributable `cc-base` assets (`setup.sh`, `setup.ps1`, `.claude/`) into `destBundledDir`
 * for `agy-base release <ver> --bundle-cc <dir>` single-archive offline distribution.
 *
 * @param {string} ccSourceDir
 * @param {string} destBundledDir
 * @param {string} [fwRoot]
 */
export function bundleCcBaseIntoDir(ccSourceDir, destBundledDir, fwRoot = DEFAULT_FW_ROOT) {
  const contract = loadCcBaseContract(fwRoot);
  const srcCheck = verifyCcBaseDir(ccSourceDir, contract, { requireInstaller: true });
  if (!srcCheck.ok) {
    throw new Error(`--bundle-cc 源目录不满足 cc-base 契约（${ccSourceDir}）：缺失 ${srcCheck.missing.join(', ')}`);
  }

  const absSrc = path.resolve(ccSourceDir);
  const absDst = path.resolve(destBundledDir);
  fs.rmSync(absDst, { recursive: true, force: true });
  fs.mkdirSync(absDst, { recursive: true });

  let copiedFiles = 0;
  for (const instName of ['setup.sh', 'setup.ps1', '.gitignore']) {
    const s = path.join(absSrc, instName);
    if (fs.existsSync(s) && fs.lstatSync(s).isFile()) {
      const d = path.join(absDst, instName);
      fs.copyFileSync(s, d);
      if (instName === 'setup.sh' && process.platform !== 'win32') {
        fs.chmodSync(d, 0o755);
      }
      copiedFiles++;
    }
  }

  const srcClaude = path.join(absSrc, '.claude');
  const dstClaude = path.join(absDst, '.claude');
  for (const relInClaude of walkRegularFiles(srcClaude, srcClaude)) {
    if (isExcludedFromCcBundle(relInClaude)) continue;
    const s = path.join(srcClaude, relInClaude);
    const d = path.join(dstClaude, relInClaude);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    copiedFiles++;
  }

  const fbTemplate = path.join(srcClaude, 'feedback', 'templates', 'feedback-index-template.md');
  if (fs.existsSync(fbTemplate) && fs.statSync(fbTemplate).isFile()) {
    const dstFbIndex = path.join(dstClaude, 'feedback', 'FEEDBACK-INDEX.md');
    fs.mkdirSync(path.dirname(dstFbIndex), { recursive: true });
    fs.copyFileSync(fbTemplate, dstFbIndex);
    copiedFiles++;
  }

  const afterCheck = verifyCcBaseDir(absDst, contract, { requireInstaller: true });
  if (!afterCheck.ok) {
    throw new Error(`--bundle-cc 打包后校验未通过：缺失 ${afterCheck.missing.join(', ')}`);
  }

  return {
    ok: true,
    bundledDir: absDst,
    copiedFiles,
    verification: afterCheck,
  };
}

// ---------------------------------------------------------------------------
// Self-test (--selftest)
// ---------------------------------------------------------------------------

function createMockCcBase(dir, contract) {
  fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'CLAUDE.md'), '# Mock CLAUDE.md\n', 'utf8');
  fs.writeFileSync(path.join(dir, '.claude', 'rules', 'core.md'), '# Core Rule\n', 'utf8');

  const minSkills = Number(contract.skills?.minCount ?? 15);
  for (let i = 1; i <= minSkills; i++) {
    const sd = path.join(dir, '.claude', 'skills', `skill-${String(i).padStart(2, '0')}`);
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'SKILL.md'), `---\nname: skill-${i}\n---\n# Skill ${i}\n`, 'utf8');
  }

  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  for (const role of contract.agents.requiredRoles) {
    fs.writeFileSync(
      path.join(dir, '.claude', 'agents', `${role}.md`),
      `---\nname: ${role}\ndescription: Mock ${role}\n---\nBody\n`,
      'utf8',
    );
  }

  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  for (const h of contract.hooks.requiredScripts) {
    fs.writeFileSync(path.join(dir, '.claude', 'hooks', h), '// mock hook\n', 'utf8');
  }

  // Minimal cross-platform mock setup.sh & setup.ps1 that copy `.claude` into target unless dry-run
  const shBody = [
    '#!/usr/bin/env bash',
    'set -eu',
    'DRY=0',
    'TARGET="."',
    'for a in "$@"; do',
    '  if [ "$a" = "--dry-run" ]; then DRY=1; else TARGET="$a"; fi',
    'done',
    'if [ "$DRY" = "1" ]; then exit 0; fi',
    'SRC="$(cd "$(dirname "$0")" && pwd)"',
    'mkdir -p "$TARGET/.claude"',
    'cp -R "$SRC/.claude/." "$TARGET/.claude/"',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'setup.sh'), shBody, 'utf8');
  if (process.platform !== 'win32') fs.chmodSync(path.join(dir, 'setup.sh'), 0o755);

  const psBody = [
    'param([string]$Target = ".", [switch]$DryRun, [switch]$Force)',
    'if ($DryRun) { exit 0 }',
    '$dst = Join-Path $Target ".claude"',
    'New-Item -ItemType Directory -Path $dst -Force | Out-Null',
    'Copy-Item -Path (Join-Path $PSScriptRoot ".claude\\*") -Destination $dst -Recurse -Force',
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(path.join(dir, 'setup.ps1'), psBody, 'utf8');
}

function runSelftest() {
  const contract = loadCcBaseContract(DEFAULT_FW_ROOT);
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-cc-dep-test-'));

  try {
    // 1. Incomplete directory fails verifyCcBaseDir
    const emptyDir = path.join(tmpBase, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });
    const badCheck = verifyCcBaseDir(emptyDir, contract);
    if (badCheck.ok || badCheck.missing.length === 0) {
      throw new Error('step 1 empty dir must fail verifyCcBaseDir');
    }

    // 2. Compliant mock cc-base passes verifyCcBaseDir
    const mockSiblingRoot = path.join(tmpBase, 'ws');
    const mockFwRoot = path.join(mockSiblingRoot, 'agy-base');
    const mockCcSibling = path.join(mockSiblingRoot, 'cc-base');
    fs.mkdirSync(mockFwRoot, { recursive: true });
    fs.copyFileSync(path.join(DEFAULT_FW_ROOT, 'cc-base-contract.json'), path.join(mockFwRoot, 'cc-base-contract.json'));
    createMockCcBase(mockCcSibling, contract);

    const goodCheck = verifyCcBaseDir(mockCcSibling, contract, { requireInstaller: true });
    if (!goodCheck.ok) {
      throw new Error(`step 2 mock cc-base failed verifyCcBaseDir: ${JSON.stringify(goodCheck)}`);
    }

    // 3. Priority discovery: sibling -> env -> bundled -> --cc-base
    const dSibling = discoverCcBaseSource(mockFwRoot, { envCcBaseDir: '' });
    if (!dSibling.found || dSibling.source !== 'sibling') {
      throw new Error(`step 3 expected sibling discovery, got ${JSON.stringify(dSibling)}`);
    }

    const mockEnvCc = path.join(tmpBase, 'env-cc');
    createMockCcBase(mockEnvCc, contract);
    const dEnv = discoverCcBaseSource(mockFwRoot, { envCcBaseDir: mockEnvCc });
    if (!dEnv.found || dEnv.source !== 'env') {
      throw new Error(`step 3b expected env discovery override, got ${JSON.stringify(dEnv)}`);
    }

    const bundledDir = path.join(mockFwRoot, '.bundled-cc-base');
    const bundleRes = bundleCcBaseIntoDir(mockCcSibling, bundledDir, mockFwRoot);
    if (!bundleRes.ok) throw new Error('step 3c bundleCcBaseIntoDir failed');
    const dBundled = discoverCcBaseSource(mockFwRoot, { envCcBaseDir: mockEnvCc });
    if (!dBundled.found || dBundled.source !== 'bundled') {
      throw new Error(`step 3c expected bundled discovery override, got ${JSON.stringify(dBundled)}`);
    }

    // 4. Tier 3 `--no-auto-cc` deferred on empty target
    const targetDeferred = path.join(tmpBase, 'target-deferred');
    const t3 = ensureUpstreamCcBase(mockFwRoot, targetDeferred, { noAutoCc: true, envCcBaseDir: '' });
    if (!t3.ok || t3.tier !== 3 || t3.action !== 'deferred' || !t3.pendingCcBase) {
      throw new Error(`step 4 expected Tier 3 deferred, got ${JSON.stringify(t3)}`);
    }

    // 5. Tier 2 auto-install into empty target & Tier 1 reuse on second call
    const targetAuto = path.join(tmpBase, 'target-auto');
    const t2 = ensureUpstreamCcBase(mockFwRoot, targetAuto, { envCcBaseDir: '' });
    if (!t2.ok || t2.tier !== 2 || t2.action !== 'installed') {
      throw new Error(`step 5 expected Tier 2 installed, got ${JSON.stringify(t2)}`);
    }
    const t1 = ensureUpstreamCcBase(mockFwRoot, targetAuto, { envCcBaseDir: '' });
    if (!t1.ok || t1.tier !== 1 || t1.action !== 'reused') {
      throw new Error(`step 5b expected Tier 1 reused, got ${JSON.stringify(t1)}`);
    }

    // 6. Invalid explicit `--cc-base` returns explicitError (code 2)
    const badExplicit = ensureUpstreamCcBase(mockFwRoot, path.join(tmpBase, 'target-bad'), {
      ccBase: emptyDir,
      envCcBaseDir: '',
    });
    if (badExplicit.ok || badExplicit.code !== 2) {
      throw new Error(`step 6 invalid --cc-base must fail with code 2, got ${JSON.stringify(badExplicit)}`);
    }

    process.stdout.write(JSON.stringify({ ok: true, tests: 6 }) + '\n');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  if (process.argv.includes('--selftest')) {
    runSelftest();
    process.exit(0);
  }
  process.stderr.write('usage: node scripts/lib/cc-dep.mjs --selftest\n');
  process.exit(2);
}
