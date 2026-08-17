Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5\bn3rceho-0f1696c3.png'
$img = [System.Drawing.Bitmap]::FromFile($src)
$r = New-Object System.Drawing.Rectangle(0, 770, 820, 75)
$b = $img.Clone($r, $img.PixelFormat)
$b.Save('E:\dsh\dsh-org-panel\tools\row2-probe.png', [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose(); $img.Dispose()
Write-Output 'probe saved'
