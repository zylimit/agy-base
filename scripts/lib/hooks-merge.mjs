#!/usr/bin/env node
// scripts/lib/hooks-merge.mjs — Pure-Node lossless merger & uninstaller for <target>/.agents/hooks.json.
// - Preserves all user-defined non-`cc-base-*` named hook blocks in `<target>/.agents/hooks.json`.
// - Updates/inserts `cc-base-*` framework hook blocks and cleans obsolete `cc-base-*` blocks.
// - `stripFrameworkHookBlocks` removes ONLY `cc-base-*` blocks on uninstall, keeping user blocks intact!
// Zero npm dependencies (Node >= 20 built-ins only).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function cloneJson(val) {
  return JSON.parse(JSON.stringify(val));
}

/**
 * Determine whether a top-level `.agents/hooks.json` block key belongs to `agy-base` (`cc-base-*`).
 * @param {string} key
 * @returns {boolean}
 */
export function isFrameworkHookBlockKey(key) {
  return typeof key === 'string' && key.startsWith('cc-base-');
}

/**
 * Losslessly merge `sourceHooksObj` (`cc-base-*` blocks) into `targetHooksObj` (or initialize when null).
 * - Preserves 100% of user custom non-`cc-base-*` blocks.
 * - Replaces/adds `cc-base-*` blocks from `sourceHooksObj`.
 * - Removes obsolete `cc-base-*` blocks that no longer exist in `sourceHooksObj`.
 * - Deterministic key ordering guarantees byte-identical idempotency across repeated installs.
 *
 * @param {Record<string, any> | null} targetHooksObj
 * @param {Record<string, any>} sourceHooksObj
 */
export function mergeHooksJson(targetHooksObj, sourceHooksObj) {
  const src = sourceHooksObj && typeof sourceHooksObj === 'object' && !Array.isArray(sourceHooksObj)
    ? cloneJson(sourceHooksObj)
    : {};

  if (!targetHooksObj || typeof targetHooksObj !== 'object' || Array.isArray(targetHooksObj)) {
    const freshKeys = Object.keys(src);
    return {
      hooks: src,
      addedBlocks: freshKeys.length,
      updatedBlocks: 0,
      removedObsoleteBlocks: 0,
      preservedUserBlocks: 0,
    };
  }

  const tgt = cloneJson(targetHooksObj);
  const out = {};
  let addedBlocks = 0;
  let updatedBlocks = 0;
  let removedObsoleteBlocks = 0;
  let preservedUserBlocks = 0;

  // 1. Place canonical framework `cc-base-*` blocks first in source order
  for (const [k, v] of Object.entries(src)) {
    if (!(k in tgt)) {
      addedBlocks++;
    } else if (JSON.stringify(tgt[k]) !== JSON.stringify(v)) {
      updatedBlocks++;
    }
    out[k] = v;
  }

  // 2. Preserve user custom non-`cc-base-*` blocks in their original order; drop obsolete `cc-base-*` blocks
  for (const [k, v] of Object.entries(tgt)) {
    if (k in out) continue;
    if (isFrameworkHookBlockKey(k)) {
      removedObsoleteBlocks++;
      continue;
    }
    preservedUserBlocks++;
    out[k] = v;
  }

  return {
    hooks: out,
    addedBlocks,
    updatedBlocks,
    removedObsoleteBlocks,
    preservedUserBlocks,
  };
}

/**
 * Strip ONLY `cc-base-*` framework blocks on uninstall, keeping all user custom blocks intact.
 * @param {Record<string, any>} hooksObj
 */
export function stripFrameworkHookBlocks(hooksObj) {
  if (!hooksObj || typeof hooksObj !== 'object' || Array.isArray(hooksObj)) {
    return { hooks: {}, removedBlocks: 0, remainingUserBlocks: 0 };
  }
  const copy = cloneJson(hooksObj);
  const out = {};
  let removedBlocks = 0;
  let remainingUserBlocks = 0;

  for (const [k, v] of Object.entries(copy)) {
    if (isFrameworkHookBlockKey(k)) {
      removedBlocks++;
    } else {
      remainingUserBlocks++;
      out[k] = v;
    }
  }

  return {
    hooks: out,
    removedBlocks,
    remainingUserBlocks,
  };
}

/**
 * Format `.agents/hooks.json` with 2-space indent + trailing LF.
 * @param {Record<string, any>} hooksObj
 * @returns {string}
 */
