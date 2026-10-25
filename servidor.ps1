param([int]$Porta = 8080, [switch]$SemNavegador)
# Servidor local simples (sem Docker/Node): o painel consulta o TSE direto do navegador.
# Para o modo com sincronização central, use o Docker (veja README.md).

$raiz = Join-Path $PSScriptRoot 'public'
$tipos = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Porta/")
$listener.Start()
Write-Host "Apuração de Eleições rodando em http://localhost:$Porta/  (Ctrl+C para parar)"
if (-not $SemNavegador) { Start-Process "http://localhost:$Porta/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($caminho -eq '') { $caminho = 'index.html' }
    $arquivo = [IO.Path]::GetFullPath((Join-Path $raiz $caminho))
    $resp = $ctx.Response
    if ($arquivo.StartsWith($raiz + [IO.Path]::DirectorySeparatorChar) -and (Test-Path $arquivo -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($arquivo)
      $ext = [IO.Path]::GetExtension($arquivo).ToLower()
      $resp.ContentType = if ($tipos[$ext]) { $tipos[$ext] } else { 'application/octet-stream' }
      $resp.Headers.Add('Cache-Control', 'no-cache')
      $resp.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $resp.StatusCode = 404
    }
    $resp.Close()
  }
} finally {
  $listener.Stop()
}
