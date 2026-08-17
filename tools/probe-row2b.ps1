Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5\bn3rceho-0f1696c3.png'
$img = [System.Drawing.Bitmap]::FromFile($src)
# 段1: x 330-560 (数据与分析部 + 运营与推广部)
$r1 = New-Object System.Drawing.Rectangle(330, 770, 230, 75)
$b1 = $img.Clone($r1, $img.PixelFormat)
$b1.Save('E:\dsh\dsh-org-panel\tools\probe-a.png', [System.Drawing.Imaging.ImageFormat]::Png)
$b1.Dispose()
# 段2: x 540-820 (运营与推广部 + 茶水间)
$r2 = New-Object System.Drawing.Rectangle(540, 770, 280, 75)
$b2 = $img.Clone($r2, $img.PixelFormat)
$b2.Save('E:\dsh\dsh-org-panel\tools\probe-b.png', [System.Drawing.Imaging.ImageFormat]::Png)
$b2.Dispose()
$img.Dispose()
Write-Output 'probes saved'
