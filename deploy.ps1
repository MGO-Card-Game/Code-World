param(
  [string]$Server = "ubuntu@212.129.221.32",
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = $PSScriptRoot
$releaseId = [DateTimeOffset]::UtcNow.ToString("yyyyMMddHHmmss")
$stageDir = "/home/ubuntu/.code-world-stage-$releaseId"
$remoteArchive = "/home/ubuntu/.code-world-$releaseId.tar.gz"
$localArchive = Join-Path ([IO.Path]::GetTempPath()) "code-world-$releaseId.tar.gz"

function Invoke-Checked {
  param(
    [Parameter(Mandatory)] [string]$Label,
    [Parameter(Mandatory)] [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

Push-Location $projectRoot
try {
  if (-not (Test-Path "Dockerfile") -or -not (Test-Path "compose.yaml")) {
    throw "Run deploy.ps1 from the project directory"
  }

  if (-not $SkipTests) {
    Write-Host "[1/5] Running tests..." -ForegroundColor Cyan
    Invoke-Checked "Tests" { npm.cmd test }
  } else {
    Write-Host "[1/5] Tests skipped" -ForegroundColor Yellow
  }

  Write-Host "[2/5] Packaging the current workspace..." -ForegroundColor Cyan
  Invoke-Checked "Packaging" {
    tar --exclude-from=.dockerignore -czf $localArchive .
  }

  Write-Host "[3/5] Uploading to $Server..." -ForegroundColor Cyan
  Invoke-Checked "Upload" {
    scp -o BatchMode=yes $localArchive "${Server}:$remoteArchive"
  }

  $remoteCommand = @(
    "mkdir -p '$stageDir'",
    "tar -xzf '$remoteArchive' -C '$stageDir'",
    "sed -i 's/\r$//' '$stageDir/scripts/deploy-remote.sh'",
    "sh '$stageDir/scripts/deploy-remote.sh' '$stageDir' '$remoteArchive'"
  ) -join " && "

  Write-Host "[4/5] Building and switching the remote container..." -ForegroundColor Cyan
  Invoke-Checked "Remote deployment" {
    ssh -o BatchMode=yes $Server $remoteCommand
  }

  Write-Host "[5/5] Deployment completed" -ForegroundColor Green
  Write-Host "URL: http://212.129.221.32:8787"
} finally {
  Pop-Location
  if (Test-Path $localArchive) {
    Remove-Item -LiteralPath $localArchive -Force
  }
}
