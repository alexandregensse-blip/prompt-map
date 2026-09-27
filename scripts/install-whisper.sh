#!/usr/bin/env bash
# Installe whisper.cpp (whisper-server) et un modèle dans .whisper/ (ignoré par git).
# Modèle par défaut : large-v3-turbo-q5_0 (~550 Mo, très bon en français).
# Machine lente sans GPU : WHISPER_MODEL=small npm run whisper:install
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=.whisper
MODEL="${WHISPER_MODEL:-large-v3-turbo-q5_0}"
mkdir -p "$DIR/models"

if command -v whisper-server >/dev/null 2>&1; then
  echo "✓ whisper-server déjà installé : $(command -v whisper-server)"
elif [ -x "$DIR/whisper.cpp/build/bin/whisper-server" ]; then
  echo "✓ whisper-server déjà compilé"
else
  for tool in git cmake c++; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "✗ Il manque « $tool » pour compiler whisper.cpp."
      echo "  Debian/Ubuntu : sudo apt install git cmake build-essential"
      echo "  macOS         : xcode-select --install && brew install cmake"
      exit 1
    fi
  done
  [ -d "$DIR/whisper.cpp" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$DIR/whisper.cpp"
  EXTRA=()
  # GPU Nvidia : accélération CUDA si le compilateur CUDA est présent.
  if command -v nvcc >/dev/null 2>&1; then EXTRA+=(-DGGML_CUDA=1); echo "→ CUDA détecté"; fi
  cmake -S "$DIR/whisper.cpp" -B "$DIR/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release ${EXTRA[@]+"${EXTRA[@]}"}
  cmake --build "$DIR/whisper.cpp/build" -j --config Release --target whisper-server
  echo "✓ whisper-server compilé"
fi

FILE="$DIR/models/ggml-$MODEL.bin"
if [ -f "$FILE" ]; then
  echo "✓ Modèle déjà présent : $FILE"
else
  echo "→ Téléchargement du modèle $MODEL…"
  curl -L --fail --progress-bar -o "$FILE.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  mv "$FILE.part" "$FILE"
  echo "✓ Modèle téléchargé : $FILE"
fi

echo
echo "Prêt. Lance Whisper avec : npm run whisper"
