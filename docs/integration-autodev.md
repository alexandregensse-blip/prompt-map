# Intégration prompt-map ↔ autodev — notes de discussion

Discussion ouverte le 2026-11-24, état tenu à jour à chaque échange. **Rien n'est acté** : ce sont des pistes, des positions et des
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
   le rapport (user : ne sait pas encore).
6. Autres parades proposées par le user : prompt-map adopte un langage moins catégorique et préface
   le plan d'une intro disant que c'est la compréhension du besoin par un agent LLM ; autodev est
   moins strict sur les points venant de prompt-map.
7. Position (Claude) : le langage moins catégorique est un complément utile mais non vérifiable ; pas de mode « autodev moins strict » réservé à prompt-map (deux jeux de règles,
   K4) ; la classification par origine donne le même effet.

## 3. Ce que prompt-map demande au user

1. Seulement ce que ni le code ni la mémoire d'autodev ne règlent (R_ASKS_103 appliquée en amont).
2. Projet existant : la grille se réduit d'elle-même. Projet vide : stack, contraintes et références
   redeviennent des questions.
3. La mémoire d'autodev sert à éviter une question, jamais à trancher ; en cas de doute, la question
   est posée (autodev pose déjà les conflits avec la mémoire, R_ASKS_106).
4. Accès de prompt-map à la mémoire d'autodev : souhaitable mais peut-être trop ambitieux (user) ; il
   peut y avoir des doutes avec la mémoire. Une question sur la
   mémoire existe déjà côté autodev (R_ENTR_116) ; par message, elle devrait revenir avec sa réponse
   (non essayé).

## 4. Partir de zéro

1. Besoin (user) : utiliser le combo pour coder un projet de zéro ; prompt-map prépare alors un plan
   multi-runs, et le premier run d'autodev n'a aucun élément.
2. Position (Claude) : prompt-map produit une liste ordonnée de besoins avec leurs dépendances plutôt
   qu'un plan en missions autodev ; autodev planifie chacun.
3. *Vérifié* : un run peut partir de la branche d'un run antérieur non promu (R_WORK_238), sa branche
   cible étant alors celle de ce run (R_WORK_218) → pull requests empilées, sans promotion entre deux
   runs.
4. autodev ne sait pas initialiser un dépôt vide aujourd'hui (user) : prérequis de ce cas.

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

Le user pense qu'on peut ajouter ces fonctions.


1. Renvoi asynchrone des questions et des rapports à l'envoyeur d'un message.
2. Marque d'origine des messages.
3. Conversation sans terminal, pilotée par messages.
4. Initialisation d'un dépôt vide.

## 8. Plus tard

1. Usage interne au run (prompt-map ou plan maker sans interface).
2. `llm-plan-maker` : idée que le user ne développera que plus tard ; prompt-map pourrait aussi
   l'utiliser.
3. Note : dans les prochaines versions d'autodev, le planner est lancé de nombreuses fois par run, pas
   seulement au début ; l'origine des points doit donc vivre dans l'état du run.
