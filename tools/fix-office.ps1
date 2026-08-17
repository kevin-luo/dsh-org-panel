# 按源图实际布局重裁：标牌两行 + 椅子/绿植/窗/霓虹牌/茶几/玻璃墙
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5\bn3rceho-0f1696c3.png'
$out = 'E:\dsh\dsh-org-panel\src\assets\office'
$img = [System.Drawing.Bitmap]::FromFile($src)

$crops = @(
  # ===== 标牌第 1 行 (y≈685-747) =====
  @(15, 685, 150, 62, 'sign-rd.png'),         # 研发部
  @(185, 685, 155, 62, 'sign-product.png'),   # 产品部
  @(355, 685, 145, 62, 'sign-meeting.png'),   # 会议室
  @(510, 685, 150, 62, 'sign-reception.png'), # 前台
  # ===== 标牌第 2 行 (y≈775-837) =====
  @(15, 775, 150, 62, 'sign-content.png'),    # 内容创作部
  @(175, 775, 155, 62, 'sign-media.png'),     # 多媒体部
  @(340, 775, 160, 62, 'sign-data.png'),      # 数据与分析部
  @(510, 775, 155, 62, 'sign-growth.png'),    # 运营与推广部
  @(675, 775, 125, 62, 'sign-breakroom.png'), # 茶水间
  # ===== 椅子（三把中的第一把，正面） =====
  @(720, 268, 115, 185, 'office-chair.png'),
  # ===== 绿植三盆（第 2 行右侧） =====
  @(1080, 248, 150, 215, 'plant-large.png'),
  @(1240, 278, 115, 185, 'plant-medium.png'),
  @(1355, 328, 90, 135, 'plant-small.png'),
  # ===== 第 3 行修正 =====
  @(248, 468, 155, 150, 'neon-logo.png'),
  @(420, 465, 315, 185, 'window-city.png'),
  @(768, 465, 245, 195, 'glass-door.png'),
  @(1040, 458, 400, 200, 'glass-wall.png'),
  @(480, 295, 265, 160, 'coffee-table.png'),
  # ===== 机器（更高，y 665 起） =====
  @(1020, 665, 120, 220, 'server-rack.png'),
  @(1150, 665, 145, 220, 'vending-machine.png'),
  @(1305, 665, 140, 220, 'coffee-machine.png'),
  # ===== 落地灯（更高，y 855 起） =====
  @(958, 852, 95, 230, 'floor-lamp.png'),
  # ===== 前台（收紧右缘） =====
  @(758, 15, 378, 222, 'reception.png')
)
foreach ($c in $crops) {
  $r = New-Object System.Drawing.Rectangle($c[0], $c[1], $c[2], $c[3])
  $b = $img.Clone($r, $img.PixelFormat)
  $b.Save("$out\$($c[4])", [System.Drawing.Imaging.ImageFormat]::Png)
  $b.Dispose()
  Write-Output "OK $($c[4]) ($($c[2])x$($c[3]))"
}
$img.Dispose()
Write-Output '--- fix done ---'
