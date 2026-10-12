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
$hostRoot = Join-Path $projectRoot 'host'
$sourceFiles = @((Join-Path $hostRoot 'Program.cs'), (Join-Path $hostRoot 'YouTubeHotkeyHost.csproj'))
$sourceText = [IO.File]::ReadAllText($sourceFiles[0]) + [IO.File]::ReadAllText($sourceFiles[1])
$sourceHash = [Security.Cryptography.SHA256]::Create()
try { $sourceDigest = $sourceHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($sourceText)) }
finally { $sourceHash.Dispose() }
$buildHash = [BitConverter]::ToString($sourceDigest).Replace('-', '').Substring(0, 12).ToLowerInvariant()
$publishPath = Join-Path $hostRoot "publish-$buildHash"
$exe = Join-Path $publishPath 'YouTubeHotkeyHost.exe'
$emptyFeed = Join-Path $projectRoot 'host\empty-feed'
New-Item -ItemType Directory -Path $emptyFeed -Force | Out-Null
dotnet restore (Join-Path $projectRoot 'host\YouTubeHotkeyHost.csproj') --source $emptyFeed
if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
dotnet publish (Join-Path $projectRoot 'host\YouTubeHotkeyHost.csproj') -c Release --no-restore -o $publishPath
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
if (!(Test-Path -LiteralPath $exe)) { throw 'Helper executable was not built.' }
# Keep the registered manifest path stable while publishing to a versioned
# directory. Windows can keep an older helper DLL locked until Chrome exits.
$hostManifestPath = Join-Path $hostRoot 'publish\native-host.json'
New-Item -ItemType Directory -Path (Split-Path $hostManifestPath) -Force | Out-Null
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
