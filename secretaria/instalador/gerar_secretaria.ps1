# Gera uma versão ASSINADA da Secretaria MiguelAngelus: publica o app, assina o .exe, monta o instalador,
# assina o instalador e copia para a área de trabalho.
# Antes: abrir o SimplySign Desktop e entrar (e-mail + código do app SimplySign no celular).
# Uso:  powershell -ExecutionPolicy Bypass -File secretaria\instalador\gerar_secretaria.ps1
$ErrorActionPreference = 'Stop'
$pastaSec = Split-Path $PSScriptRoot -Parent            # ...\Lumen\secretaria
$raiz = Split-Path $pastaSec -Parent                     # ...\Lumen
$signtool = Join-Path $raiz 'instalador\signtool\signtool.exe'
$assinante = 'Open Source Developer Marcio Aurelio Rios Martins'
$carimbo = 'http://time.certum.pl'
$iscc = Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'

function Assinar($arquivo) {
  Write-Host "Assinando $arquivo"
  & $signtool sign /n $assinante /fd sha256 /tr $carimbo /td sha256 /d 'Secretaria MiguelAngelus' $arquivo
  if ($LASTEXITCODE) { throw "Falhou ao assinar $arquivo (o SimplySign Desktop está aberto e conectado?)" }
  & $signtool verify /pa /q $arquivo
  if ($LASTEXITCODE) { throw "Assinatura não conferiu: $arquivo" }
}

$iss = Join-Path $PSScriptRoot 'SecretariaMiguelAngelus.iss'
$versao = ([regex]'#define Versao "([^"]+)"').Match((Get-Content $iss -Raw)).Groups[1].Value
$nomeInstalador = "Instalar Secretaria MiguelAngelus $versao.exe"

# confere se a versão do .iss bate com a do programa (secretaria.js e .csproj)
$js = Get-Content (Join-Path $raiz 'lumen\index.html') -Raw -Encoding utf8
if ($js -notmatch "VERSAO_SECRETARIA = '$([regex]::Escape($versao))'") { throw "VERSAO_SECRETARIA no index.html não é $versao" }
$csproj = Join-Path $pastaSec 'app\SecretariaMiguelAngelus.csproj'
if ((Get-Content $csproj -Raw) -notmatch "<Version>$([regex]::Escape($versao))</Version>") { throw "<Version> do .csproj não é $versao" }

# 1) publicar
$saida = Join-Path $pastaSec 'Secretaria MiguelAngelus App'
if (Test-Path $saida) { Remove-Item -Recurse -Force $saida }
dotnet publish $csproj -c Release -o $saida | Select-Object -Last 1
if ($LASTEXITCODE) { throw 'dotnet publish falhou' }

# 2) assinar o programa
Assinar (Join-Path $saida 'SecretariaMiguelAngelus.exe')

# 3) instalador
& $iscc /Q $iss
if ($LASTEXITCODE) { throw 'Inno Setup falhou' }
$instalador = Join-Path $PSScriptRoot $nomeInstalador
Assinar $instalador

# 4) cópias: com número (anexo da versão no GitHub) e com nome fixo
# (https://github.com/dobylucky78-droid/secretaria-miguelangelus/releases/latest/download/Instalar-Secretaria-MiguelAngelus.exe)
$mesa = Split-Path $raiz -Parent
Copy-Item $instalador (Join-Path $mesa $nomeInstalador) -Force
Copy-Item $instalador (Join-Path $mesa 'Instalar-Secretaria-MiguelAngelus.exe') -Force
Write-Host "Pronto: $nomeInstalador assinado por $assinante"
