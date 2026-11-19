; Instalador da Secretaria MiguelAngelus (Inno Setup 6).
; Gerar tudo assinado: powershell -ExecutionPolicy Bypass -File secretaria\instalador\gerar_secretaria.ps1
;
; - Programa separado do MiguelAngelus (outro AppId): os dois podem ficar instalados no mesmo computador.
; - Instala por usuário, sem pedir administrador.
; - Os dados (agenda e avisos) ficam em %LOCALAPPDATA%\SecretariaMiguelAngelus e NÃO são apagados ao desinstalar.

#define Nome "Secretaria MiguelAngelus"
#define Versao "1.5.0"
#define Editor "Paróquia São José Operário — PASCOM"
#define Exe "SecretariaMiguelAngelus.exe"

[Setup]
; AppId fixo da Secretaria: versões novas instalam por cima desta
AppId={{B0722989-6D05-46F8-9056-D0A58293D519}
AppName={#Nome}
AppVersion={#Versao}
AppVerName={#Nome} {#Versao}
AppPublisher={#Editor}
AppComments=Agenda e avisos da paróquia para o MiguelAngelus
VersionInfoVersion={#Versao}
VersionInfoDescription=Instalador da {#Nome}
DefaultDirName={autopf}\{#Nome}
DefaultGroupName={#Nome}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=.
OutputBaseFilename=Instalar Secretaria MiguelAngelus {#Versao}
SetupIconFile=..\marca\icone.ico
UninstallDisplayIcon={app}\{#Exe}
UninstallDisplayName={#Nome}
WizardStyle=modern
DisableWelcomePage=no
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "atalho"; Description: "Criar atalho na Área de Trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "..\Secretaria MiguelAngelus App\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#Nome}"; Filename: "{app}\{#Exe}"; Comment: "Agenda e avisos da paróquia"
Name: "{group}\Desinstalar a {#Nome}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#Nome}"; Filename: "{app}\{#Exe}"; Tasks: atalho; Comment: "Agenda e avisos da paróquia"

[Run]
Filename: "{app}\{#Exe}"; Description: "Abrir a {#Nome} agora"; Flags: nowait postinstall skipifsilent
; atualização automática (instalação silenciosa): reabre o programa sozinho no fim
Filename: "{app}\{#Exe}"; Flags: nowait postinstall skipifnotsilent

[Messages]
pt.WelcomeLabel2=Este assistente vai instalar a [name/ver] neste computador.%n%nA Secretaria MiguelAngelus cadastra a agenda da paróquia (celebrações) e os avisos paroquiais, que chegam ao MiguelAngelus pela nuvem da paróquia.%n%nSe já houver uma versão instalada, ela será atualizada e os dados serão mantidos.

[Code]
// Avisa (sem impedir) se faltar o WebView2 ou o .NET Framework 4.8, que o programa usa
function TemWebView2: Boolean;
var v: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) and (v <> '') and (v <> '0.0.0.0') or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', v) and (v <> '') and (v <> '0.0.0.0');
end;

function TemDotNet48: Boolean;
var r: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', r) and (r >= 528040);
end;

function InitializeSetup: Boolean;
var faltando: String;
begin
  Result := True;
  faltando := '';
  if not TemWebView2 then faltando := faltando + #13#10 + '• Microsoft Edge WebView2 (go.microsoft.com/fwlink/p/?LinkId=2124703)';
  if not TemDotNet48 then faltando := faltando + #13#10 + '• .NET Framework 4.8 (Windows Update)';
  if faltando <> '' then
    Result := MsgBox('Este computador ainda não tem:' + faltando + #13#10#13#10 +
      'A Secretaria MiguelAngelus precisa deles para abrir. Você pode instalar agora e baixar isso depois.' + #13#10#13#10 +
      'Continuar a instalação?', mbConfirmation, MB_YESNO) = IDYES;
end;
