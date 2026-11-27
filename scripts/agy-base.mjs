#!/usr/bin/env node
// scripts/agy-base.mjs — Single cross-platform CLI & transactional Zero-Copy Link installer kernel for agy-base v3.0.0.
// Subcommands: install (default) | upgrade | uninstall | doctor | manifest | pack-check | release | help
// Zero npm dependencies (Node >= 20 built-ins only).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix, validateTargetPath } from './lib/path-guard.mjs';
import {
  ensureSkillsLink,
  inspectDirLink,
  removeSkillsLink,
  safeLstat,
  unlinkSymlinkOrJunctionSafe,
} from './lib/link-manager.mjs';
import {
  bundleCcBaseIntoDir,
  ensureUpstreamCcBase,
  loadCcBaseContract,
} from './lib/cc-dep.mjs';
import {
  formatHooksJson,
  mergeHooksJson,
  stripFrameworkHookBlocks,
} from './lib/hooks-merge.mjs';
import {
  ENGINE_NAME,
  MANIFEST_REL_PATH,
  NEVER_INSTALL_ROOT,
  OPTIONAL_MANIFEST_REL_PATH,
  buildCoreManifest,
  checkManifest,
  hashLfBuffer,
  hashLfFile,
  leakScanManifest,
  scanTextForLeaks,
  walkRegularFiles,
  writeManifest,
} from './lib/manifest.mjs';
import { isOwnGeneratedAgentFile } from '../.agents/scripts/gen-agents.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRAMEWORK_ROOT = path.resolve(SCRIPT_DIR, '..');
const LOCK_STALE_TIMEOUT_MS = 10 * 60 * 1000;

const KNOWN_COMMANDS = new Set([
  'install',
  'upgrade',
  'uninstall',
  'doctor',
  'manifest',
  'pack-check',
  'release',
  'help',
]);

export const COMMON_TYPO_SUBCOMMANDS = new Map([
  ['package', 'did you mean "release <version>" or "pack-check"?'],
  ['pack', 'did you mean "release <version>" or "pack-check"?'],
  ['bundle', 'did you mean "release <version> --bundle-cc <dir>"?'],
  ['check', 'did you mean "pack-check" or "manifest --check"?'],
  ['verify', 'did you mean "pack-check" or "doctor"?'],
  ['test', 'did you mean "pack-check"?'],
  ['tests', 'did you mean "pack-check"?'],
  ['lint', 'did you mean "pack-check"?'],
  ['audit', 'did you mean "pack-check"?'],
  ['status', 'did you mean "doctor"?'],
  ['init', 'did you mean "install"?'],
  ['update', 'did you mean "upgrade"?'],
  ['remove', 'did you mean "uninstall"?'],
  ['clean', 'did you mean "uninstall"?'],
  ['version', 'did you mean "--help"?'],
]);

const KNOWN_BOOLEAN_FLAGS = new Set([
  'dry-run',
  'force',
  'uninstall',
  'source-check',
  'with-cc',
  'no-auto-cc',
  'write',
  'check',
  'leak',
  'print',
  'json',
  'strict-syntax',
  'help',
]);

const KNOWN_VALUE_FLAGS = new Set([
  'target',
  'cc-base',
  'bundle-cc',
  'out',
]);

function usageText() {
  return [
    'agy-base v3.0.0 CLI (Zero-Copy Link, Node >= 20, zero npm deps)',
    '',
    '用法:',
    '  node scripts/agy-base.mjs [install|upgrade] [--target <dir> | <dir>] [--dry-run] [--force] [--with-cc] [--no-auto-cc] [--cc-base <dir>] [--json]',
    '  node scripts/agy-base.mjs uninstall [--target <dir> | <dir>] [--force] [--dry-run] [--json]',
    '  node scripts/agy-base.mjs doctor [--target <dir> | <dir>] [--source-check] [--json]',
    '  node scripts/agy-base.mjs manifest (--write | --check | --leak | --print)',
    '  node scripts/agy-base.mjs pack-check [--strict-syntax]',
    '  node scripts/agy-base.mjs release <version> [--out <path>] [--bundle-cc <dir>]',
    '',
    '退出码: 0=clean  1=violation/fail  2=usage/blocked  3=degraded',
  ].join('\n');
}

function usageDie(msg) {
  process.stderr.write(`agy-base: ${msg}\n\n${usageText()}\n`);
  process.exit(2);
}

/**
 * Parse CLI argv strictly: unknown `-*` flags and common subcommand typos always fail with exit 2.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  const flags = new Set();
  const kv = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      flags.add('help');
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        if (KNOWN_VALUE_FLAGS.has(key)) {
          if (!val) usageDie(`选项 --${key}= 缺少参数值`);
          kv[key] = val;
        } else if (KNOWN_BOOLEAN_FLAGS.has(key)) {
          if (val === 'true' || val === '1') flags.add(key);
          else if (val !== 'false' && val !== '0') usageDie(`布尔选项 --${key} 不接受值：${val}`);
        } else {
          usageDie(`未知选项：${a}`);
        }
      } else {
        const key = a.slice(2);
        if (KNOWN_BOOLEAN_FLAGS.has(key)) {
          flags.add(key);
        } else if (KNOWN_VALUE_FLAGS.has(key)) {
          const next = argv[i + 1];
          if (next === undefined || next.startsWith('-')) {
            usageDie(`选项 --${key} 后面缺少参数值`);
          }
          kv[key] = next;
          i++;
        } else {
          usageDie(`未知选项：${a}`);
        }
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      usageDie(`未知选项：${a}`);
    }
    positional.push(a);
  }

  let cmd = 'install';
  const restPos = [...positional];
  if (restPos.length > 0 && KNOWN_COMMANDS.has(restPos[0])) {
    cmd = restPos.shift();
  } else if (
    restPos.length > 0 &&
    /^[a-z]+$/.test(restPos[0]) &&
    COMMON_TYPO_SUBCOMMANDS.has(restPos[0])
  ) {
    const badCmd = restPos[0];
    const hint = COMMON_TYPO_SUBCOMMANDS.get(badCmd);
    usageDie(
      `unknown subcommand "${badCmd}" (${hint} To install into a folder named "${badCmd}", pass --target ./${badCmd})`,
    );
  }

  if (flags.has('uninstall')) {
    if (cmd !== 'install' && cmd !== 'uninstall') {
      usageDie(`--uninstall 不能与子命令 ${cmd} 同时使用`);
    }
    cmd = 'uninstall';
  }
  if (flags.has('no-auto-cc') && flags.has('with-cc')) {
    usageDie('--no-auto-cc 与 --with-cc 不能同时使用');
  }
  if (flags.has('no-auto-cc') && kv['cc-base']) {
    usageDie('--no-auto-cc 与 --cc-base 不能同时使用');
  }

  return { cmd, flags, kv, positional: restPos };
}

function resolveTargetArg(kv, positional, cmdName) {
  if (kv.target && positional.length > 0) {
    usageDie(`${cmdName}: 同时传入了 --target (${kv.target}) 与位置参数 (${positional[0]})，请只保留一个`);
  }
  if (positional.length > 1) {
    usageDie(`${cmdName}: 多余的位置参数：${positional.slice(1).join(' ')}`);
  }
  return kv.target || positional[0] || '.';
}

// ---------------------------------------------------------------------------
// Transactional Installer / Upgrader / v2.x Migrator / Uninstaller
// ---------------------------------------------------------------------------

export function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    if (e && e.code === 'EPERM') return true;
    return false;
  }
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function inspectExistingLock(lockPath) {
  const lst = safeLstat(lockPath);
  if (!lst) {
    return { pid: null, ts: null, mtimeMs: 0, isSymlink: false };
  }
  const mtimeMs = Number(lst.mtimeMs || 0);
  if (lst.isSymbolicLink()) {
    return { pid: null, ts: mtimeMs, mtimeMs, isSymlink: true };
  }
  if (lst.isDirectory()) {
    for (const cand of ['owner.json', 'lock.json', 'pid']) {
      const p = path.join(lockPath, cand);
      const clst = safeLstat(p);
      if (!clst || clst.isSymbolicLink() || !clst.isFile()) continue;
      try {
        const rawText = fs.readFileSync(p, 'utf8').trim();
        if (/^\d+$/.test(rawText)) return { pid: Number(rawText), ts: mtimeMs, mtimeMs, isSymlink: false };
        const parsed = JSON.parse(rawText);
        return { pid: parsed?.pid ?? null, ts: Number(parsed?.ts || mtimeMs), mtimeMs, isSymlink: false };
      } catch {
        // continue
      }
    }
    return { pid: null, ts: mtimeMs, mtimeMs, isSymlink: false };
  }
  try {
    const rawText = fs.readFileSync(lockPath, 'utf8').trim();
    if (/^\d+$/.test(rawText)) return { pid: Number(rawText), ts: mtimeMs, mtimeMs, isSymlink: false };
    const parsed = JSON.parse(rawText);
    const tsVal = Number(parsed?.ts) || (parsed?.startedAt ? Date.parse(parsed.startedAt) : mtimeMs) || mtimeMs;
    return { pid: parsed?.pid ?? null, ts: tsVal, mtimeMs, isSymlink: false };
  } catch {
    return { pid: null, ts: mtimeMs, mtimeMs, isSymlink: false };
  }
}

/**
 * Acquire atomic exclusive lock `<target>/.agents/.runtime/install.lock`.
 * Reclaims orphan locks from dead PIDs or timed-out locks (> 10 minutes), supporting both file and directory lock leftovers.
 */
