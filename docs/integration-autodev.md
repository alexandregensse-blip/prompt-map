# Intégration prompt-map ↔ autodev — notes de discussion

Discussion ouverte le 2026-11-24. **Rien n'est acté** : ce sont des pistes, des positions et des
faits vérifiés dans le code d'autodev v2 (branche `task/20260929-100600`, release 0.2.0).

## 1. Vision

1. prompt-map et autodev sont deux processus distincts qui communiquent par messages, comme le
   contrôle à distance d'autodev (`autodev message`).
2. Rôle de prompt-map : faire émerger le besoin du user et le transmettre à autodev.

## 2. Ce que prompt-map transmet

1. Un plan au format JSON standard d'autodev, avec des champs ajoutés.
2. Ta transcription accompagne le plan, dans le même message, pour que le tracker puisse vérifier
   les passages cités.
3. Chaque point porte son origine :
   1. *explicite* : avec ses passages cités, vérifiés mécaniquement comme sous-chaînes de la
      transcription ;
   2. *interprété* : traité comme une décision prise pour le user (DEC-2), donc listé dans le
      rapport et contestable.
4. L'origine est portée par une marque dans le message plutôt que par une intro en prose (« pourquoi
   pas »).
5. Ouvert : autodev utilise l'origine dans ses règles, ou se contente de l'afficher dans le plan et
   le rapport.
6. Position (Claude) : pas de mode « autodev moins strict » réservé à prompt-map (deux jeux de règles,
   K4) ; la classification par origine donne le même effet.

## 3. Ce que prompt-map demande au user

1. Seulement ce que ni le code ni la mémoire d'autodev ne règlent (R_ASKS_103 appliquée en amont).
2. Projet existant : la grille se réduit d'elle-même. Projet vide : stack, contraintes et références
   redeviennent des questions.
3. La mémoire d'autodev sert à éviter une question, jamais à trancher ; en cas de doute, la question
   est posée (autodev pose déjà les conflits avec la mémoire, R_ASKS_106).
4. Accès de prompt-map à la mémoire d'autodev : souhaitable, peut-être ambitieux. Une question sur la
   mémoire existe déjà côté autodev (R_ENTR_116) ; par message, elle devrait revenir avec sa réponse
   (non essayé).

## 4. Partir de zéro

1. prompt-map produit une liste ordonnée de besoins avec leurs dépendances ; autodev planifie chacun.
2. *Vérifié* : un run peut partir de la branche d'un run antérieur non promu (R_WORK_238), sa branche
   cible étant alors celle de ce run (R_WORK_218) → pull requests empilées, sans promotion entre deux
   runs.
3. autodev ne sait pas initialiser un dépôt vide aujourd'hui : prérequis de ce cas.

## 5. Promotion et questions réservées

1. Piste du user : prompt-map, jouant le user pour autodev, ferait la promotion.
2. Position (Claude) : la promotion reste à l'humain (DEC-2, amendement du 2026-09-28) ; prompt-map
   peut être l'interface où il la fait.
3. Les questions que DEC-2 réserve au user lui parviennent ; prompt-map les relaie (à l'oral, par
   exemple). Une réponse que prompt-map tirerait de la carte serait *interprétée*.

## 6. Le canal `autodev message` aujourd'hui (vérifié dans le code)

1. Il exige la conversation du projet ouverte : la boîte de réception est relevée chaque seconde ; un
   run en cours n'est pas nécessaire.
2. Sans conversation, le message est supprimé au bout de 5 min et l'envoyeur reçoit « no reply ».
3. La réponse ne contient que la réplique immédiate ; les questions et le rapport qui suivent ne
   s'affichent que dans la conversation.
4. Conçu pour piloter une machine cible depuis le poste de pilotage (R_DEPL_112) ; la fonction de dépôt
   prend un dossier d'état quelconque, donc devrait marcher en local (non essayé).

## 7. À ajouter côté autodev

1. Renvoi asynchrone des questions et des rapports à l'envoyeur d'un message.
2. Marque d'origine des messages.
3. Conversation sans terminal, pilotée par messages.
4. Initialisation d'un dépôt vide.

