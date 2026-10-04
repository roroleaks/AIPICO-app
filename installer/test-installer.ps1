# AI PICO - Installer Test: simulates exactly what Inno Setup does
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppDir  = "$env:LOCALAPPDATA\AIPICO"
$Port    = 3456
$ServerUrl = "http://localhost:$Port"
$ScriptDir = $PSScriptRoot

$script:pass = 0; $script:fail = 0
function Check([string]$name, [bool]$ok, [string]$extra = "") {
  $icon = if ($ok) { "PASS" } else { "FAIL" }
  Write-Output "$icon | $name $(if($extra){"| $extra"})"
  if ($ok) { $script:pass++ } else { $script:fail++ }
}

Write-Output "=== AI PICO Installer Test ==="

Write-Output "[0] Pre-clean (fresh install)"
if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force }
$conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($conns) { $conns | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }
Start-Sleep 2
Check "Pre-clean: app dir removed" (-not (Test-Path $AppDir))

Write-Output "[1] Simulating Inno [Files] copy to {app}..."
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null
Copy-Item "$ScriptDir\app-source.zip" $AppDir -Force
Copy-Item "$ScriptDir\install-app.ps1" $AppDir -Force
Copy-Item "$ScriptDir\launch-aipico.ps1" $AppDir -Force
Check "Files copied to {app}" ((Test-Path "$AppDir\app-source.zip") -and (Test-Path "$AppDir\install-app.ps1"))

Write-Output "[1b] Verifying the bundle is not stale..."
$stale = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\build-app-source.ps1" -Check 2>&1
$staleExit = $LASTEXITCODE
$stale | ForEach-Object { Write-Output "  bundle: $_" }
Check "app-source.zip matches the repository" ($staleExit -eq 0) "exit=$staleExit"

Write-Output "[2] Running install-app.ps1 (npm install + build, may take minutes)..."
$sw = [System.Diagnostics.Stopwatch]::StartNew()
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$AppDir\install-app.ps1" 2>&1 | ForEach-Object { Write-Output "  install: $_" }
$exitCode = $LASTEXITCODE
$sw.Stop()
Check "install-app.ps1 completed" ($exitCode -eq 0) "exit=$exitCode time=$([math]::Round($sw.Elapsed.TotalSeconds))s"

Write-Output "[3] Verifying installed files..."
Check "package.json exists" (Test-Path "$AppDir\package.json")
Check "src folder exists" (Test-Path "$AppDir\src\app\page.tsx")
Check "photo exists" (Test-Path "$AppDir\public\dr-raouf.jpg")
Check "build output exists" (Test-Path "$AppDir\.next")
Check "node_modules exists" (Test-Path "$AppDir\node_modules")
Check "launcher script preserved" (Test-Path "$AppDir\launch-aipico.ps1")

Write-Output "[4] Starting server..."
$running = $false
try { $c = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue; if ($c) { $running = $true } } catch {}
if (-not $running) {
  $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
  $npm = Join-Path (Split-Path $nodeCmd.Source) "npm.cmd"
  Start-Process -FilePath $npm -ArgumentList "run","start","--","-p","$Port" -WorkingDirectory $AppDir -WindowStyle Hidden
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep 2
    try { $r = Invoke-WebRequest -Uri $ServerUrl -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $running = $true; break } } catch {}
  }
}
Check "Server starts on port $Port" $running

Write-Output "[5] Testing local pages..."
foreach ($route in @("/", "/gap", "/question", "/paper")) {
  try {
    $r = Invoke-WebRequest -Uri "$ServerUrl$route" -UseBasicParsing -TimeoutSec 15
    Check "Local page $route" ($r.StatusCode -eq 200)
  } catch {
    Check "Local page $route" $false $_.Exception.Message
  }
}

Write-Output "[6] Testing local API..."
try {
  $body = '{"stage":"intent","input":"ohss pcos ivf"}'
  $r = Invoke-WebRequest -Uri "$ServerUrl/api/engine" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60
  $data = $r.Content | ConvertFrom-Json
  Check "Local API intent works" ($data.specialty -eq "infertility") "source=$($data.source)"
} catch {
  Check "Local API intent works" $false $_.Exception.Message
}

try {
  $r = Invoke-WebRequest -Uri "$ServerUrl/dr-raouf.jpg" -UseBasicParsing -TimeoutSec 10
  Check "Photo serves" ($r.StatusCode -eq 200)
} catch {
  Check "Photo serves" $false
}

Write-Output ""
Write-Output "=== RESULT: $pass passed, $fail failed ==="
if ($fail -eq 0) { Write-Output ">>> INSTALLER VERIFIED: WILL NOT GET STUCK <<<" }
