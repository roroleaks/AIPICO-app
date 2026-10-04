# Rebuilds installer\app-source.zip from the current working tree.
#
# The bundle is what every desktop install actually runs (install-app.ps1 extracts it,
# then runs `npm install` and `npm run build`). It previously shipped a pre-deterministic
# snapshot: a 264-line engine route with no evidence-set, claim-finalization or
# deliverable-integrity module and no PDF route, so the desktop build enforced none of the
# guarantees the web build does. Nothing regenerated it, which is how it went stale.
#
# Run this after any change to src\, package.json or package-lock.json:
#   powershell -ExecutionPolicy Bypass -File installer\build-app-source.ps1
#
# The bundle is then verified against the tree by SHA-256, so a stale archive cannot
# pass unnoticed. To verify without rewriting:
#   powershell -ExecutionPolicy Bypass -File installer\build-app-source.ps1 -Check
#
# Layout note: entries are written at the archive root, with no wrapper folder, which is
# the layout install-app.ps1 already handles.

[CmdletBinding()]
param(
  # Compare the existing archive against the working tree without writing anything.
  # Exits 1 when the bundle is stale. Used by installer\test-installer.ps1.
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$ZipPath   = Join-Path $ScriptDir "app-source.zip"
$Stage     = Join-Path $env:TEMP ("aipico-app-source-" + [guid]::NewGuid().ToString("N").Substring(0, 8))

# Files required for `npm install` + `npm run build` to succeed.
$RootFiles = @(
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next.config.ts",
  "eslint.config.mjs",
  "vercel.json",
  ".gitignore",
  ".vercelignore",
  "README.md"
)

# Directories copied wholesale. src\ includes the *.test.ts files on purpose so an
# installer can run `npm test` and confirm the bundle matches the repository.
$RootDirs = @("src", "public")

# Never bundle: dependencies, build output, real secrets, or installer/launcher payloads
# that would nest the desktop app inside itself.
$NeverBundle = @(
  "node_modules", ".next", "out", ".git", ".vercel", "installer", "launcher",
  "coverage", ".idea", ".vscode"
)

function Assert-InRepo($rel) {
  $full = Join-Path $RepoRoot $rel
  if (-not (Test-Path -LiteralPath $full)) { throw "Required file missing from the tree: $rel" }
  return $full
}

# Relative path of $full under $base. A plain string operation: Resolve-Path -Relative
# is avoided because it cannot be combined reliably with -LiteralPath, and substring
# arithmetic is done against a base canonicalised through the provider so that lengths and
# casing always line up.
#
# Canonicalising matters: $env:TEMP is the short 8.3 form (C:\Users\RAOUF~1.RAO\...) while
# Get-ChildItem reports the long form (C:\Users\raouf.RAOUFDESKTOP\...), so a base taken
# straight from $env:TEMP never prefix-matches the paths it is meant to contain.
function Get-RelativePath([string]$base, [string]$full) {
  $b = (Get-Item -LiteralPath $base).FullName.TrimEnd('\', '/')
  if (-not $full.StartsWith($b, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path '$full' is not under '$base'."
  }
  return $full.Substring($b.Length).TrimStart('\', '/')
}

try {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
  New-Item -ItemType Directory -Path $Stage -Force | Out-Null

  foreach ($f in $RootFiles) {
    Copy-Item -LiteralPath (Assert-InRepo $f) -Destination (Join-Path $Stage $f) -Force
  }

  foreach ($d in $RootDirs) {
    $srcDir = Join-Path $RepoRoot $d
    if (-not (Test-Path -LiteralPath $srcDir)) { throw "Required directory missing from the tree: $d" }
    Copy-Item -LiteralPath $srcDir -Destination (Join-Path $Stage $d) -Recurse -Force
  }

  # Scrub anything that must never ship, even if it slipped into a copied directory.
  Get-ChildItem -LiteralPath $Stage -Recurse -Force -Directory |
    Where-Object { $NeverBundle -contains $_.Name } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }

  Get-ChildItem -LiteralPath $Stage -Recurse -Force -File |
    Where-Object {
      $_.Name -like ".env*" -or
      $_.Name -like "*.tsbuildinfo" -or
      $_.Name -eq "next-env.d.ts" -or
      $_.Extension -in @(".pem", ".key", ".log")
    } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

  $files = @(Get-ChildItem -LiteralPath $Stage -Recurse -File)
  if ($files.Count -eq 0) { throw "Refusing to write an empty archive." }

  # Parity guard: every source module the API routes import must be present in the bundle.
  $required = @(
    "src\app\api\engine\route.ts",
    "src\app\api\pdf\route.ts",
    "src\app\api\pubmed\route.ts",
    "src\lib\evidence-set.ts",
    "src\lib\relevance.ts",
    "src\lib\claim-finalization.ts",
    "src\lib\deliverable-integrity.ts",
    "src\lib\clinical-keywords.ts",
    "src\lib\clinical-input.ts",
    "src\app\paper\page.tsx",
    "src\app\question\page.tsx",
    "src\app\gap\page.tsx"
  )
  $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $Stage $_)) })
  if ($missing.Count -gt 0) {
    throw ("Bundle is missing required modules: " + ($missing -join ", "))
  }

  if ($Check) {
    if (-not (Test-Path -LiteralPath $ZipPath)) { throw "app-source.zip does not exist. Run build-app-source.ps1 without -Check." }
    Write-Host ("Checking {0}" -f $ZipPath)
  } else {
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -CompressionLevel Optimal
    $zipSize = (Get-Item -LiteralPath $ZipPath).Length
    Write-Host ("Wrote {0}" -f $ZipPath)
    Write-Host ("  entries : {0}" -f $files.Count)
    Write-Host ("  size    : {0:N0} bytes" -f $zipSize)
  }

  # ---------------------------------------------------------------------------
  # Bundle verification
  #
  # Comparing file names alone is not enough and would have passed the stale bundle:
  # it carried exactly the same paths as the tree, only older contents. Every file is
  # therefore compared by SHA-256.
  # ---------------------------------------------------------------------------
  Write-Host ""
  Write-Host "Verifying bundle against the working tree..."

  $verifyDir = Join-Path $env:TEMP ("aipico-verify-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  try {
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $verifyDir -Force

    # Paths are normalised relative to the directory being listed, so both sides of the
    # comparison use identical separators and dotfiles survive intact.
    $expected = @($RootFiles)
    foreach ($d in $RootDirs) {
      $expected += @(Get-ChildItem -LiteralPath (Join-Path $RepoRoot $d) -Recurse -File |
        ForEach-Object { Get-RelativePath $RepoRoot $_.FullName })
    }
    $expected = @($expected | Sort-Object -Unique)

    $actual = @(Get-ChildItem -LiteralPath $verifyDir -Recurse -File |
      ForEach-Object { Get-RelativePath $verifyDir $_.FullName })
    $actual = @($actual | Sort-Object -Unique)

    $problems = @()
    foreach ($d in @(Compare-Object $expected $actual)) {
      $side = if ($d.SideIndicator -eq "=>") { "only in bundle" } else { "only in tree  " }
      $problems += ("{0}  {1}" -f $side, $d.InputObject)
    }
    foreach ($rel in @($expected | Where-Object { $actual -contains $_ })) {
      $treeHash = (Get-FileHash -LiteralPath (Join-Path $RepoRoot $rel) -Algorithm SHA256).Hash
      $zipHash  = (Get-FileHash -LiteralPath (Join-Path $verifyDir $rel) -Algorithm SHA256).Hash
      if ($treeHash -ne $zipHash) { $problems += ("content differs  {0}" -f $rel) }
    }

    if ($problems.Count -gt 0) {
      Write-Host "  STALE BUNDLE - the archive does not match the working tree:"
      $problems | ForEach-Object { Write-Host ("    " + $_) }
      Write-Host ""
      Write-Host "  Fix: powershell -ExecutionPolicy Bypass -File installer\build-app-source.ps1"
      exit 1
    }

    $srcCount = $actual.Count - $RootFiles.Count
    Write-Host ("  OK: {0} files identical to the working tree by SHA-256 ({1} source + {2} root config)" -f $actual.Count, $srcCount, $RootFiles.Count)
    exit 0
  } finally {
    if (Test-Path -LiteralPath $verifyDir) { Remove-Item -LiteralPath $verifyDir -Recurse -Force }
  }
} finally {
  if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
}
