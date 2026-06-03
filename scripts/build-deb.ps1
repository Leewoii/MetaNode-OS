$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Version = "0.1.0"
$Package = "frostbyte-control-plane"
$StageRoot = Join-Path $Root "dist\deb"
$Stage = Join-Path $StageRoot "${Package}_${Version}_amd64"
$OutDeb = Join-Path $StageRoot "${Package}_${Version}_amd64.deb"

npm.cmd run build

if (Test-Path $Stage) {
  Remove-Item -LiteralPath $Stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$Debian = Join-Path $Stage "DEBIAN"
$Opt = Join-Path $Stage "opt\frostbyte-control-plane"
$Etc = Join-Path $Stage "etc\frostbyte-control-plane"
$Systemd = Join-Path $Stage "lib\systemd\system"
New-Item -ItemType Directory -Force -Path $Debian,$Opt,$Etc,$Systemd | Out-Null

Copy-Item -LiteralPath (Join-Path $Root "package.json") -Destination $Opt
Copy-Item -LiteralPath (Join-Path $Root "package-lock.json") -Destination $Opt
Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination $Opt

New-Item -ItemType Directory -Force -Path (Join-Path $Opt "apps\api"),(Join-Path $Opt "apps\worker"),(Join-Path $Opt "apps\web"),(Join-Path $Opt "packages\core") | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "apps\api\package.json") -Destination (Join-Path $Opt "apps\api")
Copy-Item -LiteralPath (Join-Path $Root "apps\api\dist") -Destination (Join-Path $Opt "apps\api") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "apps\worker\package.json") -Destination (Join-Path $Opt "apps\worker")
Copy-Item -LiteralPath (Join-Path $Root "apps\worker\dist") -Destination (Join-Path $Opt "apps\worker") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "apps\web\package.json") -Destination (Join-Path $Opt "apps\web")
Copy-Item -LiteralPath (Join-Path $Root "apps\web\dist") -Destination (Join-Path $Opt "apps\web") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "packages\core\package.json") -Destination (Join-Path $Opt "packages\core")
Copy-Item -LiteralPath (Join-Path $Root "packages\core\dist") -Destination (Join-Path $Opt "packages\core") -Recurse

Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\env") -Destination (Join-Path $Etc "env")
Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\frostbyte-api.service") -Destination $Systemd
Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\frostbyte-worker.service") -Destination $Systemd
Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\frostbyte-web.service") -Destination $Systemd
Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\postinst") -Destination $Debian
Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\prerm") -Destination $Debian
Copy-Item -LiteralPath (Join-Path $Root "packaging\deb\postrm") -Destination $Debian

$InstalledSize = [Math]::Ceiling(((Get-ChildItem -LiteralPath $Stage -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1024))
@"
Package: $Package
Version: $Version
Section: web
Priority: optional
Architecture: amd64
Maintainer: Frostbyte <frostbyte@local>
Depends: nodejs (>= 20), npm
Installed-Size: $InstalledSize
Description: Frostbyte Control Plane local AI workflow orchestrator
 Local-first Chat + Canvas AI workflow orchestrator with Ollama-first model support.
"@ | Set-Content -LiteralPath (Join-Path $Debian "control")

wsl bash -lc "rm -rf /tmp/frostbyte-control-plane-deb && mkdir -p /tmp/frostbyte-control-plane-deb && cp -a '/mnt/c/Users/Frost/Documents/Codex/2026-05-07/baryon-agent/dist/deb/frostbyte-control-plane_0.1.0_amd64' /tmp/frostbyte-control-plane-deb/"
if ($LASTEXITCODE -ne 0) { throw "copy to wsl failed" }
wsl bash -lc "cd /tmp/frostbyte-control-plane-deb/frostbyte-control-plane_0.1.0_amd64 && chmod -R u=rwX,go=rX . && chmod 755 DEBIAN && chmod 644 DEBIAN/control && chmod 755 DEBIAN/postinst DEBIAN/prerm DEBIAN/postrm"
if ($LASTEXITCODE -ne 0) { throw "chmod failed" }
wsl bash -lc "dpkg-deb --build --root-owner-group /tmp/frostbyte-control-plane-deb/frostbyte-control-plane_0.1.0_amd64 /tmp/frostbyte-control-plane-deb/frostbyte-control-plane_0.1.0_amd64.deb && cp /tmp/frostbyte-control-plane-deb/frostbyte-control-plane_0.1.0_amd64.deb '/mnt/c/Users/Frost/Documents/Codex/2026-05-07/baryon-agent/dist/deb/frostbyte-control-plane_0.1.0_amd64.deb'"
if ($LASTEXITCODE -ne 0) { throw "dpkg-deb failed" }

Write-Host $OutDeb
