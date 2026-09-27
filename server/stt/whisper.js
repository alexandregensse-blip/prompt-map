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

export function cleanTranscript(text) {
  let out = String(text || '')
    .replace(/\[(BLANK_AUDIO|MUSIC|Musique|Silence)\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (HALLUCINATIONS.some((re) => re.test(out))) return '';
  // Répétitions en boucle : autre symptôme d'hallucination.
  out = out.replace(/(\b.{6,}?\b)(\s*\1){2,}/gi, '$1');
  return out;
}

export function isOpenAiStyle(url) {
  return /\/v1\/audio\/transcriptions\/?$/.test(new URL(url).pathname);
}

export async function transcribe(wav, cfg) {
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'segment.wav');
  form.append('response_format', 'json');
  form.append('language', cfg.language);
  if (isOpenAiStyle(cfg.whisperUrl)) {
    form.append('model', cfg.whisperModel || 'whisper-1');
  } else {
    form.append('temperature', '0.0');
  }
  let res;
  try {
    res = await fetch(cfg.whisperUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError'
      ? 'Whisper n’a pas répondu en 60 s'
      : `Whisper injoignable (${cfg.whisperUrl}). Lance « npm run whisper »`);
  }
  if (!res.ok) throw new Error(`Whisper a répondu ${res.status} ${res.statusText}`);
  const data = await res.json();
  return cleanTranscript(data.text);
}

export async function whisperReachable(cfg) {
  if (!cfg.whisperUrl) return false;
  try {
    const url = new URL(cfg.whisperUrl);
    await fetch(url.origin, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
