// Fournisseur de démonstration, sans IA : rejoue le scénario de démo et, pour tout
// autre texte, range les phrases grossièrement par mots-clés. Gratuit, instantané,
// il sert à essayer l'interface et à tester la chaîne complète sans appeler Claude.

import { DIMENSIONS, DIMENSION_KEYS, normalizeGrid } from '../../web/js/shared/grid.js';
import { ROOT_ID, children, peekNextId } from '../../web/js/shared/map-model.js';
import { DEMO_SCENARIO, normalizeSpeech } from './demo-scenario.js';
import { draftExport } from './draft-export.js';

const KEYWORDS = {
  objectif: /\b(je veux|je voudrais|j'aimerais|objectif|but|il faut que|pouvoir)\b/,
  contexte: /\b(projet|repo|dépôt|existant|appli|application|code|dossier|module)\b/,
  perimetre: /\b(pas toucher|ne touche|hors|uniquement|seulement|sauf|inclu)/,
  contraintes: /\b(node|python|react|vue|typescript|javascript|rust|go|java|sql|librairie|lib|framework|version|api)\b/,
  references: /\b(exemple|modèle|comme dans|fichier|doc|documentation|s'inspirer|ressembl)/,
  critere_fin: /\b(fini|terminé|test|tests|valid|marche quand|démo)\b/,
  priorites: /\b(simple|rapide|propre|parfait|priorit|d'abord|plutôt)\b/,
  points_libres: /\b(comme tu veux|libre|à toi de voir|peu importe|choisis)\b/,
};

const PRIORITY = ['objectif', 'perimetre', 'critere_fin', 'contexte', 'contraintes', 'references', 'priorites', 'points_libres'];
// Pour ranger une phrase, le thème le plus spécifique l'emporte.
const SPECIFICITY = ['perimetre', 'critere_fin', 'references', 'points_libres', 'priorites', 'objectif', 'contraintes', 'contexte'];

function shortLabel(text) {
  const words = text.replace(/[.,;:!?…]+$/g, '').split(/\s+/).filter(Boolean);
  return words.length <= 6 ? words.join(' ') : `${words.slice(0, 6).join(' ')}…`;
}

function heuristic(session, text, grid, ops, idState) {
  const norm = normalizeSpeech(text);
  const dims = DIMENSION_KEYS.filter((k) => KEYWORDS[k].test(norm));
  const dim = SPECIFICITY.find((k) => dims.includes(k)) || 'objectif';
  const theme = DIMENSIONS.find((d) => d.key === dim).label;

  const pending = ops.filter((o) => o.op === 'add' && o.parent === ROOT_ID);
  let branch = children(session.map, ROOT_ID).find((n) => n.label === theme)?.id
    || pending.find((o) => o.label === theme)?.id;
  if (!branch) {
    branch = idState.next();
    ops.push({ op: 'add', id: branch, parent: ROOT_ID, label: theme });
  }
  ops.push({ op: 'add', id: idState.next(), parent: branch, label: shortLabel(text), detail: text.slice(0, 200) });

  if (session.map.nodes[ROOT_ID].label === 'Ton idée' && !ops.some((o) => o.id === ROOT_ID)) {
    ops.push({ op: 'update', id: ROOT_ID, label: shortLabel(text) });
  }
  for (const k of dims.length ? dims : ['objectif']) {
    const cur = grid[k];
    grid[k] = { status: cur.status === 'missing' ? 'partial' : 'covered', summary: `${cur.summary ? `${cur.summary} ` : ''}${text}`.slice(0, 280) };
  }
}

export function createDemo() {
  const scenario = new Map(DEMO_SCENARIO.map((step, i) => [normalizeSpeech(step.text), i]));
  return {
    name: 'demo',
    async update(session) {
      const fresh = (session.segments || []).slice(session.processedCount || 0);
      let grid = normalizeGrid(session.grid);
      let suggestions = null;
      const ops = [];
      let seq = Number(peekNextId(session.map).slice(1));
      const idState = { next: () => `n${seq++}` };

      for (const seg of fresh) {
        const step = scenario.get(normalizeSpeech(seg.text));
        if (step !== undefined) {
          const { response } = DEMO_SCENARIO[step];
          ops.push(...structuredClone(response.ops));
          grid = normalizeGrid(response.grid, grid);
          suggestions = structuredClone(response.suggestions);
          seq = Math.max(seq, ...response.ops.filter((o) => /^n\d+$/.test(o.id)).map((o) => Number(o.id.slice(1)) + 1));
        } else {
          heuristic(session, seg.text, grid, ops, idState);
          suggestions = null;
        }
      }

      if (!suggestions) {
        const dismissed = new Set(session.dismissed || []);
        suggestions = PRIORITY
          .filter((k) => grid[k].status === 'missing')
          .map((k) => DIMENSIONS.find((d) => d.key === k))
          .filter((d) => !dismissed.has(d.question))
          .slice(0, 2)
          .map((d) => ({ id: `h-${d.key}`, kind: 'question', text: d.question, dimension: d.key, node: '' }));
      }
      // Petit délai pour que la démo ressemble à un vrai aller-retour.
      await new Promise((r) => setTimeout(r, 350));
      return { ops, grid, suggestions };
    },
    async export(session) {
      return { prompt: draftExport(session) };
    },
  };
}
