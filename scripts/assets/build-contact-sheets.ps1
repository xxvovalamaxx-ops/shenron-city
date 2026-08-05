$ErrorActionPreference = "Stop"
$ffmpeg = "C:\Users\xxvov\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe"
$pv = "E:\temp projects\shenron-city\ds\asset-technical\evidence\assets\previews"
$cs = "E:\temp projects\shenron-city\ds\asset-technical\evidence\assets\contact-sheets"
New-Item -ItemType Directory -Force -Path $cs | Out-Null

function Make-Sheet($name, $files, $cols) {
  $n = $files.Count
  $rows = [Math]::Ceiling($n / $cols)
  $cells = @()
  for ($i = 0; $i -lt $rows * $cols; $i++) {
    $r = [Math]::Floor($i / $cols)
    $c = $i % $cols
    if ($i -ge $n) { continue }
    $x = if ($c -eq 0) { "0" } else { "{0}*w0" -f $c }
    $y = if ($r -eq 0) { "0" } else { "{0}*h0" -f $r }
    $cells += ("{0}_{1}" -f $x, $y)
  }
  $layout = $cells -join "|"
  $cmdArgs = @("-y")
  foreach ($f in $files) { $cmdArgs += @("-i", $f) }
  $fc = "[0:v]" + ((1..($n-1) | ForEach-Object { "[{0}:v]" -f $_ }) -join "") + "xstack=inputs=${n}:layout=$layout"
  $cmdArgs += @("-filter_complex", $fc)
  $out = Join-Path $cs $name
  $cmdArgs += $out
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ffmpeg
  $psi.Arguments = ($cmdArgs | ForEach-Object { if ($_ -match " ") { "`"$_`"" } else { $_ } }) -join " "
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { Write-Output "ffmpeg FAIL: $name"; Write-Output "ARGS: $($psi.Arguments)"; Write-Output ($stderr -split "`n" | Select-Object -Last 2); return }
  Write-Output "sheet: $name"
}

Get-ChildItem $pv -Directory | ForEach-Object {
  $dir = $_.FullName
  $pngs = Get-ChildItem $dir -File -Filter *.png
  if ($pngs.Count -eq 0) { return }
  $order = @("front.png","back.png","left.png","right.png","threequarter.png","wireframe.png","scale-reference.png","rig.png","interior.png")
  $files = @()
  foreach ($o in $order) { $p = Join-Path $dir $o; if (Test-Path $p) { $files += $p } }
  foreach ($png in $pngs | Sort-Object Name) { if ($files -notcontains $png.FullName) { $files += $png.FullName } }
  if ($files.Count -le 4) { $cols = $files.Count } else { $cols = 4 }
  Make-Sheet ($_.Name + "_contact.png") $files $cols
}

Get-ChildItem $pv -Directory | Where-Object { $_.Name -like "*Animations*" } | ForEach-Object {
  $pngs = Get-ChildItem $_.FullName -File -Filter *.png | Sort-Object Name
  if ($pngs.Count -gt 0) {
    Make-Sheet ($_.Name + "_strip.png") ($pngs | ForEach-Object { $_.FullName }) 6
  }
}
Write-Output "done"
