# Intégration prompt-map ↔ autodev — notes de discussion

Discussion ouverte le 2026-11-24, état tenu à jour à chaque échange. **Rien n'est acté** : ce sont
des pistes, des positions et des faits vérifiés dans le code d'autodev v2 (branche
`task/20260929-100600`, release 0.2.0). Les propos du user utiles à la réflexion sont cités
verbatim, entre guillemets.

## 1. Vision

1. User : « dans l'ideal autodev et promptmap seraient deux processus differents qui communique par
   ces messages comme l'interface de controle a distance. »
2. User, sur les deux usages envisagés au départ : « que ce soit pour faire les plans internes au run
   (donc sans interface graphique, eventuellement en un mode plus autonome) ou pour mieux comprendre
   le besoin du user. »
3. État : on travaille l'usage « comprendre le besoin » ; l'usage interne au run est reporté (§8).

## 2. Ce que prompt-map transmet

1. User : « le plan aura un format standard json, on peut ajouter des champs. »
2. User, précision : « j'ai pas dis que prompt map contenait le plan json de autodev. j'ai dis que
   promptmap fait son plan de plusieurs runs autodev, et il transmet le besoin au format json prevu
   dans le plan. »
   → prompt-map fait **son propre plan** de plusieurs runs autodev ; pour chaque run, il transmet le
   besoin au format JSON prévu dans ce plan. Ce n'est pas le plan d'autodev.
3. User : « on envoie pas la transcription complete a autodev, on envoie juste les citations qui
   permettent de decreter une demande en ferme vs souhaitee. »
4. User : « j'ai pas dis que promptmap envoyait qu'un seul message. » → plusieurs messages possibles.
5. Remarque (Claude) : sans la transcription, le tracker ne peut plus vérifier qu'une citation est
   bien de toi ; il ne peut que la lire. Que la citation soit fidèle repose alors sur prompt-map.
6. User : « on peut meme prevoir une classification des specs en fonction de si le point est
   explicite par le user, ou interprete, avec preuves cites. »
   1. Position (Claude) : *explicite* = appuyé par des citations du user (vérification mécanique
      contre la transcription caduque, cf. 2.3 et 2.5) ;
   2. *interprété* = traité comme une décision prise pour le user (DEC-2), donc listé dans le rapport
      et contestable.
7. Ouvert : autodev utilise l'origine dans ses règles, ou se contente de l'afficher dans le plan et
   le rapport. User : « je ne sais pas encore. »
8. User, autres parades : « prompt map change son langage pour etre moins categorique et preface le
   plan par une intro qui dit que c'est la comprehension d'un agent llm du besoin du user, et autodev
   est moins strict sur les points de l'agent quand il est en interface avec promptmap. »
9. Position (Claude) : le langage moins catégorique est un complément utile mais non vérifiable ;
   une marque d'origine portée par le message plutôt qu'une intro en prose — user : « pourquoi
   pas. » ; pas de mode « autodev moins strict » réservé à prompt-map (deux jeux de règles, K4), la
   classification par origine donnant le même effet.
10. User : « dans les prochaines versions, le planner est un type d'agent qui va etre lance plein de
   fois, pas juste au debut du run. » → l'origine des points doit vivre dans l'état du run, pas
   seulement dans le premier brief.

## 3. Ce que prompt-map demande au user

1. Position (Claude) : seulement ce que ni le code ni la mémoire d'autodev ne règlent (R_ASKS_103
   appliquée en amont) ; sur un projet existant, la grille se réduit d'elle-même. User, sur la grille
   réduite : « pour la grille oui je suis d'accord ».
2. User : « des fois il peut y avoir des doutes avec la memoire. l'ideal serait que promptmap ait
   acces a ces infos oui, mais c'est ptet un peu trop ambitieux, je sais pas. »
3. Position (Claude) : la mémoire sert à éviter une question, jamais à trancher ; en cas de doute, la
   question est posée (autodev pose déjà les conflits avec la mémoire, R_ASKS_106).
4. User : « aujourd'hui je crois que autodev a pas la fonction reponse mais on peut la mettre en
   place. » — Claude : une question sur la mémoire existe déjà (R_ENTR_116) ; par message, elle
   devrait revenir avec sa réponse (non essayé).

## 4. Partir de zéro

1. User : « le user peut vouloir utiliser le combo pour coder un truc de zero, auquel cas promptmap
   devra preparer un plan multi-runs autodev, et le premier autodev n'a aucun element. »
2. Le plan multi-runs est celui de prompt-map (cf. 2.2) : une suite de runs, chacun avec son besoin
   au format JSON ; autodev planifie chaque run en ses missions (DEC-1, R_ENTR_204). Sur un projet vide,
   stack, contraintes et références redeviennent des questions.
3. User, sur l'initialisation d'un dépôt vide : « je ne pense pas qu'on sache faire actuellement. »
   → prérequis de ce cas.
4. User : « ou alors repartir du travail non promu pourquoi pas. » — *Vérifié* : un run peut partir
   de la branche d'un run antérieur non promu (R_WORK_238), sa branche cible étant alors celle de ce
   run (R_WORK_218) → pull requests empilées, sans promotion entre deux runs.

