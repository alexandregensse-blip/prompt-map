# prompt-map

Outil de construction de **prompts avancés à l'oral**.

## Idée

L'utilisateur parle librement. Un agent l'écoute et construit, en temps réel, une
**carte heuristique** (mind map) structurée de tout ce qu'il dit. Cette carte n'est
pas une simple transcription : c'est une représentation exploitable par un agent pour
établir le **vrai besoin** de l'utilisateur et l'amener à préciser les points utiles
pour affiner sa cible.

L'objectif final : transformer un flot de parole spontané en un prompt riche,
structuré et sans zone d'ombre.

## Expérience visée

- **Parole libre** : l'utilisateur énonce son idée sans contrainte de forme.
- **Carte live** : il voit sa carte heuristique se construire en direct pendant qu'il parle,
  et donc voir son idée prendre forme au fur et à mesure.
- **Suggestions live** : l'agent affiche des suggestions en temps réel — questions de
  clarification, points à préciser, angles morts détectés, pistes d'approfondissement.
- **Boucle de précision** : les relances de l'agent poussent l'utilisateur à préciser sa
  cible jusqu'à ce que le besoin soit clair et complet.

## Composants (à cadrer)

1. **Capture audio + transcription** (speech-to-text en flux continu).
2. **Agent de structuration** : extrait entités, intentions, contraintes, objectifs, et
   les organise en carte heuristique évolutive.
3. **Agent de clarification** : détecte les manques et génère des suggestions/questions live.
4. **UI carte heuristique live** : rendu temps réel de la carte + panneau de suggestions.
5. **Export prompt** : synthèse finale de la carte en un prompt avancé prêt à l'emploi.

## Décisions

### Cible de l'export

Le prompt produit est un **prompt de tâche pour Claude Code** : une mission ponctuelle
(« voilà ce que je veux que tu fasses maintenant »).

Hors périmètre pour l'instant : la génération d'un `CLAUDE.md` (instructions
permanentes d'un projet, équivalent d'un system prompt) — piste possible plus tard.

### Modèle de la carte

Les deux couches sont construites ensemble :

- **Carte libre (visible)** : l'agent crée les branches à partir de ce que dit
  l'utilisateur, avec ses mots et ses thèmes. La carte doit ressembler à sa pensée,
  pas à un formulaire.
- **Grille cachée (en arrière-plan)** : une check-list de dimensions propres à un
  prompt de tâche Claude Code. À chaque mise à jour, l'agent évalue chaque dimension
  (couverte / partielle / absente) à partir de la carte libre. La grille sert à
  générer les questions de clarification et à construire l'export ; elle n'impose
  pas sa structure à la carte visible. Une dimension n'est relancée que si elle est
  pertinente (ex. : pas de question sur la stack pour un repo existant).

