// # risk: high
// Independent contract & integration test suite for agy-base v3.0.0 Zero-Copy Link installer.
// Covers:
//   - CLI strict argv, bare typo guards, mutually exclusive flags (--no-auto-cc --with-cc), path-guard, POSIX wrappers
//   - 3-Tier cc-base coordination (Tier 1 reuse + --with-cc upgrade, Tier 2 empty target ../cc-base auto co-install
//     with zero root files, Tier 3 --no-auto-cc deferred + self-healing, release --bundle-cc offline air-gap bundle
//     + TMPDIR zero agy-base-release-* residue guarantee)
//   - 3x install idempotency, 3-way upgrade (.agy-new + --force .bak + lossless hooks.json custom block preservation),
//     legacy v2 framework GEMINI.md archival vs user custom GEMINI.md preservation
//   - F-01 anti-symlink traversal (.agents -> .claude parent link, reverse same-realpath link, leaf link into .claude/,
//     subdir link, dangling link), stale/directory lock recovery, fault injection, cross-engine uninstall guard,
//     and zero-damage uninstall (.claude/ byte-for-byte SHA-256 parity)

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acquireInstallLock,
  isLegacyFrameworkGeminiMd,
  runInstall,
  runUninstall,
} from '../../scripts/agy-base.mjs';
import {
  discoverCcBaseSource,
  loadCcBaseContract,
  verifyCcBaseDir,
} from '../../scripts/lib/cc-dep.mjs';
import {
  ensureDirLink,
  removeDirLink,
  safeLstat,
  unlinkSymlinkOrJunctionSafe,
} from '../../scripts/lib/link-manager.mjs';
import { walkRegularFiles } from '../../scripts/lib/manifest.mjs';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(THIS_DIR, '..', '..');
const AGY_CLI = path.join(REPO_ROOT, 'scripts', 'agy-base.mjs');
const SIBLING_CC_BASE = path.resolve(REPO_ROOT, '..', 'cc-base');
const CONTRACT = loadCcBaseContract(REPO_ROOT);

function createOsDirLinkForTest(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  if (process.platform === 'win32') {
    fs.symlinkSync(absTarget, absLink, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(absLink), absTarget), absLink, 'dir');
  }
}

function createOsFileLinkForTest(absLink, absTarget) {
  fs.mkdirSync(path.dirname(absLink), { recursive: true });
  const rel = path.relative(path.dirname(absLink), absTarget);
  fs.symlinkSync(process.platform === 'win32' ? absTarget : rel, absLink, 'file');
}

function runCli(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  const r = spawnSync(process.execPath, [opts.cliPath || AGY_CLI, ...args], {
    cwd: opts.cwd || os.tmpdir(),
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '';
  let json = null;
  if (lastLine.startsWith('{')) {
    try {
      json = JSON.parse(lastLine);
    } catch {
      json = null;
    }
  }
  return { status: r.status ?? -1, stdout, stderr, json };
}

function snapshotTreeSha256(rootDir) {
  const map = new Map();
  if (!fs.existsSync(rootDir)) return map;
  for (const rel of walkRegularFiles(rootDir, rootDir)) {
    const full = path.join(rootDir, rel);
    const hex = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    map.set(rel, hex);
  }
  return map;
}

function assertSnapshotsEqual(expected, actual, label) {
  assert.equal(
    actual.size,
    expected.size,
    `File count mismatch in ${label}: expected ${expected.size}, got ${actual.size}`,
  );
  for (const [rel, expHash] of expected.entries()) {
    assert.equal(actual.has(rel), true, `Missing file in ${label}: ${rel}`);
    assert.equal(actual.get(rel), expHash, `SHA-256 altered in ${label}: ${rel}`);
  }
}

function seedCompliantCcBase(dir, { withInstallers = false, markerTag = 'v1' } = {}) {
  fs.mkdirSync(path.join(dir, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'CLAUDE.md'),
    `# CLAUDE.md (${markerTag})\nGovernance constitution.\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(dir, '.claude', 'rules', 'core.md'), `# Core Rule (${markerTag})\n`, 'utf8');

  const minSkills = Number(CONTRACT.skills?.minCount ?? 15);
  for (let i = 1; i <= minSkills; i += 1) {
    const skillName = `skill-${String(i).padStart(2, '0')}`;
    const skillDir = path.join(dir, '.claude', 'skills', skillName);
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: Skill ${i} (${markerTag})\n---\n# ${skillName}\n`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(skillDir, 'references', 'detail.md'),
      `Reference payload ${i} (${markerTag})\n`,
      'utf8',
    );
  }

  fs.mkdirSync(path.join(dir, '.claude', 'agents'), { recursive: true });
  const recorderRoles = new Set(['progress-recorder', 'feedback-observer', 'domain-recorder']);
  for (const role of CONTRACT.agents.requiredRoles) {
    const disallowed = recorderRoles.has(role) ? 'disallowedTools: Bash, Task\n' : 'disallowedTools: Task\n';
    fs.writeFileSync(
      path.join(dir, '.claude', 'agents', `${role}.md`),
      `---\nname: ${role}\ndescription: Role ${role} (${markerTag})\nmodel: sonnet\n${disallowed}---\n\nPrompt body for ${role} (${markerTag}).\n`,
      'utf8',
    );
  }

  fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
  for (const h of CONTRACT.hooks.requiredScripts) {
    if (h === 'session-rules-banner.mjs') {
      fs.writeFileSync(
        path.join(dir, '.claude', 'hooks', h),
        `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'banner-${markerTag}'}})+'\\n');\n`,
        'utf8',
      );
    } else {
      fs.writeFileSync(path.join(dir, '.claude', 'hooks', h), `// hook ${h} (${markerTag})\n`, 'utf8');
    }
  }

  if (withInstallers) {
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
    const shPath = path.join(dir, 'setup.sh');
    fs.writeFileSync(shPath, shBody, 'utf8');
    if (process.platform !== 'win32') fs.chmodSync(shPath, 0o755);

    const psBody = [
      'param([string]$Target = ".", [switch]$DryRun, [switch]$Force)',
      'if ($DryRun) { exit 0 }',
      '$dst = Join-Path $Target ".claude"',
      'New-Item -ItemType Directory -Path $dst -Force | Out-Null',
      'Copy-Item -Path (Join-Path $PSScriptRoot ".claude\\*") -Destination $dst -Recurse -Force',
    ].join('\r\n') + '\r\n';
    fs.writeFileSync(path.join(dir, 'setup.ps1'), psBody, 'utf8');
  }
}

function copyAgyDistributableTree(dstFwRoot) {
  fs.mkdirSync(dstFwRoot, { recursive: true });
  for (const rel of ['cc-base-contract.json', 'package.json', 'setup.ps1', 'setup.sh', 'setup-agy.sh']) {
    const s = path.join(REPO_ROOT, rel);
    const d = path.join(dstFwRoot, rel);
    fs.copyFileSync(s, d);
    if ((rel === 'setup.sh' || rel === 'setup-agy.sh') && process.platform !== 'win32') {
      fs.chmodSync(d, 0o755);
    }
  }
  for (const dirRel of ['scripts', '.agents']) {
    const srcSub = path.join(REPO_ROOT, dirRel);
    for (const rel of walkRegularFiles(srcSub, REPO_ROOT)) {
      if (rel.startsWith('.agents/tests/') || rel.startsWith('.agents/.runtime/')) continue;
      const d = path.join(dstFwRoot, rel);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, rel), d);
    }
  }
}