## 5. Promotion et questions réservées

1. User : « dans le cas de promptmap, la promotion serait son role puisque c'est promptmap qui
   jouerait le user du point de vue de autodev, non ? »
2. Position (Claude) : la promotion reste à l'humain (DEC-2, amendement du 2026-09-28) ; prompt-map
   peut être l'interface où il la fait.
3. Position (Claude) : les questions que DEC-2 réserve au user lui parviennent ; prompt-map les
   relaie (à l'oral, par exemple). Une réponse que prompt-map tirerait de la carte serait
   *interprétée*.

## 6. Le canal `autodev message` aujourd'hui (vérifié dans le code)

1. User : « par contre message c'est que quand autodev est lance et en cours d'exxecution je crois ?
   faut verifier. »
2. Il exige la conversation du projet ouverte : la boîte de réception est relevée chaque seconde ; un
   run en cours n'est pas nécessaire.
3. Sans conversation, le message est supprimé au bout de 5 min et l'envoyeur reçoit « no reply ».
4. La réponse ne contient que la réplique immédiate ; les questions et le rapport qui suivent ne
   s'affichent que dans la conversation.
5. Conçu pour piloter une machine cible depuis le poste de pilotage (R_DEPL_112) ; la fonction de
   dépôt prend un dossier d'état quelconque, donc devrait marcher en local (non essayé).

## 7. À ajouter côté autodev

User : « on peut ajouter ces fonctions je pense. »

1. Renvoi asynchrone des questions et des rapports à l'envoyeur d'un message.
2. Marque d'origine des messages.
3. Conversation sans terminal, pilotée par messages.
4. Initialisation d'un dépôt vide.

## 8. Plus tard

1. User : « pour l'usage interne on verra plus tard ; llm plan maker c'etait une idee que je ne
   developperais que plus tard, et promptmap pourra l'utiliser aussi je pense. »

## 9. Points à discuter (proposés par Claude, 2026-11-25)

1. Erreurs de transcription : un point explicite cite la transcription. Si Whisper a mal entendu, la
   citation est fausse mais vérifiée. La transcription envoyée doit être celle corrigée (✎).
   1. User : « le user ne fait rien du tout. promptmap reflechit deux secondes et corrige le
      transcript en coherence avec le discours du user et le transcript corrige est envoye. »
   2. Position (Claude) : garder la trace des mots corrigés par prompt-map ; une citation qui repose
      sur un mot corrigé par l'agent compte comme *interprétée*, pas *explicite*.
2. Classement opinion / directive ferme : autodev le fait à partir de la formulation du user. La
   parole spontanée est plus hésitante que l'écrit, d'où un risque de tout classer en opinions.
   1. User : « si c'est important, prompt map demande. et autodev gere. si promptmap demande et que
      c'est ferme, ya une citation dessus »
3. Aller-retour : les questions d'autodev reviennent dans la même session prompt-map et sur la même
   carte, ce qui lie une session prompt-map à un ou plusieurs runs.
   1. Choisi par le user : « Dans la même session » — les questions et le rapport d'autodev
      reviennent dans la session prompt-map d'origine, sur la même carte ; une session est liée à
      ses runs.
4. Montrer le plan d'autodev au user : dans ses mots, sans noms de missions (R_ENTR_204), par exemple
   comme une branche de la carte.
   1. User : « pourquoi prompt-map montrerait ce qu'autodev va faire ? on fait ce branchement
      justement pour que le user n'ait pas a s'en preoccuper » → écarté : prompt-map ne montre pas
      le plan d'autodev.
5. Critère de fin et périmètre dits par le user : la phase Specify d'autodev doit les reprendre comme
   points explicites, pas les réécrire.
   1. User : « je comprends pas. c'est promptmap qui va prompt autodev, pourquoi tu poses cette
      question ? » → retiré : autodev le couvre déjà, changer le périmètre ou le critère d'une
      demande est un changement d'objectif, toujours demandé au user (R_ASKS_104).
6. Niveau de dépense : « fais-le vite / pas cher » à l'oral. Intake sait déjà lire un niveau (tier)
   cité.
   1. User : « je crois pas que ce soit intake qui choissise le niveau, pour moi c'est de la
      config. »
   2. *Vérifié* (R_ENTR_111) : un run travaille au niveau qu'un passage cité de sa demande nomme,
      sinon à celui de la configuration, sinon en standard. La configuration donne le niveau par
      défaut, et une phrase de la demande peut le remplacer pour ce run. intake ne fait que repérer
      le passage.
   3. Conséquence de 2.3 : une phrase sur la dépense n'atteint autodev que si prompt-map la met
      parmi les citations transmises.
7. Autodev sur une autre machine : le pilote sait déjà envoyer un message à une cible
   (`--target … --message`). prompt-map tourne en local avec le micro, autodev dans un conteneur ou
   en SSH.
8. Export actuel « prompt Claude Code » : le garder à côté de la cible autodev, ou le remplacer.
9. Tester le combo : le mode démo de prompt-map produit des messages fixes, qui peuvent servir de
   scénario e2e côté autodev (fixtures `shop-py`).
