$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPort = 4173
$backendPort = 8045
$url = "http://127.0.0.1:$frontendPort/"
$logRoot = Join-Path $env:TEMP 'kunqiong-file-transfer'
$serverLog = Join-Path $logRoot 'server.log'
$serverErrorLog = Join-Path $logRoot 'server-error.log'
$viteLog = Join-Path $logRoot 'vite.log'
$viteErrorLog = Join-Path $logRoot 'vite-error.log'

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
Clear-Content -Path (Join-Path $logRoot 'startup-error.log') -ErrorAction SilentlyContinue

function Stop-PortProcess([int]$port) {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -in @('node', 'nodejs')) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source

  if (-not (Test-Path (Join-Path $root 'node_modules\vite\bin\vite.js'))) {
    $install = Start-Process -FilePath $npm -ArgumentList @('install') -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -ne 0) {
      throw 'Dependency installation failed.'
    }
  }

  Stop-PortProcess $frontendPort
  Stop-PortProcess $backendPort
  Start-Sleep -Milliseconds 500

  Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog | Out-Null
  Start-Process -FilePath $node -ArgumentList @('node_modules\vite\bin\vite.js', '--host', '0.0.0.0', '--port', $frontendPort) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $viteLog -RedirectStandardError $viteErrorLog | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        $ready = $true
        break
      }
    } catch {
      # Keep waiting while Vite starts.
    }
  }

  if (-not $ready) {
    throw "Frontend did not become ready. See $viteLog"
  }

  Start-Process $url | Out-Null
} catch {
  Add-Content -Path (Join-Path $logRoot 'startup-error.log') -Value "$(Get-Date -Format s) $($_.Exception.Message)"
}
