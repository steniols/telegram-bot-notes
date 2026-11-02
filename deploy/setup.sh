#!/usr/bin/env bash
# Roda na VM (chamado pelo deploy.ps1): instala Node 22, extrai o projeto e (re)inicia o serviço.
set -euo pipefail

APP="$HOME/telegram-bot-notes"
ARCHIVE="$HOME/telegram-bot-notes.tgz"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo ">> Instalando Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo ">> Extraindo projeto em $APP"
mkdir -p "$APP"
tar -xzf "$ARCHIVE" -C "$APP"
rm -f "$ARCHIVE"
cd "$APP"
# .env vindo do Windows pode ter BOM e CRLF
sed -i '1s/^\xEF\xBB\xBF//; s/\r$//' .env

echo ">> Instalando dependências"
npm ci --omit=dev --no-audit --no-fund

echo ">> Configurando serviço"
sed "s|__USER__|$USER|; s|__APP__|$APP|; s|__NODE__|$(command -v node)|" deploy/telegram-bot-notes.service \
  | sudo tee /etc/systemd/system/telegram-bot-notes.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable telegram-bot-notes >/dev/null 2>&1
sudo systemctl restart telegram-bot-notes

sleep 4
if systemctl is-active --quiet telegram-bot-notes; then
  echo ">> OK: bot rodando"
  journalctl -u telegram-bot-notes -n 5 --no-pager -o cat
else
  echo ">> ERRO: o serviço não subiu. Logs:"
  journalctl -u telegram-bot-notes -n 30 --no-pager -o cat
  exit 1
fi
