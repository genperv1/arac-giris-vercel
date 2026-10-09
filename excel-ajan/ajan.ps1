#requires -Version 5.1
<#
  Excel Ajani. Kantar bilgisayarinda arka planda calisir.
  Izlenen klasordeki Excel kaydedilince siteye yukler.
  baslat.bat bu dosyayi gizli pencereyle acar.
#>
param(
  [switch]$Kontrol,
  [switch]$Kur,
  [switch]$Durdur,
  [switch]$Kaldir
)

$ErrorActionPreference = 'Stop'
$VarsayilanSunucu = 'https://genper.site'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {}

$ScriptPath = $MyInvocation.MyCommand.Path
if (-not $ScriptPath) { $ScriptPath = $PSCommandPath }
$Root = Split-Path -Parent $ScriptPath
$AyarPath = Join-Path $Root 'ayar.txt'
$OrnekPath = Join-Path $Root 'ayar.ornek.txt'
$LogPath = Join-Path $Root 'ajan.log'
$DurumPath = Join-Path $Root 'durum.txt'
$PsExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$StartupName = 'Excel Ajani.lnk'
$MaxBytes = 40 * 1024 * 1024
$ExtRe = '\.(xlsx|xls|xlsm|xlsb)$'
# Yalniz gunluk ihracat listeleri gonderilir (adinda tarih olan: 03.10.2026.xlsx, 03.10.2026-YD28.xlsx)
$TarihliRe = '\d{1,2}[.\-_]\d{1,2}[.\-_]\d{4}'

$script:SonHata = ''
$script:SonHataZamani = [datetime]::MinValue
$script:Bekleyen = @{}
$script:Durum = @{}
$script:Mutex = $null
$script:SonPing = [datetime]::MinValue
$script:SonGuncelleme = [datetime]::MinValue
$script:SonBaglantiLog = [datetime]::MinValue
$script:SonrakiDeneme = [datetime]::MinValue
$script:SertifikaAtla = $false
$script:Dosyalar = $null
$script:SonTarama = [datetime]::MinValue
$script:Birak = @{}

function Write-Log([string]$msg) {
  $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
  try {
    if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt 400KB)) {
      $bak = "$LogPath.1"
      if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force }
      Move-Item -LiteralPath $LogPath -Destination $bak -Force
    }
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::AppendAllText($LogPath, $line + "`r`n", $utf8)
  } catch {}
}

function Write-LogOnce([string]$msg) {
  $now = Get-Date
  if ($msg -eq $script:SonHata -and ($now - $script:SonHataZamani).TotalSeconds -lt 120) { return }
  $script:SonHata = $msg
  $script:SonHataZamani = $now
  Write-Log $msg
}

function Read-Ayar {
  if (-not (Test-Path -LiteralPath $AyarPath)) { return $null }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $text = [System.IO.File]::ReadAllText($AyarPath, $utf8)
  if ($text.Length -gt 0 -and [int]$text[0] -eq 0xFEFF) { $text = $text.Substring(1) }
  $map = @{}
  foreach ($line in ($text -split "`r`n|`n|`r")) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $k = $t.Substring(0, $i).Trim().ToUpperInvariant()
    $v = $t.Substring($i + 1).Trim()
    $map[$k] = $v
  }
  return $map
}

function Get-Klasorler($raw) {
  $list = New-Object System.Collections.Generic.List[string]
  foreach ($p in ([string]$raw -split ';')) {
    $t = $p.Trim().Trim('"')
    if ($t) { [void]$list.Add($t) }
  }
  return $list
}

function Get-Ayar {
  $map = Read-Ayar
  if (-not $map) { $map = @{} }
  $sunucu = [string]$map['SUNUCU']
  if ($sunucu -notmatch '^https?://' -or $sunucu -match 'site-adresiniz') {
    $map['SUNUCU'] = $VarsayilanSunucu
  }
  return $map
}