## 8. Plus tard

1. Usage interne au run (prompt-map ou plan maker sans interface).
2. `llm-plan-maker`, que prompt-map pourrait aussi utiliser.
3. Note : dans les prochaines versions d'autodev, le planner est lancé de nombreuses fois par run, pas
   seulement au début ; l'origine des points doit donc vivre dans l'état du run.

## 9. Ce que le user a dit (verbatim, dans l'ordre)

Ce fichier est tenu à jour à chaque échange : tout ce que dit le user est noté ici, et les sections
1 à 8 donnent l'état des réflexions.

### 2026-11-24

1. « le proto de prompt map me laisse un bon souvenir et je pense que le projet a du potentiel. je
   reflechis a la possibilite de l'interfacer avec autodev, que ce soit pour faire les plans internes
   au run (donc sans interface graphique, eventuellement en un mode plus autonome) ou pour mieux
   comprendre le besoin du user. prend connaissance de autodev sur mon github et parlons en »
2. « autodev v2 a du code sur sa branche, j'ai publie la 0.2.0, et je suis en train de l'ameliorer.
   promptmap j'avais un proto fonctionnel pourquoi tu dis que ca existe que sur le papier ? »
   (Claude avait lu `main` seulement, qui ne contient que le cadrage ; corrigé.)
3. « dans les prochaines versions, le planner est un type d'agent qui va etre lance plein de fois,
   pas juste au debut du run. ya deux autres parades : prompt map change son langage pour etre moins
   categorique et preface le plan par une intro qui dit que c'est la comprehension d'un agent llm du
   besoin du user, et autodev est moins strict sur les points de l'agent quand il est en interface
   avec promptmap. on peut meme prevoir une classification des specs en fonction de si le point est
   explicite par le user, ou interprete, avec preuves cites. pour la grille oui je suis d'accord,
   mais ca n'empeche que le user peut vouloir utiliser le combo pour coder un truc de zero, auquel
   cas promptmap devra preparer un plan multi-runs autodev, et le premier autodev n'a aucun element.
   pour l'usage interne on verra plus tard ; llm plan maker c'etait une idee que je ne developperais
   que plus tard, et promptmap pourra l'utiliser aussi je pense. dans l'ideal autodev et promptmap
   seraient deux processus differents qui communique par ces messages comme l'interface de controle
   a distance. »
4. Forme : numéroter tous les points, tirets compris ; ne pas poser une question par section.
5. Réponses aux points numérotés :
   1. « 2.1 le plan aura un format standard json, on peut ajouter des champs. »
   2. « 2.2 je ne sais pas encore. »
   3. « 3.3 pourquoi pas. »
   4. « 5.1 des fois il peut y avoir des doutes avec la memoire. l'ideal serait que promptmap ait
      acces a ces infos oui, mais c'est ptet un peu trop ambitieux, je sais pas. »
   5. « 5.4 aujourd'hui je crois que autodev a pas la fonction reponse mais on peut la mettre en
      place. par contre message c'est que quand autodev est lance et en cours d'exxecution je crois ?
      faut verifier. » (vérifié : conversation ouverte requise, pas de run en cours requis — §6)
   6. « 7.1 je ne sais pas non plus, je ne pense pas qu'on sache faire actuellement. »
   7. « 7.2 dans le cas de promptmap, la promotion serait son role puisque c'est promptmap qui jouerait
      le user du point de vue de autodev, non ? ou alors repartir du travail non promu pourquoi
      pas. » (vérifié : repartir du non promu existe — §4.2)
   8. « 8 on peut ajouter ces fonctions je pense. »
6. Demande d'un récap sans les détails.
7. « pourquoi tu mets ca dans une memoire plutot que dans un fichier dans la branche que j'ai faite
   expres... » → ce fichier.
8. « tu dois noter tout ce que je dis, et l'etat de nos reflexions a jour dans un fichier »
9. « tu pousses direct. refais moi le recap j'ai pas lu »
