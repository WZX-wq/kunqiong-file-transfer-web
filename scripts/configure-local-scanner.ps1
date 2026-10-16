param(
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.-]*$')]
  [string]$ContainerName = 'kunqiong-clamav',
  [ValidateRange(1, 65535)]
  [int]$Port = 3310,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'deployment/clamd.conf'
$containerConfigPath = '/etc/clamav/clamd.conf'
Get-Command docker -ErrorAction Stop | Out-Null

function Invoke-Docker([string[]]$DockerArguments) {
  $result = & docker @DockerArguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($result -join [Environment]::NewLine)" }
  return ($result -join "`n")
}

function Read-Directives([string]$Content) {
  $values = @{}
  foreach ($line in ($Content -split "`n")) {
    if ($line -match '^\s*([A-Za-z][A-Za-z0-9]*)\s+([^#\r]+?)\s*(?:#.*)?$') {
      $values[$Matches[1]] = $Matches[2].Trim()
    }
  }
  return $values
}

function Get-ScannerReply([string]$Command) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $connect.Wait(2000)) { throw 'Scanner connection timed out.' }
    $stream = $client.GetStream()
    $stream.ReadTimeout = 2000
    $stream.WriteTimeout = 2000
    $request = [Text.Encoding]::ASCII.GetBytes("z$Command`0")
    $stream.Write($request, 0, $request.Length)
    $buffer = [byte[]]::new(16384)
    $response = ''
    do {
      $count = $stream.Read($buffer, 0, $buffer.Length)
      if (-not $count) { break }
      $response += [Text.Encoding]::ASCII.GetString($buffer, 0, $count)
      if ($response.Length -gt 65536) { throw 'Invalid scanner response.' }
    } while (-not $response.Contains([char]0) -and -not $response.Contains("END`n"))
    return $response
  } finally { $client.Dispose() }
}

$running = Invoke-Docker -DockerArguments @('inspect', '--format', '{{.State.Running}}', $ContainerName)
if ($running.Trim() -ne 'true') { throw 'The local scanner container is not running.' }
$expected = Read-Directives ([IO.File]::ReadAllText($configPath))
if ([int]$expected['TCPSocket'] -ne $Port) { throw 'Scanner port must match deployment/clamd.conf.' }
$bindings = Invoke-Docker -DockerArguments @('port', $ContainerName, "$Port/tcp")
if ($bindings -notmatch ":$Port(?:\s|$)") { throw 'The scanner container does not publish the configured local port.' }
$currentText = Invoke-Docker -DockerArguments @('exec', $ContainerName, 'cat', $containerConfigPath)
$current = Read-Directives $currentText
# Some Docker images rewrite MaxFileSize to 5G on startup. libclamav clamps
# every value above INT_MAX - 2 to the same effective limit used by the project.
if ($current['MaxFileSize'] -match '^(\d+)([KMG]?)$') {
  $multiplier = switch ($Matches[2]) { 'K' { 1024 } 'M' { 1048576 } 'G' { 1073741824 } default { 1 } }
  if ([long]$Matches[1] * $multiplier -ge 2147483645 -and $expected['MaxFileSize'] -eq '2147483645') {
    $current['MaxFileSize'] = '2147483645'
  }
}
$differences = @($expected.Keys | Where-Object { -not $current.ContainsKey($_) -or $current[$_] -cne $expected[$_] })
if ($CheckOnly) {
  if ($differences.Count) { throw "Local scanner configuration differs from deployment/clamd.conf: $($differences -join ', ')" }
  if ((Get-ScannerReply 'PING') -notmatch 'PONG') { throw 'Scanner is not ready.' }
  Write-Output 'Local scanner configuration and PONG verified.'
  return
}
if ($differences.Count) {
  # Never interrupt a scan already in progress. STATS itself occupies one thread.
  $stats = Get-ScannerReply 'STATS'
  $activeThreads = 0
  if ($stats -match 'THREADS:\s*live\s+(\d+)\s+idle\s+(\d+)') {
    $activeThreads = [int]$Matches[1] - [int]$Matches[2]
  }
  if ($stats -notmatch 'QUEUE:\s*0 items' -or $activeThreads -ne 1 -or $stats -notmatch '\bSTATS\b') {
    throw 'Scanner is busy; wait for active security checks to finish before updating its configuration.'
  }
  $backup = "$containerConfigPath.before-kunqiong-$(Get-Date -Format 'yyyyMMddHHmmss')"
  Invoke-Docker -DockerArguments @('exec', $ContainerName, 'cp', $containerConfigPath, $backup) | Out-Null
  # Preserve the image's logging/database options, applying the project's limits
  # and connection settings. Do not replace freshclam's independent configuration.
  $lines = @($currentText -split "`n" | Where-Object {
    -not ($_ -match '^\s*([A-Za-z][A-Za-z0-9]*)\s+' -and $expected.ContainsKey($Matches[1]))
  })
  $lines += '# Kunqiong project scanner settings (deployment/clamd.conf)'
  $lines += ($expected.Keys | Sort-Object | ForEach-Object { "$_ $($expected[$_])" })
  $temporaryConfig = Join-Path ([IO.Path]::GetTempPath()) ("kunqiong-clamd-" + [Guid]::NewGuid().ToString('N') + '.conf')
  try {
    [IO.File]::WriteAllText($temporaryConfig, ($lines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    Invoke-Docker -DockerArguments @('cp', $temporaryConfig, "${ContainerName}:$containerConfigPath") | Out-Null
    Invoke-Docker -DockerArguments @('restart', $ContainerName) | Out-Null
  } catch {
    Invoke-Docker -DockerArguments @('exec', $ContainerName, 'cp', $backup, $containerConfigPath) | Out-Null
    Invoke-Docker -DockerArguments @('restart', $ContainerName) | Out-Null
    throw
  } finally { Remove-Item -LiteralPath $temporaryConfig -ErrorAction SilentlyContinue }
  Write-Output "Updated local scanner settings: $($differences -join ', '). Backup: $backup"
}
$deadline = [DateTime]::UtcNow.AddSeconds(120)
do {
  try {
    if ((Get-ScannerReply 'PING') -match 'PONG') {
      Write-Output 'Local scanner ready: MaxScanTime 600000 ms, full archive checks required.'
      return
    }
  } catch { }
  Start-Sleep -Milliseconds 1000
} while ([DateTime]::UtcNow -lt $deadline)
if ($differences.Count) {
  Invoke-Docker -DockerArguments @('exec', $ContainerName, 'cp', $backup, $containerConfigPath) | Out-Null
  Invoke-Docker -DockerArguments @('restart', $ContainerName) | Out-Null
}
throw 'Local scanner did not become ready within 120 seconds. Check docker logs kunqiong-clamav.'
