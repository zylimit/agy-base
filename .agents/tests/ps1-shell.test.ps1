#!/usr/bin/env pwsh
# # risk: high
# .agents/tests/ps1-shell.test.ps1 - End-to-end PowerShell contract and integration test suite for agy-base.
# Pure 7-bit ASCII UTF-8 without BOM. Compatible with Windows PowerShell 5.1 and PowerShell 7+ (pwsh).
# Covers:
#   1. No-BOM, pure-ASCII, PowerShell Language.Parser AST check, and static contract for -WithCc/-NoAutoCc/-CcBase/-BundleCc & 'package' guard
#   2. Unknown flag (--dryrun), bare typo ('package'), mutually exclusive (-NoAutoCc -WithCc / -NoAutoCc -CcBase), duplicate target, and CON rejection (exit 2, zero mkdir)
#   3. setup.ps1 -DryRun zero-write guarantee
#   4. Tier 1: 3x repeated idempotent install onto cc-base (.claude/) + OS Junction/symlink check + generated subagents + doctor.mjs --json
#   5. Tier 2: empty target one-step cc-base co-installation (-CcBase mock and ../cc-base when present) with zero root files
#   6. 3-way conflict preservation (.agy-new) + hooks.json custom block preservation + upgrade -Force recovery with .bak
#   7. Legacy v2 framework GEMINI.md + physical .agents/skills migration vs user custom GEMINI.md preservation
#   8. Tier 3: -NoAutoCc deferred pre-.claude/ install (exit 0) + hook-adapter.mjs SessionStart link & subagent self-healing
#   9. setup.ps1 -Uninstall -Force detaches OS links and keeps .claude/ 100% byte-for-byte untouched

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot '..') '..'))
$SetupPs1 = Join-Path $RepoRoot 'setup.ps1'
$SelfPs1  = Join-Path (Join-Path (Join-Path $RepoRoot '.agents') 'tests') 'ps1-shell.test.ps1'
$ContractPath = Join-Path $RepoRoot 'cc-base-contract.json'

$PsExe = $null
try {
  $PsExe = (Get-Process -Id $PID).Path
} catch {
  $PsExe = $null
}
if (-not $PsExe) {
  $pwshCmd = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwshCmd) {
    $PsExe = $pwshCmd.Source
  } else {
    $PsExe = 'powershell'
  }
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Write-Utf8NoBom([string]$FilePath, [string]$Text) {
  $parent = Split-Path -Parent $FilePath
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($FilePath, $Text, $Utf8NoBom)
}

