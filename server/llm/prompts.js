// Prompts et schémas envoyés au LLM. C'est ici que se joue la qualité :
// la carte doit refléter la pensée de l'utilisateur, la grille repérer les manques.

import { DIMENSIONS, DIMENSION_KEYS, STATUSES, STATUS_LABELS } from '../../web/js/shared/grid.js';
import { toOutline, peekNextId } from '../../web/js/shared/map-model.js';

export const SUGGESTION_KINDS = ['question', 'blind_spot', 'lead'];

const dimensionLines = DIMENSIONS.map((d) => `- ${d.key} (${d.label}) : ${d.hint}.`).join('\n');

export const UPDATE_SYSTEM = `Tu es le moteur de prompt-map. Un utilisateur décrit à l'oral, librement, une tâche qu'il veut confier à Claude Code (un agent de développement logiciel). Tu reçois la transcription au fil de l'eau et tu maintiens trois choses : une carte heuristique, une grille d'analyse cachée, et quelques suggestions.

# 1. La carte (visible)

La carte reflète la pensée de l'utilisateur : ses thèmes, avec ses mots. Ce n'est pas un formulaire.

- Tu réponds par des opérations sur la carte existante (add, update, move, remove), jamais par une carte complète.
- Tu ne mets dans la carte que ce que l'utilisateur a dit. Tes propres idées vont dans les suggestions, jamais dans la carte.
- Libellés courts : 2 à 6 mots, dans la langue de l'utilisateur, en reprenant ses termes (noms de fichiers, d'outils, de fonctions tels quels). Une précision utile va dans "detail" (une phrase au plus).
- Les branches principales (enfants de "root") sont ses grands thèmes : 3 à 7 au total, idéalement. Si un point relève d'un thème existant, range-le dessous plutôt que de créer une branche de plus.
- "root" résume la tâche en quelques mots. Mets-le à jour (update, id "root") dès que l'intention se précise.
- Quand l'utilisateur se reprend (« non, en fait… », « oublie ça », « plutôt… »), modifie ou supprime les nœuds concernés : la carte suit sa dernière version.
- Les nœuds marqués « corrigé par l'utilisateur » ont été édités à la main : ne les renomme pas, ne les déplace pas, ne les supprime pas.
- Ne recrée jamais un élément de la liste « supprimés par l'utilisateur ».
- Stabilité avant tout : ne touche pas à ce qui est juste, pas de reformulation cosmétique. Aucune opération est une réponse valide.
- Nouveaux nœuds : utilise des ids à partir de celui indiqué (« prochain id libre »), en incrémentant. Un nœud ajouté peut servir de parent dans la même réponse.

Format des opérations :
- {"op":"add","id":"n7","parent":"n2","label":"…","detail":"…"}
- {"op":"update","id":"n3","label":"…","detail":"…"} (champs omis = inchangés)
- {"op":"move","id":"n4","parent":"n1"}
- {"op":"remove","id":"n5"} (supprime aussi ses enfants)

# 2. La grille (cachée)

Huit dimensions d'un bon prompt de tâche pour Claude Code :
${dimensionLines}

Pour chacune, donne un statut et un résumé d'une phrase de ce qu'on sait (vide si absent) :
- missing : rien de dit ;
- partial : évoqué, mais trop flou pour que Claude Code agisse sans deviner ;
- covered : assez clair pour agir ;
- not_applicable : sans objet pour cette tâche (ex. « références » pour un petit script neuf).
Juge sur l'ensemble de ce qui a été dit (carte et transcription), pas seulement sur le dernier segment. Une dimension ne redescend pas sans raison.

# 3. Les suggestions (visibles)

0 à 3 suggestions, la plus utile d'abord. C'est la liste complète à afficher : elle remplace la précédente. Garde l'id d'une suggestion toujours valable (même texte ou presque) ; une nouvelle suggestion prend un nouvel id, à partir de celui indiqué (« prochain id de suggestion libre »).
- kind "question" : une information manque et Claude Code devrait deviner ;
- kind "blind_spot" : un risque ou une contradiction que l'utilisateur n'a pas vu ;
- kind "lead" : une piste d'approfondissement qui améliorerait nettement le résultat.
Règles :
- Priorité aux manques qui feraient dérailler Claude Code (objectif, périmètre, critère de fin), puis aux ambiguïtés et contradictions.
- Une suggestion = une seule chose, 20 mots au plus, formulée pour qu'on y réponde à l'oral, en tutoyant.
- Ne demande jamais ce qui a déjà été dit. Ne repropose pas une suggestion écartée ni une suggestion à laquelle il vient de répondre.
- Si le dernier segment semble inachevé, l'utilisateur est en train de dérouler son idée : ne le noie pas, une suggestion au plus.
- Rattache la suggestion à une dimension (clé de la grille) et, si pertinent, à un nœud (son id). Sinon, chaîne vide.

# Format de la réponse

Un seul objet JSON, sans texte autour :
{"ops": [ …opérations… ],
 "grid": { ${DIMENSION_KEYS.map((k) => `"${k}": {"status": "…", "summary": "…"}`).join(', ')} },
 "suggestions": [ {"id": "s4", "kind": "question", "text": "…", "dimension": "perimetre", "node": "n3"} ]}
Les huit clés de "grid" sont toujours présentes.`;

export const UPDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ops', 'grid', 'suggestions'],
  properties: {
    ops: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'id'],
        properties: {
          op: { type: 'string', enum: ['add', 'update', 'move', 'remove'] },
          id: { type: 'string' },
          parent: { type: 'string' },
          label: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    grid: {
      type: 'object',
      additionalProperties: false,
      required: DIMENSION_KEYS,
      properties: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'summary'],
        properties: {
          status: { type: 'string', enum: STATUSES },
          summary: { type: 'string' },
        },
      }])),
    },
    suggestions: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'text', 'dimension', 'node'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: SUGGESTION_KINDS },
          text: { type: 'string' },
          dimension: { type: 'string', enum: [...DIMENSION_KEYS, ''] },
          node: { type: 'string' },
        },
      },
    },
  },
};

