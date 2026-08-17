Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5\bn3rceho-0f1696c3.png'
$out = 'E:\dsh\dsh-org-panel\src\assets\office'
$img = [System.Drawing.Bitmap]::FromFile($src)
$crops = @(
  @(505, 775, 118, 62, 'sign-growth.png'),
  @(630, 775, 128, 62, 'sign-breakroom.png')
)
foreach ($c in $crops) {
  $r = New-Object System.Drawing.Rectangle($c[0], $c[1], $c[2], $c[3])
  $b = $img.Clone($r, $img.PixelFormat)
  $b.Save("$out\$($c[4])", [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  Write-Output "OK $($c[4])"
}
$img.Dispose()