function Test-Ayar($map) {
  if (-not $map) { return 'ayar.txt bulunamadi.' }
  if ([string]$map['SUNUCU'] -notmatch '^https?://') { return 'ayar.txt: SUNUCU satiri hatali.' }
  if (([string]$map['ANAHTAR']).Trim().Length -lt 16) { return 'ayar.txt: ANAHTAR satiri bos. Kantarin anahtarini yazin.' }
  return ''
}

function Get-Sunucu($map) {
  return ([string]$map['SUNUCU']).Trim().TrimEnd('/')
}

function Enable-SertifikaAtla {
  if (-not $script:SertifikaAtla) { return }
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { param($sender, $cert, $chain, $errors) return $true }
}

function Install-Startup {
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup $StartupName
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $PsExe
  $sc.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
  $sc.WorkingDirectory = $Root
  $sc.WindowStyle = 7
  $sc.Description = 'Excel Ajani'
  $sc.Save()
}

function Remove-Startup {
  $startup = [Environment]::GetFolderPath('Startup')
  $lnk = Join-Path $startup $StartupName
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
}

function Get-AgentProcesses([string]$name) {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name = '$name'" -ErrorAction Stop)
  } catch {
    return @(Get-WmiObject Win32_Process -Filter "Name = '$name'" -ErrorAction SilentlyContinue)
  }
}

