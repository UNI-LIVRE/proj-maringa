#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  Atualiza o sistema no servidor com o que está no GitHub.
#  Uso (no servidor):  sudo bash /opt/unilivre/app/deploy/atualizar.sh
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
APP=/opt/unilivre/app

echo "→ Baixando a versão nova do GitHub..."
sudo -u campo git -C "$APP" pull --ff-only

echo "→ Instalando dependências da API..."
sudo -u campo npm --prefix "$APP/api" ci --omit=dev --no-audit --no-fund

echo "→ Reiniciando o sistema..."
systemctl restart campo-iam
sleep 3

if curl -fsS http://127.0.0.1:3000/api/saude > /dev/null; then
  echo "✔ Atualizado e funcionando."
else
  echo "✖ O sistema não respondeu. Veja: sudo journalctl -u campo-iam -n 50"
  exit 1
fi