export function formatHooksJson(hooksObj) {
  return JSON.stringify(hooksObj, null, 2) + '\n';
}

function runSelftest() {
  const srcHooks = {
    'cc-base-session': {
      SessionStart: [{ type: 'command', command: 'node scripts/hook-adapter.mjs SessionStart', timeout: 15 }],
    },
    'cc-base-stop': {
      Stop: [{ type: 'command', command: 'node scripts/hook-adapter.mjs Stop', timeout: 10 }],
    },
  };

  // 1. Fresh initialization
  const fresh = mergeHooksJson(null, srcHooks);
  if (fresh.addedBlocks !== 2 || fresh.preservedUserBlocks !== 0) {
    throw new Error(`step 1 fresh merge unexpected result: ${JSON.stringify(fresh)}`);
  }

  // 2. Existing user custom blocks + obsolete cc-base-legacy + modified cc-base-stop
  const targetWithCustom = {
    'team-audit': {
      PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'node scripts/team-audit.mjs' }] }],
    },
    'cc-base-legacy-obsolete': {
      PreInvocation: [{ type: 'command', command: 'node scripts/old.mjs' }],
    },
    'cc-base-stop': {
      Stop: [{ type: 'command', command: 'node scripts/hook-adapter.mjs Stop', timeout: 3 }],
    },
    'custom-pre-check': {
      PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'python3 tools/check.py' }] }],
    },
  };

  const merged = mergeHooksJson(targetWithCustom, srcHooks);
  if (
    merged.addedBlocks !== 1 ||
    merged.updatedBlocks !== 1 ||
    merged.removedObsoleteBlocks !== 1 ||
    merged.preservedUserBlocks !== 2
  ) {
    throw new Error(`step 2 merge counts mismatch: ${JSON.stringify(merged)}`);
  }
  if ('cc-base-legacy-obsolete' in merged.hooks) {
    throw new Error('step 2 obsolete cc-base-* block must be removed');
  }
  if (!('team-audit' in merged.hooks) || !('custom-pre-check' in merged.hooks)) {
    throw new Error('step 2 user non-cc-base-* hook blocks were lost');
  }

  // 3. Repeated merge is 100% byte-identical idempotent
  const again = mergeHooksJson(merged.hooks, srcHooks);
  if (
    again.addedBlocks !== 0 ||
    again.updatedBlocks !== 0 ||
    again.removedObsoleteBlocks !== 0 ||
    formatHooksJson(again.hooks) !== formatHooksJson(merged.hooks)
  ) {
    throw new Error('step 3 repeated mergeHooksJson must be 100% byte-identical');
  }

  // 4. Uninstall strips ONLY cc-base-* blocks and preserves user custom blocks
  const stripped = stripFrameworkHookBlocks(again.hooks);
  if (stripped.removedBlocks !== 2 || stripped.remainingUserBlocks !== 2) {
    throw new Error(`step 4 stripFrameworkHookBlocks mismatch: ${JSON.stringify(stripped)}`);
  }
  if ('cc-base-session' in stripped.hooks || 'cc-base-stop' in stripped.hooks) {
    throw new Error('step 4 cc-base-* blocks remained after strip');
  }
  if (!('team-audit' in stripped.hooks) || !('custom-pre-check' in stripped.hooks)) {
    throw new Error('step 4 user custom blocks lost during strip');
  }

  // 5. Uninstall on pure framework hooks leaves 0 remaining user blocks
  const strippedPure = stripFrameworkHookBlocks(fresh.hooks);
  if (strippedPure.removedBlocks !== 2 || strippedPure.remainingUserBlocks !== 0) {
    throw new Error(`step 5 pure framework strip mismatch: ${JSON.stringify(strippedPure)}`);
  }

  process.stdout.write(JSON.stringify({ ok: true, tests: 5 }) + '\n');
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    runSelftest();
    process.exit(0);
  }
  if (argv.includes('--check') && argv[1]) {
    const obj = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
    const fwKeys = Object.keys(obj).filter(isFrameworkHookBlockKey);
    const userKeys = Object.keys(obj).filter((k) => !isFrameworkHookBlockKey(k));
    process.stdout.write(JSON.stringify({ ok: true, fwKeys, userKeys }) + '\n');
    process.exit(0);
  }
  process.stderr.write('usage: node scripts/lib/hooks-merge.mjs --selftest\n');
  process.exit(2);
}