Dimensions de la grille (v1, à ajuster à l'usage) :

| Dimension | Risque si absente |
|---|---|
| Objectif | Claude fait autre chose que ce qui était voulu |
| Contexte (nouveau projet / repo existant, parties concernées) | mauvaise direction, réinvention de l'existant |
| Périmètre (inclus / à ne pas toucher) | débordement, modifications non demandées |
| Contraintes techniques (stack, libs, style) | Claude choisit à la place de l'utilisateur |
| Références (fichiers, docs, exemples à suivre) | Claude ignore l'existant ou le modèle à imiter |
| Critère de fin (tests, démo…) | arrêt trop tôt ou excès |
| Priorités (simple vs complet, rapide vs propre) | arbitrage différent de celui attendu |
| Points laissés libres | trop ou pas assez de questions |

## Statut

Premier jet fonctionnel (branche `feat/premier-jet`) : carte live, grille cachée,
suggestions, export, micro avec Whisper local, mode démo. Les choix techniques de ce
premier jet sont listés plus bas et restent **à valider**.

## Démarrage

Prérequis : **Node.js 20+** (aucun `npm install` : zéro dépendance) et, pour la vraie
analyse, la **CLI Claude Code** connectée (`claude`). Un navigateur Chrome, Chromium,
Edge ou Brave donne une fenêtre d'application ; sinon le navigateur par défaut s'ouvre.

```bash
npm start          # ouvre prompt-map (Claude Code si la CLI est installée, sinon démo)
npm run demo       # force le mode démo, sans IA
npm test           # tests automatiques (sans appel à Claude)
```

Pour parler (sinon, on écrit dans la barre du bas) :

```bash
npm run whisper:install   # une fois : compile whisper.cpp et télécharge le modèle (~550 Mo)
npm run whisper           # à laisser tourner dans un terminal à côté
```

`whisper:install` demande `git`, `cmake` et un compilateur C++. Machine lente :
`WHISPER_MODEL=small npm run whisper:install` puis `WHISPER_MODEL=small npm run whisper`.

## Utilisation

- **Parler** : bouton micro ou <kbd>Espace</kbd>. Le texte est découpé aux pauses et
  transcrit phrase par phrase. **Écrire** : <kbd>/</kbd> puis <kbd>Entrée</kbd>.
- **Carte** : molette ou pincement pour zoomer, glisser pour se déplacer. Clic sur un nœud :
  *Renommer* (ou double-clic, <kbd>Entrée</kbd>), *Creuser* (demande à l'agent
  d'approfondir), *Supprimer* (<kbd>Suppr</kbd>, avec annulation). Un nœud corrigé à la main
  porte une pastille : l'agent n'y touche plus, et ne recrée pas ce qui a été supprimé.
- **Suggestions** : *Répondre* rattache ta prochaine phrase à la question ; *Ignorer* l'écarte
  pour de bon. Survoler une suggestion met en évidence le nœud concerné.
- **Couverture** : l'état des 8 dimensions de la grille. Cliquer une dimension permet d'y
  répondre directement.
- **Générer le prompt** : Claude rédige le prompt de tâche final (modifiable, copiable,
  téléchargeable en `.md`). *Version brute* l'assemble sans IA, instantanément.
- **Voir la démo** (écran d'accueil) : rejoue un scénario complet sans IA. Une session de démo
  reste en mode démo ; *Nouvelle* repart en mode normal.
- La session est sauvegardée dans le navigateur et survit à un rechargement.

## Configuration

Tout est optionnel. Copier `prompt-map.config.example.json` en `prompt-map.config.json`,
ou utiliser les variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PROMPTMAP_LLM` | `auto` | `auto`, `claude` ou `demo` |
| `PROMPTMAP_MODEL` | *(celui de ton Claude Code)* | modèle, ex. `opus`, `sonnet` |
| `PROMPTMAP_UPDATE_EFFORT` | `low` | effort pour les mises à jour live (réactivité) |
| `PROMPTMAP_EXPORT_EFFORT` | *(défaut du modèle)* | effort pour l'export final |
| `PROMPTMAP_WHISPER_URL` | `http://127.0.0.1:8178/inference` | serveur whisper.cpp, ou tout serveur compatible OpenAI (`…/v1/audio/transcriptions`) |
| `PROMPTMAP_LANGUAGE` | `fr` | langue de transcription |
| `PROMPTMAP_PORT` | `4317` | port de l'interface |
| `PROMPTMAP_OPEN` | `1` | `0` pour ne pas ouvrir de fenêtre |

## Architecture

```
navigateur (web/)                         serveur local (server/, Node sans dépendance)
─────────────────                         ─────────────────────────────────────────────
micro → AudioWorklet → VAD → WAV ──────▶  /api/transcribe ──▶ whisper-server (local)
carte SVG, suggestions, grille            /api/update     ──▶ claude -p (abonnement)
session (localStorage) ─── état complet ▶ /api/export     ──▶ claude -p, ou version brute
```

- **Serveur sans état** : la session vit côté interface et part avec chaque requête.
  Pour le portage web, seul le serveur change (Whisper et Claude hébergés), pas l'interface.
- **Carte par opérations** : Claude renvoie des opérations (`add`, `update`, `move`,
  `remove`) sur des nœuds à ID stables, jamais une carte complète. Côté et couleur d'une
  branche sont figés à sa création : la carte ne « saute » pas. Rendu SVG maison
  (`web/js/map-view.js`), disposition pure et testée (`web/js/shared/layout.js`).
- **Un seul appel par mise à jour** : carte, grille et suggestions dans la même réponse
  JSON, validée par schéma (`server/llm/prompts.js`). Les mises à jour sont regroupées :
  une seule en cours à la fois, la suivante part avec tout ce qui s'est dit entre-temps.
- **Claude via la CLI Claude Code** (`claude -p`, sans outils, sans session, sans MCP) :
  utilise l'abonnement déjà connecté, sans clé API ni coût à l'usage.

## Choix de ce premier jet (à valider)

| Sujet | Choix | Pourquoi |
|---|---|---|
| Appel à Claude | CLI Claude Code (`claude -p`) | gratuit avec l'abonnement, rien à configurer |
| Desktop | serveur local + fenêtre `--app` de Chrome/Edge | fenêtre d'appli sans Electron (zéro dépendance), 100 % techno web |
| Rendu de carte | SVG maison, sans librairie | zéro dépendance, contrôle total des animations et des ID stables |
| Framework | aucun (JS natif, modules ES) | zéro dépendance, rien à compiler |
| Transcription | whisper.cpp (`whisper-server`) | local, gratuit, rapide ; modèle `large-v3-turbo` quantifié |
| Réactivité | effort `low` pour les mises à jour live | une mise à jour doit arriver en secondes ; l'export garde l'effort par défaut |

## Tests

`npm test` lance 45 tests (Node, sans dépendance, **sans appel à Claude**) : modèle de carte,
disposition (aucun chevauchement), découpage audio et WAV, prompts et schéma, validation des
réponses, chaîne CLI avec un faux binaire `claude`, mode démo, serveur HTTP (dont un faux
serveur whisper.cpp et le refus des appels d'un autre site).

Vérifié en plus pendant le développement (hors suite automatique) : parcours complet dans
Chromium sans erreur JS (démo, export, renommage, réponse, rechargement, thème sombre, écran
étroit) et micro réel dans le navigateur, avec de la parole française transcrite par
whisper.cpp.

## Limites connues

- **Jamais testé avec le vrai Claude** (volontairement). La sortie de
  `claude -p --output-format json --json-schema` est lue de deux façons (champ
  `structured_output`, sinon JSON extrait du texte), et si la CLI refuse `--json-schema`,
  prompt-map réessaie sans et garde ce mode. À confirmer au premier essai réel.
- La latence d'une mise à jour dépend du démarrage de la CLI et du modèle (quelques
  secondes). Leviers : `PROMPTMAP_MODEL=sonnet`, effort `low` (défaut).
- Scripts Whisper vérifiés sur Linux (messages d'erreur) mais pas compilés ici ; Windows non
  pris en charge par les scripts (whisper.cpp s'y installe à la main).
- Le mode démo sans IA range les phrases libres par mots-clés : c'est un aperçu, pas une analyse.
- Découpage audio par énergie : un bruit de fond fort et continu peut gêner la détection des pauses.
