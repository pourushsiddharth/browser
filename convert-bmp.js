const { execSync } = require('child_process');

try {
  console.log("Converting installerSidebar.png to installerSidebar.bmp...");
  execSync('powershell -Command "Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile(\'installerSidebar.png\'); $img.Save(\'installerSidebar.bmp\', [System.Drawing.Imaging.ImageFormat]::Bmp); $img.Dispose();"');
  
  console.log("Converting installerHeader.png to installerHeader.bmp...");
  execSync('powershell -Command "Add-Type -AssemblyName System.Drawing; $img = [System.Drawing.Image]::FromFile(\'installerHeader.png\'); $img.Save(\'installerHeader.bmp\', [System.Drawing.Imaging.ImageFormat]::Bmp); $img.Dispose();"');
  
  console.log("Conversion successful! Both BMP images generated.");
} catch (error) {
  console.error("Error converting images:", error.message);
}
