[CmdletBinding()]
param(
  [string]$ProjectRef = '',
  [string[]]$Only = @()
)
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$FunctionsDir = Join-Path $RepoRoot 'supabase\functions'
. (Join-Path $PSScriptRoot '_load-deploy-env.ps1')
if (-not $ProjectRef) {
  $ProjectRef = (Get-DeployEnv -ScriptRoot $PSScriptRoot).SupabaseProjectRef
}
if (-not $ProjectRef) {
  throw 'SUPABASE_PROJECT_REF required. Set it in deploy/vultr/deploy.local.env or pass -ProjectRef.'
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw 'npx not found. Install Node.js 22+ from https://nodejs.org and run npm install in the repo root.'
}
$all = @(
  'admin-dashboard',
  'admin-fees',
  'admin-panel',
  'admin-trade-settings',
  'admin-users',
  'admin-withdrawals',
  'platform-settings',
  'megapay-deposit',
  'megapay-status',
  'megapay-webhook',
  'mpesa-b2c-result',
  'mpesa-callback',
  'mpesa-deposit',
  'mpesa-status',
  'mpesa-withdraw',
  'mpesa-withdraw-dispatch',
  'real-trade',
  'real-trade-settle',
  'real-wallet',
  'scanner-stk',
  'system-issues'
)
$toDeploy = if ($Only.Count -gt 0) { $Only } else { $all }
# real-trade / real-wallet / admin-* verify the user JWT in-function (with timeout +
# payload decode). Gateway verify_jwt hangs when Auth/JWKS is degraded and pauses
# trading or leaves /admin on an endless skeleton.
$noJwt = @(
  'mpesa-callback',
  'mpesa-status',
  'megapay-webhook',
  'mpesa-b2c-result',
  'real-trade-settle',
  'real-trade',
  'real-wallet',
  'admin-dashboard',
  'admin-users',
  'admin-panel',
  'admin-fees',
  'admin-trade-settings',
  'admin-withdrawals',
  'platform-settings',
  'system-issues'
)
foreach ($name in $toDeploy) {
  $path = Join-Path $FunctionsDir $name
  if (-not (Test-Path (Join-Path $path 'index.ts'))) {
    throw "Function folder missing: $path"
  }
}
Push-Location $RepoRoot
try {
  foreach ($name in $toDeploy) {
    $extra = if ($noJwt -contains $name) { ' --no-verify-jwt' } else { '' }
    Write-Host "==> Deploying $name$extra" -ForegroundColor Cyan
    $out = cmd /c "npx supabase functions deploy $name --project-ref $ProjectRef --use-api --yes$extra 2>&1"
    $text = ($out | Out-String)
    if ($LASTEXITCODE -ne 0 -or $text -notmatch 'Deployed Functions') {
      Write-Host $text
      throw "Deploy failed for $name (exit $LASTEXITCODE)."
    }
    Write-Host "    OK $name" -ForegroundColor Green
  }
  Write-Host '==> All requested Edge Functions deployed.' -ForegroundColor Green
} finally {
  Pop-Location
}
