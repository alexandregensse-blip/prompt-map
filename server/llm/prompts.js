// Prompts et schémas envoyés au LLM. C'est ici que se joue la qualité :
// la carte doit refléter la pensée de l'utilisateur, la grille repérer les manques.

import { DIMENSIONS, DIMENSION_KEYS, STATUSES, STATUS_LABELS } from '../../web/js/shared/grid.js';
import { toOutline, peekNextId } from '../../web/js/shared/map-model.js';

export const SUGGESTION_KINDS = ['question', 'blind_spot', 'lead', 'search'];

const dimensionLines = DIMENSIONS.map((d) => `- ${d.key} (${d.label}) : ${d.hint}.`).join('\n');

export const UPDATE_SYSTEM = `Tu es le moteur de prompt-map. Un utilisateur décrit à l'oral, librement, une tâche qu'il veut confier à Claude Code (un agent de développement logiciel). Tu reçois la transcription au fil de l'eau et tu maintiens trois choses : une carte heuristique, une grille d'analyse cachée, et quelques suggestions.

# Déroulé

Tu reçois d'abord l'état complet de la session. Les messages suivants ne contiennent que les nouveautés : tes opérations, ta grille et tes suggestions précédentes ont été appliquées telles quelles, sauf si le message indique que l'utilisateur a modifié la carte (la carte actuelle est alors redonnée en entier et fait foi). Chaque réponse suit le même format.

# 1. La carte (visible)

La carte reflète la pensée de l'utilisateur : ses thèmes, avec ses mots. Ce n'est pas un formulaire.

- Tu réponds par des opérations sur la carte existante (add, update, move, remove), jamais par une carte complète.
- Tu ne mets dans la carte que ce que l'utilisateur a dit. Tes propres idées vont dans les suggestions, jamais dans la carte.
- Libellés courts : 2 à 6 mots, dans la langue de l'utilisateur, en reprenant ses termes (noms de fichiers, d'outils, de fonctions tels quels). Une précision utile va dans "detail" (une phrase au plus).
- Les branches principales (enfants de "root") sont ses grands thèmes : 3 à 7 au total, idéalement. Si un point relève d'un thème existant, range-le dessous plutôt que de créer une branche de plus.
- "root" résume la tâche en quelques mots. Mets-le à jour (update, id "root") dès que l'intention se précise.
- Quand l'utilisateur se reprend (« non, en fait… », « oublie ça », « plutôt… »), modifie ou supprime les nœuds concernés : la carte suit sa dernière version.
- La transcription vient d'un micro ouvert : elle peut contenir des paroles sans rapport avec la tâche (quelqu'un d'autre qui parle, une télévision, un aparté, des politesses). Ignore-les : ni carte, ni grille, ni suggestion.
- La transcription vient d'une reconnaissance vocale : corrige d'office les mots manifestement mal entendus, en particulier les termes techniques. Quand l'utilisateur corrige lui-même une phrase ou en retire une, mets la carte en accord avec sa version.
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

Tu ne renvoies que les dimensions qui changent par rapport à la grille actuelle, dans "grid_changes" (objet vide si rien ne change). Pour chacune, un statut et un résumé d'une phrase de ce qu'on sait :
- missing : rien de dit ;
- partial : évoqué, mais trop flou pour que Claude Code agisse sans deviner ;
- covered : assez clair pour agir ;
- not_applicable : sans objet pour cette tâche (ex. « références » pour un petit script neuf).
Juge sur l'ensemble de ce qui a été dit (carte et transcription), pas seulement sur le dernier segment. Une dimension ne redescend pas sans raison.

# 3. Les suggestions (visibles)

0 à 3 suggestions, la plus utile d'abord. Si les suggestions affichées restent les bonnes, renvoie null. Sinon, renvoie la liste complète à afficher : elle remplace la précédente. Garde l'id d'une suggestion toujours valable (même texte ou presque) ; une nouvelle suggestion prend un nouvel id, à partir de celui indiqué (« prochain id de suggestion libre »).
- kind "question" : une information manque et Claude Code devrait deviner ;
- kind "blind_spot" : un risque ou une contradiction que l'utilisateur n'a pas vu ;
- kind "lead" : une piste d'approfondissement qui améliorerait nettement le résultat ;
- kind "search" : une recherche sur le web serait utile (références, documentation, exemples, bibliothèques). "text" est alors la recherche à faire, formulée précisément. Un autre agent s'en charge : tu ne cherches jamais toi-même. Mets "requested" à true si l'utilisateur vient de demander explicitement cette recherche (« va chercher… », « trouve-moi des exemples… ») : elle est alors lancée tout de suite. Sinon false : l'utilisateur décidera.
Règles :
- Priorité aux manques qui feraient dérailler Claude Code (objectif, périmètre, critère de fin), puis aux ambiguïtés et contradictions.
- Une suggestion = une seule chose, 20 mots au plus, formulée pour qu'on y réponde à l'oral, en tutoyant.
- Ne demande jamais ce qui a déjà été dit. Ne repropose pas une suggestion écartée ni une suggestion à laquelle il vient de répondre.
- Les questions « mises de côté » restent ouvertes, mais l'utilisateur y répondra plus tard : ne les repose pas, ni sous une autre forme.
- Si le dernier segment semble inachevé, l'utilisateur est en train de dérouler son idée : ne le noie pas, une suggestion au plus.
- Rattache la suggestion à une dimension (clé de la grille) et, si pertinent, à un nœud (son id). Sinon, chaîne vide.
- "requested" vaut false pour tout ce qui n'est pas une recherche demandée.

# Format de la réponse

Un seul objet JSON, sans texte autour :
{"ops": [ …opérations… ],
 "grid_changes": { "perimetre": {"status": "partial", "summary": "…"} },
 "suggestions": null }
ou, si les suggestions changent :
 "suggestions": [ {"id": "s4", "kind": "question", "text": "…", "dimension": "perimetre", "node": "n3", "requested": false} ]
Clés possibles de "grid_changes" : ${DIMENSION_KEYS.join(', ')}.`;

