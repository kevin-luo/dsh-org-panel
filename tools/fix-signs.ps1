# 重裁 8 个部门标牌（加高避免文字裁切）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5\bn3rceho-0f1696c3.png'
$out = 'E:\dsh\dsh-org-panel\src\assets\office'
$img = [System.Drawing.Bitmap]::FromFile($src)

$crops = @(
  @(15, 662, 210, 72, 'sign-rd.png'),
  @(230, 662, 205, 72, 'sign-product.png'),
  @(440, 662, 195, 72, 'sign-meeting.png'),
  @(640, 662, 155, 72, 'sign-reception.png'),
  @(15, 752, 190, 72, 'sign-content.png'),
  @(210, 752, 190, 72, 'sign-media.png'),
  @(405, 752, 190, 72, 'sign-data.png'),
  @(600, 752, 205, 72, 'sign-growth.png')
)
foreach ($c in $crops) {
  $r = New-Object System.Drawing.Rectangle($c[0], $c[1], $c[2], $c[3])
  $b = $img.Clone($r, $img.PixelFormat)
  $b.Save("$out\$($c[4])", [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  Write-Output "OK $($c[4])"
}
$img.Dispose()
