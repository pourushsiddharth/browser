Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("c:\Users\pouru\OneDrive\Desktop\Project\browser\vayu_bg.jpg")

# Resize to sidebar (164x314)
$sidebar = New-Object System.Drawing.Bitmap 164, 314
$g = [System.Drawing.Graphics]::FromImage($sidebar)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, 164, 314)
$g.Dispose()
$sidebar.Save("c:\Users\pouru\OneDrive\Desktop\Project\browser\installerSidebar.png", [System.Drawing.Imaging.ImageFormat]::Png)
$sidebar.Dispose()

# Resize to header (150x57)
$header = New-Object System.Drawing.Bitmap 150, 57
$g = [System.Drawing.Graphics]::FromImage($header)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, 150, 57)
$g.Dispose()
$header.Save("c:\Users\pouru\OneDrive\Desktop\Project\browser\installerHeader.png", [System.Drawing.Imaging.ImageFormat]::Png)
$header.Dispose()

$src.Dispose()
write-host "Installer assets resized successfully!"
