$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Version = $env:VERSION
if (-not $Version) { $Version = "0.1.0" }
$PackageName = "frostbyte-control-plane"
$DistRoot = Join-Path $Root "dist\windows"
$Stage = Join-Path $DistRoot "app"
$OutDir = Join-Path $DistRoot "installer"
$IssPath = Join-Path $DistRoot "frostbyte-control-plane.iss"

npm.cmd run build

if (Test-Path $DistRoot) {
  Remove-Item -LiteralPath $DistRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $Stage,$OutDir | Out-Null

Copy-Item -LiteralPath (Join-Path $Root "package.json") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Root "package-lock.json") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Root ".env.example") -Destination $Stage

New-Item -ItemType Directory -Force -Path (Join-Path $Stage "apps\api"),(Join-Path $Stage "apps\worker"),(Join-Path $Stage "apps\web"),(Join-Path $Stage "packages\core"),(Join-Path $Stage "bin") | Out-Null
Copy-Item -LiteralPath (Join-Path $Root "apps\api\package.json") -Destination (Join-Path $Stage "apps\api")
Copy-Item -LiteralPath (Join-Path $Root "apps\api\dist") -Destination (Join-Path $Stage "apps\api") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "apps\worker\package.json") -Destination (Join-Path $Stage "apps\worker")
Copy-Item -LiteralPath (Join-Path $Root "apps\worker\dist") -Destination (Join-Path $Stage "apps\worker") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "apps\web\package.json") -Destination (Join-Path $Stage "apps\web")
Copy-Item -LiteralPath (Join-Path $Root "apps\web\dist") -Destination (Join-Path $Stage "apps\web") -Recurse
Copy-Item -LiteralPath (Join-Path $Root "packages\core\package.json") -Destination (Join-Path $Stage "packages\core")
Copy-Item -LiteralPath (Join-Path $Root "packages\core\dist") -Destination (Join-Path $Stage "packages\core") -Recurse

Push-Location $Stage
npm.cmd ci --omit=dev --workspaces --ignore-scripts
Pop-Location

@'
@echo off
cd /d "%~dp0.."
if not defined APP_HOST set APP_HOST=0.0.0.0
if not defined APP_PORT set APP_PORT=4310
if not defined BARYON_STATE_FILE set BARYON_STATE_FILE=%ProgramData%\FrostbyteControlPlane\app-state.json
if not defined OLLAMA_BASE_URL set OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
if not exist "%ProgramData%\FrostbyteControlPlane" mkdir "%ProgramData%\FrostbyteControlPlane"
npm --workspace apps/api start
'@ | Set-Content -LiteralPath (Join-Path $Stage "bin\start-api.cmd") -Encoding ASCII

@'
@echo off
cd /d "%~dp0.."
if not defined WORKER_POLL_MS set WORKER_POLL_MS=2000
npm --workspace apps/worker start
'@ | Set-Content -LiteralPath (Join-Path $Stage "bin\start-worker.cmd") -Encoding ASCII

@'
@echo off
cd /d "%~dp0.."
if not defined VITE_API_URL set VITE_API_URL=http://localhost:4310
npm --workspace apps/web run preview -- --host 0.0.0.0 --port 5173
'@ | Set-Content -LiteralPath (Join-Path $Stage "bin\start-web.cmd") -Encoding ASCII

@'
@echo off
start "Frostbyte API" "%~dp0start-api.cmd"
start "Frostbyte Worker" "%~dp0start-worker.cmd"
start "Frostbyte Web" "%~dp0start-web.cmd"
start "" "http://localhost:5173"
'@ | Set-Content -LiteralPath (Join-Path $Stage "bin\start-all.cmd") -Encoding ASCII

$StageEscaped = $Stage.Replace("\", "\\")
$OutDirEscaped = $OutDir.Replace("\", "\\")
@"
#define MyAppName "Frostbyte Control Plane"
#define MyAppVersion "$Version"
#define MyAppPublisher "Leeroi Alter"
#define MyAppExeName "start-all.cmd"

[Setup]
AppId={{FrostbyteControlPlane}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Frostbyte Control Plane
DefaultGroupName=Frostbyte Control Plane
DisableProgramGroupPage=yes
OutputDir=$OutDirEscaped
OutputBaseFilename=frostbyte-control-plane-$Version-win-x64-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern

[Files]
Source: "$StageEscaped\\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Start Frostbyte Control Plane"; Filename: "{app}\bin\start-all.cmd"; WorkingDir: "{app}"
Name: "{group}\Start API"; Filename: "{app}\bin\start-api.cmd"; WorkingDir: "{app}"
Name: "{group}\Start Web"; Filename: "{app}\bin\start-web.cmd"; WorkingDir: "{app}"
Name: "{commondesktop}\Frostbyte Control Plane"; Filename: "{app}\bin\start-all.cmd"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{app}\bin\start-all.cmd"; Description: "Start Frostbyte Control Plane"; Flags: postinstall skipifsilent nowait
"@ | Set-Content -LiteralPath $IssPath -Encoding UTF8

$isccCommand = Get-Command iscc.exe -ErrorAction SilentlyContinue
$isccPath = if ($isccCommand) { $isccCommand.Source } else { $null }
if (-not $isccPath) {
  $candidate = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
  if (Test-Path $candidate) {
    $isccPath = $candidate
  }
}
if (-not $isccPath) {
  throw "Inno Setup compiler not found. Install with: choco install innosetup -y"
}

& $isccPath $IssPath
if ($LASTEXITCODE -ne 0) { throw "Inno Setup build failed" }

Get-ChildItem -LiteralPath $OutDir -Filter "*.exe" | Select-Object -ExpandProperty FullName
