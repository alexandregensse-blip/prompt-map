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

Cadrage initial — cible de l'export et modèle de la carte posés (grille v1),
stack et architecture à définir.
