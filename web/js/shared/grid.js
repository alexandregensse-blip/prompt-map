// Grille cachée : dimensions d'un prompt de tâche Claude Code.
// Elle ne structure pas la carte visible ; elle sert aux questions et à l'export.

export const DIMENSIONS = [
  {
    key: 'objectif',
    label: 'Objectif',
    hint: 'Ce que Claude Code doit avoir produit à la fin',
    question: 'Concrètement, qu’est-ce que Claude doit avoir produit quand il a fini ?',
  },
  {
    key: 'contexte',
    label: 'Contexte',
    hint: 'Nouveau projet ou repo existant, parties du code concernées',
    question: 'On part de zéro ou d’un projet existant ? Quelles parties sont concernées ?',
  },
  {
    key: 'perimetre',
    label: 'Périmètre',
    hint: 'Ce qui est inclus, ce qu’il ne faut pas toucher',
    question: 'Y a-t-il des choses auxquelles Claude ne doit surtout pas toucher ?',
  },
  {
    key: 'contraintes',
    label: 'Contraintes techniques',
    hint: 'Stack, librairies, versions, style de code',
    question: 'Des contraintes techniques à respecter : langage, librairies, style ?',
  },
  {
    key: 'references',
    label: 'Références',
    hint: 'Fichiers, docs, exemples à suivre',
    question: 'Y a-t-il un fichier ou un exemple existant dont Claude doit s’inspirer ?',
  },
  {
    key: 'critere_fin',
    label: 'Critère de fin',
    hint: 'Comment savoir que c’est terminé (tests, démo…)',
    question: 'Comment tu sauras que c’est terminé ? Des tests doivent passer ?',
  },
  {
    key: 'priorites',
    label: 'Priorités',
    hint: 'Simple ou complet, rapide ou propre',
    question: 'Tu préfères un résultat simple et rapide, ou complet et soigné ?',
  },
  {
    key: 'points_libres',
    label: 'Points laissés libres',
    hint: 'Ce que Claude peut décider seul',
    question: 'Sur quoi Claude peut-il trancher seul, sans te demander ?',
  },
];

export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);

// missing : rien de dit · partial : évoqué mais flou · covered : clair
// not_applicable : sans objet pour cette tâche
export const STATUSES = ['missing', 'partial', 'covered', 'not_applicable'];

export const STATUS_LABELS = {
  missing: 'absent',
  partial: 'partiel',
  covered: 'couvert',
  not_applicable: 'sans objet',
};

export function emptyGrid() {
  const grid = {};
  for (const key of DIMENSION_KEYS) grid[key] = { status: 'missing', summary: '' };
  return grid;
}

export function dimension(key) {
  return DIMENSIONS.find((d) => d.key === key) || null;
}

// Nettoie une grille venant du LLM : dimensions inconnues ignorées,
// statuts invalides remplacés par la valeur précédente.
export function normalizeGrid(input, previous = emptyGrid()) {
  const grid = {};
  for (const key of DIMENSION_KEYS) {
    const prev = previous[key] || { status: 'missing', summary: '' };
    const next = input && typeof input === 'object' ? input[key] : null;
    if (!next || typeof next !== 'object') {
      grid[key] = { ...prev };
      continue;
    }
    const status = STATUSES.includes(next.status) ? next.status : prev.status;
    const summary = typeof next.summary === 'string' ? next.summary.trim().slice(0, 300) : prev.summary;
    grid[key] = { status, summary: status === 'missing' ? '' : summary };
  }
  return grid;
}

// Couverture de 0 à 1 ; les dimensions sans objet ne comptent pas.
export function gridProgress(grid) {
  let total = 0;
  let score = 0;
  for (const key of DIMENSION_KEYS) {
    const status = grid[key]?.status || 'missing';
    if (status === 'not_applicable') continue;
    total += 1;
    if (status === 'covered') score += 1;
    else if (status === 'partial') score += 0.5;
  }
  return total === 0 ? 1 : score / total;
}