export const UPDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ops', 'grid_changes', 'suggestions'],
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
    grid_changes: {
      type: 'object',
      additionalProperties: false,
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
      anyOf: [
        { type: 'null' },
        {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'kind', 'text', 'dimension', 'node', 'requested'],
            properties: {
              id: { type: 'string' },
              kind: { type: 'string', enum: SUGGESTION_KINDS },
              text: { type: 'string' },
              dimension: { type: 'string', enum: [...DIMENSION_KEYS, ''] },
              node: { type: 'string' },
              requested: { type: 'boolean' },
            },
          },
        },
      ],
    },
  },
};

// Une phrase de la transcription, avec son contexte (réponse, correction, retrait…).
export function formatSegment(s, i) {
  let tag = '';
  if (s.retracts !== undefined) return `${i + 1}. [l'utilisateur retire sa phrase « ${s.retracts} » : enlève de la carte ce qui ne venait que d'elle]`;
  if (s.corrects !== undefined) tag = `[l'utilisateur corrige la transcription de « ${s.corrects} », qui devient :] `;
  else if (s.answerTo) tag = `[réponse à « ${s.answerTo} »] `;
  else if (s.focus) tag = `[l'utilisateur veut approfondir « ${s.focus} »] `;
  if (s.retracted) tag = `[phrase retirée ensuite] ${tag}`;
  return `${i + 1}. ${tag}${s.text}`;
}

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
  const { map, grid, suggestions = [], dismissed = [], segments = [], processedCount = 0, usedSuggestionIds = [], later = [] } = session;
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
  if (later.length) {
    parts.push(`## Questions mises de côté par l'utilisateur (ouvertes, ne pas reposer)\n${later.map((t) => `- ${t}`).join('\n')}`);
  }

  const fmt = formatSegment;
  const done = segments.slice(0, processedCount);
  const fresh = segments.slice(processedCount);
  parts.push(`## Transcription déjà prise en compte\n${done.length ? done.map(fmt).join('\n') : '(rien)'}`);
  parts.push(`## Nouveau depuis la dernière mise à jour\n${fresh.length ? fresh.map((s, i) => fmt(s, i + done.length)).join('\n') : '(rien)'}`);
  parts.push('Mets à jour la carte, la grille et les suggestions.');
  return parts.join('\n\n');
}

