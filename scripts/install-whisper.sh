#!/usr/bin/env bash
# Installe whisper.cpp (whisper-server) et un modèle dans .whisper/ (ignoré par git).
# Modèle choisi selon la machine, modifiable avec WHISPER_MODEL=… :
#   - GPU (CUDA, Apple Silicon) ou 8 cœurs et plus : large-v3-turbo-q5_0 (~550 Mo, le plus précis)
#   - sinon : small-q5_1 (~190 Mo, ~5x plus rapide, très correct en français avec le vocabulaire)
set -euo pipefail
cd "$(dirname "$0")/.."

DIR=.whisper
mkdir -p "$DIR/models"

CORES=$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4) )
if [ -n "${WHISPER_MODEL:-}" ]; then
  MODEL="$WHISPER_MODEL"
elif command -v nvcc >/dev/null 2>&1 || [ "$(uname -sm)" = "Darwin arm64" ] || [ "$CORES" -ge 8 ]; then
  MODEL=large-v3-turbo-q5_0
else
  MODEL=small-q5_1
fi
echo "→ Modèle retenu : $MODEL ($CORES cœurs)"

if command -v whisper-server >/dev/null 2>&1; then
  echo "✓ whisper-server déjà installé : $(command -v whisper-server)"
elif [ -x "$DIR/whisper.cpp/build/bin/whisper-server" ]; then
  echo "✓ whisper-server déjà compilé"
else
  missing=()
  for tool in git cmake c++; do command -v "$tool" >/dev/null 2>&1 || missing+=("$tool"); done
  command -v make >/dev/null 2>&1 || command -v ninja >/dev/null 2>&1 || missing+=("make (ou ninja)")
  if [ ${#missing[@]} -gt 0 ]; then
    echo "✗ Pour compiler whisper.cpp, il manque : ${missing[*]}"
    echo "  Debian/Ubuntu : sudo apt install git cmake build-essential"
    echo "  macOS         : xcode-select --install && brew install cmake"
    echo "  Sans droits administrateur : pip install --user cmake ninja ziglang"
    echo "  (puis un compilateur « c++ » qui appelle « python -m ziglang c++ »)"
    exit 1
  fi
  [ -d "$DIR/whisper.cpp" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$DIR/whisper.cpp"
  EXTRA=()
  # Sans make, on génère pour ninja.
  if ! command -v make >/dev/null 2>&1; then EXTRA+=(-G Ninja); fi
  # GPU Nvidia : accélération CUDA si le compilateur CUDA est présent.
  if command -v nvcc >/dev/null 2>&1; then EXTRA+=(-DGGML_CUDA=1); echo "→ CUDA détecté"; fi
  # Binaire autonome (bibliothèques liées en statique) : rien à installer à côté.
  cmake -S "$DIR/whisper.cpp" -B "$DIR/whisper.cpp/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF ${EXTRA[@]+"${EXTRA[@]}"}
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

echo "$MODEL" > "$DIR/model"

# Modèle minuscule pour le direct (les mots s'affichent pendant qu'on parle). WHISPER_LIVE=0 pour s'en passer.
if [ "${WHISPER_LIVE:-1}" != "0" ]; then
  LIVE_FILE="$DIR/models/ggml-tiny-q5_1.bin"
  if [ -f "$LIVE_FILE" ]; then
    echo "✓ Modèle du direct déjà présent : $LIVE_FILE"
  else
    echo "→ Téléchargement du modèle du direct (tiny, ~31 Mo)…"
    curl -L --fail --progress-bar -o "$LIVE_FILE.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin"
    mv "$LIVE_FILE.part" "$LIVE_FILE"
  fi
fi
echo
echo "Prêt. Lance Whisper avec : npm run whisper"
