Get-CimInstance Win32_Process -Filter 'Name="powershell.exe"' |
  Sort-Object CreationDate -Descending |
  Select-Object -First 10 ProcessId, ParentProcessId, CreationDate, CommandLine |
  Format-List
