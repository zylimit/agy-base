#!/usr/bin/env pwsh
# setup.ps1 - agy-base v3.0.0 Windows PowerShell thin wrapper (PowerShell 5.1+ / pwsh 7+).
# Pure 7-bit ASCII UTF-8 without BOM. Validates node >= 20 and forwards to scripts/agy-base.mjs.
# Examples:
#   pwsh -File .\setup.ps1 D:\proj
#   pwsh -File .\setup.ps1 -Target D:\proj -DryRun
#   pwsh -File .\setup.ps1 upgrade -Target D:\proj -WithCc
#   pwsh -File .\setup.ps1 -Target D:\proj -NoAutoCc
#   pwsh -File .\setup.ps1 -Uninstall -Target D:\proj
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = '',
  [string]$Target = '',
  [switch]$DryRun,
  [switch]$Force,
  [switch]$Uninstall,
  [switch]$SourceCheck,
  [switch]$WithCc,
  [switch]$NoAutoCc,
  [string]$CcBase = '',
  [string]$BundleCc = '',
  [string]$Out = '',
  [switch]$Json,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ExtraArgs = @()
)

$ErrorActionPreference = 'Stop'

function Exit-Usage([string]$Message) {
  [Console]::Error.WriteLine("setup: $Message")
  [Console]::Error.WriteLine('Usage: pwsh -File .\setup.ps1 [install|upgrade|uninstall|doctor] [-Target <dir> | <dir>] [-DryRun] [-Force] [-Uninstall] [-WithCc] [-NoAutoCc] [-CcBase <dir>] [-BundleCc <dir>] [-Json]')
  exit 2
}

$KnownCommands = @('install', 'upgrade', 'uninstall', 'doctor', 'manifest', 'pack-check', 'release', 'help')
$COMMON_TYPO_SUBCOMMANDS = @(
  'package', 'pack', 'bundle', 'check', 'verify', 'test', 'tests',
  'lint', 'audit', 'status', 'init', 'update', 'remove', 'clean', 'version'
)
$AllowedForwardFlags = @(
  '--dry-run', '--force', '--uninstall', '--source-check',
  '--with-cc', '--no-auto-cc',
  '--write', '--check', '--leak', '--print', '--json', '--strict-syntax', '-h', '--help'
)

$forwardArgs = New-Object System.Collections.Generic.List[string]
$resolvedCmd = ''
$resolvedTarget = $Target

if ($Command -ne '') {
  if ($KnownCommands -contains $Command) {
    $resolvedCmd = $Command
  }
  elseif ($Command.StartsWith('-')) {
    $ExtraArgs = @($Command) + $ExtraArgs
  }
  else {
    if ($Target -eq '' -and ($Command -cmatch '^[a-z]+$') -and ($COMMON_TYPO_SUBCOMMANDS -contains $Command)) {
      Exit-Usage "unknown subcommand '$Command' (to install into a directory named '$Command', pass -Target ./$Command)"
    }
    if ($resolvedTarget -ne '') {
      Exit-Usage "both positional target ($Command) and -Target ($resolvedTarget) were specified; pass only one"
    }
    $resolvedTarget = $Command
  }
}