export function acquireInstallLock(runtimeDir, startedAt) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
  } catch (mkErr) {
    return { ok: false, code: 1, error: `无法创建运行态锁目录 ${runtimeDir}: ${mkErr?.message || mkErr}` };
  }
  const lockPath = path.join(runtimeDir, 'install.lock');

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, ts: Date.now(), startedAt }) + '\n',
          'utf8',
        );
      } finally {
        fs.closeSync(fd);
      }
      return { ok: true, lockPath };
    } catch (e) {
      const canReclaim = Boolean(
        e && (
          e.code === 'EEXIST' ||
          e.code === 'EISDIR' ||
          (e.code === 'EPERM' && safeLstat(lockPath))
        ),
      );
      if (!canReclaim) {
        return { ok: false, code: 1, error: `无法创建安装锁 ${lockPath}: ${e?.message || e}` };
      }
      const info = inspectExistingLock(lockPath);
      const ageMs = info.ts ? Math.max(0, Date.now() - info.ts) : LOCK_STALE_TIMEOUT_MS + 1;
      const timedOut = ageMs >= LOCK_STALE_TIMEOUT_MS;
      const alive = Boolean(info.pid && isPidAlive(info.pid) && !timedOut);
      if (alive) {
        return {
          ok: false,
          code: 2,
          error: `另一个安装进程正在写入目标目录：锁 ${lockPath} 的持有者 pid=${info.pid} 仍在运行`,
        };
      }
      process.stderr.write(
        `setup: 检测到陈旧安装锁 ${lockPath}（pid=${info.pid ?? 'unknown'} 已退出或超时），自动清理接管（第 ${attempt}/3 次）\n`,
      );
      try {
        if (safeLstat(lockPath)?.isSymbolicLink()) {
          unlinkSymlinkOrJunctionSafe(lockPath);
        } else {
          fs.rmSync(lockPath, { recursive: true, force: true });
        }
      } catch (rmErr) {
        return { ok: false, code: 1, error: `无法清除陈旧安装锁 ${lockPath}: ${rmErr?.message || rmErr}` };
      }
    }
  }

  return {
    ok: false,
    code: 2,
    error: `连续 3 次接管安装锁 ${lockPath} 仍被并发抢占，请确认无其他安装进程后再试`,
  };
}

function writeInstallMarker(markerPath, payload) {
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  } catch {
    // Best-effort during crash path
  }
}

function readManifestMaps(manifestPath) {
  const filesMap = new Map();
  let engine = '';
  let raw = null;
  const lst = safeLstat(manifestPath);
  if (!lst || lst.isSymbolicLink() || !lst.isFile()) return { engine, filesMap, raw };
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    engine = typeof raw?.engine === 'string' ? raw.engine : '';
    if (raw && Array.isArray(raw.files)) {
      for (const f of raw.files) {
        if (f && typeof f.path === 'string' && typeof f.sha256 === 'string') {
          filesMap.set(toPosix(f.path), f);
        }
      }
    }
  } catch {
    // Corrupt manifest falls back to conservative conflict protection
  }
  return { engine, filesMap, raw };
}

function collectFrameworkDirs(coreManifest) {
  const dirSet = new Set([
    '.agents',
    '.agents/.runtime',
    '.agents/rules',
    '.agents/scripts',
  ]);
  for (const item of coreManifest?.files || []) {
    const rel = toPosix(item?.path || '');
    if (!rel.startsWith('.agents/')) continue;
    const parts = rel.split('/');
    for (let i = 2; i < parts.length; i++) {
      dirSet.add(parts.slice(0, i).join('/'));
    }
  }
  return [...dirSet].sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export function scanUnlinkedDirs(targetDir, coreManifest) {
  const orderedDirs = collectFrameworkDirs(coreManifest);
  const unlinked = [];
  for (const relDir of orderedDirs) {
    if (unlinked.some((u) => relDir.startsWith(`${u}/`))) continue;
    if (safeLstat(path.join(targetDir, relDir))?.isSymbolicLink()) {
      unlinked.push(relDir);
    }
  }
  return unlinked;
}

function hasSymlinkAncestor(relPath, unlinkedDirSet) {
  const norm = toPosix(relPath);
  const parts = norm.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (unlinkedDirSet.has(parts.slice(0, i).join('/'))) return true;
  }
  return false;
}

function relocateBlockingPath(p, stamp) {
  let dest = `${p}.bak-${stamp}`;
  let seq = 1;
  while (safeLstat(dest)) {
    dest = `${p}.bak-${stamp}-${seq}`;
    seq++;
  }
  fs.renameSync(p, dest);
  return dest;
}

function clearLeafBeforeWrite(dstFull, stamp) {
  const lst = safeLstat(dstFull);
  if (!lst) return;
  if (lst.isSymbolicLink()) {
    unlinkSymlinkOrJunctionSafe(dstFull);
    return;
  }
  if (!lst.isFile()) {
    relocateBlockingPath(dstFull, stamp);
  }
}

function decideThreeWay(srcSha, dstFullPath, oldSha, force) {
  const lst = safeLstat(dstFullPath);
  if (!lst) return 'create';
  if (lst.isSymbolicLink()) {
    const st = statOrNull(dstFullPath);
    if (!st) return 'create';
    if (!st.isFile()) return force ? 'update' : 'conflict';
    if (force) return 'update';
    if (oldSha) {
      try {
        const dstSha = hashLfFile(dstFullPath).sha256;
        if (dstSha === oldSha) return 'update';
      } catch {
        return 'conflict';
      }
    }
    return 'conflict';
  }
  if (!lst.isFile()) return force ? 'update' : 'conflict';
  let dstSha;
  try {
    dstSha = hashLfFile(dstFullPath).sha256;
  } catch {
    return force ? 'update' : 'conflict';
  }
  if (dstSha === srcSha) return 'skip';
  if (force || (oldSha && dstSha === oldSha)) return 'update';
  return 'conflict';
}

/**
 * Identify whether `<targetDir>/GEMINI.md` was generated by legacy `agy-base` v2.x:
 * Line 1 contains `# agy-base` AND body contains `本仓是 cc-base（Claude Code 产品开发框架）的 Antigravity`.
 * User-authored `GEMINI.md` files return `false` and are NEVER touched!
 */
export function isLegacyFrameworkGeminiMd(targetDir) {
  const geminiPath = path.join(targetDir, 'GEMINI.md');
  const lst = safeLstat(geminiPath);
  if (!lst || lst.isSymbolicLink() || !lst.isFile()) return false;
  try {
    const text = fs.readFileSync(geminiPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const firstLine = (text.split('\n')[0] || '').trim();
    return (
      firstLine.includes('# agy-base') &&
      text.includes('本仓是 cc-base（Claude Code 产品开发框架）的 Antigravity')
    );
  } catch {
    return false;
  }
}

function planSkillsLink(targetDir, unlinkedDirSet = new Set(), assumeCcInstalled = false) {
  const ccTarget = path.join(targetDir, '.claude', 'skills');
  const ccStat = statOrNull(ccTarget);
  const ccExists = assumeCcInstalled || Boolean(ccStat && ccStat.isDirectory());
  if (unlinkedDirSet.has('.agents')) {
    return ccExists ? 'create' : 'skip';
  }
  const linkPath = path.join(targetDir, '.agents', 'skills');
  const info = inspectDirLink(linkPath, ccExists && ccStat ? ccTarget : undefined);
  if (!ccExists) {
    if (info.exists && !info.isLink) return 'migrate';
    return 'skip';
  }
  if (!info.exists) return 'create';
  if (info.isLink && info.valid && info.matchesTarget) return 'skip';
  if (info.isLink) return 'update';
  return 'migrate';
}

function pruneEmptyDirsNonSymlink(dir) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) pruneEmptyDirsNonSymlink(path.join(dir, e.name));
  }
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* ignore */
  }
}

/**
 * Compute full installation / upgrade / v2.x-migration plan with ZERO filesystem writes.
 * @param {string} srcRoot
 * @param {string} targetDir
 * @param {{ force?: boolean, assumeCcInstalled?: boolean }} [opts]
 */
