$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force backups | Out-Null
$name = 'browsernas-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tar.gz'
& docker compose stop
if ($LASTEXITCODE -ne 0) { throw 'Cannot stop services; backup cancelled.' }
try {
    & docker compose --profile tools run --rm --no-deps tools tar -czf "/backup/$name" -C /source settings files
    if ($LASTEXITCODE -ne 0) { throw 'Backup failed. Do not use the partial archive.' }
    Write-Host "Backup saved: backups/$name"
} finally {
    & docker compose up -d --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'Services did not restart. Run docker compose logs.' }
}
