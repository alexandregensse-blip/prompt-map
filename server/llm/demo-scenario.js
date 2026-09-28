// Scénario de démonstration : ce qu'un utilisateur pourrait dire, et les réponses
// qu'on attend du moteur à chaque étape. Sert à la démo (sans Claude) et aux tests.

const g = (status, summary = '') => ({ status, summary });
const baseGrid = {
  objectif: g('missing'), contexte: g('missing'), perimetre: g('missing'), contraintes: g('missing'),
  references: g('missing'), critere_fin: g('missing'), priorites: g('missing'), points_libres: g('missing'),
};
const sug = (id, kind, dimension, text, node = '') => ({ id, kind, dimension, text, node, requested: false });

const S2 = sug('s2', 'question', 'critere_fin', 'Comment tu sauras que l’export PDF est terminé ?');
const S3 = sug('s3', 'question', 'perimetre', 'Y a-t-il des parties du code que Claude ne doit pas toucher ?');
const S5 = sug('s5', 'lead', 'references', 'Tu as déjà un modèle de facture dont le PDF doit s’inspirer ?', 'n2');
const S6 = sug('s6', 'blind_spot', 'perimetre', 'Une facture à la fois, ou aussi un export groupé de plusieurs factures ?', 'n2');
const S7 = sug('s7', 'lead', 'critere_fin', 'Faut-il écrire de nouveaux tests Jest pour l’export ?', 'n9');
const S8 = sug('s8', 'blind_spot', 'contraintes', 'pdfkit ne lit pas le HTML : il faudra redessiner la facture en code. Ça te va ?', 'n6');
const S10 = sug('s10', 'search', 'references', 'Exemples de factures PDF générées avec pdfkit à partir d’un modèle HTML', 'n12');
const S9 = sug('s9', 'question', 'points_libres', 'Claude peut-il choisir seul la mise en page exacte du PDF ?');