export function planInstall(srcRoot, targetDir, opts = {}) {
  const valid = validateTargetPath(targetDir);
  if (!valid.ok) {
    return { ok: false, code: 2, error: valid.message };
  }
  const srcAgents = path.join(srcRoot, '.agents');
  if (!fs.existsSync(srcAgents) || !fs.statSync(srcAgents).isDirectory()) {
    return { ok: false, code: 2, error: `源框架目录缺失 .agents：${srcAgents}` };
  }

  const force = Boolean(opts.force);
  const assumeCcInstalled = Boolean(opts.assumeCcInstalled);

  const srcManifestFile = path.join(srcRoot, MANIFEST_REL_PATH);
  let coreManifest = null;
  if (fs.existsSync(srcManifestFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(srcManifestFile, 'utf8'));
      if (parsed && parsed.version === 1 && parsed.engine === ENGINE_NAME && Array.isArray(parsed.files)) {
        coreManifest = parsed;
      }
    } catch {
      coreManifest = null;
    }
  }
  if (!coreManifest) {
    coreManifest = buildCoreManifest(srcRoot);
  }

  const unlinkedDirs = scanUnlinkedDirs(targetDir, coreManifest);
  const unlinkedDirSet = new Set(unlinkedDirs);

  const { engine: oldEngine, filesMap: oldCoreMap } = unlinkedDirSet.has('.agents')
    ? { engine: '', filesMap: new Map() }
    : readManifestMaps(path.join(targetDir, MANIFEST_REL_PATH));
  const { filesMap: oldOptMap } = unlinkedDirSet.has('.agents')
    ? { filesMap: new Map() }
    : readManifestMaps(path.join(targetDir, OPTIONAL_MANIFEST_REL_PATH));
  const newCorePaths = new Set(coreManifest.files.map((f) => toPosix(f.path)));

  // In v2.x upgrades where no FRAMEWORK-MANIFEST.json existed yet, treat unmodified v2 managed scripts/rules/skills.json
  // cleanly: `scripts/*` and `rules/*` were framework-owned in v2 `put_tree`, while `skills.json` falls back to 3-way.
  const isLegacyV2Upgrade = !oldEngine && (
    fs.existsSync(path.join(targetDir, '.agents', 'cc-base-files.txt')) ||
    fs.existsSync(path.join(targetDir, '.agents', 'cc-base-version.txt')) ||
    isLegacyFrameworkGeminiMd(targetDir)
  );

  const ops = [];

  // 1. Managed `.agents/*` files
  for (const item of coreManifest.files) {
    const rel = toPosix(item.path);
    if (!rel.startsWith('.agents/') || NEVER_INSTALL_ROOT.has(rel)) continue;
    const srcFull = path.join(srcRoot, rel);
    if (!fs.existsSync(srcFull)) continue;
    const dstFull = path.join(targetDir, rel);
    const oldEntry = oldCoreMap.get(rel);
    let action;
    if (hasSymlinkAncestor(rel, unlinkedDirSet)) {
      action = 'create';
    } else if (
      isLegacyV2Upgrade &&
      !oldEntry &&
      (rel.startsWith('.agents/scripts/') || rel.startsWith('.agents/rules/'))
    ) {
      action = decideThreeWay(item.sha256, dstFull, null, true);
    } else {
      action = decideThreeWay(item.sha256, dstFull, oldEntry?.sha256, force);
    }
    ops.push({
      action,
      kind: 'managed',
      relPath: rel,
      srcFull,
      sha256: item.sha256,
      bytes: item.bytes,
    });
  }

  // 2. Obsolete managed files from older manifests + legacy v2 `cc-base-*.txt`
  const obsoleteCandidates = new Map([...oldCoreMap, ...oldOptMap]);
  const obsoleteRemovals = [];
  if (!unlinkedDirSet.has('.agents')) {
    for (const [oldRel, oldEntry] of obsoleteCandidates) {
      if (newCorePaths.has(oldRel)) continue;
      if (!oldRel.startsWith('.agents/')) continue;
      if (hasSymlinkAncestor(oldRel, unlinkedDirSet)) continue;
      if (oldRel.startsWith('.agents/skills/') || oldRel.startsWith('.agents/agents/')) continue;
      if (oldRel.startsWith('.agents/local/') || oldRel.startsWith('.agents/.runtime/')) continue;
      const full = path.join(targetDir, oldRel);
      const lst = safeLstat(full);
      if (!lst || lst.isSymbolicLink() || !lst.isFile()) continue;
      const actualSha = hashLfFile(full).sha256;
      if (actualSha === oldEntry.sha256 || force) {
        obsoleteRemovals.push(oldRel);
      }
    }
    for (const v2Rel of ['.agents/cc-base-files.txt', '.agents/cc-base-version.txt']) {
      if (safeLstat(path.join(targetDir, v2Rel))) {
        obsoleteRemovals.push(v2Rel);
      }
    }
  }

  // 3. `.agents/hooks.json` lossless merge (preserving user non-`cc-base-*` blocks!)
  const srcHooksPath = path.join(srcRoot, '.agents', 'hooks.json');
  const dstHooksPath = path.join(targetDir, '.agents', 'hooks.json');
  let hooksPlan = null;
  if (fs.existsSync(srcHooksPath)) {
    const srcHooksObj = JSON.parse(fs.readFileSync(srcHooksPath, 'utf8'));
    const dstHooksLst = hasSymlinkAncestor('.agents/hooks.json', unlinkedDirSet)
      ? null
      : safeLstat(dstHooksPath);

    if (!dstHooksLst) {
      const merged = mergeHooksJson(null, srcHooksObj);
      const content = formatHooksJson(merged.hooks);
      hooksPlan = { action: 'create', content };
      ops.push({ action: 'create', kind: 'hooks', relPath: '.agents/hooks.json' });
    } else if (dstHooksLst.isSymbolicLink()) {
      const liveSt = statOrNull(dstHooksPath);
      const fresh = mergeHooksJson(null, srcHooksObj);
      const content = formatHooksJson(fresh.hooks);
      const action = !liveSt ? 'create' : (force ? 'update' : 'conflict');
      hooksPlan = { action, content };
      ops.push({ action, kind: 'hooks', relPath: '.agents/hooks.json' });
    } else if (!dstHooksLst.isFile()) {
      const fresh = mergeHooksJson(null, srcHooksObj);
      const content = formatHooksJson(fresh.hooks);
      const action = force ? 'update' : 'conflict';
      hooksPlan = { action, content };
      ops.push({ action, kind: 'hooks', relPath: '.agents/hooks.json' });
    } else {
      let dstHooksObj = null;
      let parseFailed = false;
      try {
        dstHooksObj = JSON.parse(fs.readFileSync(dstHooksPath, 'utf8'));
      } catch {
        parseFailed = true;
      }
      if (parseFailed && !force) {
        const fresh = mergeHooksJson(null, srcHooksObj);
        hooksPlan = { action: 'conflict', content: formatHooksJson(fresh.hooks) };
        ops.push({ action: 'conflict', kind: 'hooks', relPath: '.agents/hooks.json' });
      } else {
        const merged = mergeHooksJson(parseFailed ? null : dstHooksObj, srcHooksObj);
        const content = formatHooksJson(merged.hooks);
        const same = !parseFailed && hashLfBuffer(content).sha256 === hashLfFile(dstHooksPath).sha256;
        const action = same ? 'skip' : 'update';
        hooksPlan = { action, content };
        ops.push({ action, kind: 'hooks', relPath: '.agents/hooks.json' });
      }
    }
  }

  // 4. `.agents/FRAMEWORK-MANIFEST.json`
  const manifestText = fs.existsSync(srcManifestFile)
    ? fs.readFileSync(srcManifestFile, 'utf8')
    : JSON.stringify(coreManifest, null, 2) + '\n';
  const dstManifestPath = path.join(targetDir, MANIFEST_REL_PATH);
  let manifestAction = 'create';
  const dstManLst = hasSymlinkAncestor(MANIFEST_REL_PATH, unlinkedDirSet)
    ? null
    : safeLstat(dstManifestPath);
  if (dstManLst) {
    if (dstManLst.isSymbolicLink()) {
      const liveSt = statOrNull(dstManifestPath);
      manifestAction = !liveSt ? 'create' : (force ? 'update' : 'conflict');
    } else if (!dstManLst.isFile()) {
      manifestAction = force ? 'update' : 'conflict';
    } else {
      manifestAction = hashLfBuffer(manifestText).sha256 === hashLfFile(dstManifestPath).sha256 ? 'skip' : 'update';
    }
  }
  ops.push({ action: manifestAction, kind: 'manifest', relPath: MANIFEST_REL_PATH, content: manifestText });

  // 5. OS link plan (`.agents/skills -> .claude/skills`)
  const skillsLinkAction = planSkillsLink(targetDir, unlinkedDirSet, assumeCcInstalled);
  ops.push({
    action: skillsLinkAction === 'migrate' ? 'update' : skillsLinkAction,
    linkAction: skillsLinkAction,
    kind: 'link',
    relPath: '.agents/skills',
  });

  // 6. Legacy v2 `GEMINI.md` root migration check
  const migrateLegacyGemini = isLegacyFrameworkGeminiMd(targetDir);

  const stats = {
    create: ops.filter((o) => o.action === 'create').length,
    update: ops.filter((o) => o.action === 'update').length,
    conflict: ops.filter((o) => o.action === 'conflict').length,
    skip: ops.filter((o) => o.action === 'skip').length,
    prunedObsolete: obsoleteRemovals.length,
    total: ops.length,
  };

  return {
    ok: true,
    code: 0,
    oldEngine,
    unlinkedDirs,
    ops,
    obsoleteRemovals,
    migrateLegacyGemini,
    stats,
    conflicts: ops.filter((o) => o.action === 'conflict').map((o) => o.relPath),
    hooksPlan,
    manifestText,
  };
}

/**
 * Execute transactional install, idempotent reinstall, 3-way upgrade, v2.x migration, and 3-tier `cc-base` co-install.
 * @param {string} srcRoot
 * @param {string} targetDir
 * @param {{
 *   dryRun?: boolean,
 *   force?: boolean,
 *   withCc?: boolean,
 *   noAutoCc?: boolean,
 *   ccBase?: string
 * }} [opts]
 */
