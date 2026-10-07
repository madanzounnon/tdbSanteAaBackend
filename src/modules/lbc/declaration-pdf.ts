import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { INDICES_CENTIF, STATUTS_OPERATION, TYPES_CLIENT } from './catalogue';

// Fiche "Déclaration de soupçon" au format du modèle CENTIF-Bénin (annexe du
// cahier) : mêmes sections, mêmes libellés, même ordre. Les zones non
// renseignées sont imprimées en pointillés pour pouvoir être complétées à la
// main si besoin.

const VERT = '#8EE68E';
const GRIS = '#BFBFBF';
const MARGE = 45;
const POINTILLES = '……………………………………';

// Logos de l'en-tête officiel (modèle CENTIF) : Ministère de l'Économie et
// des Finances et CENTIF, déposés dans LBC_LOGOS_DIR (défaut : uploads/).
// Un logo absent n'empêche pas la génération de la fiche.
const DOSSIER_LOGOS = path.resolve(process.env.LBC_LOGOS_DIR || 'uploads');
const LOGO_MEF = path.join(DOSSIER_LOGOS, 'logo_mef.png');
const LOGO_CENTIF = path.join(DOSSIER_LOGOS, 'logo.png');

function logo(doc: Doc, fichier: string, x: number, y: number, largeurLogo: number) {
  if (!fs.existsSync(fichier)) return;
  try {
    doc.image(fichier, x, y, { width: largeurLogo });
  } catch (err) {
    console.error(`[LBC] Logo illisible : ${fichier}`, err);
  }
}

type Doc = PDFKit.PDFDocument;

// Chaîne AAAA-MM-JJ (saisie) ou Date à minuit heure locale (relue par pg).
const fmtDate = (d: unknown): string => {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10).split('-').reverse().join('/');
  const date = new Date(d as string);
  return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString('fr-FR');
};
const fmtMontant = (n: unknown): string =>
  n === null || n === undefined || n === '' ? '' : Math.round(Number(n)).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
// Les polices standard PDF (WinAnsi) n'ont pas ≥ / ≤ : on les translittère
// plutôt que d'imprimer un glyphe vide.
const val = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v).trim().replace(/≥/g, '>=').replace(/≤/g, '<=');

function largeur(doc: Doc) {
  return doc.page.width - 2 * MARGE;
}

function place(doc: Doc, hauteur: number) {
  if (doc.y + hauteur > doc.page.height - MARGE - 20) doc.addPage();
}

function section(doc: Doc, titre: string, sousTitre?: string) {
  place(doc, 60);
  doc.moveDown(0.6);
  const y = doc.y;
  const h = sousTitre ? 30 : 20;
  doc.save().rect(MARGE + 30, y, largeur(doc) - 60, h).fill(VERT).restore();
  doc.fillColor('black').font('Times-Bold').fontSize(11)
    .text(titre, MARGE + 30, y + 5, { width: largeur(doc) - 60, align: 'center' });
  if (sousTitre) {
    doc.font('Times-BoldItalic').fontSize(8).text(sousTitre, MARGE + 30, y + 18, { width: largeur(doc) - 60, align: 'center' });
  }
  doc.y = y + h + 8;
  doc.x = MARGE;
  doc.font('Helvetica').fontSize(9);
}

function sousTitre(doc: Doc, texte: string) {
  place(doc, 30);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(9.5).text(texte, MARGE, doc.y, { underline: true });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9);
}

// "Libellé : valeur" sur toute la largeur (ou une colonne).
function champ(doc: Doc, libelle: string, valeur: unknown, x = MARGE, w = largeur(doc)) {
  const v = val(valeur);
  doc.font('Helvetica').fontSize(9).text(`${libelle} : `, x, doc.y, { width: w, continued: true });
  doc.font(v ? 'Helvetica-Bold' : 'Helvetica').text(v || POINTILLES);
}

function champs2(doc: Doc, gauche: [string, unknown][], droite: [string, unknown][]) {
  const w = largeur(doc) / 2 - 8;
  const y0 = doc.y;
  for (const [l, v] of gauche) champ(doc, l, v, MARGE, w);
  const yG = doc.y;
  doc.y = y0;
  for (const [l, v] of droite) champ(doc, l, v, MARGE + w + 16, w);
  doc.y = Math.max(yG, doc.y);
  doc.x = MARGE;
}