// Message suivant d'une conversation déjà ouverte : seulement ce qui a changé.
// seen = ce que le modèle a déjà vu (voir claude-stream.js).
export function buildDeltaMessage(session, seen) {
  const { map, suggestions = [], dismissed = [], segments = [], usedSuggestionIds = [], later = [] } = session;
  const parts = [];
  const fmt = formatSegment;
  const fresh = segments.slice(seen.segmentKeys.length);
  parts.push(`## Nouveau depuis la dernière mise à jour\n${fresh.length
    ? fresh.map((s, i) => fmt(s, i + seen.segmentKeys.length)).join('\n')
    : '(rien)'}`);

  const outline = toOutline(map);
  const removed = map.removedByUser?.slice(seen.removedCount) || [];
  if (outline !== seen.expectedOutline || removed.length) {
    parts.push(`## L'utilisateur a modifié la carte : voici la carte actuelle\n${outline}`);
  }
  if (removed.length) {
    parts.push(`## Supprimés par l'utilisateur (ne pas recréer)\n${removed.map((l) => `- ${l}`).join('\n')}`);
  }
  const newlyDismissed = dismissed.slice(seen.dismissedCount);
  if (newlyDismissed.length) {
    parts.push(`## Suggestions écartées par l'utilisateur (ne pas reproposer)\n${newlyDismissed.map((t) => `- ${t}`).join('\n')}`);
  }
  const newlyLater = later.filter((t) => !(seen.later || []).includes(t));
  if (newlyLater.length) {
    parts.push(`## Questions mises de côté par l'utilisateur (ouvertes, ne pas reposer)\n${newlyLater.map((t) => `- ${t}`).join('\n')}`);
  }
  parts.push(`## Suggestions affichées\n${suggestions.length
    ? suggestions.map((s) => `- [${s.id}] (${s.kind}${s.dimension ? `, ${s.dimension}` : ''}) ${s.text}`).join('\n')
    : '(aucune)'}`);
  parts.push(`Prochain id libre : ${peekNextId(map)} · Prochain id de suggestion libre : ${nextSuggestionId(suggestions, usedSuggestionIds)}`);
  parts.push('Mets à jour la carte, la grille et les suggestions.');
  return parts.join('\n\n');
}

// ---------- Agent de recherche (parallèle, séparé de l'agent de travail) ----------

export const RESEARCH_SYSTEM = `Tu es l'agent de recherche de prompt-map. Un utilisateur prépare une tâche pour Claude Code ; tu reçois le contexte de sa tâche et une recherche à faire. Tu cherches sur le web avec WebSearch, et tu vérifies avec WebFetch une page dont tu n'es pas sûr.

Ce que tu rends :
- 3 à 6 références vraiment utiles pour cette tâche : documentation officielle, exemples de code, bibliothèques, articles solides et récents. Pas de pages génériques ni de contenus sponsorisés.
- Pour chacune : un titre court, l'URL exacte (jamais inventée, toujours issue de tes recherches), et en une phrase pourquoi elle aide pour cette tâche précise.
- 0 à 3 idées concrètes tirées de ta recherche (une bibliothèque adaptée, un piège connu, une bonne pratique), une phrase chacune.
Écris en français. Réponds uniquement avec l'objet JSON demandé.`;

export const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['references', 'ideas'],
  properties: {
    references: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url', 'why'],
        properties: { title: { type: 'string' }, url: { type: 'string' }, why: { type: 'string' } },
      },
    },
    ideas: { type: 'array', maxItems: 3, items: { type: 'string' } },
  },
};

export function buildResearchMessage(session, topic) {
  return [
    `## Tâche en préparation (carte actuelle)\n${toOutline(session.map)}`,
    `## Recherche demandée\n${topic}`,
    'Fais la recherche et rends les références.',
  ].join('\n\n');
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
  const { map, grid, segments = [], suggestions = [], later = [] } = session;
  return [
    `## Carte\n${toOutline(map)}`,
    `## Grille\n${DIMENSION_KEYS.map((k) => {
      const g = grid?.[k] || { status: 'missing', summary: '' };
      return `- ${k} : ${g.status}${g.summary ? ` — ${g.summary}` : ''}`;
    }).join('\n')}`,
    `## Questions de l'agent restées sans réponse\n${suggestions.length || later.length
      ? [...suggestions.map((s) => `- (${s.kind}) ${s.text}`), ...later.map((t) => `- (mise de côté) ${t}`)].join('\n')
      : '(aucune)'}`,
    `## Transcription\n${segments.map(formatSegment).join('\n') || '(vide)'}`,
    'Rédige le prompt de tâche final.',
  ].join('\n\n');
}