export function runInstall(srcRoot, targetDir, opts = {}) {
  const valid = validateTargetPath(targetDir);
  if (!valid.ok) {
    return { ok: false, code: 2, error: valid.message };
  }

  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const withCc = Boolean(opts.withCc);
  const explicitCc = String(opts.ccBase || '').trim();
  const noAutoCc = Boolean(opts.noAutoCc) || (!withCc && !explicitCc && process.env.AGY_NO_AUTO_CC === '1');

  if (!dryRun && path.resolve(srcRoot) === path.resolve(targetDir)) {
    return {
      ok: false,
      code: 2,
      error: `target 目录不能指向 agy-base 框架源仓库自身（${targetDir}）；请指定下游项目路径或使用 --dry-run`,
    };
  }

  // Step A: 3-tier upstream `cc-base` coordination (Tier 1 reuse/upgrade, Tier 2 auto-install, Tier 3 deferred)
  const ccRes = ensureUpstreamCcBase(srcRoot, targetDir, {
    dryRun,
    force,
    withCc,
    noAutoCc,
    ccBase: explicitCc,
  });
  if (!ccRes.ok) {
    return {
      ok: false,
      code: ccRes.code || 1,
      error: ccRes.error || '协调上游 cc-base 失败',
    };
  }

  const willHaveCcBase = ccRes.tier === 1 || ccRes.tier === 2;
  const plan = planInstall(srcRoot, targetDir, { force, assumeCcInstalled: willHaveCcBase });
  if (!plan.ok) return plan;

  if (dryRun) {
    return {
      ok: true,
      code: 0,
      dryRun: true,
      target: targetDir,
      ccBase: {
        tier: ccRes.tier,
        action: ccRes.action,
        sourceKind: ccRes.sourceKind || null,
        source: ccRes.source || null,
      },
      plan,
      stats: plan.stats,
      conflicts: plan.conflicts,
      written: [],
      migratedPaths: [],
      generatedAgentsCount: 0,
      pendingCcBase: Boolean(ccRes.pendingCcBase),
    };
  }

  const startedAt = new Date().toISOString();
  const migrationStamp = startedAt.replace(/[-:.]/g, '');
  const agentsDir = path.join(targetDir, '.agents');
  const runtimeDir = path.join(agentsDir, '.runtime');
  const markerPath = path.join(runtimeDir, 'install.marker');

  // Pre-lock safety guard: NEVER traverse a symlinked `.agents` or `.agents/.runtime` when creating `install.lock`!
  try {
    const agLst = safeLstat(agentsDir);
    if (agLst?.isSymbolicLink()) {
      unlinkSymlinkOrJunctionSafe(agentsDir);
    } else if (agLst && !agLst.isDirectory()) {
      relocateBlockingPath(agentsDir, migrationStamp);
    }

    const rtLst = safeLstat(runtimeDir);
    if (rtLst?.isSymbolicLink()) {
      unlinkSymlinkOrJunctionSafe(runtimeDir);
    } else if (rtLst && !rtLst.isDirectory()) {
      relocateBlockingPath(runtimeDir, migrationStamp);
    }

    const lockCandidate = path.join(runtimeDir, 'install.lock');
    if (safeLstat(lockCandidate)?.isSymbolicLink()) {
      unlinkSymlinkOrJunctionSafe(lockCandidate);
    }
  } catch (preErr) {
    return {
      ok: false,
      code: 1,
      error: `准备目标目录安全边界失败（${targetDir}）: ${preErr?.message || preErr}`,
    };
  }

  const lock = acquireInstallLock(runtimeDir, startedAt);
  if (!lock.ok) return lock;

  const written = [];
  const migratedPaths = [];
  let generatedAgentsCount = 0;
  let installDone = false;

  const failAfterRaw = process.env.AGY_SETUP_FAIL_AFTER || '';
  const failAfter = /^\d+$/.test(failAfterRaw) ? parseInt(failAfterRaw, 10) : 0;

  const recordWrite = (relPath) => {
    written.push(toPosix(relPath));
    writeInstallMarker(markerPath, { status: 'active', pid: process.pid, startedAt, written });
    if (failAfter > 0 && written.length >= failAfter) {
      throw new Error(
        `AGY_SETUP_FAIL_AFTER=${failAfter} 故障注入生效：写入第 ${written.length} 个文件（${relPath}）后强制中止`,
      );
    }
  };

  const backupExisting = (dstFull) => {
    const lst = safeLstat(dstFull);
    if (lst && !lst.isSymbolicLink() && lst.isFile()) {
      const bakPath = `${dstFull}.bak`;
      if (safeLstat(bakPath)?.isSymbolicLink()) {
        unlinkSymlinkOrJunctionSafe(bakPath);
      }
      fs.copyFileSync(dstFull, bakPath);
    }
  };

  const ensureSafeDirChain = (absDir) => {
    const rel = toPosix(path.relative(targetDir, absDir));
    if (!rel || rel === '.' || rel.startsWith('..')) return;
    const segs = rel.split('/').filter(Boolean);
    let cur = path.resolve(targetDir);
    for (const seg of segs) {
      cur = path.join(cur, seg);
      const lst = safeLstat(cur);
      if (lst?.isSymbolicLink()) {
        unlinkSymlinkOrJunctionSafe(cur);
      } else if (lst && !lst.isDirectory()) {
        relocateBlockingPath(cur, migrationStamp);
      }
    }
    fs.mkdirSync(absDir, { recursive: true });
  };

  const onSignal = (sig) => {
    if (!installDone) {
      writeInstallMarker(markerPath, {
        status: 'interrupted',
        pid: process.pid,
        startedAt,
        written,
        error: `terminated by ${sig}`,
      });
    }
    try {
      if (safeLstat(lock.lockPath)?.isSymbolicLink()) unlinkSymlinkOrJunctionSafe(lock.lockPath);
      else fs.rmSync(lock.lockPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    process.exit(1);
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    writeInstallMarker(markerPath, { status: 'active', pid: process.pid, startedAt, written });

    // Step 0: Detach any symlinked framework subdirectories recorded in `plan.unlinkedDirs` (shallow-to-deep)
    for (const relDir of plan.unlinkedDirs || []) {
      const fullDir = path.join(targetDir, relDir);
      if (safeLstat(fullDir)?.isSymbolicLink()) {
        unlinkSymlinkOrJunctionSafe(fullDir);
      }
    }

    // Also if `.agents/agents` was a symlink from an external experiment, detach symlink safely without traversing
    const agyAgentsSub = path.join(agentsDir, 'agents');
    if (safeLstat(agyAgentsSub)?.isSymbolicLink()) {
      unlinkSymlinkOrJunctionSafe(agyAgentsSub);
    }

    // Step 1: Smooth v2.x migration — archive legacy framework-generated `GEMINI.md` (NEVER touch user custom `GEMINI.md`!)
    if (isLegacyFrameworkGeminiMd(targetDir)) {
      const legacyGeminiSrc = path.join(targetDir, 'GEMINI.md');
      const legacyGeminiDst = path.join(runtimeDir, `migrated-v2-${migrationStamp}`, 'GEMINI.md');
      fs.mkdirSync(path.dirname(legacyGeminiDst), { recursive: true });
      fs.renameSync(legacyGeminiSrc, legacyGeminiDst);
      migratedPaths.push(toPosix(legacyGeminiDst));
    }

    // Step 2: Establish / repair / migrate `.agents/skills -> .claude/skills` OS directory link
    const linkRes = ensureSkillsLink(targetDir, {
      migrate: true,
      force,
      migrationStamp,
    });
    if (!linkRes.ok) {
      throw new Error(linkRes.skills.message || '建立 .agents/skills 软链/Junction 失败');
    }
    if (linkRes.skills.backupPath) {
      migratedPaths.push(toPosix(linkRes.skills.backupPath));
    }

    // Step 3: Remove unmodified obsolete files & legacy v2 `cc-base-{files,version}.txt`
    for (const oldRel of plan.obsoleteRemovals) {
      const full = path.join(targetDir, oldRel);
      try {
        const lst = safeLstat(full);
        if (lst?.isSymbolicLink()) {
          unlinkSymlinkOrJunctionSafe(full);
        } else if (lst?.isFile()) {
          fs.unlinkSync(full);
        }
      } catch {
        /* ignore */
      }
    }
    const oldOptManifest = path.join(targetDir, OPTIONAL_MANIFEST_REL_PATH);
    const oldOptLst = safeLstat(oldOptManifest);
    if (oldOptLst?.isSymbolicLink()) unlinkSymlinkOrJunctionSafe(oldOptManifest);
    else if (oldOptLst?.isFile()) fs.unlinkSync(oldOptManifest);

    // Step 4: Write / 3-way merge managed `.agents/*` files, `.agents/hooks.json`, and `.agents/FRAMEWORK-MANIFEST.json`
    for (const op of plan.ops) {
      if (op.kind === 'link' || op.action === 'skip') continue;
      const dstFull = path.join(targetDir, op.relPath);

      if (op.kind === 'hooks') {
        if (op.action === 'conflict') {
          const newPath = `${dstFull}.agy-new`;
          ensureSafeDirChain(path.dirname(newPath));
          clearLeafBeforeWrite(newPath, migrationStamp);
          fs.writeFileSync(newPath, plan.hooksPlan.content, 'utf8');
          recordWrite(`${op.relPath}.agy-new`);
        } else {
          if (op.action === 'update') backupExisting(dstFull);
          ensureSafeDirChain(path.dirname(dstFull));
          clearLeafBeforeWrite(dstFull, migrationStamp);
          fs.writeFileSync(dstFull, plan.hooksPlan.content, 'utf8');
          recordWrite(op.relPath);
        }
        continue;
      }

      if (op.action === 'conflict') {
        const newPath = `${dstFull}.agy-new`;
        ensureSafeDirChain(path.dirname(newPath));
        clearLeafBeforeWrite(newPath, migrationStamp);
        if (op.srcFull) fs.copyFileSync(op.srcFull, newPath);
        else if (typeof op.content === 'string') fs.writeFileSync(newPath, op.content, 'utf8');
        recordWrite(`${op.relPath}.agy-new`);
        continue;
      }

      if (op.action === 'update') {
        backupExisting(dstFull);
      }
      ensureSafeDirChain(path.dirname(dstFull));
      clearLeafBeforeWrite(dstFull, migrationStamp);
      if (op.srcFull) fs.copyFileSync(op.srcFull, dstFull);
      else if (typeof op.content === 'string') fs.writeFileSync(dstFull, op.content, 'utf8');
      recordWrite(op.relPath);
    }

    // Step 5: When `<target>/.claude/agents` exists, run `gen-agents.mjs` to generate `.agents/agents/*.md`
    // and write `.agents/.runtime/agents-gen.sha256`!
    const ccAgentsDir = path.join(targetDir, '.claude', 'agents');
    const targetGenScript = path.join(targetDir, '.agents', 'scripts', 'gen-agents.mjs');
    const genScript = fs.existsSync(targetGenScript)
      ? targetGenScript
      : path.join(srcRoot, '.agents', 'scripts', 'gen-agents.mjs');
    if (statOrNull(ccAgentsDir)?.isDirectory() && fs.existsSync(genScript)) {
      const genRes = spawnSync(process.execPath, [genScript, '--root', path.resolve(targetDir), '--quiet'], {
        cwd: path.resolve(targetDir),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (genRes.status !== 0) {
        throw new Error(`执行 gen-agents.mjs 失败: ${String(genRes.stderr || genRes.stdout || '').trim()}`);
      }
      const dstAgentsDir = path.join(targetDir, '.agents', 'agents');
      if (statOrNull(dstAgentsDir)?.isDirectory()) {
        generatedAgentsCount = fs.readdirSync(dstAgentsDir).filter((f) => f.endsWith('.md')).length;
      }
    }

    installDone = true;
    fs.rmSync(markerPath, { force: true });
    if (safeLstat(lock.lockPath)?.isSymbolicLink()) unlinkSymlinkOrJunctionSafe(lock.lockPath);
    else fs.rmSync(lock.lockPath, { recursive: true, force: true });
    pruneEmptyDirsNonSymlink(agentsDir);

    return {
      ok: true,
      code: 0,
      dryRun: false,
      target: targetDir,
      ccBase: {
        tier: ccRes.tier,
        action: ccRes.action,
        sourceKind: ccRes.sourceKind || null,
        source: ccRes.source || null,
      },
      plan,
      stats: plan.stats,
      conflicts: plan.conflicts,
      written,
      migratedPaths,
      links: {
        skills: linkRes.skills.status,
      },
      generatedAgentsCount,
      pendingCcBase: Boolean(ccRes.pendingCcBase || linkRes.pendingCcBase),
    };
  } catch (err) {
    const msg = String(err?.message || err);
    if (!installDone) {
      writeInstallMarker(markerPath, {
        status: 'interrupted',
        pid: process.pid,
        startedAt,
        written,
        error: msg,
      });
    }
    return {
      ok: false,
      code: 1,
      interrupted: true,
      error: msg,
      written,
    };
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    try {
      if (safeLstat(lock.lockPath)?.isSymbolicLink()) unlinkSymlinkOrJunctionSafe(lock.lockPath);
      else fs.rmSync(lock.lockPath, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Safely uninstall `agy-base` from `targetDir`.
 * - Verifies `manifest.engine === 'agy-base'`.
 * - Detaches `.agents/skills` symlink/Junction via `removeSkillsLink` (NEVER touching `.claude/`!).
 * - Removes generated `.agents/agents/*.md` carrying `gen-agents.mjs` marker (preserving hand-written/custom agents).
 * - Strips ONLY `cc-base-*` blocks from `.agents/hooks.json` (preserving user custom blocks).
 * - Removes managed files & prunes empty directories.
 */
export function runUninstall(targetDir, opts = {}) {
  const valid = validateTargetPath(targetDir);
  if (!valid.ok) {
    return { ok: false, code: 2, error: valid.message };
  }
  const force = Boolean(opts.force);
  const dryRun = Boolean(opts.dryRun);
  const agentsDir = path.join(targetDir, '.agents');
  const coreManifestPath = path.join(targetDir, MANIFEST_REL_PATH);

  const agLst = safeLstat(agentsDir);
  if (!agLst) {
    return {
      ok: false,
      code: 2,
      error: `目标目录未检测到 agy-base 安装清单（${MANIFEST_REL_PATH}）：${targetDir}`,
    };
  }
  if (agLst.isSymbolicLink()) {
    if (!force) {
      return {
        ok: false,
        code: 2,
        error: `拒绝卸载：目标 .agents 目录本身是符号链接/联接点（${agentsDir}），不穿透外部目录（如需仅拆链请传 --force）`,
      };
    }
    if (!dryRun) unlinkSymlinkOrJunctionSafe(agentsDir);
    return { ok: true, code: 0, dryRun, removed: ['.agents'], keptModified: [] };
  }

  const manLst = safeLstat(coreManifestPath);
  if (!manLst) {
    return {
      ok: false,
      code: 2,
      error: `目标目录未检测到 agy-base 安装清单（${MANIFEST_REL_PATH}）：${targetDir}`,
    };
  }
  if (manLst.isSymbolicLink()) {
    if (!force) {
      return {
        ok: false,
        code: 2,
        error: `拒绝卸载：${MANIFEST_REL_PATH} 是符号链接，不穿透外部清单（如需强制拆链请传 --force）`,
      };
    }
    if (!dryRun) unlinkSymlinkOrJunctionSafe(coreManifestPath);
    return { ok: true, code: 0, dryRun, removed: [MANIFEST_REL_PATH], keptModified: [] };
  }

  let rawManifest = null;
  try {
    rawManifest = JSON.parse(fs.readFileSync(coreManifestPath, 'utf8'));
  } catch {
    rawManifest = null;
  }
  if (!rawManifest || rawManifest.engine !== ENGINE_NAME) {
    if (!force) {
      return {
        ok: false,
        code: 2,
        error: `目标目录安装引擎为 "${rawManifest?.engine || 'unknown'}"（期望 "${ENGINE_NAME}"），拒绝跨引擎误卸载（如需强制卸载请传 --force）`,
      };
    }
  }

  const { filesMap: coreMap } = readManifestMaps(coreManifestPath);
  const removed = [];
  const keptModified = [];

  // 1. Detach `.agents/skills` OS directory link — NEVER touches `.claude/`!
  if (!dryRun) {
    const linkRes = removeSkillsLink(targetDir);
    if (linkRes.skills.removed) removed.push('.agents/skills');
  } else if (safeLstat(path.join(agentsDir, 'skills'))?.isSymbolicLink()) {
    removed.push('.agents/skills');
  }

  // 2. Clean generated `.agents/agents/*.md` (preserving hand-written or renamed custom agents!)
  const genAgentsDir = path.join(agentsDir, 'agents');
  const genLst = safeLstat(genAgentsDir);
  if (genLst) {
    if (genLst.isSymbolicLink()) {
      if (force) {
        if (!dryRun) unlinkSymlinkOrJunctionSafe(genAgentsDir);
        removed.push('.agents/agents');
      } else {
        keptModified.push('.agents/agents');
      }
    } else if (genLst.isDirectory()) {
      for (const f of fs.readdirSync(genAgentsDir).sort()) {
        if (!f.endsWith('.md')) continue;
        const fp = path.join(genAgentsDir, f);
        const flst = safeLstat(fp);
        if (!flst || flst.isSymbolicLink() || !flst.isFile()) continue;
        try {
          const content = fs.readFileSync(fp, 'utf8');
          if (isOwnGeneratedAgentFile(f, content)) {
            if (!dryRun) fs.unlinkSync(fp);
            removed.push(`.agents/agents/${f}`);
          }
        } catch {
          keptModified.push(`.agents/agents/${f}`);
        }
      }
    }
  }

  // 3. Remove managed files from manifest (never traversing symlinks!)
  for (const [relPath, entry] of coreMap) {
    if (!relPath.startsWith('.agents/')) continue;
    const relParts = relPath.split('/');
    let ancestorSym = false;
    for (let i = 2; i < relParts.length; i++) {
      if (safeLstat(path.join(targetDir, relParts.slice(0, i).join('/')))?.isSymbolicLink()) {
        ancestorSym = true;
        break;
      }
    }
    if (ancestorSym) {
      keptModified.push(relPath);
      continue;
    }
    const full = path.join(targetDir, relPath);
    const lst = safeLstat(full);
    if (!lst) continue;
    if (lst.isSymbolicLink()) {
      if (force) {
        if (!dryRun) unlinkSymlinkOrJunctionSafe(full);
        removed.push(relPath);
      } else {
        keptModified.push(relPath);
      }
      continue;
    }
    if (!lst.isFile()) {
      keptModified.push(relPath);
      continue;
    }
    const actualSha = hashLfFile(full).sha256;
    if (actualSha === entry.sha256 || force) {
      if (!dryRun) {
        fs.unlinkSync(full);
        const bak = `${full}.bak`;
        if (safeLstat(bak)?.isFile()) fs.unlinkSync(bak);
      }
      removed.push(relPath);
    } else {
      keptModified.push(relPath);
    }
  }

  // 4. Strip `cc-base-*` blocks from `.agents/hooks.json`, keeping user custom non-`cc-base-*` blocks
  const hooksPath = path.join(agentsDir, 'hooks.json');
  const hkLst = safeLstat(hooksPath);
  if (hkLst) {
    if (hkLst.isSymbolicLink()) {
      if (force) {
        if (!dryRun) unlinkSymlinkOrJunctionSafe(hooksPath);
        removed.push('.agents/hooks.json');
      } else {
        keptModified.push('.agents/hooks.json');
      }
    } else if (hkLst.isFile()) {
      try {
        const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
        const stripped = stripFrameworkHookBlocks(parsed);
        if (stripped.remainingUserBlocks === 0) {
          if (!dryRun) {
            fs.unlinkSync(hooksPath);
            const bak = `${hooksPath}.bak`;
            if (safeLstat(bak)?.isFile()) fs.unlinkSync(bak);
          }
          removed.push('.agents/hooks.json');
        } else if (!dryRun && stripped.removedBlocks > 0) {
          fs.writeFileSync(hooksPath, formatHooksJson(stripped.hooks), 'utf8');
        }
      } catch {
        keptModified.push('.agents/hooks.json');
      }
    } else {
      keptModified.push('.agents/hooks.json');
    }
  }

  if (!dryRun) {
    const curManLst = safeLstat(coreManifestPath);
    if (curManLst?.isSymbolicLink()) {
      unlinkSymlinkOrJunctionSafe(coreManifestPath);
      removed.push(MANIFEST_REL_PATH);
    } else if (curManLst?.isFile()) {
      fs.unlinkSync(coreManifestPath);
      removed.push(MANIFEST_REL_PATH);
    }

    const rtDir = path.join(agentsDir, '.runtime');
    const rtLst = safeLstat(rtDir);
    if (rtLst && !rtLst.isSymbolicLink() && rtLst.isDirectory()) {
      for (const rtName of ['agents-gen.sha256', 'agy-last-prompt.json', 'gate-block.log', 'install.lock', 'install.marker']) {
        const rp = path.join(rtDir, rtName);
        const rlst = safeLstat(rp);
        if (rlst?.isSymbolicLink()) unlinkSymlinkOrJunctionSafe(rp);
        else if (rlst) fs.rmSync(rp, { recursive: true, force: true });
      }
    }
    pruneEmptyDirsNonSymlink(agentsDir);
  }

  return {
    ok: true,
    code: 0,
    dryRun,
    removed,
    keptModified,
  };
}

// ---------------------------------------------------------------------------
// Reporting, pack-check, and release (with `--bundle-cc`)
// ---------------------------------------------------------------------------

function printInstallReport(res, cmd, jsonMode) {
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({
        status: res.ok ? 'ok' : (res.code === 2 ? 'blocked' : 'violation'),
        code: res.code,
        command: cmd,
        dryRun: Boolean(res.dryRun),
        target: res.target,
        ccBase: res.ccBase || null,
        stats: res.stats,
        links: res.links || null,
        generatedAgentsCount: res.generatedAgentsCount || 0,
        pendingCcBase: Boolean(res.pendingCcBase),
        migratedPaths: res.migratedPaths || [],
        conflicts: res.conflicts || [],
        writtenCount: res.written ? res.written.length : 0,
        error: res.error || null,
      }) + '\n',
    );
    return;
  }

  if (!res.ok) {
    process.stderr.write(`setup: ${res.error}\n`);
    return;
  }

  if (res.dryRun) {
    process.stdout.write(
      `dry-run: 预览计划（零写入），目标目录：${res.target} [cc-base: tier=${res.ccBase?.tier} action=${res.ccBase?.action}]\n`,
    );
    if (res.plan.migrateLegacyGemini) {
      process.stdout.write('  migrate   GEMINI.md -> .agents/.runtime/migrated-v2-<ts>/GEMINI.md\n');
    }
    for (const op of res.plan.ops) {
      process.stdout.write(`  ${op.action.padEnd(9)} ${op.relPath}\n`);
    }
    process.stdout.write(
      `dry-run: create=${res.stats.create} update=${res.stats.update} conflict=${res.stats.conflict} skip=${res.stats.skip}（conflict 真装时写入 <file>.agy-new，绝不覆盖本地修改）\n`,
    );
    return;
  }

  if (res.migratedPaths && res.migratedPaths.length > 0) {
    process.stderr.write(
      `setup: 检测到旧版 v2 遗留内容，已安全归档至：\n${res.migratedPaths.map((p) => `  - ${p}`).join('\n')}\n`,
    );
  }

  if (res.conflicts && res.conflicts.length > 0) {
    process.stderr.write(
      `setup: ${res.conflicts.length} 个文件存在本地改动，未覆盖；新版已旁落 <file>.agy-new 供审阅合并：\n`,
    );
    for (const c of res.conflicts) {
      process.stderr.write(`  - ${c} -> ${c}.agy-new\n`);
    }
  }

  if (res.pendingCcBase) {
    process.stderr.write(
      'setup: 提示——当前目标尚未安装上游 cc-base (.claude/)；已装入 .agents/ 桥接壳，后续装入 cc-base 后重跑 setup 或启动 agy 会话将由 SessionStart 自动补建软链与生成子代理。\n',
    );
  }

  process.stdout.write(
    `${cmd}: ok target=${res.target} ccBase=${res.ccBase?.action || 'n/a'} create=${res.stats.create} update=${res.stats.update} conflict=${res.stats.conflict} skip=${res.stats.skip} skillsLink=${res.links?.skills || 'n/a'} agentsGen=${res.generatedAgentsCount}\n`,
  );
}

function runNodeSubprocess(scriptPath, args, cwd = FRAMEWORK_ROOT) {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (r.error) {
    return { status: -1, stdout: '', stderr: r.error.message, parsed: null };
  }
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '';
  let parsed = null;
  if (lastLine.startsWith('{')) {
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      parsed = null;
    }
  }
  return { status: r.status ?? -1, stdout, stderr, parsed };
}

function checkAllSyntaxInRepo(root, strictSyntax) {
  const failures = [];
  const warnings = [];
  const allFiles = walkRegularFiles(root, root).filter(
    (rel) =>
      !rel.startsWith('.git/') &&
      !rel.startsWith('node_modules/') &&
      !rel.startsWith('.serena/') &&
      !rel.startsWith('.bundled-cc-base/'),
  );

  let resolvedPsBin = undefined;
  const getPowerShellParserBin = () => {
    if (resolvedPsBin !== undefined) return resolvedPsBin;
    for (const cand of ['pwsh', 'powershell']) {
      const probe = spawnSync(cand, ['-NoProfile', '-Command', 'exit 0'], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (!probe.error || probe.error.code !== 'ENOENT') {
        resolvedPsBin = cand;
        return resolvedPsBin;
      }
    }
    resolvedPsBin = null;
    return null;
  };

  let resolvedShBin = undefined;
  const getShellParserBin = () => {
    if (resolvedShBin !== undefined) return resolvedShBin;
    for (const cand of ['sh', 'bash']) {
      const probe = spawnSync(cand, ['-c', 'exit 0'], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (!probe.error || probe.error.code !== 'ENOENT') {
        resolvedShBin = cand;
        return resolvedShBin;
      }
    }
    resolvedShBin = null;
    return null;
  };

  for (const rel of allFiles) {
    const full = path.join(root, rel);
    if (/\.(?:mjs|cjs|js)$/.test(rel)) {
      const r = spawnSync(process.execPath, ['--check', full], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (r.status !== 0) {
        failures.push(`${rel}: node --check failed (${String(r.stderr || '').trim().split(/\r?\n/)[0] || r.status})`);
      }
    } else if (rel.endsWith('.json')) {
      const buf = fs.readFileSync(full);
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        failures.push(`${rel}: UTF-8 BOM is forbidden in JSON`);
      }
      try {
        JSON.parse(buf.toString('utf8'));
      } catch (e) {
        failures.push(`${rel}: invalid JSON (${e.message})`);
      }
    } else if (rel.endsWith('.ps1')) {
      const buf = fs.readFileSync(full);
      if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        failures.push(`${rel}: UTF-8 BOM detected (must be pure 7-bit ASCII without BOM)`);
      }
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] > 0x7f) {
          failures.push(`${rel}: non-ASCII byte 0x${buf[i].toString(16)} at offset ${i}`);
          break;
        }
      }
      const psBin = getPowerShellParserBin();
      if (!psBin) {
        if (process.platform === 'win32' || strictSyntax) {
          failures.push(`${rel}: pwsh/powershell unavailable for AST verification`);
        } else {
          warnings.push(`${rel}: pwsh/powershell not installed on ${process.platform}, AST check skipped (BOM & ASCII verified)`);
        }
      } else {
        const pwshProbe = spawnSync(
          psBin,
          [
            '-NoProfile',
            '-Command',
            `$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${full.replace(/'/g, "''")}',[ref]$t,[ref]$e);if($e -and $e.Count -gt 0){Write-Error $e[0].Message;exit 1}`,
          ],
          { cwd: root, encoding: 'utf8', shell: false, windowsHide: true },
        );
        if (pwshProbe.status !== 0) {
          failures.push(`${rel}: PowerShell AST parse failed via ${psBin} (${String(pwshProbe.stderr || '').trim().split(/\r?\n/)[0]})`);
        }
      }
    } else if (rel.endsWith('.sh')) {
      const shBin = getShellParserBin();
      if (!shBin) {
        if (process.platform !== 'win32' || strictSyntax) {
          failures.push(`${rel}: sh/bash unavailable for syntax verification`);
        } else {
          warnings.push(`${rel}: sh/bash not installed on win32, skipped`);
        }
      } else {
        const shProbe = spawnSync(shBin, ['-n', full], {
          cwd: root,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        if (shProbe.status !== 0) {
          failures.push(`${rel}: ${shBin} -n failed (${String(shProbe.stderr || '').trim().split(/\r?\n/)[0]})`);
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, warnings, checkedFiles: allFiles.length };
}

function handlePackCheck(flags) {
  const strictSyntax = flags.has('strict-syntax');
  const steps = [];
  const bad = [];
  const warnings = [];

  // 1. Unit selftests
  const libSelftests = [
    ['selftest-path-guard', path.join(FRAMEWORK_ROOT, 'scripts', 'lib', 'path-guard.mjs')],
    ['selftest-link-manager', path.join(FRAMEWORK_ROOT, 'scripts', 'lib', 'link-manager.mjs')],
    ['selftest-cc-dep', path.join(FRAMEWORK_ROOT, 'scripts', 'lib', 'cc-dep.mjs')],
    ['selftest-hooks-merge', path.join(FRAMEWORK_ROOT, 'scripts', 'lib', 'hooks-merge.mjs')],
    ['selftest-manifest', path.join(FRAMEWORK_ROOT, 'scripts', 'lib', 'manifest.mjs')],
    ['selftest-ps-floor', path.join(FRAMEWORK_ROOT, '.agents', 'scripts', 'ps-floor.mjs')],
  ];
  for (const [name, script] of libSelftests) {
    const r = runNodeSubprocess(script, ['--selftest'], FRAMEWORK_ROOT);
    if (r.status === 0) {
      steps.push({ step: name, ok: true, code: 0 });
    } else {
      const summary = r.stderr.trim().split(/\r?\n/)[0] || `exit ${r.status}`;
      bad.push({ step: name, code: r.status || 1, summary });
      steps.push({ step: name, ok: false, code: r.status || 1, summary });
    }
  }

  // 2. Validate cc-base-contract.json
  try {
    loadCcBaseContract(FRAMEWORK_ROOT);
    steps.push({ step: 'cc-base-contract', ok: true, code: 0 });
  } catch (e) {
    bad.push({ step: 'cc-base-contract', code: 1, summary: e.message });
    steps.push({ step: 'cc-base-contract', ok: false, code: 1 });
  }

  // 3. Repo-wide syntax + encoding check
  const syn = checkAllSyntaxInRepo(FRAMEWORK_ROOT, strictSyntax);
  for (const w of syn.warnings) {
    warnings.push({ step: 'check-syntax', code: 0, summary: w });
  }
  if (!syn.ok) {
    bad.push({ step: 'check-syntax', code: 1, summary: syn.failures[0], failures: syn.failures.slice(0, 10) });
    steps.push({ step: 'check-syntax', ok: false, code: 1 });
  } else {
    steps.push({ step: 'check-syntax', ok: true, code: 0, checkedFiles: syn.checkedFiles });
  }

  // 4. Manifest drift check
  const mCheck = checkManifest(FRAMEWORK_ROOT);
  if (mCheck.code !== 0) {
    bad.push({ step: 'manifest-check', code: mCheck.code, summary: mCheck.summary, problems: mCheck.problems?.slice(0, 10) });
    steps.push({ step: 'manifest-check', ok: false, code: mCheck.code });
  } else {
    steps.push({ step: 'manifest-check', ok: true, code: 0 });
  }

  // 5. Anti-leak scan
  const mLeak = leakScanManifest(FRAMEWORK_ROOT, { requireManifestOnDisk: true });
  if (mLeak.code !== 0) {
    bad.push({ step: 'manifest-leak', code: mLeak.code, summary: mLeak.summary, hits: mLeak.hits?.slice(0, 10) });
    steps.push({ step: 'manifest-leak', ok: false, code: mLeak.code });
  } else {
    steps.push({ step: 'manifest-leak', ok: true, code: 0 });
  }

  // 6. Source doctor check
  const doctorScript = path.join(FRAMEWORK_ROOT, '.agents', 'scripts', 'doctor.mjs');
  if (!fs.existsSync(doctorScript)) {
    bad.push({ step: 'doctor', code: 3, summary: 'missing .agents/scripts/doctor.mjs' });
    steps.push({ step: 'doctor', ok: false, code: 3 });
  } else {
    const dr = runNodeSubprocess(doctorScript, ['--source-check', '--json', FRAMEWORK_ROOT], FRAMEWORK_ROOT);
    if (dr.status !== 0) {
      bad.push({
        step: 'doctor',
        code: dr.status,
        summary: dr.parsed?.summary || dr.stderr.trim().split(/\r?\n/)[0] || `doctor exited ${dr.status}`,
      });
      steps.push({ step: 'doctor', ok: false, code: dr.status });
    } else {
      steps.push({ step: 'doctor', ok: true, code: 0 });
    }
  }

  // 7. Shell wrapper `--help` smoke check (when `sh` is available)
  if (process.platform !== 'win32') {
    for (const wrapper of ['setup.sh', 'setup-agy.sh']) {
      const wp = path.join(FRAMEWORK_ROOT, wrapper);
      const sr = spawnSync('sh', [wp, '--help'], {
        cwd: FRAMEWORK_ROOT,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      if (sr.status !== 0) {
        bad.push({ step: `smoke-${wrapper}`, code: sr.status || 1, summary: `${wrapper} --help exited ${sr.status}` });
        steps.push({ step: `smoke-${wrapper}`, ok: false, code: sr.status || 1 });
      } else {
        steps.push({ step: `smoke-${wrapper}`, ok: true, code: 0 });
      }
    }
  }

  const code = bad.length === 0 ? 0 : (bad.every((b) => b.code === 3) ? 3 : 1);
  const payload = {
    status: code === 0 ? 'ok' : (code === 3 ? 'degraded' : 'violation'),
    code,
    summary: code === 0 ? `pack-check: all ${steps.length} checks passed` : `pack-check: ${bad.length} check(s) failed`,
    steps,
    warnings,
    bad,
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
  process.exit(code);
}

export function isReleaseExcludedRel(rel, allowBundledCc = false) {
  const p = toPosix(rel);
  if (p === '.bundled-cc-base' || p.startsWith('.bundled-cc-base/')) {
    if (!allowBundledCc) return true;
    const sub = p.slice('.bundled-cc-base/'.length);
    if (!sub) return true;
    if (
      sub === '.git' ||
      sub.startsWith('.git/') ||
      sub === 'progress.md' ||
      sub === 'progress.archive.md' ||
      /^progress\..*\.md$/.test(sub) ||
      sub === 'CHANGELOG.md' ||
      sub === 'Product-Spec.md' ||
      sub === 'Product-Spec-CHANGELOG.md' ||
      /^Product-Spec.*\.md$/.test(sub) ||
      sub === 'DEV-PLAN.md' ||
      sub === 'DEV-PLAN.archive.md' ||
      /^DEV-PLAN.*\.md$/.test(sub) ||
      sub === 'make-release.sh' ||
      sub === 'sync-from-cc-base.sh' ||
      sub.startsWith('docs/') ||
      sub.startsWith('tests/') ||
      sub.startsWith('.serena/') ||
      sub.startsWith('node_modules/') ||
      sub.startsWith('dist/') ||
      sub.startsWith('out/') ||
      sub.startsWith('release/') ||
      sub.startsWith('harness-state/') ||
      sub === '.claude/EVOLUTION.md' ||
      sub === '.claude/.last-review' ||
      sub === '.claude/.needs-review' ||
      sub === '.claude/.needs-review.lock' ||
      sub.startsWith('.claude/tests/') ||
      sub.startsWith('.claude/.runtime/') ||
      sub.startsWith('.claude/evidence/') ||
      sub.startsWith('.claude/local/') ||
      sub.startsWith('.claude/agent-memory/') ||
      sub.startsWith('.claude/worktrees/') ||
      sub.startsWith('.claude/research/') ||
      /^\.claude\/harness\/(?:receipts|state|waivers|trend|evidence|ext)\//.test(sub) ||
      (sub.startsWith('.claude/feedback/') &&
        !sub.startsWith('.claude/feedback/templates/') &&
        sub !== '.claude/feedback/FEEDBACK-INDEX.md')
    ) {
      return true;
    }
    if (/\.(?:bak|agy-new|cac-link-new|cac-base-new|framework-new|swp)$/.test(sub) || /\.bak-/.test(sub)) {
      return true;
    }
    if (/(?:^|\/)(?:\.DS_Store|Thumbs\.db|hooks\.local\.json|settings\.local\.json|settings-windows\.json|\.credentials\.json|signals\.jsonl)$/.test(sub)) {
      return true;
    }
    return false;
  }

  if (
    p === 'GEMINI.md' ||
    p === 'progress.md' ||
    p === 'progress.archive.md' ||
    /^progress\..*\.md$/.test(p) ||
    p === 'CHANGELOG.md' ||
    p === 'Product-Spec.md' ||
    p === 'Product-Spec-CHANGELOG.md' ||
    /^Product-Spec.*\.md$/.test(p) ||
    p === 'DEV-PLAN.md' ||
    p === 'DEV-PLAN.archive.md' ||
    /^DEV-PLAN.*\.md$/.test(p) ||
    p === 'sync-from-cc-base.sh' ||
    p === 'make-release.sh' ||
    p.startsWith('.claude/') ||
    p.startsWith('docs/') ||
    p.startsWith('tests/') ||
    p === '.agents/tests' ||
    p.startsWith('.agents/tests/') ||
    p.startsWith('.serena/') ||
    p.startsWith('node_modules/') ||
    p.startsWith('harness-state/') ||
    p.startsWith('.agents/harness-state/') ||
    p.startsWith('dist/') ||
    p.startsWith('out/') ||
    p.startsWith('release/')
  ) {
    return true;
  }
  if (
    p === '.agents/skills' ||
    p.startsWith('.agents/skills/') ||
    p === '.agents/agents' ||
    p.startsWith('.agents/agents/') ||
    p.startsWith('.agents/.runtime/') ||
    p.startsWith('.agents/local/') ||
    p.startsWith('.agents/evidence/') ||
    p === '.agents/cc-base-files.txt' ||
    p === '.agents/cc-base-version.txt'
  ) {
    return true;
  }
  if (/\.(?:bak|agy-new|cac-link-new|cac-base-new|framework-new|swp)$/.test(p) || /\.bak-/.test(p)) return true;
  if (/(?:^|\/)(?:\.DS_Store|Thumbs\.db|hooks\.local\.json|settings\.local\.json|\.credentials\.json)$/.test(p)) {
    return true;
  }
  return false;
}

function resolveTarCommand() {
  if (process.platform === 'win32') {
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sysTar)) return { bin: sysTar, extraFlags: [] };
    const probe = spawnSync('tar', ['--help'], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
    if (`${probe.stdout || ''}\n${probe.stderr || ''}`.includes('--force-local')) {
      return { bin: 'tar', extraFlags: ['--force-local'] };
    }
  }
  return { bin: 'tar', extraFlags: [] };
}

function handleRelease(version, outOverride, bundleCcDir) {
  if (!version || !/^[A-Za-z0-9._+-]+$/.test(version) || version.includes('..')) {
    usageDie(`release 需要合法的版本号（如 v3.0.0），收到：${version || '<empty>'}`);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-base-release-'));
  const pkgName = `agy-base-${version}`;
  const stageDir = path.join(tmpBase, pkgName);
  const verifyDir = path.join(tmpBase, 'verify-unpack');
  const hasBundleCc = Boolean(bundleCcDir && String(bundleCcDir).trim());
  let exitCode = 0;

  try {
    releaseFlow: {
      fs.mkdirSync(stageDir, { recursive: true });

      // Walk live working tree regular files (excluding `.git`, `node_modules`, `.serena`, `.bundled-cc-base`)
      const sourceRelList = walkRegularFiles(FRAMEWORK_ROOT, FRAMEWORK_ROOT).filter(
        (p) =>
          !p.startsWith('.git/') &&
          !p.startsWith('node_modules/') &&
          !p.startsWith('.serena/') &&
          !p.startsWith('.bundled-cc-base/'),
      );

      for (const rel of sourceRelList) {
        if (isReleaseExcludedRel(rel, false)) continue;
        const srcFull = path.join(FRAMEWORK_ROOT, rel);
        if (!fs.existsSync(srcFull) || !fs.lstatSync(srcFull).isFile()) continue;
        const dstFull = path.join(stageDir, rel);
        fs.mkdirSync(path.dirname(dstFull), { recursive: true });
        fs.copyFileSync(srcFull, dstFull);
        if ((rel === 'setup.sh' || rel === 'setup-agy.sh') && process.platform !== 'win32') {
          fs.chmodSync(dstFull, 0o755);
        }
      }

      let bundledStats = null;
      if (hasBundleCc) {
        try {
          bundledStats = bundleCcBaseIntoDir(
            String(bundleCcDir).trim(),
            path.join(stageDir, '.bundled-cc-base'),
            FRAMEWORK_ROOT,
          );
        } catch (e) {
          process.stderr.write(`release: ${e.message}\n`);
          exitCode = 2;
          break releaseFlow;
        }
      }

      const defaultArchive = path.join(os.tmpdir(), `${pkgName}.tar.gz`);
      const outPath = outOverride ? path.resolve(outOverride) : defaultArchive;
      const exportAsDir = outPath.endsWith('.dir');

      let unpackRoot = stageDir;
      if (exportAsDir) {
        fs.rmSync(outPath, { recursive: true, force: true });
        fs.cpSync(stageDir, outPath, { recursive: true });
        unpackRoot = outPath;
      } else {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.rmSync(outPath, { force: true });
        const tarCmd = resolveTarCommand();
        const tmpArchiveName = `${pkgName}.tar.gz`;
        const tmpArchivePath = path.join(tmpBase, tmpArchiveName);
        const packRes = spawnSync(tarCmd.bin, [...tarCmd.extraFlags, '-czf', tmpArchiveName, pkgName], {
          cwd: tmpBase,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        if (packRes.error || packRes.status !== 0) {
          process.stderr.write(`release: tar 打包失败: ${packRes.error?.message || packRes.stderr}\n`);
          exitCode = 1;
          break releaseFlow;
        }

        fs.mkdirSync(verifyDir, { recursive: true });
        const unpackRes = spawnSync(tarCmd.bin, [...tarCmd.extraFlags, '-xzf', tmpArchiveName, '-C', 'verify-unpack'], {
          cwd: tmpBase,
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        if (unpackRes.error || unpackRes.status !== 0) {
          process.stderr.write(`release: 解包校验失败: ${unpackRes.error?.message || unpackRes.stderr}\n`);
          exitCode = 1;
          break releaseFlow;
        }
        fs.copyFileSync(tmpArchivePath, outPath);
        unpackRoot = path.join(verifyDir, pkgName);
      }

      const unpackedFiles = walkRegularFiles(unpackRoot, unpackRoot);
      const leakedFiles = unpackedFiles.filter((rel) => isReleaseExcludedRel(rel, hasBundleCc));

      const contentHits = [];
      for (const rel of unpackedFiles) {
        const full = path.join(unpackRoot, rel);
        const buf = fs.readFileSync(full);
        if (buf.includes(0)) continue;
        contentHits.push(...scanTextForLeaks(rel, buf.toString('utf8')));
      }

      if (leakedFiles.length > 0 || contentHits.length > 0) {
        if (!exportAsDir) fs.rmSync(outPath, { force: true });
        process.stdout.write(
          JSON.stringify({
            status: 'violation',
            code: 1,
            summary: `release leak check failed: leakedFiles=${leakedFiles.length}, contentHits=${contentHits.length}`,
            leakedFiles: leakedFiles.slice(0, 20),
            contentHits: contentHits.slice(0, 20),
          }) + '\n',
        );
        exitCode = 1;
        break releaseFlow;
      }

      process.stdout.write(
        JSON.stringify({
          status: 'ok',
          code: 0,
          version,
          bundledCcBase: hasBundleCc,
          bundledCcFiles: bundledStats ? bundledStats.copiedFiles : 0,
          artifact: toPosix(outPath),
          files: unpackedFiles.length,
          summary: `release ${version}: verified ${unpackedFiles.length} unpacked files${hasBundleCc ? ' (with .bundled-cc-base)' : ''} with 0 leaks`,
        }) + '\n',
      );
      exitCode = 0;
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }

  process.exit(exitCode);
}

function main() {
  const { cmd, flags, kv, positional } = parseCliArgs(process.argv.slice(2));

  if (flags.has('help') || cmd === 'help') {
    process.stdout.write(usageText() + '\n');
    process.exit(0);
  }

  switch (cmd) {
    case 'install':
    case 'upgrade': {
      const target = resolveTargetArg(kv, positional, cmd);
      const res = runInstall(FRAMEWORK_ROOT, target, {
        dryRun: flags.has('dry-run'),
        force: flags.has('force'),
        withCc: flags.has('with-cc'),
        noAutoCc: flags.has('no-auto-cc'),
        ccBase: kv['cc-base'] || '',
      });
      printInstallReport(res, cmd, flags.has('json'));
      process.exit(res.code);
      break;
    }

    case 'uninstall': {
      const target = resolveTargetArg(kv, positional, 'uninstall');
      const res = runUninstall(target, {
        force: flags.has('force'),
        dryRun: flags.has('dry-run'),
      });
      if (flags.has('json')) {
        process.stdout.write(
          JSON.stringify({
            status: res.ok ? 'ok' : 'blocked',
            code: res.code,
            removed: res.removed || [],
            keptModified: res.keptModified || [],
            error: res.error || null,
          }) + '\n',
        );
      } else if (!res.ok) {
        process.stderr.write(`uninstall: ${res.error}\n`);
      } else {
        process.stdout.write(
          `uninstall: ${res.dryRun ? '(dry-run) ' : ''}removed=${res.removed.length} keptModified=${res.keptModified.length} target=${target}\n`,
        );
      }
      process.exit(res.code);
      break;
    }

    case 'doctor': {
      const target = resolveTargetArg(kv, positional, 'doctor');
      const v = validateTargetPath(target);
      if (!v.ok) {
        process.stderr.write(`doctor: ${v.message}\n`);
        process.exit(2);
      }
      const targetDoctor = path.join(target, '.agents', 'scripts', 'doctor.mjs');
      const fwDoctor = path.join(FRAMEWORK_ROOT, '.agents', 'scripts', 'doctor.mjs');
      const script = fs.existsSync(targetDoctor) ? targetDoctor : fwDoctor;
      if (!fs.existsSync(script)) {
        process.stderr.write('doctor: missing .agents/scripts/doctor.mjs\n');
        process.exit(3);
      }
      const args = [script, target];
      if (flags.has('source-check')) args.push('--source-check');
      if (flags.has('json')) args.push('--json');
      const r = spawnSync(process.execPath, args, {
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
      });
      process.exit(r.status ?? 1);
      break;
    }

    case 'manifest': {
      const modes = ['write', 'check', 'leak', 'print'].filter((m) => flags.has(m));
      if (modes.length > 1) {
        usageDie('manifest: --write / --check / --leak / --print 只能传其中一个');
      }
      const mode = modes[0] || 'check';
      const root = kv.target ? path.resolve(kv.target) : FRAMEWORK_ROOT;
      if (mode === 'print') {
        process.stdout.write(JSON.stringify(buildCoreManifest(root), null, 2) + '\n');
        process.exit(0);
      }
      const res =
        mode === 'write'
          ? writeManifest(root)
          : mode === 'leak'
            ? leakScanManifest(root, { requireManifestOnDisk: false })
            : checkManifest(root);
      process.stdout.write(JSON.stringify(res) + '\n');
      process.exit(res.code);
      break;
    }

    case 'pack-check': {
      handlePackCheck(flags);
      break;
    }

    case 'release': {
      handleRelease(positional[0], kv.out, kv['bundle-cc']);
      break;
    }

    default:
      usageDie(`未知子命令：${cmd}`);
  }
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main();
}