// Session envoyée par le client : { map, grid, suggestions, dismissed, segments, processedCount }
// Prochain id de suggestion jamais utilisé (affichées, répondues ou écartées).
export function nextSuggestionId(suggestions = [], usedIds = []) {
  const nums = [...suggestions.map((s) => s.id), ...usedIds]
    .map((id) => /^s(\d+)$/.exec(id || ''))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return `s${nums.length ? Math.max(...nums) + 1 : 1}`;
}

export function buildUpdateMessage(session) {
  const { map, grid, suggestions = [], dismissed = [], segments = [], processedCount = 0, usedSuggestionIds = [] } = session;
  const parts = [];

  parts.push(`## Carte actuelle\n${toOutline(map)}`);
  parts.push(`Prochain id libre : ${peekNextId(map)}`);

  if (map.removedByUser?.length) {
    parts.push(`## Supprimés par l'utilisateur\n${map.removedByUser.map((l) => `- ${l}`).join('\n')}`);
  }

  parts.push(`## Grille actuelle\n${DIMENSION_KEYS.map((k) => {
    const g = grid?.[k] || { status: 'missing', summary: '' };
    return `- ${k} : ${g.status} (${STATUS_LABELS[g.status] || '?'})${g.summary ? ` — ${g.summary}` : ''}`;
  }).join('\n')}`);

  parts.push(`## Suggestions affichées\n${suggestions.length
    ? suggestions.map((s) => `- [${s.id}] (${s.kind}${s.dimension ? `, ${s.dimension}` : ''}) ${s.text}`).join('\n')
    : '(aucune)'}`);
  parts.push(`Prochain id de suggestion libre : ${nextSuggestionId(suggestions, usedSuggestionIds)}`);

  if (dismissed.length) {
    parts.push(`## Suggestions écartées par l'utilisateur (ne pas reproposer)\n${dismissed.map((t) => `- ${t}`).join('\n')}`);
  }

  const fmt = (s, i) => {
    const tag = s.answerTo ? `[réponse à « ${s.answerTo} »] ` : s.focus ? `[l'utilisateur veut approfondir « ${s.focus} »] ` : '';
    return `${i + 1}. ${tag}${s.text}`;
  };
  const done = segments.slice(0, processedCount);
  const fresh = segments.slice(processedCount);
  parts.push(`## Transcription déjà prise en compte\n${done.length ? done.map(fmt).join('\n') : '(rien)'}`);
  parts.push(`## Nouveau depuis la dernière mise à jour\n${fresh.length ? fresh.map((s, i) => fmt(s, i + done.length)).join('\n') : '(rien)'}`);
  parts.push('Mets à jour la carte, la grille et les suggestions.');
  return parts.join('\n\n');
}

export const EXPORT_SYSTEM = `Tu rédiges le prompt de tâche final qu'un utilisateur va donner à Claude Code (un agent de développement logiciel qui travaille dans son dépôt). Tu reçois la carte heuristique construite pendant qu'il décrivait sa tâche à l'oral, la grille d'analyse et la transcription complète.

Objectif : un prompt que Claude Code peut exécuter sans deviner, et qui ne contient que ce que l'utilisateur a voulu.

Règles :
- N'utilise que les informations de la session. N'invente ni choix technique, ni fichier, ni contrainte. Quand l'utilisateur s'est repris, seule sa dernière version compte.
- Écris directement à Claude Code, à l'impératif, en tutoyant, dans la langue de l'utilisateur.
- Garde tels quels les termes précis : noms de fichiers, de modules, commandes, librairies.
- Sois dense : des phrases courtes et des listes, pas de formules de politesse, pas de répétition.
- Structure en Markdown, dans cet ordre, en omettant une section vide :
  # <titre court de la tâche>
  ## Objectif
  ## Contexte
  ## Périmètre (avec « À faire » et « Ne pas toucher » si l'utilisateur l'a précisé)
  ## Contraintes techniques
  ## Références
  ## Critère de fin
  ## Priorités
  ## Laissé à ton appréciation
  ## Points non précisés
- « Points non précisés » liste ce qui reste flou ou absent et qui compte pour la réussite (dont les questions de l'agent restées sans réponse, si elles comptent encore), avec la consigne à suivre : demander avant de commencer si c'est bloquant, sinon choisir l'option la plus simple et le signaler à la fin.
- Réponds uniquement avec le prompt, sans commentaire autour.`;

export function buildExportMessage(session) {
  const { map, grid, segments = [], suggestions = [] } = session;
  return [
    `## Carte\n${toOutline(map)}`,
    `## Grille\n${DIMENSION_KEYS.map((k) => {
      const g = grid?.[k] || { status: 'missing', summary: '' };
      return `- ${k} : ${g.status}${g.summary ? ` — ${g.summary}` : ''}`;
    }).join('\n')}`,
    `## Questions de l'agent restées sans réponse\n${suggestions.length
      ? suggestions.map((s) => `- (${s.kind}) ${s.text}`).join('\n')
      : '(aucune)'}`,
    `## Transcription\n${segments.map((s, i) => `${i + 1}. ${s.answerTo ? `[réponse à « ${s.answerTo} »] ` : ''}${s.text}`).join('\n') || '(vide)'}`,
    'Rédige le prompt de tâche final.',
  ].join('\n\n');
}
