$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
try { Add-Type -AssemblyName System.Printing } catch {}
$printServer = $null
try { $printServer = New-Object System.Printing.LocalPrintServer } catch {}
while ($true) {
  if ($printServer) {
    try { $printServer.Refresh() } catch {}
    foreach ($q in @($printServer.GetPrintQueues())) {
      try { $q.Refresh() } catch { continue }
      try {
        foreach ($job in @($q.GetPrintJobInfoCollection())) {
          $name = [string]$job.Name
          $id = [string]$job.JobIdentifier
          if ($name) { [Console]::Out.WriteLine("$id`t$name") }
        }
      } catch {}
    }
  }
  foreach ($j in @(Get-CimInstance -ClassName Win32_PrintJob)) {
    $doc = [string]$j.Document
    $id = [string]$j.JobId
    if ($doc) { [Console]::Out.WriteLine("$id`t$doc") }
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 40
}
