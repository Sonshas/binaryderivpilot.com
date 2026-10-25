# Emergency / local fallback only. Routine deploys: push to main → GitHub Actions (deploy-web.yml).
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerIp,
  [string]$User = 'deploy',
  [string]$SshKey = '',
  [ValidateRange(1, 50)]
  [int]$KeepReleases = 5,
  [switch]$ReloadCaddy,
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$SiteRoot = '/var/www/binaryderivpilot'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WebDir = Join-Path $RepoRoot 'apps\web'
$DistDir = Join-Path $WebDir 'dist'
$Release = Get-Date -Format 'yyyyMMdd-HHmmss'
function Assert-LastExit([string]$Step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Step failed (exit code $LASTEXITCODE)."
  }
}
foreach ($tool in 'npm', 'ssh', 'scp') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "'$tool' was not found on PATH. Install Node.js 22+ and the Windows OpenSSH Client."
  }
}
$sshOpts = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15')
if ($SshKey) {
  $sshOpts += @('-i', $SshKey)
}
$sshTarget = "$User@$ServerIp"
if ($ServerIp.Contains(':')) {
  $scpHost = "$User@[$ServerIp]"
} else {
  $scpHost = $sshTarget
}
if (-not $SkipBuild) {
  Write-Host '==> Building apps/web (production)' -ForegroundColor Cyan
  # Single root .env; vite.config forces VITE_E2E_AUTH_BYPASS=false in production mode.
  $env:VITE_E2E_AUTH_BYPASS = 'false'
  Push-Location $WebDir
  try {
    npm run build
    Assert-LastExit 'npm run build'
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path (Join-Path $DistDir 'index.html'))) {
  throw "Build output not found at $DistDir."
}
Write-Host '==> Verifying the auth bypass is not in the bundle' -ForegroundColor Cyan
$distFiles = Get-ChildItem $DistDir -Recurse -File -Include *.js, *.html
if ($distFiles | Select-String -SimpleMatch -Pattern 'E2E auth bypass', 'VITE_E2E_AUTH_BYPASS:`true`' -List) {
  throw 'The production bundle still contains the E2E auth bypass. Aborting deploy.'
}
Write-Host "==> Uploading dist to $sshTarget`:$SiteRoot/releases/$Release" -ForegroundColor Cyan
scp @sshOpts -r $DistDir "${scpHost}:$SiteRoot/releases/$Release"
Assert-LastExit 'scp upload'
Write-Host '==> Activating release' -ForegroundColor Cyan
$activateLocal = Join-Path $PSScriptRoot 'activate-release.sh'
scp @sshOpts $activateLocal "${scpHost}:/tmp/activate-release.sh"
Assert-LastExit 'scp activate-release.sh'
$remote = "bash /tmp/activate-release.sh '$SiteRoot' '$Release' '$KeepReleases'"
if ($ReloadCaddy) {
  $remote += '; sudo -n /usr/bin/systemctl reload caddy'
}
ssh @sshOpts $sshTarget $remote
Assert-LastExit 'Remote activation'
Write-Host "==> Deployed release $Release. Open https://binaryderivpilot.com" -ForegroundColor Green
