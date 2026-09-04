# run.ps1 — SIH26191 Risk-Aware Relocation Platform
# One-command start for Windows PowerShell per §10 / §16
#
# Usage:
#   .\run.ps1          - start all services + seed pilot data
#   .\run.ps1 -Build   - force rebuild of images before starting
#   .\run.ps1 -Clean   - wipe database volume and restart fresh
# =============================================================

param (
    [switch]$Build,
    [switch]$Clean
)

$ErrorActionPreference = "Continue"

function Write-LogInfo($msg)  { Write-Host "[run.ps1] $msg" -ForegroundColor Cyan }
function Write-LogOk($msg)    { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-LogWarn($msg)  { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-LogDie($msg)   { Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }

Set-Alias -Name Log-Info -Value Write-LogInfo -Scope Local
Set-Alias -Name Log-Ok -Value Write-LogOk -Scope Local
Set-Alias -Name Log-Warn -Value Write-LogWarn -Scope Local
Set-Alias -Name Log-Die -Value Write-LogDie -Scope Local

# Refresh PATH to pick up Docker Desktop if recently installed
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

# Find docker executable
$dockerExe = "docker"
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    $fallbackPath = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
    if (Test-Path $fallbackPath) {
        $dockerExe = $fallbackPath
    } else {
        Log-Die "Docker CLI not found. Please ensure Docker Desktop is installed and in PATH."
    }
}

Log-Info "Using Docker CLI at: $dockerExe"

# Ensure .env exists
if (-not (Test-Path ".env")) {
    Log-Warn ".env not found - creating from .env.example"
    Copy-Item ".env.example" -Destination ".env"
}

# Clean slate if requested
if ($Clean) {
    Log-Warn "--Clean specified: stopping containers and removing database volume..."
    & $dockerExe compose down -v --remove-orphans
}

# Start containers
$composeArgs = @("compose", "up", "-d")
if ($Build) {
    $composeArgs += "--build"
}
$composeArgs += "--remove-orphans"

Log-Info "Starting Docker Compose services..."
& $dockerExe @composeArgs
if ($LASTEXITCODE -ne 0) {
    Log-Die "docker compose up failed. Ensure Docker Desktop engine is running."
}

# Wait for database
Log-Info "Waiting for PostGIS to be healthy..."
$retries = 30
$dbHealthy = $false
while ($retries -gt 0) {
    $status = & $dockerExe compose ps db --format json 2>$null | ConvertFrom-Json
    if ($status -and $status.Health -eq "healthy") {
        $dbHealthy = $true
        break
    }
    Start-Sleep -Seconds 2
    $retries--
}
if ($dbHealthy) {
    Log-Ok "PostGIS is healthy."
} else {
    Log-Warn "PostGIS health check timed out. Backend may still connect once ready."
}

# Wait for backend
Log-Info "Waiting for backend API to be reachable..."
$retries = 30
$backendUp = $false
while ($retries -gt 0) {
    try {
        $res = Invoke-WebRequest -Uri "http://localhost:8000/healthz" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($res.StatusCode -eq 200) {
            $backendUp = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
    $retries--
}
if ($backendUp) {
    Log-Ok "Backend API is up at http://localhost:8000"
} else {
    Log-Warn "Backend API not responding yet. Check: docker compose logs backend"
}

# Seed pilot data
Log-Info "Seeding Chamoli pilot dataset..."
& $dockerExe compose exec backend python ingestion/load_pilot_data.py
if ($LASTEXITCODE -eq 0) {
    Log-Ok "Pilot data loaded successfully."
} else {
    Log-Warn "Pilot data ingestion completed or exited with warning."
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SIH26191 Risk-Aware Relocation Platform is RUNNING      " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Frontend  ->  http://localhost:5173                     " -ForegroundColor Cyan
Write-Host "  Backend   ->  http://localhost:8000                     " -ForegroundColor Cyan
Write-Host "  API Docs  ->  http://localhost:8000/docs                " -ForegroundColor Cyan
Write-Host "  Database  ->  localhost:5432 (PostGIS 15-3.4)           " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Logs:     docker compose logs -f                        " -ForegroundColor Yellow
Write-Host "  Stop:     docker compose down                           " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Green