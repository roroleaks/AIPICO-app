# AI PICO - post-install: extract app, install deps, build
$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppDir  = "$env:LOCALAPPDATA\AIPICO"
$LogFile = "$AppDir\install.log"
if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }

function Log($m) { try { "$(Get-Date -Format 'HH:mm:ss') | $m" | Out-File $LogFile -Append -Encoding utf8 } catch {} }
Log "===== AI PICO install started ====="

function Find-Node {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

try {
  # 1. Node.js check/install
  $node = Find-Node
  if (-not $node) {
    Log "Node.js not found - installing..."
    $installer = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $installer -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$installer`" /qn" -Wait
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
    $node = Find-Node
    if (-not $node) { throw "Node.js installation failed" }
  }
  Log "Node: $node"
  $nodeDir = Split-Path $node
  $npm = Join-Path $nodeDir "npm.cmd"

  # 2. Extract bundled app source (DO NOT wipe {app} - it holds the
  #    Inno-deployed launcher scripts and the uninstaller)
  $zip = Join-Path $PSScriptRoot "app-source.zip"
  if (-not (Test-Path $zip)) { throw "app-source.zip not found next to installer" }

  $tmp = "$env:TEMP\aipico-extract"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $wrapper = Get-ChildItem $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName "package.json") } | Select-Object -First 1
  if ($wrapper) {
    Copy-Item "$($wrapper.FullName)\*" $AppDir -Recurse -Force
  } else {
    Copy-Item "$tmp\*" $AppDir -Recurse -Force
  }
  # keep launcher scripts fresh (Inno also deploys them; this is a safety net)
  $src1 = Join-Path $PSScriptRoot "launch-aipico.ps1"
  $dest1 = "$AppDir\launch-aipico.ps1"
  if ((Test-Path $src1) -and ((Get-Item $src1).FullName -ne (Get-Item $dest1 -ErrorAction SilentlyContinue).FullName)) {
    Copy-Item $src1 $dest1 -Force
  }
  $src2 = Join-Path $PSScriptRoot "launch-aipico.vbs"
  $dest2 = "$AppDir\launch-aipico.vbs"
  if ((Test-Path $src2) -and ((Get-Item $src2).FullName -ne (Get-Item $dest2 -ErrorAction SilentlyContinue).FullName)) {
    Copy-Item $src2 $dest2 -Force
  }
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Log "App extracted to $AppDir"

  # 3. Dependencies
  Set-Location $AppDir
  $npmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
  if (-not (Test-Path $npmCli)) { throw "npm-cli.js not found at $npmCli" }

  Log "Running npm install..."
  $outLog = "$env:TEMP\npm-install.log"
  $errLog = "$env:TEMP\npm-install-err.log"
  $proc = Start-Process -FilePath $node -ArgumentList "`"$npmCli`"","install","--no-audit","--no-fund" -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  if (-not $proc.WaitForExit(600000)) { $proc.Kill(); throw "npm install timed out after 10 minutes" }
  Log "npm install exit: $($proc.ExitCode)"
  if (-not (Test-Path "$AppDir\node_modules")) {
    $errText = if (Test-Path $errLog) { Get-Content $errLog -Tail 12 | Out-String } else { "" }
    $outText = if (Test-Path $outLog) { Get-Content $outLog -Tail 12 | Out-String } else { "" }
    Log "npm install failed. ERR: $errText OUT: $outText"
    throw "npm install failed - see log"
  }
  Log "Dependencies installed"

  # 4. Build
  Log "Running production build..."
  $outLog2 = "$env:TEMP\npm-build.log"
  $errLog2 = "$env:TEMP\npm-build-err.log"
  $proc = Start-Process -FilePath $node -ArgumentList "`"$npmCli`"","run","build" -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog2 -RedirectStandardError $errLog2
  if (-not $proc.WaitForExit(300000)) { $proc.Kill(); throw "Build timed out after 5 minutes" }
  Log "build exit: $($proc.ExitCode)"
  if (-not (Test-Path "$AppDir\.next")) {
    $errText = if (Test-Path $errLog2) { Get-Content $errLog2 -Tail 20 | Out-String } else { "(empty)" }
    $outText = if (Test-Path $outLog2) { Get-Content $outLog2 -Tail 20 | Out-String } else { "(empty)" }
    Log "BUILD FAILED. ERR: $errText OUT: $outText"
    throw "Build failed - see log"
  }
  Log "Build completed"

  Log "===== install OK ====="
  exit 0
} catch {
  Log "ERROR: $($_.Exception.Message)"
  [System.Windows.Forms.MessageBox]::Show("AI PICO installation problem:`n$($_.Exception.Message)`n`nFull log: $LogFile", "AI PICO Setup") | Out-Null
  exit 1
}
