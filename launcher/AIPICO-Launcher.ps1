# AI PICO Launcher - Clinical Question Assistant
# (c) Dr Raouf Roshdy 2026 - All rights reserved
[CmdletBinding()]
param(
  [switch]$ConfigureKey
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppDir = "$env:LOCALAPPDATA\AIPICO"
$Repo = "https://github.com/roroleaks/clinical-question-assistant.git"
$ServerUrl = "http://localhost:3456"
$DisclaimerFile = "$AppDir\.disclaimer-accepted"

function Write-Step($msg) { Write-Host "`n[$([char]0x25B6)] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }

function Show-Banner {
  Clear-Host
  Write-Host ""
  Write-Host "  ==================================================" -ForegroundColor Cyan
  Write-Host "                                                    " -ForegroundColor Cyan
  Write-Host "      A I   P I C O                                " -ForegroundColor White
  Write-Host "      Clinical Question Assistant                   " -ForegroundColor White
  Write-Host "                                                    " -ForegroundColor Cyan
  Write-Host "      Created by Dr Raouf Roshdy                    " -ForegroundColor Yellow
  Write-Host "      (c) 2026 - All rights reserved                " -ForegroundColor Gray
  Write-Host "                                                    " -ForegroundColor Cyan
  Write-Host "  ==================================================" -ForegroundColor Cyan
}

function Show-Disclaimer {
  Clear-Host
  Write-Host ""
  Write-Host "  ==================================================" -ForegroundColor Yellow
  Write-Host "               IMPORTANT DISCLAIMER                 " -ForegroundColor Yellow
  Write-Host "  ==================================================" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  This software is provided for EDUCATIONAL and" -ForegroundColor White
  Write-Host "  ACADEMIC RESEARCH purposes only." -ForegroundColor White
  Write-Host ""
  Write-Host "  1. NOT a medical device. NOT certified for" -ForegroundColor Gray
  Write-Host "     clinical use or patient care decisions." -ForegroundColor Gray
  Write-Host "  2. AI-generated content may contain errors," -ForegroundColor Gray
  Write-Host "     omissions, or outdated information." -ForegroundColor Gray
  Write-Host "  3. Always verify formulated questions," -ForegroundColor Gray
  Write-Host "     references, and evidence against original" -ForegroundColor Gray
  Write-Host "     sources before any professional use." -ForegroundColor Gray
  Write-Host "  4. No patient data should be entered into" -ForegroundColor Gray
  Write-Host "     this application." -ForegroundColor Gray
  Write-Host "  5. Provided 'as is' without warranty of any" -ForegroundColor Gray
  Write-Host "     kind. The author accepts no liability for" -ForegroundColor Gray
  Write-Host "     any use of this software." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Creator: Dr Raouf Roshdy (c) 2026" -ForegroundColor Yellow
  Write-Host ""
  $answer = Read-Host "  Do you accept these terms? (Y/N)"
  if ($answer -notmatch "^[Yy]") {
    Write-Host "`n  Installation cancelled. The application requires accepting the disclaimer." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 0
  }
  if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }
  "Accepted $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-File $DisclaimerFile -Encoding utf8
}

Show-Banner

# First run: disclaimer
if (-not (Test-Path $DisclaimerFile)) {
  Show-Disclaimer
  Show-Banner
  Write-Host ""
  Write-Host "  Thank you. Starting first-time installation..." -ForegroundColor Green
}

# Step 1: Check Node.js
Write-Step "Checking Node.js..."
$nodeOk = $false
try {
  $v = & node --version 2>$null
  if ($v -match "v(\d+)\.") { if ([int]$Matches[1] -ge 18) { $nodeOk = $true; Write-Ok "Node.js $v found" } }
} catch {}
if (-not $nodeOk) {
  Write-Info "Node.js 18+ not found. Installing via winget..."
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    & winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>$null
  } else {
    Write-Info "winget not available. Downloading Node.js installer..."
    $installer = "$env:TEMP\node-installer.msi"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi" -OutFile $installer -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i `"$installer`" /qn" -Wait
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  try { $v = & node --version 2>$null; Write-Ok "Node.js $v installed" } catch { Write-Host "  [X] Node.js installation failed. Please install from nodejs.org and rerun." -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
}

# Step 2: Get/update app files
Write-Step "Preparing application files..."
if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }
$hasPackage = Test-Path "$AppDir\package.json"
$hasSrc = Test-Path "$AppDir\src"
if (-not ($hasPackage -and $hasSrc)) {
  Write-Info "Downloading application (first run only)..."
  $zip = "$env:TEMP\aipico-app.zip"
  Invoke-WebRequest -Uri "$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
  $tmp = "$env:TEMP\aipico-extract"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
  Copy-Item "$($inner.FullName)\*" $AppDir -Recurse -Force
  Write-Ok "Application downloaded"
} else {
  Write-Ok "Application files found"
}

Set-Location $AppDir

# Step 3: Install dependencies
Write-Step "Installing dependencies (first run only)..."
if (-not (Test-Path "$AppDir\node_modules")) {
  & npm install --no-audit --no-fund 2>&1 | Out-Null
  Write-Ok "Dependencies installed"
} else {
  Write-Ok "Dependencies already installed"
}

# Step 4: Build if needed
Write-Step "Building application (first run only)..."
if (-not (Test-Path "$AppDir\.next")) {
  & npm run build 2>&1 | Out-Null
  Write-Ok "Application built"
} else {
  Write-Ok "Build found"
}

# Step 4b: Configure Gemini API Key (Optional)
$envFile = "$AppDir\.env.local"
$hasKey = $false
if (Test-Path $envFile) {
  $envContent = Get-Content $envFile
  if ($envContent -match "GEMINI_API_KEY=\S+") {
    $hasKey = $true
  }
}

if ($ConfigureKey) {
  Write-Step "Reconfiguring Gemini API Key..."
  Write-Host "  Current key status: $(if ($hasKey) { 'Configured' } else { 'Not configured' })"
  $key = Read-Host "  Please enter your new GEMINI_API_KEY (leave empty to keep current or clear)"
  $key = $key.Trim()
  if ($key) {
    "GEMINI_API_KEY=$key" | Out-File $envFile -Encoding utf8
    Write-Ok "Gemini API key updated in .env.local"
  } else {
    if ($hasKey) {
      $clearChoice = Read-Host "  Clear current key and run in deterministic mode? (Y/N)"
      if ($clearChoice -match "^[Yy]") {
        if (Test-Path $envFile) { Remove-Item $envFile -Force }
        Write-Ok "Gemini API key cleared. Running in deterministic mode."
      } else {
        Write-Info "Key left unchanged."
      }
    } else {
      Write-Info "No key entered."
    }
  }
} elseif (-not $hasKey) {
  Write-Step "Checking AI Commentary configuration..."
  Write-Info "No Gemini API key is configured. AI-written commentary will be disabled,"
  Write-Info "and the app will run in deterministic fallback mode (honest evidence lists)."
  Write-Host ""
  $choice = Read-Host "  Do you want to configure a Gemini API key now? (Y/N)"
  if ($choice -match "^[Yy]") {
    Write-Host ""
    $key = Read-Host "  Please enter your GEMINI_API_KEY (e.g. AIzaSy...)"
    $key = $key.Trim()
    if ($key) {
      "GEMINI_API_KEY=$key" | Out-File $envFile -Encoding utf8
      Write-Ok "Gemini API key saved to .env.local"
    } else {
      Write-Info "Empty key entered. Continuing in deterministic mode."
    }
  } else {
    Write-Info "Continuing in deterministic mode. You can configure the key later by running:"
    Write-Info "  launcher\AIPICO-Launcher.ps1 -ConfigureKey"
  }
} else {
  Write-Step "Checking AI Commentary configuration..."
  Write-Ok "Gemini API key configuration found"
}

# Step 5: Start server
Write-Step "Starting AI PICO server..."
$existing = Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue
if ($existing) {
  Write-Info "Server already running on port 3456"
} else {
  $env:PORT = "3456"
  Start-Process -FilePath "npm" -ArgumentList "run","start","--","-p","3456" -WorkingDirectory $AppDir -WindowStyle Hidden
  Write-Info "Waiting for server to start..."
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    try { $r = Invoke-WebRequest -Uri $ServerUrl -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ready = $true; break } } catch {}
  }
  if ($ready) { Write-Ok "Server started" } else { Write-Host "  [X] Server failed to start" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
}

# Step 6: Open browser
Write-Step "Opening AI PICO..."
Start-Process $ServerUrl
Write-Host ""
Write-Host "  ==================================================" -ForegroundColor Green
Write-Host "   AI PICO is running at $ServerUrl" -ForegroundColor Green
Write-Host "   Created by Dr Raouf Roshdy (c) 2026" -ForegroundColor Yellow
Write-Host "  ==================================================" -ForegroundColor Green
Write-Host ""
Write-Info "Keep this window open while using the app."
Read-Host "Press Enter to close this launcher (app stays running)"