export const DEMO_SCENARIO = [
  {
    text: 'Alors voilà, j’ai une appli de facturation pour mon activité de freelance, et je voudrais pouvoir exporter les factures en PDF.',
    response: {
      ops: [
        { op: 'update', id: 'root', label: 'Export PDF des factures' },
        { op: 'add', id: 'n1', parent: 'root', label: 'Appli de facturation freelance' },
        { op: 'add', id: 'n2', parent: 'root', label: 'Export PDF', detail: 'Exporter les factures en PDF' },
      ],
      grid: {
        ...baseGrid,
        objectif: g('partial', 'Exporter les factures en PDF depuis l’appli de facturation.'),
        contexte: g('partial', 'Appli de facturation pour une activité freelance.'),
      },
      suggestions: [
        sug('s1', 'question', 'contexte', 'C’est une appli existante ? Avec quelle stack ?', 'n1'),
        S2,
      ],
    },
  },
  {
    text: 'C’est un projet existant, le back est en Node avec Express et le front en React. Les factures sont gérées dans le dossier src/invoices.',
    response: {
      ops: [
        { op: 'update', id: 'n1', label: 'Appli facturation existante' },
        { op: 'add', id: 'n3', parent: 'n1', label: 'Back Node / Express' },
        { op: 'add', id: 'n4', parent: 'n1', label: 'Front React' },
        { op: 'add', id: 'n5', parent: 'n1', label: 'src/invoices', detail: 'Dossier où sont gérées les factures' },
      ],
      grid: {
        ...baseGrid,
        objectif: g('partial', 'Exporter les factures en PDF depuis l’appli de facturation.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('partial', 'Stack imposée : Node/Express et React. Librairie PDF non choisie.'),
      },
      suggestions: [S2, S3],
    },
  },
  {
    text: 'Pour générer le PDF je pensais utiliser Puppeteer.',
    response: {
      ops: [{ op: 'add', id: 'n6', parent: 'n2', label: 'Puppeteer', detail: 'Piste pour générer le PDF' }],
      grid: {
        ...baseGrid,
        objectif: g('partial', 'Exporter les factures en PDF depuis l’appli de facturation.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('partial', 'Node/Express et React ; génération PDF envisagée avec Puppeteer.'),
      },
      suggestions: [
        sug('s4', 'blind_spot', 'contraintes', 'Puppeteer embarque un Chromium complet : c’est acceptable sur ton serveur ?', 'n6'),
        S2,
        S3,
      ],
    },
  },
  {
    text: 'Non en fait oublie Puppeteer, c’est trop lourd. Plutôt un truc léger, genre pdfkit.',
    response: {
      ops: [{ op: 'update', id: 'n6', label: 'pdfkit', detail: 'Librairie légère ; Puppeteer écarté car trop lourd' }],
      grid: {
        ...baseGrid,
        objectif: g('partial', 'Exporter les factures en PDF depuis l’appli de facturation.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('covered', 'Node/Express et React ; PDF généré avec pdfkit (pas Puppeteer, trop lourd).'),
      },
      suggestions: [S2, S3, S5],
    },
  },
  {
    text: 'Et surtout il ne faut pas toucher au module de paiement, il est fragile.',
    response: {
      ops: [{ op: 'add', id: 'n7', parent: 'root', label: 'Module paiement intouchable', detail: 'Module fragile, ne pas le modifier' }],
      grid: {
        ...baseGrid,
        objectif: g('partial', 'Exporter les factures en PDF depuis l’appli de facturation.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('covered', 'Node/Express et React ; PDF généré avec pdfkit (pas Puppeteer, trop lourd).'),
        perimetre: g('partial', 'Ne pas toucher au module de paiement (fragile).'),
      },
      suggestions: [S2, S6, S5],
    },
  },
  {
    answer: 's2',
    text: 'Ce sera fini quand on pourra cliquer sur un bouton dans la page facture pour télécharger le PDF, et que les tests Jest passent.',
    response: {
      ops: [
        { op: 'add', id: 'n8', parent: 'n2', label: 'Bouton dans la page facture', detail: 'Télécharge le PDF de la facture affichée' },
        { op: 'add', id: 'n9', parent: 'root', label: 'Fini quand…' },
        { op: 'add', id: 'n10', parent: 'n9', label: 'PDF téléchargeable' },
        { op: 'add', id: 'n11', parent: 'n9', label: 'Tests Jest au vert' },
      ],
      grid: {
        ...baseGrid,
        objectif: g('covered', 'Un bouton dans la page facture permet de télécharger la facture en PDF.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('covered', 'Node/Express et React ; PDF généré avec pdfkit (pas Puppeteer, trop lourd).'),
        perimetre: g('partial', 'Ne pas toucher au module de paiement (fragile).'),
        critere_fin: g('covered', 'Le bouton télécharge le PDF et les tests Jest passent.'),
      },
      suggestions: [S5, S6, S7],
    },
  },
  {
    text: 'Pour la mise en page, il y a déjà un modèle de facture en HTML dans templates/invoice.html, il faut que le PDF lui ressemble.',
    response: {
      ops: [{ op: 'add', id: 'n12', parent: 'n2', label: 'Modèle templates/invoice.html', detail: 'Le PDF doit ressembler à ce modèle HTML' }],
      grid: {
        ...baseGrid,
        objectif: g('covered', 'Un bouton dans la page facture permet de télécharger la facture en PDF.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('covered', 'Node/Express et React ; PDF généré avec pdfkit (pas Puppeteer, trop lourd).'),
        perimetre: g('partial', 'Ne pas toucher au module de paiement (fragile).'),
        references: g('covered', 'templates/invoice.html : modèle dont le PDF doit reprendre la mise en page.'),
        critere_fin: g('covered', 'Le bouton télécharge le PDF et les tests Jest passent.'),
      },
      suggestions: [S8, S6, S10],
    },
  },
  {
    text: 'Et je préfère un truc simple qui marche plutôt qu’un truc parfait.',
    response: {
      ops: [{ op: 'add', id: 'n13', parent: 'root', label: 'Simple avant parfait' }],
      grid: {
        ...baseGrid,
        objectif: g('covered', 'Un bouton dans la page facture permet de télécharger la facture en PDF.'),
        contexte: g('covered', 'Projet existant : back Node/Express, front React, factures dans src/invoices.'),
        contraintes: g('covered', 'Node/Express et React ; PDF généré avec pdfkit (pas Puppeteer, trop lourd).'),
        perimetre: g('partial', 'Ne pas toucher au module de paiement (fragile).'),
        references: g('covered', 'templates/invoice.html : modèle dont le PDF doit reprendre la mise en page.'),
        critere_fin: g('covered', 'Le bouton télécharge le PDF et les tests Jest passent.'),
        priorites: g('covered', 'Une solution simple qui marche plutôt que parfaite.'),
      },
      suggestions: [S8, S6, S9],
    },
  },
];

export function normalizeSpeech(text) {
  return String(text).toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
