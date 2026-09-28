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
npm run whisper:install   # une fois : compile whisper.cpp et télécharge le modèle
npm run whisper           # à laisser tourner dans un terminal à côté
```

`whisper:install` demande `git`, `cmake`, `make` (ou `ninja`) et un compilateur C++, et
produit un binaire autonome. Le modèle est choisi selon la machine : `large-v3-turbo-q5_0`
(~550 Mo, le plus précis) avec un GPU ou 8 cœurs et plus, sinon `small-q5_1` (~190 Mo,
environ 5 fois plus rapide). `WHISPER_MODEL=…` impose un autre modèle.

Sans droits administrateur, tout s'installe en espace utilisateur :
`pip install --user cmake ninja ziglang`, avec de petits scripts `cc`, `c++`, `ar` et
`ranlib` qui appellent `python -m ziglang cc` (resp. `c++`, `ar`, `ranlib`), placés en tête
du `PATH`.

### Depuis un autre poste (conteneur, machine du réseau)

Le navigateur n'ouvre le micro qu'en HTTPS ou sur `localhost`. Pour servir prompt-map sur
une IP (ici celle d'un conteneur Docker, `hostname -i`) :

```bash
npm run cert -- 172.17.0.5      # certificat auto-signé pour cette IP
PROMPTMAP_HOST=0.0.0.0 PROMPTMAP_ALLOWED_HOSTS=172.17.0.5 \
PROMPTMAP_TLS_CERT=.cert/cert.pem PROMPTMAP_TLS_KEY=.cert/key.pem npm start
```

Puis ouvrir `https://172.17.0.5:4317` et accepter une fois l'avertissement du certificat.
Seules les adresses de `PROMPTMAP_ALLOWED_HOSTS` sont acceptées : prompt-map pilote ta CLI
Claude, il ne faut pas l'exposer à tout le réseau.

## Utilisation

- **Parler** : bouton micro, ou <kbd>Espace</kbd> : appui maintenu pour parler tant qu'on
  tient la touche (relâcher envoie), appui bref pour le micro continu. **Écrire** : <kbd>/</kbd>
  puis <kbd>Entrée</kbd>.
- **Direct** : `npm run whisper` lance aussi un petit Whisper (`tiny`, 1 cœur) qui affiche
  les mots dans la bulle pendant qu'on parle ; le texte définitif vient du modèle principal.
  Le direct se met en pause pendant la transcription d'un morceau définitif, pour ne jamais
  la ralentir. Les deux serveurs adaptent leur fenêtre d'encodage à la durée de l'extrait
  (`audio_ctx`), ce qui les rend 2 à 3 fois plus rapides sur quelques secondes.
- **Recherche web** : faite par un **agent séparé**, lancé en parallèle, avec les seuls outils
  `WebSearch` et `WebFetch`, sans rien partager avec l'agent de travail. Elle se lance d'un
  bouton *Chercher* : sur une question « Recherche » proposée par l'agent, ou sur un nœud.
  Elle part aussi toute seule quand tu la demandes à voix haute (« va chercher… »). Les
  références et idées trouvées s'ajoutent à la carte en un clic (branches « Références » et
  « Pistes de la recherche ») ; l'agent de travail ne voit que ce que tu ajoutes.
- **Paroles parasites** : le micro capte tout ; c'est l'agent qui écarte ce qui n'a rien à
  voir avec la tâche (autre conversation, télé, politesses).
- **Carte** : molette ou pincement pour zoomer, glisser le fond pour se déplacer. Clic sur
  un nœud : son détail s'affiche, avec *Renommer* (ou double-clic, <kbd>Entrée</kbd>),
  *Ajouter* un point dessous (<kbd>Tab</kbd>), *Creuser* (demande à l'agent d'approfondir),
  *Supprimer* (<kbd>Suppr</kbd>, avec annulation). Glisser un nœud sur un autre l'y range.
  Un nœud créé, renommé ou déplacé à la main porte une pastille : l'agent n'y touche plus,
  et ne recrée pas ce qui a été supprimé.
- **Transcription** : survoler une phrase propose ✎ (corriger ce que Whisper a mal compris)
  et ✕ (retirer la phrase). L'agent remet la carte en accord. Après chaque phrase dite, la
  bulle montre un instant ce que Whisper a compris. Les termes de la carte sont transmis à
  Whisper comme vocabulaire, pour mieux reconnaître les noms techniques.
