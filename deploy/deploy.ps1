# Envia o projeto para a VM e (re)inicia o bot.
#   Primeira vez (leva junto as anotações salvas no PC):
#     .\deploy\deploy.ps1 -Ip 1.2.3.4 -Key C:\caminho\chave.key -WithData
#   Atualizações de código (mantém os dados do servidor):
#     .\deploy\deploy.ps1 -Ip 1.2.3.4 -Key C:\caminho\chave.key
param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$User = 'ubuntu',
  [switch]$WithData
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot)

if (-not (Test-Path $Key)) { throw "Chave não encontrada: $Key" }
if (-not (Test-Path .env)) { throw 'Arquivo .env não encontrado' }

# O ssh recusa chaves que outros usuários do Windows podem ler
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null

$items = @('package.json', 'package-lock.json', 'src', 'public', 'deploy', '.env')
if ($WithData) {
  if (Test-Path data/cerebro.db) { $items += 'data' } else { Write-Host 'Sem data/cerebro.db local; enviando sem dados.' }
}
$tgz = Join-Path $env:TEMP 'telegram-bot-notes.tgz'
tar -czf $tgz @items
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar o projeto' }

$target = "$User@$Ip"
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')

Write-Host ">> Enviando para $target"
scp @sshOpts $tgz "${target}:~/telegram-bot-notes.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Falha no envio (scp). Confira IP, usuário e chave.' }
Remove-Item $tgz

Write-Host '>> Instalando e iniciando na VM'
ssh @sshOpts $target 'tar -xzf ~/telegram-bot-notes.tgz -C /tmp deploy/setup.sh && bash /tmp/deploy/setup.sh'
if ($LASTEXITCODE -ne 0) { throw 'A instalação na VM falhou (veja as mensagens acima).' }

Write-Host ''
Write-Host 'Pronto! Lembre de NÃO rodar o bot no PC ao mesmo tempo (o Telegram só entrega as mensagens para um).'
Write-Host "Dashboard: ssh -i `"$Key`" -L 3001:127.0.0.1:3001 $target   e abra http://localhost:3001"
Write-Host "Logs:      ssh -i `"$Key`" $target journalctl -u telegram-bot-notes -f"
