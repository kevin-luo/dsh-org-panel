# 扫描标牌边界：对每列统计亮像素数，找连续亮区段
Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5\bn3rceho-0f1696c3.png'
$img = New-Object System.Drawing.Bitmap($src)

$y0 = 778; $y1 = 832   # 标牌行纵向范围
$cols = @{}
for ($x = 0; $x -lt 820; $x++) {
  $bright = 0
  for ($y = $y0; $y -lt $y1; $y += 2) {
    $p = $img.GetPixel($x, $y)
    if (($p.R + $p.G + $p.B) -gt 180) { $bright++ }
  }
  $cols[$x] = $bright
}
# 找连续段：亮像素数 >= 4 视为标牌内部
$inSeg = $false; $start = 0
$segs = @()
for ($x = 0; $x -lt 820; $x++) {
  $on = $cols[$x] -ge 4
  if ($on -and -not $inSeg) { $inSeg = $true; $start = $x }
  if (-not $on -and $inSeg) { $inSeg = $false; $segs += "$start..$($x-1) (w=$($x-$start))" }
}
if ($inSeg) { $segs += "$start..819" }
Write-Output 'Row2 bright segments:'
$segs | ForEach-Object { Write-Output $_ }

# 同样方法扫第 1 行标牌 y 688-742
$y0 = 688; $y1 = 742
$cols = @{}
for ($x = 0; $x -lt 700; $x++) {
  $bright = 0
  for ($y = $y0; $y -lt $y1; $y += 2) {
    $p = $img.GetPixel($x, $y)
    if (($p.R + $p.G + $p.B) -gt 180) { $bright++ }
  }
  $cols[$x] = $bright
}
$inSeg = $false; $start = 0
$segs = @()
for ($x = 0; $x -lt 700; $x++) {
  $on = $cols[$x] -ge 4
  if ($on -and -not $inSeg) { $inSeg = $true; $start = $x }
  if (-not $on -and $inSeg) { $inSeg = $false; $segs += "$start..$($x-1) (w=$($x-$start))" }
}
if ($inSeg) { $segs += "$start..699" }
Write-Output 'Row1 bright segments:'
$segs | ForEach-Object { Write-Output $_ }
$img.Dispose()
