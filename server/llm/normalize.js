// Validation de la réponse du LLM : on garde ce qui est exploitable, on écarte le reste.

import { DIMENSION_KEYS, normalizeGrid } from '../../web/js/shared/grid.js';
import { SUGGESTION_KINDS } from './prompts.js';

export function normalizeUpdate(raw, previousGrid) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const ops = Array.isArray(data.ops) ? data.ops.filter((o) => o && typeof o === 'object').slice(0, 60) : [];
  const grid = normalizeGrid(data.grid, previousGrid);
  const seen = new Set();
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `s-auto-${i}`,
      kind: SUGGESTION_KINDS.includes(s.kind) ? s.kind : 'question',
      text: s.text.trim().slice(0, 200),
      dimension: DIMENSION_KEYS.includes(s.dimension) ? s.dimension : '',
      node: typeof s.node === 'string' ? s.node.trim() : '',
    }))
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .slice(0, 3);
  return { ops, grid, suggestions };
}

// Extrait un objet JSON d'un texte (au cas où le modèle entoure sa réponse).
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
