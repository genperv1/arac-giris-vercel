$ErrorActionPreference = 'SilentlyContinue'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
while ($true) {
  foreach ($j in @(Get-CimInstance -ClassName Win32_PrintJob)) {
    $doc = [string]$j.Document
    if ($doc) { [Console]::Out.WriteLine($doc) }
  }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 200
}
