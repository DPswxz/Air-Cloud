param([ValidateRange(1024,65535)][int]$Port = 8088, [switch]$LAN)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $dockerBin = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin'
    if (Test-Path "$dockerBin\docker.exe") { $env:PATH = "$dockerBin;$env:PATH" }
    else { throw 'Install Docker Desktop (Linux containers / WSL 2) first: https://docs.docker.com/desktop/setup/install/windows-install/ . Then double-click start.cmd again.' }
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) { Start-Process -FilePath $desktop -WindowStyle Hidden }
    $ready = $false
    for ($i=0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    }
    if (-not $ready) { throw 'Docker is not ready. Start Docker Desktop and select Linux containers, then retry.' }
}
& docker compose version
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if ($PSBoundParameters.ContainsKey('Port')) { $env:NAS_PORT = "$Port" }
if ($LAN) { $env:NAS_BIND = '0.0.0.0' }
& docker compose up -d --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'Startup failed. Run docker compose logs --tail 100 to diagnose. Existing data is preserved.' }
$published = & docker compose port portal 8088
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine the published portal port.' }
$actualPort = ($published | Select-Object -First 1) -replace '^.*:', ''
Write-Host "BrowserNAS ready: http://localhost:$actualPort"
if ($LAN) { Write-Host 'LAN access enabled for this run. Complete admin setup first; allow the port on Private networks only.' }
Start-Process "http://localhost:$actualPort"
