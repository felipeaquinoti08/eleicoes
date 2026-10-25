param([int]$Porta = 8080, [switch]$SemNavegador)
# Roda o painel completo (servidor + sincronização com o TSE) nesta máquina, sem Docker.
# Usa o Node.js instalado; se não houver, baixa uma versão portátil para .\runtime (só na primeira vez).
$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$versao = 'v22.11.0'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $dir = Join-Path $raiz "runtime\node-$versao-win-x64"
  $node = Join-Path $dir 'node.exe'
  if (-not (Test-Path $node)) {
    Write-Host "Baixando Node.js $versao portátil (só na primeira vez)..."
    New-Item -ItemType Directory -Force (Join-Path $raiz 'runtime') | Out-Null
    $zip = Join-Path $raiz 'runtime\node.zip'
    Invoke-WebRequest "https://nodejs.org/dist/$versao/node-$versao-win-x64.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath (Join-Path $raiz 'runtime') -Force
    Remove-Item $zip
  }
}

$env:PORTA = "$Porta"
if (-not $SemNavegador) {
  Start-Job -ScriptBlock { param($p) Start-Sleep 2; Start-Process "http://localhost:$p/" } -ArgumentList $Porta | Out-Null
}
Write-Host "Apuração de Eleições em http://localhost:$Porta/  (Ctrl+C para parar)"
& $node (Join-Path $raiz 'server\server.js')