for ($i = 0; $i -lt $ExtraArgs.Count; $i++) {
  $arg = $ExtraArgs[$i]
  if ($AllowedForwardFlags -contains $arg) {
    [void]$forwardArgs.Add($arg)
    continue
  }
  if ($arg -eq '--target' -or $arg -eq '--cc-base' -or $arg -eq '--bundle-cc' -or $arg -eq '--out') {
    if (($i + 1) -ge $ExtraArgs.Count -or $ExtraArgs[$i + 1].StartsWith('-')) {
      Exit-Usage "option $arg requires a value"
    }
    $val = $ExtraArgs[$i + 1]
    $i++
    if ($arg -eq '--target') {
      if ($resolvedTarget -ne '') { Exit-Usage "duplicate target specified ($resolvedTarget vs $val)" }
      $resolvedTarget = $val
    }
    elseif ($arg -eq '--cc-base') {
      if ($CcBase -ne '') { Exit-Usage "duplicate --cc-base specified ($CcBase vs $val)" }
      $CcBase = $val
    }
    elseif ($arg -eq '--bundle-cc') {
      if ($BundleCc -ne '') { Exit-Usage "duplicate --bundle-cc specified ($BundleCc vs $val)" }
      $BundleCc = $val
    }
    else {
      if ($Out -ne '') { Exit-Usage "duplicate --out specified ($Out vs $val)" }
      $Out = $val
    }
    continue
  }
  if ($arg.StartsWith('--target=')) {
    $val = $arg.Substring(9)
    if (-not $val) { Exit-Usage '--target= requires a non-empty value' }
    if ($resolvedTarget -ne '') { Exit-Usage "duplicate target specified ($resolvedTarget vs $val)" }
    $resolvedTarget = $val
    continue
  }
  if ($arg.StartsWith('--cc-base=')) {
    $val = $arg.Substring(10)
    if (-not $val) { Exit-Usage '--cc-base= requires a non-empty value' }
    if ($CcBase -ne '') { Exit-Usage "duplicate --cc-base specified ($CcBase vs $val)" }
    $CcBase = $val
    continue
  }
  if ($arg.StartsWith('--bundle-cc=')) {
    $val = $arg.Substring(12)
    if (-not $val) { Exit-Usage '--bundle-cc= requires a non-empty value' }
    if ($BundleCc -ne '') { Exit-Usage "duplicate --bundle-cc specified ($BundleCc vs $val)" }
    $BundleCc = $val
    continue
  }
  if ($arg.StartsWith('--out=')) {
    $val = $arg.Substring(6)
    if (-not $val) { Exit-Usage '--out= requires a non-empty value' }
    if ($Out -ne '') { Exit-Usage "duplicate --out specified ($Out vs $val)" }
    $Out = $val
    continue
  }
  if ($arg.StartsWith('-')) {
    Exit-Usage "unknown option: $arg"
  }
  if ($resolvedCmd -eq '' -and ($KnownCommands -contains $arg)) {
    $resolvedCmd = $arg
    continue
  }
  if ($resolvedCmd -eq 'release') {
    [void]$forwardArgs.Add($arg)
    continue
  }
  if ($resolvedTarget -eq '') {
    if ($resolvedCmd -eq '' -and $Target -eq '' -and ($arg -cmatch '^[a-z]+$') -and ($COMMON_TYPO_SUBCOMMANDS -contains $arg)) {
      Exit-Usage "unknown subcommand '$arg' (to install into a directory named '$arg', pass -Target ./$arg)"
    }
    $resolvedTarget = $arg
  }
  else {
    Exit-Usage "unexpected extra positional argument: $arg"
  }
}

if ($Uninstall) {
  if ($resolvedCmd -ne '' -and $resolvedCmd -ne 'install' -and $resolvedCmd -ne 'uninstall') {
    Exit-Usage "-Uninstall cannot be combined with subcommand '$resolvedCmd'"
  }
  $resolvedCmd = 'uninstall'
}
if ($resolvedCmd -eq '') {
  $resolvedCmd = 'install'
}

if ($WithCc -and $NoAutoCc) {
  Exit-Usage '-WithCc and -NoAutoCc cannot be used together'
}
if ($CcBase -ne '' -and $NoAutoCc) {
  Exit-Usage '-CcBase and -NoAutoCc cannot be used together'
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  [Console]::Error.WriteLine('[setup] missing required runtime: node (>= 20)')
  exit 3
}

$majorStr = (& node -p "process.versions.node.split('.')[0]" 2>$null | Out-String).Trim()
$majorInt = 0
if (-not [int]::TryParse($majorStr, [ref]$majorInt) -or $majorInt -lt 20) {
  $verStr = (& node --version 2>$null | Out-String).Trim()
  [Console]::Error.WriteLine("[setup] node >= 20 required (found: $verStr)")
  exit 3
}

$cliArgs = New-Object System.Collections.Generic.List[string]
[void]$cliArgs.Add($resolvedCmd)

if ($resolvedTarget -ne '') {
  [void]$cliArgs.Add('--target')
  [void]$cliArgs.Add($resolvedTarget)
}
if ($DryRun -and -not ($forwardArgs -contains '--dry-run')) { [void]$cliArgs.Add('--dry-run') }
if ($Force -and -not ($forwardArgs -contains '--force')) { [void]$cliArgs.Add('--force') }
if ($SourceCheck -and -not ($forwardArgs -contains '--source-check')) { [void]$cliArgs.Add('--source-check') }
if ($WithCc -and -not ($forwardArgs -contains '--with-cc')) { [void]$cliArgs.Add('--with-cc') }
if ($NoAutoCc -and -not ($forwardArgs -contains '--no-auto-cc')) { [void]$cliArgs.Add('--no-auto-cc') }
if ($Json -and -not ($forwardArgs -contains '--json')) { [void]$cliArgs.Add('--json') }
if ($CcBase -ne '') {
  [void]$cliArgs.Add('--cc-base')
  [void]$cliArgs.Add($CcBase)
}
if ($BundleCc -ne '') {
  [void]$cliArgs.Add('--bundle-cc')
  [void]$cliArgs.Add($BundleCc)
}
if ($Out -ne '') {
  [void]$cliArgs.Add('--out')
  [void]$cliArgs.Add($Out)
}
foreach ($fa in $forwardArgs) {
  [void]$cliArgs.Add($fa)
}

$entryScript = Join-Path $PSScriptRoot 'scripts\agy-base.mjs'
& node $entryScript @cliArgs
exit $LASTEXITCODE
