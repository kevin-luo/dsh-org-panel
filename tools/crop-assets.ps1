# 资产裁剪脚本：把资产大图裁成独立 PNG 文件
# 输出到 src/assets/（随包发布，经 DSH Web /plugins/dsh-org-panel/assets/ 访问）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\Administrator\AppData\Roaming\Qoder\SharedClientCache\cache\images\task-dd5'
$out = 'E:\dsh\dsh-org-panel\src\assets'
New-Item -ItemType Directory -Force -Path "$out\staff", "$out\office", "$out\ui" | Out-Null

function Crop($file, $x, $y, $w, $h, $name) {
  $img = [System.Drawing.Bitmap]::FromFile("$src\$file")
  $rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
  $crop = $img.Clone($rect, $img.PixelFormat)
  $crop.Save("$out\$name", [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose(); $img.Dispose()
  Write-Output "OK $name ($w x $h)"
}

# ============ 员工立绘（4列 x 2行，cell 362x543，取上部去掉名牌） ============
$CW = 362; $CH = 543; $PH = 436   # portrait height：去掉底部名牌

# 图 1：老王 大壮 小明 阿搜 / 小周 阿南 小麦 小静
$f1 = '8nsnp2x1-352109b0.png'
Crop $f1 (0*$CW) 0 $CW $PH 'staff/tech-lead.png'        # 老王
Crop $f1 (1*$CW) 0 $CW $PH 'staff/platform.png'         # 大壮
Crop $f1 (2*$CW) 0 $CW $PH 'staff/pm.png'               # 小明(产品经理)
Crop $f1 (3*$CW) 0 $CW $PH 'staff/search-specialist.png' # 阿搜
Crop $f1 (0*$CW) $CH $CW $PH 'staff/developer.png'      # 小周(前端)
Crop $f1 (1*$CW) $CH $CW $PH 'staff/developer-2.png'    # 阿南(后端，备用)
Crop $f1 (2*$CW) $CH $CW $PH 'staff/data-analyst.png'   # 小麦(数据分析师)
Crop $f1 (3*$CW) $CH $CW $PH 'staff/recruiter.png'      # 小静(招聘/行政)

# 图 2：小画 阿镜 南枝 柚子 / 阿阅 小雨 小白 阿图
$f2 = '9lo89eew-3b5d19aa.png'
Crop $f2 (0*$CW) 0 $CW $PH 'staff/image-creator.png'    # 小画
Crop $f2 (1*$CW) 0 $CW $PH 'staff/video-producer.png'   # 阿镜
Crop $f2 (2*$CW) 0 $CW $PH 'staff/novelist.png'         # 南枝
Crop $f2 (3*$CW) 0 $CW $PH 'staff/social-editor.png'    # 柚子
Crop $f2 (0*$CW) $CH $CW $PH 'staff/doc.png'            # 阿阅(知识库)
Crop $f2 (1*$CW) $CH $CW $PH 'staff/community.png'      # 小雨(社区运营，备用)
Crop $f2 (2*$CW) $CH $CW $PH 'staff/growth.png'         # 小白(增长运营)
Crop $f2 (3*$CW) $CH $CW $PH 'staff/researcher.png'     # 阿图(AI插件研究员)

Write-Output '--- staff done ---'
