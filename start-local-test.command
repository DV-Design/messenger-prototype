#!/bin/zsh
set -eu
cd "${0:A:h}"
lab_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if [[ -x "$lab_node/node" ]]; then export PATH="$lab_node:$PATH"; fi
if [[ ! -d node_modules ]]; then
  print 'Сначала выполните npm ci в папке проекта.'
  exit 1
fi
lab_ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
print 'Локальный сервер мессенджера. Телефоны должны быть в той же Wi-Fi сети.'
print "Адрес для телефона: http://${lab_ip:-LAN-АДРЕС-КОМПЬЮТЕРА}:8787"
print 'Для остановки нажмите Ctrl+C. Это испытательный сервер без офлайн-доставки.'
HOST=0.0.0.0 npm run dev:server
