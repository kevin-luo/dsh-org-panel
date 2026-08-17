# 办公室家具 + Logo 裁剪
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5'
$out = 'E:\dsh\dsh-org-panel\src\assets'

function Crop($file, $x, $y, $w, $h, $name) {
  $img = [System.Drawing.Bitmap]::FromFile("$src\$file")
  $rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
  $crop = $img.Clone($rect, $img.PixelFormat)
  $crop.Save("$out\$name", [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose(); $img.Dispose()
  Write-Output "OK $name ($w x $h)"
}

$f = 'bn3rceho-0f1696c3.png'   # 家具资产图 1448x1086

# ===== 第 1 行：工位 / 前台 / 会议桌 =====
Crop $f   10  20 470 205 'office/desk-dual.png'
Crop $f  505  20 245 205 'office/desk-single.png'
Crop $f  765  10 380 225 'office/reception.png'
Crop $f 1155  10 290 215 'office/meeting-table.png'

# ===== 第 2 行：沙发 / 茶几 / 椅子 / 绿植 =====
Crop $f   10 245 435 215 'office/sofa-set.png'
Crop $f  480 265 265 180 'office/coffee-table.png'
Crop $f  770 235 150 210 'office/office-chair.png'
Crop $f 1115 245 120 205 'office/plant-large.png'
Crop $f 1240 255 110 195 'office/plant-medium.png'
Crop $f 1355 265  90 185 'office/plant-small.png'

# ===== 第 3 行：书架 / 霓虹牌 / 窗 / 门 / 玻璃墙 =====
Crop $f   15 465 220 195 'office/bookshelf.png'
Crop $f  240 460 195 185 'office/neon-logo.png'
Crop $f  445 465 360 190 'office/window-city.png'
Crop $f  810 465 245 195 'office/glass-door.png'
Crop $f 1065 465 380 195 'office/glass-wall.png'

# ===== 第 4 行：部门标牌 =====
Crop $f   15 670 210  60 'office/sign-rd.png'
Crop $f  230 670 205  60 'office/sign-product.png'
Crop $f  440 670 195  60 'office/sign-meeting.png'
Crop $f  640 670 155  60 'office/sign-reception.png'
Crop $f   15 760 190  60 'office/sign-content.png'
Crop $f  210 760 190  60 'office/sign-media.png'
Crop $f  405 760 190  60 'office/sign-data.png'
Crop $f  600 760 205  60 'office/sign-growth.png'

# ===== 第 4 行右侧：大屏 / 机柜 / 贩卖机 / 咖啡机 =====
Crop $f  690 660 320 190 'office/dashboard-screen.png'
Crop $f 1020 660 115 220 'office/server-rack.png'
Crop $f 1140 660 155 220 'office/vending-machine.png'
Crop $f 1300 660 145 220 'office/coffee-machine.png'

# ===== 第 5 行：地板 / 落地灯 =====
Crop $f   10 890 250 195 'office/floor-dark.png'
Crop $f  265 890 250 195 'office/floor-wood.png'
Crop $f  520 890 250 195 'office/floor-carpet.png'
Crop $f  795 890 160 170 'office/floor-round.png'
Crop $f  960 880  90 205 'office/floor-lamp.png'

# ===== Logo（来自图标资产图 k7m7rmje-84cf7fc2.png） =====
$g = 'k7m7rmje-84cf7fc2.png'
Crop $g   30  15 540 205 'ui/logo-full.png'      # 横版带文字 logo
Crop $g  980  25 165 165 'ui/logo-hex.png'       # 六边形图标

Write-Output '--- office/ui done ---'
