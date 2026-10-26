$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendPort = 4173
$backendPort = 8045
$url = "http://127.0.0.1:$frontendPort/"
$healthUrl = "http://127.0.0.1:$backendPort/api/health"
$logRoot = Join-Path $env:TEMP 'kunqiong-file-transfer'
$serverLog = Join-Path $logRoot 'server.log'
$serverErrorLog = Join-Path $logRoot 'server-error.log'
$viteLog = Join-Path $logRoot 'vite.log'
$viteErrorLog = Join-Path $logRoot 'vite-error.log'
$startupErrorLog = Join-Path $logRoot 'startup-error.log'

# 用绝对路径启动脚本：进程命令行里才会带上项目根目录，Stop-ProjectNodeProcesses 才能
# 按 CommandLine 认出本项目的进程（-WorkingDirectory 不会出现在命令行中，用相对路径
# 启动时该函数永远匹配不到）。路径统一加引号，避免安装目录含空格时被拆成多个参数。
$backendArguments = @("`"$(Join-Path $root 'server.mjs')`"")
$viteScript = Join-Path $root 'node_modules\vite\bin\vite.js'
$viteArguments = @("`"$viteScript`"", '--host', '0.0.0.0', '--port', $frontendPort)

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
Clear-Content -Path $startupErrorLog -ErrorAction SilentlyContinue
try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {
  # The launcher does not require console encoding support.
}

function Stop-PortProcess([int]$port) {
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listeners) { return }
    foreach ($listener in $listeners) {
      $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -in @('node', 'nodejs')) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      } else {
        throw "Port $port is already used by a non-Node process (PID $($listener.OwningProcess))."
      }
    }
    Start-Sleep -Milliseconds 300
  }
  throw "Unable to stop the previous process on port $port."
}

function Stop-ProjectNodeProcesses {
  # 依赖「命令行含项目根目录 + 脚本名」两点同时成立，避免误杀其它项目的 node 进程。
  # 前提是启动时传绝对脚本路径：见 $backendArguments / $viteArguments 的说明。
  $rootPattern = [regex]::Escape($root)
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $rootPattern -and $_.CommandLine -match 'server\.mjs|vite\.js' }
  foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Wait-Ready([string]$targetUrl, [string]$serviceName, [int]$attempts = 60) {
  for ($attempt = 0; $attempt -lt $attempts; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $targetUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return
      }
    } catch {
      # Keep waiting while the service starts.
    }
  }
  throw "$serviceName did not become ready. See $logRoot"
}

function Get-DotEnvValue([string]$name) {
  $line = Get-Content (Join-Path $root '.env') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^\s*$([regex]::Escape($name))\s*=" } |
    Select-Object -First 1
  if ($line -and $line -match '^\s*[^=]+\s*=\s*(.*)$') {
    return $Matches[1].Trim().Trim('"').Trim("'")
  }
  return ''
}

try {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $npm = (Get-Command npm.cmd -ErrorAction Stop).Source

  if (-not (Test-Path $viteScript)) {
    $install = Start-Process -FilePath $npm -ArgumentList @('install') -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -ne 0) {
      throw 'Dependency installation failed.'
    }
  }

  # The local Docker scanner is not managed by the test-server deployment script.
  # Keep its settings aligned before starting the app, so large archives do not
  # hit clamd's default two-minute limit. External/native scanners remain manual.
  $scannerHost = if ($env:KUNQIONG_CLAMAV_HOST) { $env:KUNQIONG_CLAMAV_HOST } else { Get-DotEnvValue 'KUNQIONG_CLAMAV_HOST' }
  $scannerPortText = if ($env:KUNQIONG_CLAMAV_PORT) { $env:KUNQIONG_CLAMAV_PORT } else { Get-DotEnvValue 'KUNQIONG_CLAMAV_PORT' }
  if ($scannerHost -in @('127.0.0.1', 'localhost', '::1') -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    $scannerPort = if ($scannerPortText -match '^\d+$') { [int]$scannerPortText } else { 3310 }
    # Docker Desktop 未启动时 docker 会往 stderr 写错误；$ErrorActionPreference='Stop' 下
    # 这会变成终止性错误，直接把整个启动流程打断。这里只当“没有本地扫描容器”处理。
    $scannerContainer = ''
    try {
      $scannerContainer = (& docker ps --filter 'name=^/kunqiong-clamav$' --format '{{.Names}}' 2>$null | Out-String).Trim()
    } catch {
      $scannerContainer = ''
    }
    if ($scannerContainer -eq 'kunqiong-clamav' -and $scannerPort -eq 3310) {
      & (Join-Path $root 'scripts/configure-local-scanner.ps1') -Port $scannerPort
    }
  }

  Stop-PortProcess $frontendPort
  Stop-PortProcess $backendPort
  Stop-ProjectNodeProcesses
  Start-Sleep -Milliseconds 500

  $dbEnabled = (Get-DotEnvValue 'KUNQIONG_DB_ENABLED') -match '^(1|true|yes|on)$'
  $dbHost = Get-DotEnvValue 'KUNQIONG_DB_HOST'
  $dbPortText = Get-DotEnvValue 'KUNQIONG_DB_PORT'
  $dbPort = if ($dbPortText -match '^\d+$') { [int]$dbPortText } else { 3306 }
  if ($dbEnabled -and $dbHost) {
    $dbAvailable = Test-NetConnection -ComputerName $dbHost -Port $dbPort -InformationLevel Quiet -WarningAction SilentlyContinue
    if (-not $dbAvailable) {
      $env:KUNQIONG_DB_ENABLED = 'false'
      Add-Content -Path $startupErrorLog -Value "$(Get-Date -Format s) Remote database port unavailable; started with local storage for this launch."
    }
  }

  $backendProcess = Start-Process -FilePath $node -ArgumentList $backendArguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog -PassThru
  try {
    Wait-Ready $healthUrl 'Backend' 12
  } catch {
    if (-not $dbEnabled -or $env:KUNQIONG_DB_ENABLED -eq 'false') { throw }
    Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-ProjectNodeProcesses
    $env:KUNQIONG_DB_ENABLED = 'false'
    Add-Content -Path $startupErrorLog -Value "$(Get-Date -Format s) Remote database initialization timed out; restarted with local storage for this launch."
    Start-Process -FilePath $node -ArgumentList $backendArguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog | Out-Null
    Wait-Ready $healthUrl 'Backend'
  }

  Start-Process -FilePath $node -ArgumentList $viteArguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $viteLog -RedirectStandardError $viteErrorLog | Out-Null

  Wait-Ready $healthUrl 'Backend'
  Wait-Ready $url 'Frontend'

  Start-Process $url | Out-Null
} catch {
  $reason = $_.Exception.Message
  $message = "项目启动失败：$reason`n`n日志目录：$logRoot"
  Add-Content -Path $startupErrorLog -Value ("{0} {1}" -f (Get-Date -Format s), $message) -Encoding utf8
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, '鲲穹文件传输启动失败', 'OK', 'Error') | Out-Null
  } catch {
    # Keep the launcher usable on systems without the WPF assembly.
  }
}