function caseACocher(doc: Doc, coche: boolean, libelle: string, x = MARGE, w = largeur(doc)) {
  place(doc, 14);
  const y = doc.y;
  doc.lineWidth(0.7).rect(x, y + 1, 8, 8).stroke();
  if (coche) {
    doc.moveTo(x + 1.5, y + 5).lineTo(x + 3.5, y + 8).lineTo(x + 7, y + 2).stroke();
  }
  doc.font(coche ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(libelle, x + 13, y, { width: w - 13 });
  doc.moveDown(0.15);
  doc.x = MARGE;
}

function paragraphe(doc: Doc, texte: unknown, lignesVides = 3) {
  const t = val(texte);
  if (t) {
    doc.font('Helvetica').fontSize(9).text(t, MARGE, doc.y, { width: largeur(doc), align: 'justify' });
  } else {
    for (let i = 0; i < lignesVides; i++) doc.text('…'.repeat(95), MARGE);
  }
  doc.moveDown(0.3);
}

function tableau(doc: Doc, entetes: string[], proportions: number[], lignes: string[][], lignesMin = 3) {
  const w = largeur(doc);
  const cols = proportions.map((p) => p * w);
  const dessinerLigne = (cellules: string[], gras: boolean) => {
    doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    const h = Math.max(14, ...cellules.map((c, i) => doc.heightOfString(c || ' ', { width: cols[i] - 6 }) + 5));
    place(doc, h);
    const y = doc.y;
    let x = MARGE;
    cellules.forEach((c, i) => {
      doc.lineWidth(0.5).rect(x, y, cols[i], h).stroke();
      doc.text(c, x + 3, y + 3, { width: cols[i] - 6 });
      x += cols[i];
    });
    doc.y = y + h;
    doc.x = MARGE;
  };
  dessinerLigne(entetes, true);
  const toutes = [...lignes];
  while (toutes.length < lignesMin) toutes.push(entetes.map(() => ''));
  toutes.forEach((l) => dessinerLigne(l, false));
  doc.moveDown(0.4);
}

function identificationPP(doc: Doc, p: any) {
  sousTitre(doc, 'Personne physique');
  champs2(
    doc,
    [
      ['Nom', p.nom], ['Prénom(s)', p.prenoms], ['Père', p.pere], ['Mère', p.mere],
      ['Date de naissance', fmtDate(p.date_naissance)], ['Lieu de naissance', p.lieu_naissance],
      ['Nationalité', p.nationalite], ['Situation matrimoniale', p.situation_matrimoniale],
      ['Conjoint (e)', p.conjoint], ['Activité professionnelle', p.activite_professionnelle], ['Employeur', p.employeur],
    ],
    [
      ['Document d\'identité — Type', p.piece_type], ['N°', p.piece_numero],
      ['Valide du', `${fmtDate(p.piece_valide_du)}${p.piece_valide_au ? ` au ${fmtDate(p.piece_valide_au)}` : ''}`],
      ['Délivré par', p.piece_delivree_par],
      ['Adresse', p.adresse], ['BP', p.bp], ['Domicile', p.domicile],
      ['Tél.', p.telephone], ['Fax', p.fax], ['Mobile', p.mobile], ['E-mail', p.email],
    ],
  );
}

function identificationPM(doc: Doc, p: any) {
  const d = p.dirigeant ?? {};
  sousTitre(doc, 'Personne morale');
  champs2(
    doc,
    [
      ['Raison sociale', p.raison_sociale], ['Sigle', p.sigle], ['Forme juridique', p.forme_juridique],
      ['N° Identifiant fiscal unique', p.ifu], ['N° Registre de commerce', p.rccm],
      ['Date d\'inscription au registre', fmtDate(p.date_inscription_rc)], ['Secteur d\'activité', p.secteur_activite],
      ['Adresse', p.adresse], ['BP', p.bp], ['Siège social', p.siege_social],
      ['Tél.', p.telephone], ['Fax', p.fax], ['Mobile', p.mobile], ['E-mail', p.email], ['Site web', p.site_web],
    ],
    [
      ['Dirigeant déclaré — Nom', d.nom], ['Prénom(s)', d.prenoms], ['Père', d.pere], ['Mère', d.mere],
      ['Qualité', d.qualite], ['Date de naissance', fmtDate(d.date_naissance)], ['Lieu de naissance', d.lieu_naissance],
      ['Nationalité', d.nationalite], ['Situation matrimoniale', d.situation_matrimoniale], ['Conjoint (e)', d.conjoint],
      ['Activité professionnelle déclarée', d.activite_professionnelle], ['Employeur', d.employeur],
      ['Document d\'identité du dirigeant — Type', d.piece_type], ['N°', d.piece_numero],
      ['Valide du', `${fmtDate(d.piece_valide_du)}${d.piece_valide_au ? ` au ${fmtDate(d.piece_valide_au)}` : ''}`],
      ['Délivré par', d.piece_delivree_par],
    ],
  );
}

function relationsAffaires(doc: Doc, r: any = {}) {
  place(doc, 90);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).text('Relations d\'affaires', MARGE, doc.y, { width: largeur(doc), align: 'center', underline: true });
  doc.moveDown(0.3);
  const w = largeur(doc) * 0.58;
  const y0 = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).text('Eléments clés de la relation (Profil du client, patrimoine connu)', MARGE, y0, { width: w, underline: true });
  doc.font('Helvetica').fontSize(9).text(val(r.elements_cles) || `${POINTILLES}\n${POINTILLES}\n${POINTILLES}`, MARGE, doc.y + 2, { width: w });
  const yG = doc.y;
  const x2 = MARGE + w + 15;
  doc.y = y0;
  doc.font('Helvetica-Bold').text('Type de client :', x2, y0, { underline: true });
  const types: string[] = r.types_client ?? [];
  for (const [code, libelle] of Object.entries(TYPES_CLIENT)) caseACocher(doc, types.includes(code), libelle, x2 + 10, largeur(doc) - w - 25);
  doc.moveDown(0.3);
  doc.font('Helvetica').text(`Date d'entrée en relation : ${fmtDate(r.date_entree) || '…/…/……'}`, x2, doc.y);
  doc.text(`Date d'arrêt de la relation : ${fmtDate(r.date_arret) || '…/…/……'}`, x2, doc.y);
  doc.y = Math.max(yG, doc.y);
  doc.x = MARGE;
}

