# Prefer GitHub Actions (push main) for the website. This script is an emergency/local fallback.
[CmdletBinding()]
param(
  [string]$ServerIp = '',
  [string]$User = '',
  [string]$SshKey = '',
  [switch]$SyncCaddy,
  [switch]$DeployEdgeFunctions,
  [switch]$SkipWeb,
  [switch]$SkipBuild,
  [string]$ProjectRef = ''
)
$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
. (Join-Path $ScriptDir '_load-deploy-env.ps1')
$deployEnv = Get-DeployEnv -ScriptRoot $ScriptDir
if (-not $ServerIp) { $ServerIp = $deployEnv.VultrServerIp }
if (-not $User) { $User = $deployEnv.VultrSshUser }
if (-not $SshKey) { $SshKey = $deployEnv.VultrSshKey }
if (-not $ProjectRef) { $ProjectRef = $deployEnv.SupabaseProjectRef }
if (-not $User) { $User = 'deploy' }
if (-not $SkipWeb) {
  if (-not $ServerIp) {
    throw @'
Server IP required. Either:
  - .\deploy\vultr\publish-live.ps1 -ServerIp <VULTR_IPV4>
  - Create deploy/vultr/deploy.local.env and set VULTR_SERVER_IP
Use the Vultr instance IPv4 (Cloudflare orange-cloud DNS does not show it in nslookup).
'@
  }
  $deployArgs = @{
    ServerIp = $ServerIp
    User     = $User
  }
  if ($SshKey) { $deployArgs.SshKey = $SshKey }
  if ($SkipBuild) { $deployArgs.SkipBuild = $true }
  & (Join-Path $ScriptDir 'deploy.ps1') @deployArgs
  if ($LASTEXITCODE -ne 0) { throw 'Web deploy failed.' }
}
if ($SyncCaddy) {
  if (-not $ServerIp) { throw '-SyncCaddy requires -ServerIp (or deploy.local.env).' }
  $caddyArgs = @{ ServerIp = $ServerIp; User = $User }
  if ($SshKey) { $caddyArgs.SshKey = $SshKey }
  & (Join-Path $ScriptDir 'sync-caddy.ps1') @caddyArgs
  if ($LASTEXITCODE -ne 0) { throw 'Caddy sync failed.' }
}
if ($DeployEdgeFunctions) {
  & (Join-Path $ScriptDir 'deploy-supabase-functions.ps1') -ProjectRef $ProjectRef
  if ($LASTEXITCODE -ne 0) { throw 'Edge function deploy failed.' }
}
Write-Host ''
Write-Host '==> Live publish step finished.' -ForegroundColor Green
Write-Host '    Site: https://optionmarkettraders.com'
Write-Host '    Host DB is current through 20261005190000 — new SQL only via forward migrations (deploy/supabase/README.md).'
if (-not $DeployEdgeFunctions) {
  Write-Host '    Tip: re-run with -DeployEdgeFunctions after `npx supabase login`.'
}
