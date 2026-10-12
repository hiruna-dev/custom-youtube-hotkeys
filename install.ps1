param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$manifestPath = Join-Path $projectRoot 'extension\manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$publicKey = [Convert]::FromBase64String($manifest.key)
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = $sha.ComputeHash($publicKey) } finally { $sha.Dispose() }
$letters = 'abcdefghijklmnop'
$extensionId = -join (0..15 | ForEach-Object { $b = [int]$hash[$_]; [string]$letters[$b -shr 4] + [string]$letters[$b -band 15] })
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.custom.youtube_hotkeys'
$oldRegistryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ren.youtube_hotkeys'
if ($Uninstall) {
  if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
  if (Test-Path -LiteralPath $oldRegistryPath) { Remove-Item -LiteralPath $oldRegistryPath }
  Write-Host 'Native messaging registration removed.'
  exit 0
}
$publishPath = Join-Path $projectRoot 'host\publish'
$exe = Join-Path $publishPath 'YouTubeHotkeyHost.exe'
# Chrome can keep the previous helper running and lock its published DLL during an update.
Get-Process -Name 'YouTubeHotkeyHost' -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -eq $exe } |
  Stop-Process -Force
$emptyFeed = Join-Path $projectRoot 'host\empty-feed'
New-Item -ItemType Directory -Path $emptyFeed -Force | Out-Null
dotnet restore (Join-Path $projectRoot 'host\YouTubeHotkeyHost.csproj') --source $emptyFeed
if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
dotnet publish (Join-Path $projectRoot 'host\YouTubeHotkeyHost.csproj') -c Release --no-restore -o $publishPath
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
if (!(Test-Path -LiteralPath $exe)) { throw 'Helper executable was not built.' }
$hostManifestPath = Join-Path $publishPath 'native-host.json'
$hostManifest = [ordered]@{
  name = 'com.custom.youtube_hotkeys'
  description = 'Custom YouTube Hotkeys Windows helper'
  path = $exe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
}
[IO.File]::WriteAllText($hostManifestPath, ($hostManifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $hostManifestPath
if (Test-Path -LiteralPath $oldRegistryPath) { Remove-Item -LiteralPath $oldRegistryPath }
Write-Host "Helper installed for Chrome extension ID: $extensionId"
Write-Host 'Now load the extension folder in chrome://extensions with Developer mode > Load unpacked.'
Write-Host "Folder: $(Join-Path $projectRoot 'extension')"
