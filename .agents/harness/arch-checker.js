/**
 * Architecture Anti-Rot & Dependency Governance Engine for Antigravity (AGY)
 */
const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, 'module-catalog.json');
const BASELINE_PATH = path.join(__dirname, 'arch-baseline.json');

const LAYER_ORDER = {
  domain: 1,
  application: 2,
  presentation: 3,
  infrastructure: 2
};

function loadCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { modules: [] };
  }
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

function checkCycles(modules) {
  const adj = {};
  modules.forEach(m => {
    adj[m.name] = m.dependencies || [];
  });

  const visited = {};
  const recStack = {};
  const cycles = [];

  function dfs(node, path) {
    visited[node] = true;
    recStack[node] = true;
    path.push(node);

    const neighbors = adj[node] || [];
    for (const neighbor of neighbors) {
      if (!visited[neighbor]) {
        dfs(neighbor, path);
      } else if (recStack[neighbor]) {
        const cyclePath = path.slice(path.indexOf(neighbor));
        cycles.push(cyclePath.join(' -> ') + ' -> ' + neighbor);
      }
    }

    recStack[node] = false;
    path.pop();
  }

  Object.keys(adj).forEach(node => {
    if (!visited[node]) {
      dfs(node, []);
    }
  });

  return cycles;
}

function checkLayerViolations(modules) {
  const modMap = {};
  modules.forEach(m => { modMap[m.name] = m; });

  const violations = [];
  modules.forEach(m => {
    const fromLayer = m.layer;
    (m.dependencies || []).forEach(depName => {
      const depMod = modMap[depName];
      if (!depMod) return;
      const toLayer = depMod.layer;

      // Domain (layer 1) must not depend on Application (2) or Presentation (3)
      if (fromLayer === 'domain' && (toLayer === 'application' || toLayer === 'presentation')) {
        violations.push(`Illegal dependency: ${m.name} (${fromLayer}) -> ${depName} (${toLayer})`);
      }
    });
  });

  return violations;
}

function runScan() {
  console.log('🔍 Running Antigravity Architecture Anti-Rot Scan...');
  const catalog = loadCatalog();
  const cycles = checkCycles(catalog.modules);
  const layerViolations = checkLayerViolations(catalog.modules);

  let passed = true;

  if (cycles.length > 0) {
    console.error('❌ Circular Dependencies Detected:');
    cycles.forEach(c => console.error(`  - ${c}`));
    passed = false;
  } else {
    console.log('✅ Zero Circular Dependencies.');
  }

  if (layerViolations.length > 0) {
    console.error('❌ Layer Boundary Violations Detected:');
    layerViolations.forEach(v => console.error(`  - ${v}`));
    passed = false;
  } else {
    console.log('✅ Layer Boundary Rules Passed.');
  }

  if (!passed) {
    process.exit(1);
  }
  console.log('🎉 Architecture Governance Audit: PASSED');
}

function generateBaseline() {
  console.log('📌 Generating Architecture Baseline Ratchet...');
  const catalog = loadCatalog();
  const cycles = checkCycles(catalog.modules);
  const layerViolations = checkLayerViolations(catalog.modules);

  const baseline = {
    timestamp: new Date().toISOString(),
    knownCycles: cycles,
    knownViolations: layerViolations
  };

  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf8');
  console.log(`✅ Baseline generated at ${BASELINE_PATH}`);
}

const cmd = process.argv[2] || 'scan';
if (cmd === 'scan') {
  runScan();
} else if (cmd === 'baseline') {
  generateBaseline();
} else if (cmd === 'mcp-server') {
  console.log('Antigravity MCP Arch Checker Server running...');
} else {
  console.log(`Unknown command: ${cmd}`);
}
