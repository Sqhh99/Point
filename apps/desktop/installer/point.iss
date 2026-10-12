; Point Windows installer (Inno Setup 6.3+). Built by scripts/package.mjs:
;   ISCC /DAppVersion=0.1.0 /DArch=x64|arm64 /DSourceDir=<win-unpacked> /DOutputDir=<release> point.iss
; Per-user install (no UAC). AppId is fixed forever: changing it breaks upgrade-in-place and uninstall.
; User data lives in %APPDATA%\Point, outside {app}; uninstall keeps it unless the user opts in.

#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef Arch
  #error Arch is required (x64 or arm64)
#endif

[Setup]
AppId={{6F3B2C1E-8A4D-4E7B-9C2F-5D1A0B7E3C94}
AppName=Point
AppVersion={#AppVersion}
AppVerName=Point {#AppVersion}
AppPublisher=Sqhh99
AppPublisherURL=https://github.com/Sqhh99/Point
AppSupportURL=https://github.com/Sqhh99/Point/issues
AppUpdatesURL=https://github.com/Sqhh99/Point/releases
DefaultDirName={localappdata}\Programs\Point
DefaultGroupName=Point
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
OutputDir={#OutputDir}
OutputBaseFilename=Point-{#AppVersion}-win-{#Arch}-setup
UninstallDisplayIcon={app}\Point.exe
UninstallDisplayName=Point
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
#if FileExists(AddBackslash(SourcePath) + "..\build\icon.ico")
SetupIconFile=..\build\icon.ico
#endif
#if FileExists(AddBackslash(SourcePath) + "..\build\installer\wizard-large.bmp")
WizardImageFile=..\build\installer\wizard-large.bmp
#endif
#if FileExists(AddBackslash(SourcePath) + "..\build\installer\wizard-small.bmp")
WizardSmallImageFile=..\build\installer\wizard-small.bmp
#endif

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Point"; Filename: "{app}\Point.exe"
Name: "{autodesktop}\Point"; Filename: "{app}\Point.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Point.exe"; Description: "{cm:LaunchProgram,Point}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent() then
    if MsgBox('是否同时删除 Point 的笔记和设置？'#13#10'（%APPDATA%\Point）',
              mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(ExpandConstant('{userappdata}\Point'), True, True, True);
end;
