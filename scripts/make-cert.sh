#!/usr/bin/env bash
# Crée un certificat auto-signé dans .cert/ pour servir prompt-map en HTTPS
# (le navigateur n'ouvre le micro qu'en HTTPS ou sur localhost).
# Usage : npm run cert -- 172.17.0.5   (adresses IP ou noms supplémentaires)
set -euo pipefail
cd "$(dirname "$0")/.."
OPENSSL="${OPENSSL:-openssl}"
mkdir -p .cert
SAN="DNS:localhost,IP:127.0.0.1"
for host in "$@"; do
  if [[ "$host" =~ ^[0-9.]+$ ]]; then SAN="$SAN,IP:$host"; else SAN="$SAN,DNS:$host"; fi
done
"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 825 -sha256 \
  -subj "/CN=prompt-map" -addext "subjectAltName=$SAN" \
  -keyout .cert/key.pem -out .cert/cert.pem 2>/dev/null
echo "✓ Certificat créé (.cert/cert.pem, $SAN)"
echo "  Lance : PROMPTMAP_TLS_CERT=.cert/cert.pem PROMPTMAP_TLS_KEY=.cert/key.pem npm start"
