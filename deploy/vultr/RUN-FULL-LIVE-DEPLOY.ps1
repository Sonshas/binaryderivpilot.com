[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipEdge,
  [switch]$SyncCaddy
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
foreach ($tool in 'npm', 'ssh', 'scp', 'npx') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "'$tool' not on PATH. Install Node.js 22+ (includes npm/npx) and Windows OpenSSH Client."
  }
}
. (Join-Path $PSScriptRoot '_load-deploy-env.ps1')
$cfg = Get-DeployEnv -ScriptRoot $PSScriptRoot
Write-Host '==> Step 1/2: Vultr web + Supabase Edge' -ForegroundColor Cyan
$pubArgs = @{ SkipWeb = $false }
if ($SkipBuild) { $pubArgs.SkipBuild = $true }
if (-not $SkipEdge) { $pubArgs.DeployEdgeFunctions = $true }
if ($SyncCaddy) { $pubArgs.SyncCaddy = $true }
& (Join-Path $PSScriptRoot 'publish-live.ps1') @pubArgs
Write-Host ''
Write-Host '==> Step 2/2: Verify' -ForegroundColor Cyan
Write-Host '  https://optionmarkettraders.com — hard refresh'
Write-Host '  Admin → Fees, REAL trading smoke test as needed.'