- **Questions de l'agent** : en cartes au-dessus de la carte heuristique. *Répondre*
  rattache ta prochaine phrase à la question : la carte passe à « Réponse notée ✓ », puis
  s'envole vers le nœud que ta réponse a créé ou modifié. *Ignorer* l'écarte pour de bon.
  Survoler une question met en évidence le nœud concerné.
- **Parole longue** : le texte est découpé aux respirations (au-delà de 6 s de parole) ou,
  sans aucune pause, toutes les 12 s au plus : il arrive au fil de l'eau. Si Whisper est
  assez rapide (3 fois plus vite que la parole), la bulle montre en plus une transcription
  provisoire pendant qu'on parle. Les bruits (« [Rires] », « *porte* ») sont écartés, et un
  mot isolé (« merci ») attend la suite au lieu de déclencher une mise à jour.
- **Panneau de gauche** : la couverture (les 8 dimensions de la grille ; cliquer une dimension
  permet d'y répondre) et la transcription, qui défile en suivant le texte.
- **Générer le prompt** : Claude rédige le prompt de tâche final (modifiable, copiable,
  téléchargeable en `.md`). *Copier la commande* donne `claude '…'`, à coller dans un
  terminal ouvert dans le dossier du projet. *Version brute* assemble le prompt sans IA,
  instantanément.
- **Voir la démo** (écran d'accueil) : rejoue un scénario complet sans IA. Une session de démo
  reste en mode démo ; *Nouvelle* repart en mode normal.
- **Sessions** : chaque session est gardée dans le navigateur (elle survit à un rechargement).
  *Nouvelle* en démarre une autre sans rien effacer ; *Sessions* liste les précédentes pour
  les rouvrir ou les supprimer. Le dernier prompt généré est conservé avec sa session.
- Pendant une mise à jour, la pastille en haut affiche le temps écoulé.
- **Plus tard** : sur une question, la met de côté. L'agent ne la repose pas, elle reste
  dans la pile « Plus tard » (pour y répondre ou l'écarter) et dans les points non précisés
  du prompt final.
- **Consommation**, en bas du panneau, à la façon d'une statusline Claude Code : modèle,
  effort, mode, `Ctx` (taille du contexte du dernier appel et part de la fenêtre, en
  couleur), tokens de la session (entrée + sortie, hors cache), cache lu au dernier appel,
  durée. Le détail (et l'équivalent API) est au survol. Le serveur note aussi chaque appel
  dans son terminal.

## Configuration

Tout est optionnel. Copier `prompt-map.config.example.json` en `prompt-map.config.json`,
ou utiliser les variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PROMPTMAP_LLM` | `auto` | `auto`, `claude` ou `demo` |
| `PROMPTMAP_CLAUDE_MODE` | `stream` | `stream` : une conversation Claude gardée ouverte par session · `oneshot` : un processus par mise à jour |
| `PROMPTMAP_MODEL` | *(celui de ton Claude Code)* | modèle, ex. `opus`, `sonnet` |
| `PROMPTMAP_UPDATE_EFFORT` | `low` | effort pour les mises à jour live (réactivité) |
| `PROMPTMAP_EXPORT_EFFORT` | *(défaut du modèle)* | effort pour l'export final |
| `PROMPTMAP_WHISPER_LIVE_URL` | `http://127.0.0.1:8179/inference` | petit Whisper du direct (`''` pour s'en passer) |
| `PROMPTMAP_WHISPER_URL` | `http://127.0.0.1:8178/inference` | serveur whisper.cpp, ou tout serveur compatible OpenAI (`…/v1/audio/transcriptions`) |
| `PROMPTMAP_LANGUAGE` | `fr` | langue de transcription |
| `PROMPTMAP_PORT` | `4317` | port de l'interface |
| `PROMPTMAP_OPEN` | `1` | `0` pour ne pas ouvrir de fenêtre |
| `PROMPTMAP_HOST` | `127.0.0.1` | adresse d'écoute (`0.0.0.0` pour un conteneur) |
| `PROMPTMAP_ALLOWED_HOSTS` | *(aucune)* | adresses acceptées en plus de localhost, séparées par des virgules |
| `PROMPTMAP_TLS_CERT` / `PROMPTMAP_TLS_KEY` | *(aucun)* | certificat et clé PEM pour servir en HTTPS (`npm run cert`) |

## Architecture

```
navigateur (web/)                         serveur local (server/, Node sans dépendance)
─────────────────                         ─────────────────────────────────────────────
micro → AudioWorklet → VAD → WAV ──────▶  /api/transcribe ──▶ whisper-server (local)
carte SVG, suggestions, grille            /api/update     ──▶ claude -p en flux, gardé ouvert
session (localStorage) ─── état complet ▶ /api/export     ──▶ claude -p, ou version brute
```

- **Serveur sans état** : la session vit côté interface et part avec chaque requête.
  Pour le portage web, seul le serveur change (Whisper et Claude hébergés), pas l'interface.
- **Carte par opérations** : Claude renvoie des opérations (`add`, `update`, `move`,
  `remove`) sur des nœuds à ID stables, jamais une carte complète. Côté et couleur d'une
  branche sont figés à sa création : la carte ne « saute » pas. Rendu SVG maison
  (`web/js/map-view.js`), disposition pure et testée (`web/js/shared/layout.js`).
- **Un seul appel par mise à jour, en différences** : dans la même réponse JSON, validée
  par schéma (`server/llm/prompts.js`), les opérations sur la carte, les seules dimensions de
  la grille qui changent (`grid_changes`) et les questions, ou `null` si elles ne changent
  pas. Moins de texte produit, donc des réponses plus rapides. Les mises à jour sont regroupées :
  une seule en cours à la fois, la suivante part avec tout ce qui s'est dit entre-temps.
- **Claude via la CLI Claude Code** (`claude -p`, sans outils, sans MCP) : utilise
  l'abonnement déjà connecté, sans clé API ni coût à l'usage.
- **Conversation gardée ouverte** (`server/llm/claude-stream.js`) : un processus
  `claude -p --input-format stream-json` par session, lancé dès l'ouverture de la page.
  Plus de démarrage de la CLI à chaque mise à jour, et le début de la conversation reste en
  cache côté modèle. Le premier message donne l'état complet, les suivants seulement les
  nouveautés (nouvelles phrases, corrections faites à la main sur la carte, suggestions
  écartées).
- **Pseudo-compact** : si le processus plante, dépasse 30 échanges ou reste inactif
  15 min, on en relance un en lui donnant l'état actuel (carte, grille, suggestions,
  transcription) en un seul message, sans rejouer l'historique. Pendant un plantage, la mise
  à jour en cours passe par un appel ponctuel de secours ; après trois échecs de suite, le
  mode ponctuel reste actif.

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

`npm test` lance 67 tests (Node, sans dépendance, **sans appel à Claude**) : modèle de carte,
disposition (aucun chevauchement), découpage audio et WAV, prompts et schéma, validation des
réponses, chaîne CLI avec un faux binaire `claude` (appel ponctuel et conversation gardée
ouverte : nouveautés seules, plantage et reprise, limite de longueur), mode démo, serveur HTTP (dont un faux
serveur whisper.cpp et le refus des appels d'un autre site).

Vérifié en plus pendant le développement (hors suite automatique) : parcours complet dans
Chromium sans erreur JS (démo, export, renommage, ajout et glisser-déposer de nœuds,
correction et retrait de phrases, réponse, rechargement, thème sombre, écran étroit), et
chaîne audio réelle : `npm run whisper:install` puis `npm run whisper`, parole française
injectée comme micro de Chromium, transcrite par `whisper-server` (~5 s par phrase avec
`small-q5_1` sur 2 cœurs, ~23 s avec `large-v3-turbo`).

## Limites connues

- **Jamais testé avec le vrai Claude** (volontairement). La sortie de
  `claude -p --output-format json --json-schema` est lue de deux façons (champ
  `structured_output`, sinon JSON extrait du texte), et si la CLI refuse `--json-schema`,
  prompt-map réessaie sans et garde ce mode. À confirmer au premier essai réel.
- Le mode flux (`--input-format stream-json`) n'a pas non plus été essayé avec le vrai
  Claude. S'il échoue, le secours ponctuel prend le relais ; `PROMPTMAP_CLAUDE_MODE=oneshot`
  le désactive.
- Latence : le terminal du serveur affiche la durée de chaque mise à jour. Leviers :
  `PROMPTMAP_MODEL=sonnet`, effort `low` (défaut).
- Scripts Whisper éprouvés sur Linux (compilation complète avec zig, cmake et ninja) ;
  macOS non essayé ; Windows non pris en charge par les scripts (whisper.cpp s'y installe
  à la main).
- La première phrase n'a pas encore de vocabulaire : un terme rare peut y être mal compris
  (à corriger avec ✎, ou laissé à Claude, qui corrige les mots manifestement mal entendus).
- Le mode démo sans IA range les phrases libres par mots-clés : c'est un aperçu, pas une analyse.
- Découpage audio par énergie : un bruit de fond fort et continu peut gêner la détection des pauses.
