// Transcription par un serveur Whisper local : whisper.cpp (`whisper-server`, route
// /inference) ou tout serveur compatible OpenAI (/v1/audio/transcriptions).

// Phrases que Whisper « entend » dans le silence ou le bruit (hallucinations connues).
const HALLUCINATIONS = [
  /sous-titr(es|age) (réalisés? )?(par|de) .*/i,
  /amara\.org/i,
  /merci d'avoir regardé( cette vidéo)?/i,
  /abonnez-vous/i,
  /^\s*(\[|\()?(blank_audio|musique|music|silence|applaudissements|rires|bruit)(\]|\))?\s*$/i,
  /^\s*\.+\s*$/,
];

// Annotations de bruit que Whisper ajoute : [Bruit de joie], (Rires), *tousse*, ♪ … ♪.
// Une parenthèse longue (5 mots ou plus) est gardée : c'est sans doute vraiment dit.
function stripNoise(text) {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(([^)]*)\)/g, (m, inner) => (inner.trim().split(/\s+/).length >= 5 ? m : ' '))
    .replace(/\*[^*]{1,40}\*/g, ' ')
    .replace(/♪[^♪]*♪?/g, ' ');
}

export function cleanTranscript(text) {
  let out = stripNoise(String(text || ''))
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:!?-]+/, '')
    .trim();
  if (HALLUCINATIONS.some((re) => re.test(out))) return '';
  // Répétitions en boucle : autre symptôme d'hallucination.
  out = out.replace(/(\b.{6,}?\b)(\s*\1){2,}/gi, '$1');
  return out;
}

export function isOpenAiStyle(url) {
  return /\/v1\/audio\/transcriptions\/?$/.test(new URL(url).pathname);
}

// Durée d'un WAV PCM 16 bits mono 16 kHz, d'après sa taille.
export function wavSeconds(wav) {
  return Math.max(0, (wav.length - 44) / 32000);
}

// Fenêtre d'encodage ajustée à la durée (whisper.cpp encode 30 s par défaut) : 2 à 3 fois plus
// rapide sur un morceau de quelques secondes, avec une marge pour ne rien couper.
export function audioContext(seconds) {
  return Math.min(1500, Math.ceil((seconds / 30) * 1500) + 128);
}

// prompt : indice de vocabulaire (termes de la carte, phrase précédente) pour que Whisper
// reconnaisse mieux les noms propres et les termes techniques.
// live : transcription provisoire, envoyée au petit serveur dédié s'il existe.
export async function transcribe(wav, cfg, { prompt = '', live = false } = {}) {
  const url = live && cfg.whisperLiveUrl ? cfg.whisperLiveUrl : cfg.whisperUrl;
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'segment.wav');
  form.append('response_format', 'json');
  form.append('language', cfg.language);
  if (prompt) form.append('prompt', prompt.slice(0, 800));
  if (isOpenAiStyle(url)) {
    form.append('model', cfg.whisperModel || 'whisper-1');
  } else {
    form.append('temperature', '0.0');
    // whisper.cpp : pas de jetons « non-parole » ([Musique], (Rires)…).
    form.append('suppress_nst', 'true');
    form.append('audio_ctx', String(audioContext(wavSeconds(wav))));
  }
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(live ? 10000 : 60000) });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError'
      ? `Whisper n’a pas répondu en ${live ? 10 : 60} s`
      : `Whisper injoignable (${url}). Lance « npm run whisper »`);
  }
  if (!res.ok) throw new Error(`Whisper a répondu ${res.status} ${res.statusText}`);
  const data = await res.json();
  return cleanTranscript(data.text);
}

export async function whisperReachable(cfg, target = cfg.whisperUrl) {
  if (!target) return false;
  try {
    const url = new URL(target);
    await fetch(url.origin, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