function Invoke-PsScript([string]$ScriptPath, [string[]]$ScriptArgs) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $stdoutLines = & $PsExe -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @ScriptArgs 2>$null
    $rc = $LASTEXITCODE
    $stdoutText = ($stdoutLines | Out-String).Trim()
    return @{ ExitCode = $rc; Stdout = $stdoutText }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Invoke-NodeJson([string]$ScriptPath, [string[]]$NodeArgs, [string]$StdinText = '') {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($StdinText -ne '') {
      $stdoutLines = $StdinText | & node $ScriptPath @NodeArgs 2>$null
    } else {
      $stdoutLines = & node $ScriptPath @NodeArgs 2>$null
    }
    $rc = $LASTEXITCODE
    $stdoutText = ($stdoutLines | Out-String).Trim()
    return @{ ExitCode = $rc; Stdout = $stdoutText }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Seed-CompliantCcBase([string]$TargetDir, [switch]$WithInstallers) {
  $contract = [System.IO.File]::ReadAllText($ContractPath) | ConvertFrom-Json
  Write-Utf8NoBom (Join-Path $TargetDir '.claude/CLAUDE.md') "# Mock CLAUDE.md`nCore governance constitution.`n"
  Write-Utf8NoBom (Join-Path $TargetDir '.claude/rules/core.md') "# Core Rules`n"

  $minSkills = [int]$contract.skills.minCount
  for ($i = 1; $i -le $minSkills; $i++) {
    $num = $i.ToString('00')
    Write-Utf8NoBom (Join-Path $TargetDir ".claude/skills/skill-$num/SKILL.md") "---`nname: skill-$num`n---`n# Skill $num`n"
    Write-Utf8NoBom (Join-Path $TargetDir ".claude/skills/skill-$num/refs/guide.md") "precious-skill-ref-$num`n"
  }

  foreach ($role in $contract.agents.requiredRoles) {
    $disallowedLine = ''
    if ($role -eq 'progress-recorder' -or $role -eq 'feedback-observer' -or $role -eq 'domain-recorder') {
      $disallowedLine = "disallowedTools: Bash, Task`n"
    }
    $agentBody = "---`nname: $role`ndescription: Mock role $role`nmodel: sonnet`n$disallowedLine---`n`nRole instructions for $role.`n"
    Write-Utf8NoBom (Join-Path $TargetDir ".claude/agents/$role.md") $agentBody
  }

  foreach ($hk in $contract.hooks.requiredScripts) {
    if ($hk -eq 'session-rules-banner.mjs') {
      Write-Utf8NoBom (Join-Path $TargetDir ".claude/hooks/$hk") "process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'cc-banner-ok'}})+'\n');`n"
    } else {
      Write-Utf8NoBom (Join-Path $TargetDir ".claude/hooks/$hk") "// mock hook $hk`n"
    }
  }

  if ($WithInstallers) {
    $shBody = "#!/usr/bin/env bash`nset -eu`nDRY=0`nTARGET='.'`nfor a in `"`$@`"; do`n  if [ `"`$a`" = '--dry-run' ]; then DRY=1; else TARGET=`"`$a`"; fi`ndone`nif [ `"`$DRY`" = '1' ]; then exit 0; fi`nSRC=`"`$(cd `"`$(dirname `"`$0`")`" && pwd)`"`nmkdir -p `"`$TARGET/.claude`"`ncp -R `"`$SRC/.claude/.`" `"`$TARGET/.claude/`"`n"
    Write-Utf8NoBom (Join-Path $TargetDir 'setup.sh') $shBody
    $psBody = "param([string]`$Target = '.', [switch]`$DryRun, [switch]`$Force)`nif (`$DryRun) { exit 0 }`n`$dst = Join-Path `$Target '.claude'`nNew-Item -ItemType Directory -Path `$dst -Force | Out-Null`nCopy-Item -Path (Join-Path `$PSScriptRoot '.claude\*') -Destination `$dst -Recurse -Force`n"
    Write-Utf8NoBom (Join-Path $TargetDir 'setup.ps1') $psBody
  }
}

function Get-TreeHashSnapshot([string]$RootDir) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $RootDir)) { return $map }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $files = Get-ChildItem -LiteralPath $RootDir -Recurse -File -Force
    foreach ($f in $files) {
      $rel = $f.FullName.Substring($RootDir.Length).TrimStart('\', '/').Replace('\', '/')
      $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
      $hashHex = ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
      $map[$rel] = $hashHex
    }
  } finally {
    $sha.Dispose()
  }
  return $map
}

function Assert-SnapshotsEqual([hashtable]$Expected, [hashtable]$Actual, [string]$Label) {
  if ($Expected.Count -ne $Actual.Count) {
    throw ("Snapshot file count mismatch ($Label): expected $($Expected.Count), got $($Actual.Count)")
  }
  foreach ($k in $Expected.Keys) {
    if (-not $Actual.ContainsKey($k)) {
      throw ("Snapshot missing file ($Label): $k")
    }
    if ($Actual[$k] -ne $Expected[$k]) {
      throw ("Snapshot SHA256 mismatch ($Label): $k")
    }
  }
}

$PassCount = 0
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) {
    throw "ASSERTION FAILED: $Message"
  }
}

function Step-Pass([string]$Label) {
  $script:PassCount++
  Write-Host ("ok {0} - {1}" -f $script:PassCount, $Label)
}

# 1. PowerShell AST, No-BOM, Pure-ASCII, and Static Parameter Contract verification
$PsFiles = @(
  @{ Name = 'setup.ps1'; Path = $SetupPs1 },
  @{ Name = '.agents/tests/ps1-shell.test.ps1'; Path = $SelfPs1 }
)

$SetupAst = $null
foreach ($item in $PsFiles) {
  Assert-True (Test-Path -LiteralPath $item.Path) ("Missing PowerShell script: " + $item.Name)
  $bytes = [System.IO.File]::ReadAllBytes($item.Path)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  Assert-True (-not $hasBom) ("UTF-8 BOM detected in " + $item.Name)

  for ($idx = 0; $idx -lt $bytes.Length; $idx++) {
    Assert-True ($bytes[$idx] -lt 0x80) ("Non-ASCII byte 0x{0:X2} at offset {1} in {2}" -f $bytes[$idx], $idx, $item.Name)
  }

  $tokens = $null
  $parseErrors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($item.Path, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors -and $parseErrors.Count -gt 0) {
    throw ("PowerShell AST parse error in {0}: {1}" -f $item.Name, $parseErrors[0].Message)
  }
  if ($item.Name -eq 'setup.ps1') {
    $SetupAst = $ast
  }
}

$DeclaredParams = @($SetupAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
foreach ($reqParam in @('Command', 'Target', 'DryRun', 'Force', 'Uninstall', 'SourceCheck', 'WithCc', 'NoAutoCc', 'CcBase', 'BundleCc', 'Out', 'Json')) {
  Assert-True ($DeclaredParams -contains $reqParam) ("setup.ps1 ParamBlock missing parameter -$reqParam")
}

$SetupText = [System.IO.File]::ReadAllText($SetupPs1)
foreach ($reqToken in @("'package'", '--with-cc', '--no-auto-cc', '--cc-base', '--bundle-cc')) {
  Assert-True ($SetupText.Contains($reqToken)) ("setup.ps1 missing static contract token: " + $reqToken)
}
Step-Pass 'AST parse, no-BOM, pure-ASCII, and -WithCc/-NoAutoCc/-CcBase/-BundleCc/package static contract passed'

$TmpBase = Join-Path ([System.IO.Path]::GetTempPath()) ('agy-ps1-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))

try {
  New-Item -ItemType Directory -Path $TmpBase -Force | Out-Null

  # 2. Reject --dryrun, bare 'package' typo, mutually exclusive flags, duplicate target, and CON (exit 2, zero mkdir)
  $workCwd = Join-Path $TmpBase 'cwd-guard'
  New-Item -ItemType Directory -Path $workCwd -Force | Out-Null

  Push-Location -LiteralPath $workCwd
  try {
    $rTypo = Invoke-PsScript $SetupPs1 @('--dryrun')
    $rPkg  = Invoke-PsScript $SetupPs1 @('package')
  } finally {
    Pop-Location
  }
  Assert-True ($rTypo.ExitCode -eq 2) ("Expected setup.ps1 --dryrun to exit 2, got " + $rTypo.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $workCwd '--dryrun'))) 'setup.ps1 must NOT create directory --dryrun'
  Assert-True ($rPkg.ExitCode -eq 2) ("Expected setup.ps1 package bare typo to exit 2, got " + $rPkg.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $workCwd 'package'))) 'setup.ps1 must NOT create directory package'

  $mutTarget = Join-Path $TmpBase 'mut-noauto-withcc'
  $rMut = Invoke-PsScript $SetupPs1 @('-Target', $mutTarget, '-NoAutoCc', '-WithCc')
  Assert-True ($rMut.ExitCode -eq 2) ("Expected -NoAutoCc -WithCc conflict to exit 2, got " + $rMut.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath $mutTarget)) '-NoAutoCc -WithCc must NOT create target directory'

  $mutCcTarget = Join-Path $TmpBase 'mut-noauto-ccbase'
  $rMutCc = Invoke-PsScript $SetupPs1 @('-Target', $mutCcTarget, '-NoAutoCc', '-CcBase', $TmpBase)
  Assert-True ($rMutCc.ExitCode -eq 2) ("Expected -NoAutoCc -CcBase conflict to exit 2, got " + $rMutCc.ExitCode)

  $dupA = Join-Path $TmpBase 'dup-a'
  $dupB = Join-Path $TmpBase 'dup-b'
  $rDup = Invoke-PsScript $SetupPs1 @($dupA, '-Target', $dupB)
  Assert-True ($rDup.ExitCode -eq 2) ("Expected duplicate target rejection exit 2, got " + $rDup.ExitCode)

  $conTarget = Join-Path $TmpBase 'CON'
  $rCon = Invoke-PsScript $SetupPs1 @($conTarget)
  Assert-True ($rCon.ExitCode -eq 2) ("Expected setup.ps1 CON path rejection exit 2, got " + $rCon.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath $conTarget)) 'setup.ps1 must NOT create reserved CON directory'
  Step-Pass 'Unknown option (--dryrun), bare package, -NoAutoCc/-WithCc, duplicate target, and CON rejected with exit 2'

  # 3. setup.ps1 -DryRun leaves zero files on disk
  $dryTarget = Join-Path $TmpBase 'dry-target'
  $rDry = Invoke-PsScript $SetupPs1 @('-Target', $dryTarget, '-NoAutoCc', '-DryRun')
  Assert-True ($rDry.ExitCode -eq 0) ("setup.ps1 -DryRun failed with exit " + $rDry.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath $dryTarget)) 'setup.ps1 -DryRun must not create target directory'
  Step-Pass 'setup.ps1 -DryRun succeeded with zero writes'

  # 4. Tier 1: 3x repeated idempotent install onto cc-base (.claude/) + OS link + subagents + doctor.mjs
  $projTarget = Join-Path $TmpBase 'proj-tier1'
  Seed-CompliantCcBase $projTarget
  $snapClaudeBefore = Get-TreeHashSnapshot (Join-Path $projTarget '.claude')

  $rInst1 = Invoke-PsScript $SetupPs1 @($projTarget, '-Json')
  Assert-True ($rInst1.ExitCode -eq 0) ("setup.ps1 install #1 failed: " + $rInst1.ExitCode)
  $j1 = $rInst1.Stdout | ConvertFrom-Json
  Assert-True ($j1.ccBase.tier -eq 1 -and $j1.ccBase.action -eq 'reused') 'Tier 1 install #1 must report tier=1 action=reused'
  Assert-True ($j1.generatedAgentsCount -ge 8) 'Tier 1 install #1 must generate >= 8 subagents'

  $rInst2 = Invoke-PsScript $SetupPs1 @($projTarget, '-Json')
  Assert-True ($rInst2.ExitCode -eq 0) ("setup.ps1 install #2 failed: " + $rInst2.ExitCode)
  $j2 = $rInst2.Stdout | ConvertFrom-Json
  Assert-True ($j2.stats.create -eq 0 -and $j2.stats.update -eq 0 -and $j2.stats.conflict -eq 0) 'Install #2 must have create=0 update=0 conflict=0'

  $rInst3 = Invoke-PsScript $SetupPs1 @('-Target', $projTarget, '-Json')
  Assert-True ($rInst3.ExitCode -eq 0) ("setup.ps1 install #3 failed: " + $rInst3.ExitCode)
  $j3 = $rInst3.Stdout | ConvertFrom-Json
  Assert-True ($j3.stats.create -eq 0 -and $j3.stats.update -eq 0 -and $j3.stats.conflict -eq 0) 'Install #3 must have create=0 update=0 conflict=0'

  $topNames = @(Get-ChildItem -LiteralPath $projTarget -Force | Select-Object -ExpandProperty Name | Sort-Object)
  Assert-True (($topNames -join ',') -eq '.agents,.claude') ("Expected only .agents and .claude at root, got: " + ($topNames -join ','))

  $skillsLinkItem = Get-Item -LiteralPath (Join-Path $projTarget '.agents/skills') -Force
  $isSkillsLink = [bool]($skillsLinkItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or ([string]$skillsLinkItem.LinkType -ne '')
  Assert-True $isSkillsLink '.agents/skills must be an OS ReparsePoint (Junction/symlink)'

  $docScript = Join-Path $projTarget '.agents/scripts/doctor.mjs'
  $rDoc = Invoke-NodeJson $docScript @($projTarget, '--json')
  Assert-True ($rDoc.ExitCode -eq 0) ("Downstream doctor.mjs failed: " + $rDoc.Stdout)
  $docObj = $rDoc.Stdout | ConvertFrom-Json
  Assert-True ([bool]$docObj.ok) 'Downstream doctor.mjs ok must be true'
  Step-Pass 'Tier 1 3x repeated install idempotency, zero root file intrusion, OS link, subagents, and doctor.mjs passed'

  # 5. Tier 2: Empty target automatic cc-base co-installation
  $mockCcSource = Join-Path $TmpBase 'mock-cc-source'
  Seed-CompliantCcBase $mockCcSource -WithInstallers
  if ([System.Environment]::OSVersion.Platform -eq 'Unix') {
    & chmod +x (Join-Path $mockCcSource 'setup.sh')
  }
  $autoTarget = Join-Path $TmpBase 'proj-tier2-auto'
  $rAuto = Invoke-PsScript $SetupPs1 @('-Target', $autoTarget, '-CcBase', $mockCcSource, '-Json')
  Assert-True ($rAuto.ExitCode -eq 0) ("Tier 2 auto-install failed: " + $rAuto.ExitCode)
  $autoObj = $rAuto.Stdout | ConvertFrom-Json
  Assert-True ($autoObj.ccBase.tier -eq 2 -and $autoObj.ccBase.action -eq 'installed') 'Expected Tier 2 tier=2 action=installed'
  Assert-True (-not [bool]$autoObj.pendingCcBase) 'Expected pendingCcBase=false after Tier 2 co-install'
  $autoTopNames = @(Get-ChildItem -LiteralPath $autoTarget -Force | Select-Object -ExpandProperty Name | Sort-Object)
  Assert-True (($autoTopNames -join ',') -eq '.agents,.claude') 'Tier 2 co-install must leave zero root files'
  Step-Pass 'Tier 2 empty target one-step cc-base co-installation passed with zero root files'

  # 6. 3-way conflict protection (.agy-new) + hooks.json custom block preservation + upgrade -Force recovery
  $hooksFile = Join-Path $projTarget '.agents/hooks.json'
  $hooksObj = [System.IO.File]::ReadAllText($hooksFile) | ConvertFrom-Json
  $hooksObj | Add-Member -NotePropertyName 'team-custom-audit' -NotePropertyValue @{ Stop = @(@{ type = 'command'; command = 'node custom.mjs' }) }
  Write-Utf8NoBom $hooksFile (($hooksObj | ConvertTo-Json -Depth 10) + "`n")

  $managedDoc = Join-Path $projTarget '.agents/scripts/doctor.mjs'
  $origDoc = [System.IO.File]::ReadAllText($managedDoc)
  Write-Utf8NoBom $managedDoc ($origDoc + "`n// Local PS1 Edit`n")

  $rUpg = Invoke-PsScript $SetupPs1 @('upgrade', '-Target', $projTarget, '-Json')
  Assert-True ($rUpg.ExitCode -eq 0) ("setup.ps1 upgrade failed: " + $rUpg.ExitCode)
  Assert-True (Test-Path -LiteralPath ($managedDoc + '.agy-new')) 'Expected .agents/scripts/doctor.mjs.agy-new sidecar'
  Assert-True ([System.IO.File]::ReadAllText($managedDoc).Contains('Local PS1 Edit')) 'User edit in doctor.mjs must be preserved'
  $mergedHooksText = [System.IO.File]::ReadAllText($hooksFile)
  Assert-True ($mergedHooksText.Contains('team-custom-audit')) 'User custom block in hooks.json must be preserved'

  Remove-Item -LiteralPath ($managedDoc + '.agy-new') -Force
  $rUpgForce = Invoke-PsScript $SetupPs1 @('upgrade', '-Target', $projTarget, '-Force', '-Json')
  Assert-True ($rUpgForce.ExitCode -eq 0) ("setup.ps1 upgrade -Force failed: " + $rUpgForce.ExitCode)
  Assert-True (-not [System.IO.File]::ReadAllText($managedDoc).Contains('Local PS1 Edit')) 'upgrade -Force must restore framework doctor.mjs'
  Assert-True (Test-Path -LiteralPath ($managedDoc + '.bak')) 'upgrade -Force must write .bak backup'
  Step-Pass '3-way conflict sidecar (.agy-new), hooks.json lossless merge, and upgrade -Force (.bak) passed'

  # 7. Legacy v2 GEMINI.md + physical .agents/skills migration vs user custom GEMINI.md preservation
  $v2Target = Join-Path $TmpBase 'proj-v2-migrate'
  Seed-CompliantCcBase $v2Target
  $v2Sig = [regex]::Unescape('\u672c\u4ed3\u662f cc-base\uff08Claude Code \u4ea7\u54c1\u5f00\u53d1\u6846\u67b6\uff09\u7684 Antigravity')
  Write-Utf8NoBom (Join-Path $v2Target 'GEMINI.md') ("# agy-base v2.2`n`n" + $v2Sig + "`n")
  Write-Utf8NoBom (Join-Path $v2Target '.agents/skills/old-v2-skill/SKILL.md') "# old v2 skill`n"
  $rV2 = Invoke-PsScript $SetupPs1 @($v2Target, '-Json')
  Assert-True ($rV2.ExitCode -eq 0) ("v2 migration install failed: " + $rV2.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $v2Target 'GEMINI.md'))) 'Legacy v2 GEMINI.md must be archived away from root'
  $v2Obj = $rV2.Stdout | ConvertFrom-Json
  Assert-True ($v2Obj.migratedPaths.Count -ge 2) 'Expected both legacy GEMINI.md and physical .agents/skills to be archived'

  $customGemTarget = Join-Path $TmpBase 'proj-user-gemini'
  Seed-CompliantCcBase $customGemTarget
  Write-Utf8NoBom (Join-Path $customGemTarget 'GEMINI.md') "# Custom Team Instructions`nKeep this file intact.`n"
  $rCustomGem = Invoke-PsScript $SetupPs1 @($customGemTarget, '-Json')
  Assert-True ($rCustomGem.ExitCode -eq 0) 'Install with user custom GEMINI.md failed'
  Assert-True ([System.IO.File]::ReadAllText((Join-Path $customGemTarget 'GEMINI.md')).Contains('Custom Team Instructions')) 'User custom GEMINI.md must remain untouched'
  Step-Pass 'Legacy v2 GEMINI.md archival and user custom GEMINI.md preservation passed'

  # 8. Tier 3: -NoAutoCc deferred pre-.claude/ install + SessionStart self-healing
  $preTarget = Join-Path $TmpBase 'proj-tier3-pre'
  $rPre = Invoke-PsScript $SetupPs1 @($preTarget, '-NoAutoCc', '-Json')
  Assert-True ($rPre.ExitCode -eq 0) ("Tier 3 -NoAutoCc install failed: " + $rPre.ExitCode)
  $preObj = $rPre.Stdout | ConvertFrom-Json
  Assert-True ($preObj.ccBase.tier -eq 3 -and $preObj.ccBase.action -eq 'deferred') 'Expected tier=3 action=deferred with -NoAutoCc'
  Assert-True ([bool]$preObj.pendingCcBase) 'Expected pendingCcBase=true when -NoAutoCc is passed on empty target'
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $preTarget '.agents/skills'))) '.agents/skills link must not exist before .claude/'

  Seed-CompliantCcBase $preTarget
  $adapterScript = Join-Path $preTarget '.agents/scripts/hook-adapter.mjs'
  $evJson = ('{"cwd":"' + $preTarget.Replace('\', '\\') + '"}')
  $rSs = Invoke-NodeJson $adapterScript @('SessionStart') $evJson
  Assert-True ($rSs.ExitCode -eq 0) 'SessionStart after .claude/ arrival must exit 0'
  $healedSkills = Get-Item -LiteralPath (Join-Path $preTarget '.agents/skills') -Force
  $isHealedLink = [bool]($healedSkills.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or ([string]$healedSkills.LinkType -ne '')
  Assert-True $isHealedLink 'SessionStart must self-heal .agents/skills ReparsePoint'
  Assert-True (Test-Path -LiteralPath (Join-Path $preTarget '.agents/agents/implementer.md')) 'SessionStart must self-heal generated .agents/agents/*.md'
  Step-Pass 'Tier 3 -NoAutoCc install and SessionStart automatic link & subagent self-healing passed'

  # 9. Uninstall detaches OS links, strips only cc-base-* hooks, and leaves .claude/ 100% byte-for-byte untouched
  $rUn = Invoke-PsScript $SetupPs1 @('-Uninstall', '-Target', $projTarget, '-Force', '-Json')
  Assert-True ($rUn.ExitCode -eq 0) ("setup.ps1 -Uninstall -Force failed: " + $rUn.ExitCode)
  Assert-True (-not (Test-Path -LiteralPath (Join-Path $projTarget '.agents/skills'))) '.agents/skills link must be detached on uninstall'
  Assert-True ([System.IO.File]::ReadAllText($hooksFile).Contains('team-custom-audit')) 'Uninstall must keep user custom hook blocks in hooks.json'

  $snapClaudeAfter = Get-TreeHashSnapshot (Join-Path $projTarget '.claude')
  Assert-SnapshotsEqual $snapClaudeBefore $snapClaudeAfter '.claude/ tree after -Uninstall -Force'
  Step-Pass 'setup.ps1 -Uninstall -Force detached OS links while preserving .claude/ byte-for-byte'

  Write-Host ("1..{0} ALL PASSED" -f $PassCount)
  exit 0
}
finally {
  if (Test-Path -LiteralPath $TmpBase) {
    Remove-Item -LiteralPath $TmpBase -Recurse -Force -ErrorAction SilentlyContinue
  }
}