function Stop-AgentProcesses {
  $me = $PID
  $names = @('powershell.exe', 'pwsh.exe')
  foreach ($name in $names) {
    $procs = @(Get-AgentProcesses $name)
    foreach ($p in $procs) {
      if ([int]$p.ProcessId -eq $me) { continue }
      $cmd = [string]$p.CommandLine
      if ($cmd -notmatch 'ajan\.ps1') { continue }
      if ($cmd -match '-Kontrol' -or $cmd -match '-Kur' -or $cmd -match '-Durdur' -or $cmd -match '-Kaldir') { continue }
      try { Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

function Get-Sha256([byte[]]$bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($bytes)
  } finally {
    $sha.Dispose()
  }
  return ([BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
}

function Read-SharedBytes([string]$path) {
  $last = $null
  for ($n = 0; $n -lt 8; $n++) {
    $fs = $null
    try {
      $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      $ms = New-Object System.IO.MemoryStream
      $fs.CopyTo($ms)
      return $ms.ToArray()
    } catch {
      $last = $_
      Start-Sleep -Milliseconds 400
    } finally {
      if ($fs) { $fs.Dispose() }
    }
  }
  throw $last
}

function Invoke-Ajan {
  param(
    [string]$Method,
    [string]$Url,
    [byte[]]$Body,
    [string]$Key
  )
  Enable-SertifikaAtla
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Method = $Method
  $req.Timeout = 120000
  $req.ReadWriteTimeout = 120000
  $req.UserAgent = 'ExcelAjani'
  try {
    $req.Proxy = [System.Net.WebRequest]::GetSystemWebProxy()
    $req.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials
  } catch {}
  $req.Headers['x-excel-agent-key'] = $Key
  if ($Body -and $Body.Length -gt 0) {
    $req.ContentType = 'application/octet-stream'
    $req.ContentLength = $Body.Length
    $stream = $req.GetRequestStream()
    try { $stream.Write($Body, 0, $Body.Length) } finally { $stream.Close() }
  }
  $resp = $null
  try {
    $resp = $req.GetResponse()
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if (-not $resp) { throw }
  }
  try {
    $raw = New-Object System.IO.MemoryStream
    $inStream = $resp.GetResponseStream()
    if ($inStream) { $inStream.CopyTo($raw) }
    $bytes = $raw.ToArray()
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    return @{ Code = [int]$resp.StatusCode; Text = $text; Bytes = $bytes }
  } finally {
    $resp.Close()
  }
}

function Get-ExcelFiles($klasorler) {
  $files = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  foreach ($klasor in $klasorler) {
    if (-not (Test-Path -LiteralPath $klasor)) {
      Write-LogOnce "Klasor yok: $klasor"
      continue
    }
    $found = @(Get-ChildItem -LiteralPath $klasor -Recurse -File -ErrorAction SilentlyContinue)
    foreach ($f in $found) {
      $name = [string]$f.Name
      if ($name.StartsWith('~$') -or $name.StartsWith('.')) { continue }
      if ($name -notmatch $ExtRe) { continue }
      if ($f.Length -le 0 -or $f.Length -gt $MaxBytes) { continue }
      [void]$files.Add($f)
    }
  }
  return $files
}

function Add-DirUnique($list, $seen, $path) {
  if (-not $path) { return }
  $t = ([string]$path).Trim().Trim('"')
  if (-not $t) { return }
  if (-not (Test-Path -LiteralPath $t)) { return }
  $k = $t.ToLowerInvariant()
  if ($seen.ContainsKey($k)) { return }
  $seen[$k] = $true
  [void]$list.Add($t)
}

function Add-ExcelFile($all, $got, $file) {
  if (-not $file -or -not $file.FullName) { return }
  if ([string]$file.Name -notmatch $TarihliRe) { return }
  $k = ([string]$file.FullName).ToLowerInvariant()
  if ($got.ContainsKey($k)) { return }
  $got[$k] = $true
  [void]$all.Add($file)
}

function Get-WatchExcelFiles($map) {
  $deep = New-Object System.Collections.Generic.List[string]
  $seen = @{}
  foreach ($p in @(Get-Klasorler $map['KLASOR'])) { Add-DirUnique $deep $seen $p }
  $home = [string]$env:USERPROFILE
  $defaults = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('MyDocuments'),
    (Join-Path $home 'Downloads'),
    (Join-Path $home 'Desktop'),
    (Join-Path $home 'Documents'),
    (Join-Path $home 'OneDrive\Desktop'),
    (Join-Path $home 'OneDrive\Documents'),
    (Join-Path $home 'OneDrive\Downloads'),
    $Root
  )
  foreach ($p in $defaults) { Add-DirUnique $deep $seen $p }
  $all = New-Object System.Collections.Generic.List[System.IO.FileInfo]
  $got = @{}
  foreach ($f in @(Get-ExcelFiles $deep)) { Add-ExcelFile $all $got $f }
  foreach ($d in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
    $driveRoot = [string]$d.Root
    if ($driveRoot -notmatch '^[A-Za-z]:\\$') { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $driveRoot -File -ErrorAction SilentlyContinue)) {
      $name = [string]$f.Name
      if ($name.StartsWith('~$') -or $name.StartsWith('.')) { continue }
      if ($name -notmatch $ExtRe) { continue }
      if ($f.Length -le 0 -or $f.Length -gt $MaxBytes) { continue }
      Add-ExcelFile $all $got $f
    }
    foreach ($dir in @(Get-ChildItem -LiteralPath $driveRoot -Directory -ErrorAction SilentlyContinue)) {
      if ([string]$dir.Name -notmatch '(?i)excel|kantar|ihracat|liste|sevkiyat') { continue }
      foreach ($f in @(Get-ExcelFiles @($dir.FullName))) { Add-ExcelFile $all $got $f }
    }
  }
  return $all
}

function Load-Durum {
  $script:Durum = @{}
  if (-not (Test-Path -LiteralPath $DurumPath)) { return }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $text = [System.IO.File]::ReadAllText($DurumPath, $utf8)
  foreach ($line in ($text -split "`r`n|`n|`r")) {
    if (-not $line) { continue }
    $parts = $line.Split("`t")
    if ($parts.Length -lt 4) { continue }
    $script:Durum[$parts[0]] = @{
      stamp = $parts[1]
      sha = $parts[2]
      sentAt = [int64]$parts[3]
    }
  }
}

function Save-Durum {
  $sb = New-Object System.Text.StringBuilder
  foreach ($k in $script:Durum.Keys) {
    $row = $script:Durum[$k]
    [void]$sb.Append($k)
    [void]$sb.Append("`t")
    [void]$sb.Append([string]$row.stamp)
    [void]$sb.Append("`t")
    [void]$sb.Append([string]$row.sha)
    [void]$sb.Append("`t")
    [void]$sb.Append([string]$row.sentAt)
    [void]$sb.Append("`r`n")
  }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($DurumPath, $sb.ToString(), $utf8)
}

function Send-Excel($file, $base, $key) {
  $full = [string]$file.FullName
  $keyPath = $full.ToLowerInvariant()
  $stamp = '{0}|{1}' -f $file.LastWriteTimeUtc.Ticks, $file.Length
  $prev = $script:Durum[$keyPath]
  $nowMs = [int64]([DateTime]::UtcNow - [DateTime]'1970-01-01Z').TotalMilliseconds
  if ($prev -and $prev.stamp -eq $stamp -and $prev.sha) {
    $ageDays = ($nowMs - [int64]$prev.sentAt) / 86400000
    if ($ageDays -lt 3) { return }
  }
  if ($script:Bekleyen[$keyPath] -ne $stamp) {
    $script:Bekleyen[$keyPath] = $stamp
    return
  }
  $bytes = Read-SharedBytes $full
  if (-not $bytes -or $bytes.Length -eq 0 -or $bytes.Length -gt $MaxBytes) { return }
  $sha = Get-Sha256 $bytes
  if ($prev -and $prev.sha -eq $sha) {
    $ageDays = if ($prev.sentAt) { ($nowMs - [int64]$prev.sentAt) / 86400000 } else { 99 }
    if ($ageDays -lt 3) {
      $script:Durum[$keyPath] = @{ stamp = $stamp; sha = $sha; sentAt = [int64]$prev.sentAt }
      return
    }
  }
  $mtime = [int64]($file.LastWriteTimeUtc - [DateTime]'1970-01-01Z').TotalMilliseconds
  $name = [Uri]::EscapeDataString([string]$file.Name)
  $machine = [Uri]::EscapeDataString([string]$env:COMPUTERNAME)
  $url = "$base/api/excel-agent/upload?name=$name&mtime=$mtime&machine=$machine"
  $res = Invoke-Ajan -Method 'PUT' -Url $url -Body $bytes -Key $key
  if ($res.Code -lt 200 -or $res.Code -ge 300) {
    $script:SonrakiDeneme = (Get-Date).AddSeconds(30)
    throw "Yukleme basarisiz ($($res.Code)) $($file.Name): $($res.Text)"
  }
  if ($res.Text -match '"dropped"\s*:\s*true') {
    Remove-BirakFile $file
    return
  }
  $script:Durum[$keyPath] = @{ stamp = $stamp; sha = $sha; sentAt = $nowMs }
  $kb = [math]::Round($bytes.Length / 1KB)
  Write-Log "Gonderildi: $($file.Name) ($kb KB) $env:COMPUTERNAME"
}

function Set-Birak([string]$text) {
  $next = @{}
  $m = [regex]::Match([string]$text, '"dropFiles"\s*:\s*\[(.*?)\]')
  if ($m.Success) {
    foreach ($hit in [regex]::Matches($m.Groups[1].Value, '"((?:\\.|[^"\\])*)"')) {
      $name = [string]$hit.Groups[1].Value
      if (-not $name) { continue }
      $stem = [System.IO.Path]::GetFileNameWithoutExtension($name).ToLowerInvariant()
      if ($stem) { $next[$stem] = $true }
      $next[$name.ToLowerInvariant()] = $true
    }
  }
  $script:Birak = $next
}

function Test-BirakFile($file) {
  if (-not $script:Birak -or $script:Birak.Count -eq 0 -or -not $file) { return $false }
  $name = ([string]$file.Name).ToLowerInvariant()
  $stem = [System.IO.Path]::GetFileNameWithoutExtension([string]$file.Name).ToLowerInvariant()
  return ($script:Birak.ContainsKey($name) -or $script:Birak.ContainsKey($stem))
}

function Remove-BirakFile($file) {
  $full = [string]$file.FullName
  try {
    if (Test-Path -LiteralPath $full) {
      Remove-Item -LiteralPath $full -Force -ErrorAction Stop
      Write-Log "Tamamlandi, kantardan silindi: $($file.Name)"
    }
  } catch {
    Write-LogOnce "Tamamlanan Excel silinemedi $($file.Name): $($_.Exception.Message)"
  }
  $keyPath = $full.ToLowerInvariant()
  if ($script:Durum.ContainsKey($keyPath)) { $script:Durum.Remove($keyPath) }
}

function Update-Self($base, $key) {
  $localBytes = [System.IO.File]::ReadAllBytes($ScriptPath)
  $localVer = (Get-Sha256 $localBytes).Substring(0, 16)
  $ping = Invoke-Ajan -Method 'GET' -Url "$base/api/excel-agent/ping" -Body $null -Key $key
  if ($ping.Code -ne 200) {
    Write-LogOnce "Sunucuya ulasilamadi ($($ping.Code))."
    return
  }
  $m = [regex]::Match([string]$ping.Text, '"version"\s*:\s*"([0-9a-fA-F]*)"')
  if (-not $m.Success) { return }
  $remoteVer = $m.Groups[1].Value.ToLowerInvariant()
  if (-not $remoteVer -or $remoteVer -eq $localVer) { return }
  $dl = Invoke-Ajan -Method 'GET' -Url "$base/api/excel-agent/script" -Body $null -Key $key
  if ($dl.Code -ne 200 -or -not $dl.Bytes -or $dl.Bytes.Length -lt 100) { return }
  $dlVer = (Get-Sha256 $dl.Bytes).Substring(0, 16)
  if ($dlVer -ne $remoteVer) {
    Write-LogOnce 'Sunucudaki ajan dosyasi dogrulanamadi.'
    return
  }
  $yeni = "$ScriptPath.yeni"
  [System.IO.File]::WriteAllBytes($yeni, $dl.Bytes)
  Copy-Item -LiteralPath $ScriptPath -Destination "$ScriptPath.bak" -Force
  [System.IO.File]::Copy($yeni, $ScriptPath, $true)
  Write-Log "Ajan guncellendi ($remoteVer). Yeniden basliyor."
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
  Start-Process -FilePath $PsExe -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Hidden
  if ($script:Mutex) {
    try { $script:Mutex.ReleaseMutex() } catch {}
    try { $script:Mutex.Dispose() } catch {}
    $script:Mutex = $null
  }
  exit 0
}

function Enter-SingleInstance {
  $mutex = New-Object System.Threading.Mutex($false, 'Local\AracGirisExcelAjani')
  $got = $false
  try {
    $got = $mutex.WaitOne(15000, $false)
  } catch [System.Threading.AbandonedMutexException] {
    $got = $true
  }
  if (-not $got) {
    Write-Log 'Baska bir Excel Ajani zaten calisiyor.'
    exit 0
  }
  $script:Mutex = $mutex
}

if ($Durdur) {
  Stop-AgentProcesses
  Write-Host 'Excel Ajani durduruldu.'
  exit 0
}

if ($Kaldir) {
  Stop-AgentProcesses
  Remove-Startup
  Write-Host 'Excel Ajani kaldirildi.'
  exit 0
}

if (-not (Test-Path -LiteralPath $AyarPath) -and (Test-Path -LiteralPath $OrnekPath)) {
  Copy-Item -LiteralPath $OrnekPath -Destination $AyarPath
}

$ayar = Get-Ayar
$hata = Test-Ayar $ayar
if ($Kontrol) {
  if ($hata) {
    Write-Host $hata
    exit 1
  }
  Write-Host 'Ayarlar tamam.'
  exit 0
}

if ($Kur) {
  if ($hata) {
    Write-Host $hata
    exit 1
  }
  Install-Startup
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
  Start-Process -FilePath $PsExe -ArgumentList $arg -WorkingDirectory $Root -WindowStyle Hidden
  Write-Host 'Excel Ajani arka planda baslatildi.'
  exit 0
}

if ($hata) {
  Write-Log $hata
  while ($true) {
    Start-Sleep -Seconds 20
    $ayar = Get-Ayar
    $hata = Test-Ayar $ayar
    if (-not $hata) { break }
    Write-LogOnce $hata
  }
}

Enter-SingleInstance
Load-Durum
$script:SertifikaAtla = ([string]$ayar['SERTIFIKA']).ToLowerInvariant() -eq 'atla'
$base = Get-Sunucu $ayar
Write-Log "Basladi. Sunucu: $base  Bilgisayar: $env:COMPUTERNAME"

try {
  while ($true) {
    try {
      $yeniAyar = Get-Ayar
      $yeniHata = Test-Ayar $yeniAyar
      if ($yeniHata) {
        Write-LogOnce $yeniHata
      } else {
        $ayar = $yeniAyar
        $script:SertifikaAtla = ([string]$ayar['SERTIFIKA']).ToLowerInvariant() -eq 'atla'
        $base = Get-Sunucu $ayar
        $key = [string]$ayar['ANAHTAR']
        $now = Get-Date
        # Klasor taramasi dakikada bir; arada yalniz bilinen dosyalarin degisimine bakilir
        if (-not $script:Dosyalar -or ($now - $script:SonTarama).TotalSeconds -ge 60) {
          $script:SonTarama = $now
          $script:Dosyalar = @(Get-WatchExcelFiles $ayar)
        }
        $files = @($script:Dosyalar | ForEach-Object { try { [System.IO.FileInfo]::new($_.FullName) } catch { $null } } | Where-Object { $_ -and $_.Exists })
        if (($now - $script:SonPing).TotalSeconds -ge 60) {
          $script:SonPing = $now
          try {
            $ping = Invoke-Ajan -Method 'GET' -Url "$base/api/excel-agent/ping" -Body $null -Key $key
            if ($ping.Code -eq 200) {
              Set-Birak ([string]$ping.Text)
              if (($now - $script:SonBaglantiLog).TotalMinutes -ge 10) {
                $script:SonBaglantiLog = $now
                Write-Log "Baglanti var. Izlenen Excel: $($files.Count)"
              }
            } else {
              Write-LogOnce "Sunucu yaniti: $($ping.Code) $($ping.Text)"
            }
          } catch {
            Write-LogOnce $_.Exception.Message
          }
        }
        if ($now -ge $script:SonrakiDeneme) {
          foreach ($file in $files) {
            try {
              if (Test-BirakFile $file) {
                Remove-BirakFile $file
                continue
              }
              Send-Excel $file $base $key
            } catch {
              # Eski Excel okunamaz veya silinemezse diger dosyalar yine sisteme gider.
              Write-LogOnce $_.Exception.Message
            }
          }
          Save-Durum
        }
        if (($now - $script:SonGuncelleme).TotalMinutes -ge 10) {
          $script:SonGuncelleme = $now
          try { Update-Self $base $key } catch { Write-LogOnce $_.Exception.Message }
        }
      }
    } catch {
      Write-LogOnce $_.Exception.Message
    }
    Start-Sleep -Seconds 3
  }
} finally {
  if ($script:Mutex) {
    try { $script:Mutex.ReleaseMutex() } catch {}
    try { $script:Mutex.Dispose() } catch {}
  }
}
