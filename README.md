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

## Statut

Cadrage initial — description posée, stack et architecture à définir.
