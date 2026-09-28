// Appels au serveur local.

async function call(method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body instanceof Uint8Array ? { 'content-type': 'audio/wav', ...headers } : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error('Serveur prompt-map injoignable. Est-il lancé ?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// Ce que le serveur a besoin de savoir de la session.
function payload(session) {
  const { map, grid, suggestions, dismissed, segments, processedCount, hidden } = session;
  const usedSuggestionIds = hidden.map((h) => h.id);
  // Une question déjà répondue n'est plus « affichée » pour l'agent.
  const shown = suggestions.filter((s) => !s.answered);
  return { sessionId: session.id, map, grid, suggestions: shown, dismissed, segments, processedCount, usedSuggestionIds };
}

export const api = {
  status: () => call('GET', '/api/status'),
  demoScript: () => call('GET', '/api/demo-script'),
  update: (session, demo) => call('POST', '/api/update', { session: payload(session), demo }),
  export: (session, { demo, draft } = {}) => call('POST', '/api/export', { session: payload(session), demo, draft }),
  transcribe: (wav, prompt = '') => call('POST', '/api/transcribe', wav, { 'x-whisper-prompt': encodeURIComponent(prompt) }),
  // Démarre la conversation Claude à l'avance : la première mise à jour n'attend pas la CLI.
  warmup: (session) => call('POST', '/api/warmup', { sessionId: session.id, demo: session.demo }).catch(() => {}),
};
