// Export sans IA : assemble un prompt à partir de la grille et de la carte.
// Sert en mode démo et comme version de secours si Claude ne répond pas.

import { DIMENSIONS } from '../../web/js/shared/grid.js';
import { ROOT_ID, children } from '../../web/js/shared/map-model.js';

const SECTION_TITLES = {
  objectif: 'Objectif',
  contexte: 'Contexte',
  perimetre: 'Périmètre',
  contraintes: 'Contraintes techniques',
  references: 'Références',
  critere_fin: 'Critère de fin',
  priorites: 'Priorités',
  points_libres: 'Laissé à ton appréciation',
};

function outline(map) {
  const lines = [];
  const walk = (id, depth) => {
    for (const c of children(map, id)) {
      lines.push(`${'  '.repeat(depth)}- ${c.label}${c.detail ? ` : ${c.detail}` : ''}`);
      walk(c.id, depth + 1);
    }
  };
  walk(ROOT_ID, 0);
  return lines.join('\n');
}

export function draftExport({ map, grid, suggestions = [] }) {
  const out = [`# ${map.nodes[ROOT_ID].label}`];
  const open = [];
  for (const d of DIMENSIONS) {
    const g = grid?.[d.key] || { status: 'missing', summary: '' };
    if (g.status === 'not_applicable') continue;
    if (g.summary) out.push(`## ${SECTION_TITLES[d.key]}\n${g.summary}`);
    if (g.status === 'missing' || g.status === 'partial') open.push(d);
  }
  const tree = outline(map);
  if (tree) out.push(`## Ce que j'ai décrit\n${tree}`);
  const questions = suggestions.filter((s) => s.kind !== 'lead').map((s) => `- Question restée ouverte : ${s.text}`);
  if (open.length || questions.length) {
    out.push(`## Points non précisés\nSi l'un de ces points bloque, demande-moi avant de commencer. Sinon, choisis l'option la plus simple et signale-le à la fin.\n${[
      ...questions,
      ...open.map((d) => `- ${d.label}${grid?.[d.key]?.status === 'partial' ? ' (précisé en partie)' : ''} : ${d.hint.charAt(0).toLowerCase()}${d.hint.slice(1)}.`),
    ].join('\n')}`);
  }
  return out.join('\n\n');
}