describe('agy-base Zero-Copy Link Installer & Co-Install Suite', () => {
  let tmpRoot = '';

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-link-installer-test-'));
  });

  after(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  describe('1. CLI Strict Argv, Typo Subcommands, Mutually Exclusive Flags & Path Guard', () => {
    it('rejects --no-auto-cc combined with --with-cc or --cc-base with exit 2 and zero mkdir', () => {
      const t1 = path.join(tmpRoot, 'mut-excl-1');
      const r1 = runCli(['install', '--target', t1, '--no-auto-cc', '--with-cc']);
      assert.equal(r1.status, 2);
      assert.equal(fs.existsSync(t1), false);

      const t2 = path.join(tmpRoot, 'mut-excl-2');
      const r2 = runCli(['install', '--target', t2, '--no-auto-cc', '--cc-base', tmpRoot]);
      assert.equal(r2.status, 2);
      assert.equal(fs.existsSync(t2), false);
    });

    it('rejects bare typo subcommands (package/pack/bundle/check/test/update/remove) and unknown flags with exit 2', () => {
      const workCwd = path.join(tmpRoot, 'typo-cwd');
      fs.mkdirSync(workCwd, { recursive: true });

      for (const badSub of ['package', 'pack', 'bundle', 'check', 'test', 'update', 'remove']) {
        const r = runCli([badSub], { cwd: workCwd });
        assert.equal(r.status, 2, `Expected exit 2 for bare typo "${badSub}", got ${r.status}`);
        assert.equal(fs.existsSync(path.join(workCwd, badSub)), false, `Must NOT create folder "${badSub}"`);
      }

      const rFlag = runCli(['--dryrun'], { cwd: workCwd });
      assert.equal(rFlag.status, 2);
      assert.equal(fs.existsSync(path.join(workCwd, '--dryrun')), false);

      const rDup = runCli(['--target', path.join(tmpRoot, 'dup1'), path.join(tmpRoot, 'dup2')]);
      assert.equal(rDup.status, 2);
    });

    it('blocks unsafe target paths (.., system roots, Windows reserved names, trailing dot/space) and self-install', () => {
      const badPaths = [
        '../escape-out',
        '/etc/agy-forbidden',
        'C:\\Windows\\System32',
        path.join(tmpRoot, 'CON'),
        path.join(tmpRoot, 'LPT1.txt'),
        path.join(tmpRoot, 'bad*char'),
        `${path.join(tmpRoot, 'traildot')}.`,
        `${path.join(tmpRoot, 'trailspace')} `,
      ];
      for (const bp of badPaths) {
        const r = runCli(['install', '--target', bp, '--no-auto-cc']);
        assert.equal(r.status, 2, `Expected exit 2 for unsafe path ${bp}`);
      }

      const rSelf = runCli(['install', '--target', REPO_ROOT, '--no-auto-cc']);
      assert.equal(rSelf.status, 2);

      const dryTarget = path.join(tmpRoot, 'dry-run-clean');
      const rDry = runCli(['install', '--target', dryTarget, '--no-auto-cc', '--dry-run', '--json']);
      assert.equal(rDry.status, 0);
      assert.equal(rDry.json?.dryRun, true);
      assert.equal(fs.existsSync(dryTarget), false);
    });

    it('validates POSIX thin wrappers setup.sh and setup-agy.sh when sh is available', () => {
      if (process.platform === 'win32') {
        assert.equal(fs.existsSync(path.join(REPO_ROOT, 'setup.ps1')), true);
        return;
      }
      for (const scriptName of ['setup.sh', 'setup-agy.sh']) {
        const scriptPath = path.join(REPO_ROOT, scriptName);
        const helpRes = spawnSync('sh', [scriptPath, '--help'], {
          cwd: os.tmpdir(),
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        assert.equal(helpRes.status, 0);

        const badOpt = spawnSync('sh', [scriptPath, '--dryrun'], {
          cwd: os.tmpdir(),
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        });
        assert.equal(badOpt.status, 2);
      }

      const shTarget = path.join(tmpRoot, 'sh-wrapper-target');
      const shInst = spawnSync('sh', [path.join(REPO_ROOT, 'setup-agy.sh'), shTarget, '--no-auto-cc', '--json'], {
        cwd: os.tmpdir(),
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      assert.equal(shInst.status, 0);
      const parsed = JSON.parse(shInst.stdout.trim().split(/\r?\n/).pop());
      assert.equal(parsed.status, 'ok');
      assert.equal(parsed.ccBase.tier, 3);
    });
  });

  describe('2. Three-Tier cc-base Co-Installation & Offline --bundle-cc Release', () => {
    it('Tier 1: reuses existing compliant .claude/ and upgrades upstream when --with-cc is passed', () => {
      const target = path.join(tmpRoot, 'tier1-proj');
      seedCompliantCcBase(target, { markerTag: 'initial-v1' });

      const r1 = runCli(['install', target, '--json'], { env: { CC_BASE_DIR: '' } });
      assert.equal(r1.status, 0, r1.stderr);
      assert.equal(r1.json?.ccBase?.tier, 1);
      assert.equal(r1.json?.ccBase?.action, 'reused');
      assert.equal(r1.json?.pendingCcBase, false);
      assert.equal(r1.json?.links?.skills, 'created');
      assert.equal(r1.json?.generatedAgentsCount, CONTRACT.agents.requiredRoles.length);

      // Prepare an upgraded upstream cc-base source (v2) with a new role and updated CLAUDE.md
      const ccV2 = path.join(tmpRoot, 'cc-upstream-v2');
      seedCompliantCcBase(ccV2, { withInstallers: true, markerTag: 'upgraded-v2' });
      fs.writeFileSync(
        path.join(ccV2, '.claude', 'agents', 'extra-specialist.md'),
        '---\nname: extra-specialist\ndescription: Specialist v2\n---\nBody\n',
        'utf8',
      );

      const rUpg = runCli(['upgrade', target, '--with-cc', '--cc-base', ccV2, '--json']);
      assert.equal(rUpg.status, 0, rUpg.stderr);
      assert.equal(rUpg.json?.ccBase?.tier, 1);
      assert.equal(rUpg.json?.ccBase?.action, 'upgraded');
      assert.match(fs.readFileSync(path.join(target, '.claude', 'CLAUDE.md'), 'utf8'), /upgraded-v2/);
      assert.equal(fs.existsSync(path.join(target, '.agents', 'agents', 'extra-specialist.md')), true);
    });

    it('Tier 2: auto-discovers sibling ../cc-base on empty target for one-step dual install with zero root files', () => {
      const ws = path.join(tmpRoot, 'sibling-ws');
      const wsAgy = path.join(ws, 'agy-base');
      const wsCc = path.join(ws, 'cc-base');
      copyAgyDistributableTree(wsAgy);
      seedCompliantCcBase(wsCc, { withInstallers: true, markerTag: 'sibling-auto' });

      const emptyTarget = path.join(tmpRoot, 'tier2-empty-target');
      const r = runCli(['install', emptyTarget, '--json'], {
        cliPath: path.join(wsAgy, 'scripts', 'agy-base.mjs'),
        env: { CC_BASE_DIR: '', AGY_NO_AUTO_CC: '' },
      });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.json?.ccBase?.tier, 2);
      assert.equal(r.json?.ccBase?.action, 'installed');
      assert.equal(r.json?.ccBase?.sourceKind, 'sibling');
      assert.equal(r.json?.pendingCcBase, false);

      // Zero root file intrusion: ONLY .agents and .claude directories exist at target root
      const rootEntries = fs.readdirSync(emptyTarget).sort();
      assert.deepEqual(rootEntries, ['.agents', '.claude']);

      // OS link verification (.agents/skills -> .claude/skills)
      const skillsLink = path.join(emptyTarget, '.agents', 'skills');
      assert.equal(fs.lstatSync(skillsLink).isSymbolicLink(), true);
      if (process.platform !== 'win32') {
        assert.equal(fs.readlinkSync(skillsLink).replace(/\\/g, '/'), '../.claude/skills');
      }
      assert.equal(fs.existsSync(path.join(skillsLink, 'skill-01', 'SKILL.md')), true);

      // Downstream doctor Mode B must pass 100%
      const docRes = spawnSync(
        process.execPath,
        [path.join(emptyTarget, '.agents', 'scripts', 'doctor.mjs'), emptyTarget, '--json'],
        { cwd: os.tmpdir(), encoding: 'utf8', shell: false, windowsHide: true },
      );
      assert.equal(docRes.status, 0, docRes.stderr);
      const docJson = JSON.parse(docRes.stdout.trim());
      assert.equal(docJson.ok, true);
      assert.equal(docJson.mode, 'downstream');
      assert.ok(docJson.detail.skillsCount >= 15);
      assert.ok(docJson.detail.agentsCount >= 8);

      // Also verify real sibling ../cc-base discovery if present in active workspace
      if (verifyCcBaseDir(SIBLING_CC_BASE, CONTRACT, { requireInstaller: true }).ok) {
        const realSiblingDisc = discoverCcBaseSource(REPO_ROOT, { envCcBaseDir: '' });
        assert.equal(realSiblingDisc.found, true);
        assert.equal(realSiblingDisc.source, 'sibling');
      }
    });

    it('Tier 2 discovery priority: --cc-base > .bundled-cc-base > CC_BASE_DIR > ../cc-base, and invalid --cc-base exits 2', () => {
      const ws = path.join(tmpRoot, 'priority-ws');
      const wsAgy = path.join(ws, 'agy-base');
      const wsSibling = path.join(ws, 'cc-base');
      const wsEnv = path.join(tmpRoot, 'priority-env-cc');
      const wsBundled = path.join(wsAgy, '.bundled-cc-base');
      const wsFlag = path.join(tmpRoot, 'priority-flag-cc');
      copyAgyDistributableTree(wsAgy);
      seedCompliantCcBase(wsSibling, { withInstallers: true, markerTag: 'sib' });
      seedCompliantCcBase(wsEnv, { withInstallers: true, markerTag: 'env' });
      seedCompliantCcBase(wsFlag, { withInstallers: true, markerTag: 'flag' });

      const d1 = discoverCcBaseSource(wsAgy, { envCcBaseDir: '' });
      assert.equal(d1.source, 'sibling');

      const d2 = discoverCcBaseSource(wsAgy, { envCcBaseDir: wsEnv });
      assert.equal(d2.source, 'env');

      seedCompliantCcBase(wsBundled, { withInstallers: true, markerTag: 'bundled' });
      const d3 = discoverCcBaseSource(wsAgy, { envCcBaseDir: wsEnv });
      assert.equal(d3.source, 'bundled');

      const d4 = discoverCcBaseSource(wsAgy, { ccBase: wsFlag, envCcBaseDir: wsEnv });
      assert.equal(d4.source, 'cc-base-flag');

      const badCcDir = path.join(tmpRoot, 'empty-bad-cc');
      fs.mkdirSync(badCcDir, { recursive: true });
      const rBad = runCli(['install', path.join(tmpRoot, 'bad-cc-target'), '--cc-base', badCcDir]);
      assert.equal(rBad.status, 2);
    });

    it('Tier 3: --no-auto-cc installs bridge shell cleanly (exit 0) and SessionStart self-heals once .claude/ arrives', () => {
      const target = path.join(tmpRoot, 'tier3-deferred');
      const r = runCli(['install', target, '--no-auto-cc', '--json']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.json?.ccBase?.tier, 3);
      assert.equal(r.json?.ccBase?.action, 'deferred');
      assert.equal(r.json?.pendingCcBase, true);
      assert.equal(safeLstat(path.join(target, '.agents', 'skills')), null);
      assert.equal(fs.existsSync(path.join(target, '.agents', 'agents')), false);

      // Arrive upstream .claude/ later and trigger SessionStart hook-adapter
      seedCompliantCcBase(target, { markerTag: 'late-arrival' });
      const ss = spawnSync(
        process.execPath,
        [path.join(target, '.agents', 'scripts', 'hook-adapter.mjs'), 'SessionStart'],
        {
          cwd: target,
          input: JSON.stringify({ cwd: target }),
          encoding: 'utf8',
          shell: false,
          windowsHide: true,
        },
      );
      assert.equal(ss.status, 0, ss.stderr);
      assert.equal(fs.lstatSync(path.join(target, '.agents', 'skills')).isSymbolicLink(), true);
      assert.equal(fs.existsSync(path.join(target, '.agents', 'agents', 'implementer.md')), true);
      assert.equal(fs.existsSync(path.join(target, '.agents', '.runtime', 'agents-gen.sha256')), true);
    });

    it('release --bundle-cc builds clean offline all-in-one archive, installs air-gapped, and leaves zero agy-base-release-* temp dirs', () => {
      const ccSrc = path.join(tmpRoot, 'cc-for-bundle');
      seedCompliantCcBase(ccSrc, { withInstallers: true, markerTag: 'offline-bundle' });
      // Seed private runtime/memory artifacts in upstream cc-base that MUST be stripped by bundler
      fs.writeFileSync(path.join(ccSrc, '.claude', 'EVOLUTION.md'), '# Private Evolution\n', 'utf8');
      fs.writeFileSync(path.join(ccSrc, '.claude', '.needs-review'), 'src/secret.ts\n', 'utf8');
      fs.writeFileSync(path.join(ccSrc, '.claude', '.credentials.json'), '{"token":"placeholder"}\n', 'utf8');
      fs.mkdirSync(path.join(ccSrc, '.claude', 'feedback', 'templates'), { recursive: true });
      fs.writeFileSync(path.join(ccSrc, '.claude', 'feedback', 'fb-001.md'), 'private feedback\n', 'utf8');
      fs.writeFileSync(
        path.join(ccSrc, '.claude', 'feedback', 'templates', 'feedback-index-template.md'),
        '# Feedback Index Template\n',
        'utf8',
      );

      const isolatedTmp = path.join(tmpRoot, 'isolated-release-tmp');
      fs.mkdirSync(isolatedTmp, { recursive: true });
      const isolatedEnv = {
        TMPDIR: isolatedTmp,
        TMP: isolatedTmp,
        TEMP: isolatedTmp,
      };

      // Verify error path also cleans up agy-base-release-* via finally!
      const badBundleDir = path.join(tmpRoot, 'invalid-bundle-src');
      fs.mkdirSync(badBundleDir, { recursive: true });
      const badRel = runCli(
        ['release', 'v3.0.0-bad', '--bundle-cc', badBundleDir, '--out', path.join(tmpRoot, 'bad.tar.gz')],
        { env: isolatedEnv },
      );
      assert.equal(badRel.status, 2);
      assert.deepEqual(
        fs.readdirSync(isolatedTmp).filter((n) => n.startsWith('agy-base-release-')),
        [],
        'Failed release must leave zero agy-base-release-* directories in TMPDIR',
      );

      // Happy-path offline release archive
      const archivePath = path.join(tmpRoot, 'agy-base-v3.0.0-offline.tar.gz');
      const relRes = runCli(
        ['release', 'v3.0.0-offline', '--bundle-cc', ccSrc, '--out', archivePath],
        { env: isolatedEnv },
      );
      assert.equal(relRes.status, 0, relRes.stderr);
      assert.equal(relRes.json?.status, 'ok');
      assert.equal(relRes.json?.bundledCcBase, true);
      assert.ok(relRes.json?.bundledCcFiles > 20);
      assert.equal(fs.existsSync(archivePath), true);
      assert.deepEqual(
        fs.readdirSync(isolatedTmp).filter((n) => n.startsWith('agy-base-release-')),
        [],
        'Successful release must leave zero agy-base-release-* directories in TMPDIR',
      );

      // Unpack into isolated air-gap directory (no sibling cc-base, empty CC_BASE_DIR)
      const airgapDir = path.join(tmpRoot, 'airgap-intranet');
      fs.mkdirSync(airgapDir, { recursive: true });
      const tarBin = process.platform === 'win32'
        ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
        : 'tar';
      const unpack = spawnSync(tarBin, ['-xzf', archivePath, '-C', airgapDir], {
        cwd: airgapDir,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
      });
      assert.equal(unpack.status, 0, unpack.stderr);

      const unpackedFw = path.join(airgapDir, 'agy-base-v3.0.0-offline');
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'CLAUDE.md')), true);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'EVOLUTION.md')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', '.needs-review')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', '.credentials.json')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'feedback', 'fb-001.md')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.bundled-cc-base', '.claude', 'feedback', 'FEEDBACK-INDEX.md')), true);
      assert.equal(fs.existsSync(path.join(unpackedFw, 'progress.md')), false);
      assert.equal(fs.existsSync(path.join(unpackedFw, '.serena')), false);

      const airgapTarget = path.join(airgapDir, 'my-offline-service');
      const airgapInst = runCli(['install', airgapTarget, '--json'], {
        cliPath: path.join(unpackedFw, 'scripts', 'agy-base.mjs'),
        env: { CC_BASE_DIR: '', AGY_NO_AUTO_CC: '' },
      });
      assert.equal(airgapInst.status, 0, airgapInst.stderr);
      assert.equal(airgapInst.json?.ccBase?.tier, 2);
      assert.equal(airgapInst.json?.ccBase?.sourceKind, 'bundled');
      assert.deepEqual(fs.readdirSync(airgapTarget).sort(), ['.agents', '.claude']);
    });
  });

  describe('3. 3x Idempotency, 3-Way Upgrade, Lossless hooks.json Merge & v2 GEMINI.md Migration', () => {
    it('achieves 100% byte-identical idempotency across 3x repeated installs', () => {
      const target = path.join(tmpRoot, 'idem-3x');
      seedCompliantCcBase(target);

      const r1 = runCli(['install', target, '--json']);
      assert.equal(r1.status, 0, r1.stderr);
      assert.ok(r1.json.stats.create > 0);
      const hooksBytes1 = fs.readFileSync(path.join(target, '.agents', 'hooks.json'), 'utf8');
      const manBytes1 = fs.readFileSync(path.join(target, '.agents', 'FRAMEWORK-MANIFEST.json'), 'utf8');

      const r2 = runCli(['install', target, '--json']);
      assert.equal(r2.status, 0, r2.stderr);
      assert.equal(r2.json.stats.create, 0);
      assert.equal(r2.json.stats.update, 0);
      assert.equal(r2.json.stats.conflict, 0);
      assert.equal(r2.json.stats.skip, r2.json.stats.total);

      const r3 = runCli(['install', '--target', target, '--json']);
      assert.equal(r3.status, 0, r3.stderr);
      assert.equal(r3.json.stats.create, 0);
      assert.equal(r3.json.stats.update, 0);
      assert.equal(r3.json.stats.conflict, 0);
      assert.equal(fs.readFileSync(path.join(target, '.agents', 'hooks.json'), 'utf8'), hooksBytes1);
      assert.equal(fs.readFileSync(path.join(target, '.agents', 'FRAMEWORK-MANIFEST.json'), 'utf8'), manBytes1);
    });

    it('performs 3-way upgrade: preserves custom hooks.json blocks, writes .agy-new on conflict, and backs up .bak on --force', () => {
      const target = path.join(tmpRoot, 'three-way-upgrade');
      seedCompliantCcBase(target);
      assert.equal(runCli(['install', target, '--json']).status, 0);

      // 1) User adds custom named blocks + obsolete cc-base-* block to hooks.json
      const hooksPath = path.join(target, '.agents', 'hooks.json');
      const hooksObj = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      hooksObj['team-security-audit'] = {
        PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'node tools/sec.mjs' }] }],
      };
      hooksObj['custom-stop-metric'] = {
        Stop: [{ type: 'command', command: 'node tools/metric.mjs' }],
      };
      hooksObj['cc-base-legacy-obsolete'] = {
        SessionStart: [{ type: 'command', command: 'node scripts/dead.mjs' }],
      };
      fs.writeFileSync(hooksPath, JSON.stringify(hooksObj, null, 2) + '\n', 'utf8');

      // 2) User hand-edits a managed script (.agents/scripts/doctor.mjs)
      const docPath = path.join(target, '.agents', 'scripts', 'doctor.mjs');
      const originalDoc = fs.readFileSync(docPath, 'utf8');
      const customDoc = `${originalDoc}\n// USER_HAND_EDIT_MARKER\n`;
      fs.writeFileSync(docPath, customDoc, 'utf8');

      // Run normal 3-way upgrade (without --force)
      const upg = runCli(['upgrade', target, '--json']);
      assert.equal(upg.status, 0, upg.stderr);
      assert.deepEqual(upg.json.conflicts, ['.agents/scripts/doctor.mjs']);

      // Verify user edit preserved in doctor.mjs and clean version written to doctor.mjs.agy-new
      assert.equal(fs.readFileSync(docPath, 'utf8'), customDoc);
      assert.equal(fs.readFileSync(`${docPath}.agy-new`, 'utf8'), originalDoc);

      // Verify hooks.json lossless merge: user blocks preserved, obsolete cc-base-* removed, canonical cc-base-* intact
      const mergedHooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      assert.ok('team-security-audit' in mergedHooks);
      assert.ok('custom-stop-metric' in mergedHooks);
      assert.equal('cc-base-legacy-obsolete' in mergedHooks, false);
      assert.ok('cc-base-session' in mergedHooks);
      assert.ok('cc-base-stop' in mergedHooks);

      // Run upgrade --force: overwrites doctor.mjs with clean framework copy and backs up user copy to .bak
      fs.rmSync(`${docPath}.agy-new`, { force: true });
      const upgForce = runCli(['upgrade', target, '--force', '--json']);
      assert.equal(upgForce.status, 0, upgForce.stderr);
      assert.equal(upgForce.json.conflicts.length, 0);
      assert.equal(fs.readFileSync(docPath, 'utf8'), originalDoc);
      assert.equal(fs.readFileSync(`${docPath}.bak`, 'utf8'), customDoc);
    });

    it('archives legacy v2 framework GEMINI.md & physical skills/ while leaving user custom GEMINI.md untouched', () => {
      // Case A: Legacy v2 framework GEMINI.md
      const v2Proj = path.join(tmpRoot, 'v2-legacy-proj');
      seedCompliantCcBase(v2Proj);
      const legacyGeminiContent = [
        '# agy-base — Antigravity 宿主指令',
        '',
        '本仓是 cc-base（Claude Code 产品开发框架）的 Antigravity 适配层。',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(v2Proj, 'GEMINI.md'), legacyGeminiContent, 'utf8');
      fs.mkdirSync(path.join(v2Proj, '.agents', 'skills', 'v2-copied-skill'), { recursive: true });
      fs.writeFileSync(path.join(v2Proj, '.agents', 'skills', 'v2-copied-skill', 'SKILL.md'), '# Old v2 skill\n', 'utf8');
      fs.writeFileSync(path.join(v2Proj, '.agents', 'cc-base-files.txt'), 'old-list\n', 'utf8');
      fs.writeFileSync(path.join(v2Proj, '.agents', 'cc-base-version.txt'), '2.2.0\n', 'utf8');

      assert.equal(isLegacyFrameworkGeminiMd(v2Proj), true);

      const rV2 = runCli(['upgrade', v2Proj, '--json']);
      assert.equal(rV2.status, 0, rV2.stderr);
      assert.equal(fs.existsSync(path.join(v2Proj, 'GEMINI.md')), false, 'Legacy v2 GEMINI.md must be moved out of root');
      assert.equal(fs.existsSync(path.join(v2Proj, '.agents', 'cc-base-files.txt')), false);
      assert.equal(fs.existsSync(path.join(v2Proj, '.agents', 'cc-base-version.txt')), false);
      assert.equal(fs.lstatSync(path.join(v2Proj, '.agents', 'skills')).isSymbolicLink(), true);
      assert.ok(rV2.json.migratedPaths.some((p) => p.endsWith('/GEMINI.md')));
      assert.ok(rV2.json.migratedPaths.some((p) => p.endsWith('/skills')));

      // Case B: User-authored custom GEMINI.md (even starting with # Project or mentioning Gemini)
      const userGemProj = path.join(tmpRoot, 'user-custom-gemini-proj');
      seedCompliantCcBase(userGemProj);
      const userGeminiContent = '# My Service Gemini Guide\nDomain rules written by our engineering team.\n';
      fs.writeFileSync(path.join(userGemProj, 'GEMINI.md'), userGeminiContent, 'utf8');
      assert.equal(isLegacyFrameworkGeminiMd(userGemProj), false);

      const rUser = runCli(['install', userGemProj, '--json']);
      assert.equal(rUser.status, 0, rUser.stderr);
      assert.equal(fs.readFileSync(path.join(userGemProj, 'GEMINI.md'), 'utf8'), userGeminiContent);
    });
  });

  describe('4. F-01 Symlink Traversal Guards, Lock Recovery, Cross-Engine Guard & Zero-Damage Uninstall', () => {
    it('F-01: blocks parent symlink (.agents -> .claude), reverse same-realpath link, leaf symlinks into .claude/, and dangling links with 0% .claude/ damage', () => {
      // Subcase 1: Pre-planted parent symlink `.agents -> .claude`
      const p1 = path.join(tmpRoot, 'f01-parent-sym');
      seedCompliantCcBase(p1);
      const snap1Before = snapshotTreeSha256(path.join(p1, '.claude'));
      createOsDirLinkForTest(path.join(p1, '.agents'), path.join(p1, '.claude'));

      // Direct link-manager call must block with parent-is-symlink
      const directBlock = ensureDirLink(
        path.join(p1, '.agents', 'skills'),
        path.join(p1, '.claude', 'skills'),
        { migrate: true, force: true },
      );
      assert.equal(directBlock.ok, false);
      assert.equal(directBlock.reason, 'parent-is-symlink');
      assertSnapshotsEqual(snap1Before, snapshotTreeSha256(path.join(p1, '.claude')), 'after ensureDirLink parent-is-symlink');

      // Full installer must detach `.agents` symlink pre-lock without penetrating `.claude/`
      const inst1 = runInstall(REPO_ROOT, p1, { noAutoCc: false });
      assert.equal(inst1.ok, true, inst1.error);
      assert.equal(fs.lstatSync(path.join(p1, '.agents')).isSymbolicLink(), false);
      assert.equal(fs.lstatSync(path.join(p1, '.agents')).isDirectory(), true);
      assertSnapshotsEqual(snap1Before, snapshotTreeSha256(path.join(p1, '.claude')), 'after runInstall on .agents -> .claude');

      // Subcase 2: Reverse symlink `.claude/skills -> ../.agents/skills` (same realpath)
      const p2 = path.join(tmpRoot, 'f01-reverse-sym');
      const p2AgySkills = path.join(p2, '.agents', 'skills');
      const p2ClaudeSkills = path.join(p2, '.claude', 'skills');
      fs.mkdirSync(path.join(p2AgySkills, 'valuable'), { recursive: true });
      fs.writeFileSync(path.join(p2AgySkills, 'valuable', 'SKILL.md'), '# Do not vacate me\n', 'utf8');
      createOsDirLinkForTest(p2ClaudeSkills, p2AgySkills);

      const revBlock = ensureDirLink(p2AgySkills, p2ClaudeSkills, { migrate: true, force: true });
      assert.equal(revBlock.ok, false);
      assert.equal(revBlock.reason, 'same-realpath-as-target');
      assert.equal(fs.existsSync(path.join(p2AgySkills, 'valuable', 'SKILL.md')), true);

      // Subcase 3: Leaf symlink pointing to `.claude/CLAUDE.md`, subdir symlink `.agents/rules -> ../.claude/rules`, and dangling symlink
      const p3 = path.join(tmpRoot, 'f01-leaf-and-dangling');
      seedCompliantCcBase(p3);
      const snap3Before = snapshotTreeSha256(path.join(p3, '.claude'));
      fs.mkdirSync(path.join(p3, '.agents'), { recursive: true });
      createOsFileLinkForTest(
        path.join(p3, '.agents', 'skills.json'),
        path.join(p3, '.claude', 'CLAUDE.md'),
      );
      createOsDirLinkForTest(
        path.join(p3, '.agents', 'rules'),
        path.join(p3, '.claude', 'rules'),
      );
      fs.symlinkSync('../nonexistent-dangling-file', path.join(p3, '.agents', 'hooks.json'));

      const inst3 = runInstall(REPO_ROOT, p3, { force: true });
      assert.equal(inst3.ok, true, inst3.error);
      assert.equal(fs.lstatSync(path.join(p3, '.agents', 'skills.json')).isSymbolicLink(), false);
      assert.equal(fs.lstatSync(path.join(p3, '.agents', 'rules')).isSymbolicLink(), false);
      assert.equal(fs.lstatSync(path.join(p3, '.agents', 'hooks.json')).isSymbolicLink(), false);
      assertSnapshotsEqual(snap3Before, snapshotTreeSha256(path.join(p3, '.claude')), 'after leaf/subdir/dangling symlink install');

      // Also verify removeDirLink & unlinkSymlinkOrJunctionSafe refuse physical directories
      const physRes = removeDirLink(path.join(p3, '.claude', 'skills'));
      assert.equal(physRes.ok, false);
      assert.equal(physRes.removed, false);
      assert.throws(() => unlinkSymlinkOrJunctionSafe(path.join(p3, '.claude', 'skills')));
      assertSnapshotsEqual(snap3Before, snapshotTreeSha256(path.join(p3, '.claude')), 'after physical removeDirLink refusal');
    });

    it('recovers from dead-PID file locks, timed-out locks, directory locks, and fault-injected interrupted markers while blocking live-PID locks', () => {
      const target = path.join(tmpRoot, 'lock-recovery');
      seedCompliantCcBase(target);
      const runtimeDir = path.join(target, '.agents', '.runtime');
      const lockPath = path.join(runtimeDir, 'install.lock');

      // 1) Dead PID file lock -> reclaimed
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999991, ts: Date.now() }) + '\n', 'utf8');
      assert.equal(runInstall(REPO_ROOT, target).ok, true);

      // 2) Timed-out (> 10 min) lock even with live PID -> reclaimed
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() - 15 * 60 * 1000 }) + '\n', 'utf8');
      assert.equal(runInstall(REPO_ROOT, target).ok, true);

      // 3) Directory lock leftover (`install.lock/owner.json` with dead PID) -> reclaimed
      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: 99999992, ts: Date.now() }) + '\n', 'utf8');
      assert.equal(runInstall(REPO_ROOT, target).ok, true);

      // 4) Live PID fresh lock -> blocks with code 2
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }) + '\n', 'utf8');
      const blocked = acquireInstallLock(runtimeDir, new Date().toISOString());
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, 2);
      fs.rmSync(lockPath, { force: true });

      // 5) Fault injection (AGY_SETUP_FAIL_AFTER=2) writes interrupted marker & releases lock, then next install heals
      const crashTarget = path.join(tmpRoot, 'fault-inject-target');
      seedCompliantCcBase(crashTarget);
      const crashRes = runCli(['install', crashTarget], { env: { AGY_SETUP_FAIL_AFTER: '2' } });
      assert.equal(crashRes.status, 1);
      const markerFile = path.join(crashTarget, '.agents', '.runtime', 'install.marker');
      assert.equal(fs.existsSync(markerFile), true);
      assert.equal(JSON.parse(fs.readFileSync(markerFile, 'utf8')).status, 'interrupted');
      assert.equal(fs.existsSync(path.join(crashTarget, '.agents', '.runtime', 'install.lock')), false);

      const healRes = runCli(['install', crashTarget, '--json'], { env: { AGY_SETUP_FAIL_AFTER: '' } });
      assert.equal(healRes.status, 0);
      assert.equal(fs.existsSync(markerFile), false);
    });

    it('refuses cross-engine and symlinked-.agents uninstall, and normal uninstall keeps .claude/ 100% byte-for-byte intact', () => {
      // 1) Cross-engine manifest refusal
      const foreignProj = path.join(tmpRoot, 'foreign-engine-proj');
      fs.mkdirSync(path.join(foreignProj, '.agents'), { recursive: true });
      fs.writeFileSync(
        path.join(foreignProj, '.agents', 'FRAMEWORK-MANIFEST.json'),
        JSON.stringify({ version: 1, engine: 'other-scaffold', files: [] }) + '\n',
        'utf8',
      );
      const foreignUn = runUninstall(foreignProj);
      assert.equal(foreignUn.ok, false);
      assert.equal(foreignUn.code, 2);

      // 2) Symlinked .agents directory refusal without --force
      const symAgentsProj = path.join(tmpRoot, 'sym-agents-uninstall');
      seedCompliantCcBase(symAgentsProj);
      createOsDirLinkForTest(path.join(symAgentsProj, '.agents'), path.join(symAgentsProj, '.claude'));
      const symUn = runUninstall(symAgentsProj);
      assert.equal(symUn.ok, false);
      assert.equal(symUn.code, 2);

      // 3) Normal uninstall with user custom hook block & user custom agent -> .claude/ 100% byte-for-byte intact
      const proj = path.join(tmpRoot, 'clean-uninstall-proj');
      seedCompliantCcBase(proj);
      const snapBefore = snapshotTreeSha256(path.join(proj, '.claude'));

      assert.equal(runCli(['install', proj, '--json']).status, 0);

      // Add user custom hook block and custom hand-written agent
      const hkPath = path.join(proj, '.agents', 'hooks.json');
      const hkObj = JSON.parse(fs.readFileSync(hkPath, 'utf8'));
      hkObj['user-custom-block'] = { Stop: [{ type: 'command', command: 'node user.mjs' }] };
      fs.writeFileSync(hkPath, JSON.stringify(hkObj, null, 2) + '\n', 'utf8');

      const customAgentPath = path.join(proj, '.agents', 'agents', 'my-domain-bot.md');
      fs.writeFileSync(customAgentPath, '---\nname: my-domain-bot\ndescription: Custom\n---\nBody\n', 'utf8');

      const unRes = runCli(['uninstall', proj, '--json']);
      assert.equal(unRes.status, 0, unRes.stderr);
      assert.equal(safeLstat(path.join(proj, '.agents', 'skills')), null);
      assert.equal(fs.existsSync(path.join(proj, '.agents', 'agents', 'implementer.md')), false);
      assert.equal(fs.existsSync(customAgentPath), true, 'Hand-written custom agent must be preserved');

      const remainingHooks = JSON.parse(fs.readFileSync(hkPath, 'utf8'));
      assert.deepEqual(Object.keys(remainingHooks), ['user-custom-block']);

      const snapAfter = snapshotTreeSha256(path.join(proj, '.claude'));
      assertSnapshotsEqual(snapBefore, snapAfter, '.claude/ after normal uninstall');

      // 4) Pure framework install + uninstall prunes .agents/ completely
      const pureProj = path.join(tmpRoot, 'pure-uninstall-proj');
      seedCompliantCcBase(pureProj);
      const snapPureBefore = snapshotTreeSha256(path.join(pureProj, '.claude'));
      assert.equal(runCli(['install', pureProj, '--json']).status, 0);
      assert.equal(runCli(['uninstall', pureProj, '--json']).status, 0);
      assert.equal(fs.existsSync(path.join(pureProj, '.agents')), false);
      assertSnapshotsEqual(snapPureBefore, snapshotTreeSha256(path.join(pureProj, '.claude')), '.claude/ after pure uninstall');
    });
  });
});
