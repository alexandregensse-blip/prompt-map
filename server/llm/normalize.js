// Validation de la réponse du LLM : on garde ce qui est exploitable, on écarte le reste.

import { DIMENSION_KEYS, normalizeGrid } from '../../web/js/shared/grid.js';
import { SUGGESTION_KINDS } from './prompts.js';

export function normalizeUpdate(raw, previousGrid) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const ops = Array.isArray(data.ops) ? data.ops.filter((o) => o && typeof o === 'object').slice(0, 60) : [];
  // Grille : seulement les dimensions qui changent (grid_changes) ; « grid » complète acceptée aussi.
  const changes = data.grid_changes && typeof data.grid_changes === 'object' ? data.grid_changes : data.grid;
  const grid = normalizeGrid({ ...previousGrid, ...(changes && typeof changes === 'object' ? changes : {}) }, previousGrid);
  // Questions auxquelles l'utilisateur vient de répondre en parlant (reconnues par l'agent).
  const answered = (Array.isArray(data.answered) ? data.answered : []).filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()).slice(0, 5);
  // null : les suggestions affichées restent les mêmes.
  if (data.suggestions === null) return { ops, grid, answered, suggestions: null };
  const seen = new Set();
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .map((s, i) => ({
      id: typeof s.id === 'string' && s.id.trim() ? s.id.trim() : `s-auto-${i}`,
      kind: SUGGESTION_KINDS.includes(s.kind) ? s.kind : 'question',
      text: s.text.trim().slice(0, 200),
      dimension: DIMENSION_KEYS.includes(s.dimension) ? s.dimension : '',
      node: typeof s.node === 'string' ? s.node.trim() : '',
      requested: s.requested === true && s.kind === 'search',
    }))
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .slice(0, 3);
  return { ops, grid, answered, suggestions };
}

// Résultat d'une recherche : liens http(s) valides seulement, champs nettoyés.
export function normalizeResearch(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const seen = new Set();
  const references = (Array.isArray(data.references) ? data.references : [])
    .map((r) => ({ title: clean(r?.title, 120), url: clean(r?.url, 500), why: clean(r?.why, 300) }))
    .filter((r) => {
      try {
        const u = new URL(r.url);
        return /^https?:$/.test(u.protocol) && r.title && !seen.has(r.url) && seen.add(r.url);
      } catch { return false; }
    })
    .slice(0, 8);
  const ideas = (Array.isArray(data.ideas) ? data.ideas : []).map((i) => clean(i, 300)).filter(Boolean).slice(0, 3);
  return { references, ideas };
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
