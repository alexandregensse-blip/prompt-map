#!/usr/bin/env bash
# Lance whisper-server sur 127.0.0.1:8178, en français, avec le modèle installé.
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=.whisper
# Modèle : WHISPER_MODEL, sinon celui retenu à l'installation.
MODEL="${WHISPER_MODEL:-$(cat "$DIR/model" 2>/dev/null || echo large-v3-turbo-q5_0)}"
PORT="${WHISPER_PORT:-8178}"
LANGUAGE="${PROMPTMAP_LANGUAGE:-fr}"
FILE="$DIR/models/ggml-$MODEL.bin"

if [ -x "$DIR/whisper.cpp/build/bin/whisper-server" ]; then
  BIN="$DIR/whisper.cpp/build/bin/whisper-server"
elif command -v whisper-server >/dev/null 2>&1; then
  BIN=whisper-server
else
  echo "✗ whisper-server introuvable. Installe-le d'abord : npm run whisper:install"
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "✗ Modèle absent ($FILE). Installe-le : npm run whisper:install"
  exit 1
fi

THREADS="${WHISPER_THREADS:-$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4) | awk '{print ($1 > 8) ? 8 : $1}')}"

# Serveur du direct (tiny, 1 cœur) en arrière-plan, arrêté avec le principal.
LIVE_FILE="$DIR/models/ggml-tiny-q5_1.bin"
LIVE_PORT="${WHISPER_LIVE_PORT:-8179}"
if [ "${WHISPER_LIVE:-1}" != "0" ] && [ -f "$LIVE_FILE" ]; then
  echo "→ Whisper du direct (tiny, 1 thread) sur http://127.0.0.1:$LIVE_PORT/inference"
  "$BIN" -m "$LIVE_FILE" -l "$LANGUAGE" -t 1 --host 127.0.0.1 --port "$LIVE_PORT" >/dev/null 2>&1 &
  LIVE_PID=$!
  trap 'kill $LIVE_PID 2>/dev/null' EXIT INT TERM
fi

echo "→ Whisper ($MODEL, $THREADS threads) sur http://127.0.0.1:$PORT/inference"
"$BIN" -m "$FILE" -l "$LANGUAGE" -t "$THREADS" --host 127.0.0.1 --port "$PORT"