export function genererPdfDeclaration(d: any): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: MARGE, bufferPages: true, info: { Title: `Déclaration de soupçon ${d.reference}` } });

  // ---- En-tête (modèle CENTIF) :
  //  ligne 1 : logo du Ministère de l'Économie et des Finances ;
  //  ligne 2 : logo CENTIF | nom de la Cellule (centré) | coordonnées.
  const haut = MARGE - 15;
  logo(doc, LOGO_MEF, MARGE + 40, haut, 150);
  const ligne2 = haut + 50;
  logo(doc, LOGO_CENTIF, MARGE, ligne2 + 2, 80);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('black')
    .text('CELLULE NATIONALE DE TRAITEMENT', MARGE + 90, ligne2, { width: 250, align: 'center' })
    .text('DES INFORMATIONS FINANCIERES', MARGE + 90, doc.y + 2, { width: 250, align: 'center' });
  const xContact = MARGE + 350;
  doc.font('Helvetica').fontSize(8.5)
    .text('Tél : 21 31 20 98– Fax : 21 31 20 87', xContact, ligne2 - 12, { width: largeur(doc) - 350 })
    .text('01 BP 8255  COTONOU – Zone', xContact, doc.y + 1, { width: largeur(doc) - 350 })
    .text('Résidentielle Zongo', xContact, doc.y + 1, { width: largeur(doc) - 350 });
  doc.y = ligne2 + 50;
  doc.x = MARGE;
  doc.font('Times-Bold').fontSize(15).text('DECLARATION DE SOUPCON', { width: largeur(doc), align: 'center' });
  doc.font('Times-BoldItalic').fontSize(7.5).text(
    'Article 79 de la loi n°2018-17 du 25 juillet 2018 relative à la lutte contre le blanchiment de capitaux et le financement du terrorisme en République du Bénin',
    { width: largeur(doc), align: 'center' },
  );
  doc.moveDown(1);
  doc.font('Times-Bold').fontSize(10.5)
    .text('A envoyer à :', { width: largeur(doc), align: 'center' })
    .text('Cellule Nationale de Traitement des Informations Financières (CENTIF-BENIN)', { width: largeur(doc), align: 'center' })
    .text('Lot 40 C4 Zone Résidentielle ZONGO 01 BP 8255 Cotonou', { width: largeur(doc), align: 'center' });

  // ---- Organisme déclarant
  const o = d.organisme ?? {};
  section(doc, 'ORGANISME DECLARANT');
  champs2(doc, [['Secteur d\'activité', o.secteur]], [['Numéro IFU', o.ifu]]);
  champ(doc, 'Libellé de l\'organisme', o.libelle);
  champ(doc, 'Adresse complète', o.adresse);
  champs2(doc, [['BP', o.bp], ['Téléphone', o.telephone]], [['Ville', o.ville], ['Email', o.email]]);

  // ---- Personne physique déclarante
  const p = d.declarant ?? {};
  section(doc, 'PERSONNE PHYSIQUE DECLARANTE');
  champ(doc, 'Nom', p.nom);
  champ(doc, 'Prénoms', p.prenoms);
  champ(doc, 'Fonction', p.fonction);
  champ(doc, 'Téléphone', p.telephone);
  champ(doc, 'Email', p.email);

  // ---- Informations générales
  section(doc, 'INFORMATIONS GENERALES');
  champs2(doc, [['Date de la déclaration', fmtDate(d.date_declaration)]], [['Référence interne', d.reference]]);
  doc.moveDown(0.3);
  caseACocher(doc, d.type_declaration === 'NOUVELLE', 'Nouvelle déclaration');
  caseACocher(
    doc,
    d.type_declaration === 'COMPLEMENT',
    `Complément à une déclaration antérieure        Référence : ${val(d.reference_anterieure) || POINTILLES}`,
  );
  doc.moveDown(0.3);
  const pieces: string[] = [
    ...(d.pieces ?? []).map((x: any) => x.libelle),
    ...val(d.pieces_complementaires).split('\n').map((l) => l.trim()).filter(Boolean),
  ];
  doc.font('Helvetica').text('Cette déclaration comporte-t-elle des pièces complémentaires ?', MARGE);
  const yPieces = doc.y;
  caseACocher(doc, pieces.length === 0, 'Non', MARGE, 80);
  doc.y = yPieces;
  caseACocher(doc, pieces.length > 0, 'Oui', MARGE + 90, 80);
  doc.text('Si OUI, les énumérer', MARGE);
  if (pieces.length) pieces.forEach((l, i) => doc.font('Helvetica').text(`${i + 1}. ${l}`, MARGE + 10));
  else paragraphe(doc, '', 2);

  // ---- Détails de l'opération suspecte
  section(doc, 'DETAILS DE L\'OPERATION SUSPECTE');
  sousTitre(doc, 'Statut de l\'opération');
  const statuts = Object.entries(STATUTS_OPERATION);
  for (let i = 0; i < statuts.length; i += 2) {
    const y = doc.y;
    statuts.slice(i, i + 2).forEach(([code, libelle], j) => {
      doc.y = y;
      const coche = d.statut_operation === code;
      caseACocher(doc, coche, `${libelle} le ${coche && d.date_statut_operation ? fmtDate(d.date_statut_operation) : '…/…/……'}`, MARGE + j * (largeur(doc) / 2), largeur(doc) / 2);
    });
  }
  sousTitre(doc, 'Détails des transactions suspectes');
  champ(doc, 'Motif de la déclaration', d.motif);
  champ(doc, 'Date ou Période', d.date_periode);
  champ(doc, 'Nature de l\'opération', d.nature_operation);
  champ(doc, 'Nombre d\'opérations', d.nombre_operations);
  champ(doc, 'Lieu', d.lieu);
  champs2(doc, [['Montant', fmtMontant(d.montant)]], [['Devise', d.devise]]);
  sousTitre(doc, 'Supports utilisés');
  tableau(
    doc,
    ['Types', 'Référence', 'Description, modalités, observations'],
    [0.2, 0.22, 0.58],
    (d.supports ?? []).map((s: any) => [val(s.type), val(s.reference), val(s.description)]),
  );

  // ---- Indices
  section(doc, 'INDICES DE SOUPCONS DE BLANCHIMENT DE CAPITAUX ET', 'DE FINANCEMENT DU TERRORISME');
  const indices: string[] = d.indices ?? [];
  for (const i of INDICES_CENTIF) caseACocher(doc, indices.includes(i.code), i.libelle);
  caseACocher(doc, !!val(d.autres_motifs), 'Autres motifs, à préciser :');
  paragraphe(doc, d.autres_motifs, 2);

  // ---- Identification des personnes (une fiche par intervenant)
  const personnes: any[] = d.personnes?.length ? d.personnes : [{ type: 'PP' }];
  personnes.forEach((pers, idx) => {
    doc.addPage();
    section(
      doc,
      `IDENTIFICATION DE LA PERSONNE${personnes.length > 1 ? ` (${idx + 1}/${personnes.length})` : ''}`,
      'Remplir une fiche d\'identification pour chaque intervenant',
    );
    if (pers.type === 'PM') identificationPM(doc, pers);
    else identificationPP(doc, pers);
    relationsAffaires(doc, pers.relation);
  });

  // ---- Identification (suite)
  const pi = d.personnes_impliquees ?? {};
  section(doc, 'IDENTIFICATION DE LA PERSONNE (suite)', 'Remplir une fiche d\'identification pour chaque intervenant');
  sousTitre(doc, 'Personnes impliquées');
  caseACocher(doc, !!pi.pp, `Personnes physiques concernées ?        Nombre : ${pi.pp ? val(pi.nb_pp) : '………'}`);
  caseACocher(doc, !!pi.pm, `Personnes morales concernées ?          Nombre : ${pi.pm ? val(pi.nb_pm) : '………'}`);
  doc.moveDown(0.4);
  tableau(
    doc,
    ['Type de compte', 'Intitulé', 'Numéro de compte'],
    [0.25, 0.4, 0.35],
    (pi.comptes ?? []).map((c: any) => [val(c.type), val(c.intitule), val(c.numero)]),
    4,
  );
  sousTitre(doc, 'Liens existants entre les personnes impliquées');
  paragraphe(doc, pi.liens, 3);
  sousTitre(doc, 'Autres informations :');
  paragraphe(doc, pi.autres_informations, 4);

  // ---- Description / analyse
  doc.addPage();
  section(doc, 'DESCRIPTION/ANALYSE', '(Décrire tous les éléments permettant d\'identifier clairement le soupçon qui motive la déclaration)');
  paragraphe(doc, d.description_analyse, 18);

  // ---- Signature (+ mention de confidentialité, sur la même page)
  place(doc, 150);
  doc.moveDown(1);
  const y = doc.y;
  doc.save().rect(MARGE, y, largeur(doc), 80).fillAndStroke(GRIS, 'black').restore();
  doc.fillColor('black').font('Helvetica-Bold').fontSize(9.5)
    .text(`Fait à ${val(d.fait_a) || '……………………………'}, le ${fmtDate(d.date_signature) || '……/……/……'}`, MARGE + 8, y + 8);
  doc.text('Signature du déclarant', MARGE + largeur(doc) / 2 + 30, y + 8, { underline: true });

  // ---- Mention légale de confidentialité (modèle CENTIF)
  doc.font('Times-Italic').fontSize(9).fillColor('black').text(
    'Article 82- alinéa 1 et 2 de la loi 2018-17 du 25 juillet 2018 portant LBC/FT en République du Bénin : '
      + 'Ces déclarations sont confidentielles et ne peuvent être communiquées au propriétaire des sommes '
      + 'ou à l’auteur des opérations induisant une déclaration de soupçon.',
    MARGE, y + 80 + 22,
    { width: largeur(doc), align: 'center' },
  );

  // ---- Pied de page
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    // Écriture dans la marge basse : sans ce reset pdfkit ajouterait une page.
    doc.page.margins.bottom = 0;
    const bas = doc.page.height - MARGE + 10;
    doc.font('Helvetica').fontSize(7).fillColor('#555555')
      .text(`CONFIDENTIEL — ${d.reference}`, MARGE, bas, { width: largeur(doc) / 2, lineBreak: false })
      .text(`${i + 1}`, MARGE + largeur(doc) / 2, bas, { width: largeur(doc) / 2, align: 'right', lineBreak: false });
    doc.fillColor('black');
  }

  doc.end();
  return doc;
}
