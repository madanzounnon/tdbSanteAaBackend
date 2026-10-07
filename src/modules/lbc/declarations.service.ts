import fs from 'fs';
import path from 'path';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { querySource } from '../../etl/config/source-pool';
import { getParametresMap, ErreurValidation } from './referentiels.service';
import { CRITERES, INDICES_CENTIF, SIGNAUX, STATUTS_DOSSIER, STATUTS_OPERATION, STATUTS_TRANSMISSION } from './catalogue';
import { detecter } from './detection.service';

export const DOSSIER_PIECES = path.resolve(process.env.LBC_UPLOAD_DIR || 'uploads/lbc');

const LIBELLES_PIECE: Record<string, string> = {
  CIN: "Carte d'identité nationale",
  P: 'Passeport',
  PC: 'Permis de conduire',
  CS: 'Carte de séjour',
  CC: 'Carte consulaire',
  RC: 'Registre de commerce',
  IF: 'IFU',
};
const LIBELLES_SITUATION: Record<string, string> = { M: 'Marié(e)', C: 'Célibataire', D: 'Divorcé(e)', V: 'Veuf / Veuve' };

const fmtMontant = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} FCFA`;

// Les DATE/TIMESTAMP relus par pg (ou oracledb) sont des Date à minuit
// HEURE LOCALE : toISOString() les ferait glisser à la veille (UTC+1).
const isoDate = (d: Date | string | null): string | null => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = new Date(d);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${deux(x.getMonth() + 1)}-${deux(x.getDate())}`;
};
const fmtDate = (d: Date | string | null) => {
  const iso = isoDate(d);
  return iso ? iso.split('-').reverse().join('/') : '';
};

async function historiser(m: EntityManager, declarationId: number, action: string, detail: unknown, par: string | null) {
  await m.query(
    `INSERT INTO lbc_declaration_historique (declaration_id, action, detail, par) VALUES ($1, $2, $3, $4)`,
    [declarationId, action, detail === undefined ? null : JSON.stringify(detail), par],
  );
}

async function nouvelleReference(m: EntityManager): Promise<string> {
  const annee = new Date().getFullYear();
  const [row] = await m.query(
    `INSERT INTO lbc_compteur (annee, dernier) VALUES ($1, 1)
     ON CONFLICT (annee) DO UPDATE SET dernier = lbc_compteur.dernier + 1
     RETURNING dernier`,
    [annee],
  );
  return `DS-${annee}-${String(row.dernier).padStart(4, '0')}`;
}

// --------------------------------------------- Pré-remplissage depuis ORASS

// oracledb renvoie les alias non quotés en MAJUSCULES : on ramène les clés
// en minuscules pour les lire comme des colonnes Postgres.
const enMinuscules = (row: Record<string, unknown> | undefined) =>
  row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])) as any : null;

// Fiche d'identification (page "Identification de la personne" du modèle
// CENTIF) relue en direct dans ORASS au moment de la création : ce sont les
// informations "précédemment enregistrées lors des transactions avec la
// compagnie" (cahier, point 6). Si ORASS est injoignable, on retombe sur ce
// que contient lbc_operation — le déclarant complète à la main.
async function ficheAssure(codeAssu: string) {
  const { rows } = await querySource<any>(
    `SELECT a.codeassu, a.genrassu, a.raissoci, a.prenassu, a.datecrea, a.lieunais, a.codsitfa,
            NVL(a.libproas, pr.libeprof) AS profession, ac.libeacti AS activite,
            a.codtyppi, NVL(a.numpieid, a.nume_cin) AS numero_piece, a.datpieid, a.liepieid,
            pn.libenati AS nationalite, a.adreassu, a.boitpost, a.quaradres, v.libevill AS ville,
            a.teleassu, a.fax_assu, a.telporas, a.mailassu, a.regicomm, a.numepate,
            ql.libequal AS qualite, a.nom_res1, a.foncres1, a.teleres1, a.mailres1,
            a.codebanq, a.numcptba,
            (SELECT MIN(p.dateeffe) FROM police p WHERE p.codeassu = a.codeassu) AS date_entree,
            (SELECT MAX(p.dateeche) FROM police p WHERE p.codeassu = a.codeassu) AS derniere_echeance,
            (SELECT COUNT(*) FROM police p WHERE p.codeassu = a.codeassu) AS nb_polices
     FROM assure a
     LEFT JOIN profession pr ON pr.codeprof = a.codeprof
     LEFT JOIN activite ac ON ac.codeacti = a.codeacti
     LEFT JOIN pays pn ON pn.codepays = a.codpayna
     LEFT JOIN ville v ON v.codevill = a.codevill
     LEFT JOIN qualite ql ON ql.codequal = a.codequal
     WHERE a.codeassu = :1`,
    [Number(codeAssu)],
  );
  return enMinuscules(rows[0]);
}

async function ficheBeneficiaire(codeBene: string) {
  const { rows } = await querySource<any>(
    `SELECT b.nombenef, b.adrebene, b.telebene, b.fax_bene, b.mailbene, b.regicomm, b.patebene,
            b.nume_cin, b.statjuri, b.nom_resp, b.nume_rib, v.libevill AS ville, nb.libenatu
     FROM beneficiaire b
     LEFT JOIN ville v ON v.codevill = b.codevill
     LEFT JOIN nature_beneficiaire nb ON nb.codnatbe = b.codnatbe
     WHERE b.codebene = :1`,
    [Number(codeBene)],
  );
  return enMinuscules(rows[0]);
}

function relationVide() {
  return { elements_cles: '', types_client: [] as string[], date_entree: null as string | null, date_arret: null as string | null };
}

// "Sans précision" est la valeur par défaut des référentiels ORASS
// PROFESSION/ACTIVITE, pas une information : on la traite comme vide.
const renseigne = (v: unknown) => (v && !/^sans pr[ée]cision$/i.test(String(v).trim()) ? String(v) : null);

function personneDepuisAssure(source: any, ops: any[]) {
  const a = { ...source, profession: renseigne(source.profession), activite: renseigne(source.activite) };
  const relation = relationVide();
  relation.date_entree = isoDate(a.date_entree);
  if (a.derniere_echeance && new Date(a.derniere_echeance) < new Date()) {
    relation.date_arret = isoDate(a.derniere_echeance);
    relation.types_client.push('TERMINEE');
  }
  relation.types_client.push(Number(a.nb_polices) > 1 ? 'HABITUEL' : 'OCCASIONNEL');
  relation.elements_cles = [
    a.qualite && `Qualité ORASS : ${a.qualite}`,
    a.profession && `Profession / activité : ${a.profession}`,
    `${a.nb_polices} police(s) souscrite(s) auprès de la compagnie`,
    `Opérations visées : ${ops.length} pour ${fmtMontant(ops.reduce((s, o) => s + Math.abs(Number(o.montant)), 0))}`,
  ].filter(Boolean).join('\n');

  const piece = {
    piece_type: LIBELLES_PIECE[a.codtyppi] ?? a.codtyppi ?? '',
    piece_numero: a.numero_piece ?? '',
    piece_valide_du: isoDate(a.datpieid),
    piece_valide_au: null,
    piece_delivree_par: a.liepieid ?? '',
  };
  const coordonnees = {
    adresse: a.adreassu ?? '',
    bp: a.boitpost ?? '',
    telephone: a.teleassu ?? '',
    fax: a.fax_assu ?? '',
    mobile: a.telporas ?? '',
    email: a.mailassu ?? '',
  };

  if (a.genrassu === 'PM') {
    return {
      type: 'PM',
      code_client: String(a.codeassu),
      raison_sociale: a.raissoci ?? '',
      sigle: '',
      forme_juridique: a.qualite ?? '',
      ifu: a.codtyppi === 'IF' ? a.numero_piece ?? '' : a.numepate ?? '',
      rccm: a.regicomm ?? '',
      date_inscription_rc: isoDate(a.datecrea),
      secteur_activite: a.activite ?? a.profession ?? '',
      ...coordonnees,
      siege_social: [a.quaradres, a.ville].filter(Boolean).join(', '),
      site_web: '',
      dirigeant: {
        nom: a.nom_res1 ?? '', prenoms: '', pere: '', mere: '', qualite: a.foncres1 ?? '',
        date_naissance: null, lieu_naissance: '', nationalite: '', situation_matrimoniale: '', conjoint: '',
        activite_professionnelle: '', employeur: '',
        piece_type: '', piece_numero: '', piece_valide_du: null, piece_valide_au: null, piece_delivree_par: '',
      },
      relation,
    };
  }
  return {
    type: 'PP',
    code_client: String(a.codeassu),
    nom: a.raissoci ?? '',
    prenoms: a.prenassu ?? '',
    pere: '',
    mere: '',
    date_naissance: isoDate(a.datecrea),
    lieu_naissance: a.lieunais ?? '',
    nationalite: a.nationalite ?? '',
    situation_matrimoniale: LIBELLES_SITUATION[a.codsitfa] ?? '',
    conjoint: '',
    activite_professionnelle: a.profession ?? '',
    employeur: '',
    ...piece,
    ...coordonnees,
    domicile: [a.quaradres, a.ville].filter(Boolean).join(', '),
    relation,
  };
}

function personneDepuisOperations(ops: any[], b: any | null) {
  const o = ops[0];
  const relation = relationVide();
  relation.types_client.push('OCCASIONNEL');
  relation.elements_cles = [
    o.libelle_nature_beneficiaire && `Bénéficiaire de règlement : ${o.libelle_nature_beneficiaire}`,
    `Opérations visées : ${ops.length} pour ${fmtMontant(ops.reduce((s, x) => s + Math.abs(Number(x.montant)), 0))}`,
  ].filter(Boolean).join('\n');
  const estPM = o.type_personne === 'PM' || (b?.statjuri && !/PHYS/i.test(b.statjuri));
  const nom = b?.nombenef ?? o.personne_nom ?? '';
  const coordonnees = {
    adresse: b?.adrebene ?? '', bp: '', telephone: b?.telebene ?? '', fax: b?.fax_bene ?? '', mobile: '', email: b?.mailbene ?? '',
  };
  if (estPM) {
    return {
      type: 'PM', code_client: o.code_client, raison_sociale: nom, sigle: '', forme_juridique: b?.statjuri ?? '',
      ifu: b?.patebene ?? '', rccm: b?.regicomm ?? '', date_inscription_rc: null, secteur_activite: '',
      ...coordonnees, siege_social: b?.ville ?? '', site_web: '',
      dirigeant: {
        nom: b?.nom_resp ?? '', prenoms: '', pere: '', mere: '', qualite: '', date_naissance: null, lieu_naissance: '',
        nationalite: '', situation_matrimoniale: '', conjoint: '', activite_professionnelle: '', employeur: '',
        piece_type: '', piece_numero: '', piece_valide_du: null, piece_valide_au: null, piece_delivree_par: '',
      },
      relation,
    };
  }
  return {
    type: 'PP', code_client: o.code_client, nom, prenoms: '', pere: '', mere: '', date_naissance: null, lieu_naissance: '',
    nationalite: '', situation_matrimoniale: '', conjoint: '', activite_professionnelle: '', employeur: '',
    piece_type: b?.nume_cin ? "Carte d'identité nationale" : '', piece_numero: b?.nume_cin ?? '',
    piece_valide_du: null, piece_valide_au: null, piece_delivree_par: '',
    ...coordonnees, domicile: b?.ville ?? '', relation,
  };
}

async function identifierPersonnes(ops: any[]) {
  const parPersonne = new Map<string, any[]>();
  for (const o of ops) parPersonne.set(o.personne_cle, [...(parPersonne.get(o.personne_cle) ?? []), o]);

  const personnes: any[] = [];
  const comptes: any[] = [];
  let sourceIndisponible = false;
  for (const [cle, opsPersonne] of parPersonne) {
    try {
      if (cle.startsWith('ASS-')) {
        const a = await ficheAssure(cle.slice(4));
        if (a) {
          personnes.push(personneDepuisAssure(a, opsPersonne));
          if (a.numcptba) comptes.push({ type: 'Compte bancaire', intitule: a.raissoci ?? '', numero: a.numcptba });
          continue;
        }
      }
      const b = cle.startsWith('BEN-') ? await ficheBeneficiaire(cle.slice(4)) : null;
      personnes.push(personneDepuisOperations(opsPersonne, b));
      if (b?.nume_rib) comptes.push({ type: 'Compte bancaire (RIB)', intitule: b.nombenef ?? '', numero: b.nume_rib });
    } catch (err) {
      console.error('[LBC] Lecture ORASS impossible, pré-remplissage partiel', err);
      sourceIndisponible = true;
      personnes.push(personneDepuisOperations(opsPersonne, null));
    }
  }
  return { personnes, comptes, sourceIndisponible };
}

// ----------------------------------------------------------- Création

export async function creerDeclaration(body: any, par: string | null) {
  const operationIds: number[] = Array.isArray(body.operationIds) ? body.operationIds.map(Number).filter(Boolean) : [];
  const params = await getParametresMap();
  const organisme = {
    secteur: params.organisme_secteur, ifu: params.organisme_ifu, libelle: params.organisme_libelle,
    adresse: params.organisme_adresse, bp: params.organisme_bp, ville: params.organisme_ville,
    telephone: params.organisme_telephone, email: params.organisme_email,
  };
  const declarant = {
    nom: body.declarant?.nom ?? '', prenoms: body.declarant?.prenoms ?? '', fonction: body.declarant?.fonction ?? '',
    telephone: body.declarant?.telephone ?? '', email: body.declarant?.email ?? '',
  };

  let ops: any[] = [];
  let preRemplissage: Record<string, unknown> = {};
  let avertissement: string | null = null;

  if (operationIds.length) {
    ops = await AppDataSource.query(
      `SELECT * FROM lbc_operation WHERE id = ANY($1::bigint[]) ORDER BY date_operation`,
      [operationIds],
    );
    if (ops.length !== operationIds.length) throw new ErreurValidation('Certaines opérations sont introuvables');

    // Critères de détection recalculés sur la période couverte par les
    // opérations, pour pré-cocher les indices et rédiger le motif.
    const du = isoDate(ops[0].date_operation)!;
    const au = isoDate(ops[ops.length - 1].date_operation)!;
    const { operations: evaluees } = await detecter({ du, au, inclureEcartees: true, inclureDeclarees: true });
    const parId = new Map(evaluees.map((e: any) => [Number(e.id), e]));
    const criteres = new Set<string>();
    const signaux = new Set<string>();
    let sanction = false;
    for (const o of ops) {
      const e: any = parId.get(Number(o.id));
      e?.criteres.forEach((c: string) => criteres.add(c));
      e?.signaux.forEach((s: string) => signaux.add(s));
      if (e?.personnes_surveillees?.some((p: any) => p.categorie === 'SANCTION')) sanction = true;
    }
    const indices = new Set<string>();
    criteres.forEach((c) => CRITERES[c]?.indice && indices.add(CRITERES[c].indice!));
    signaux.forEach((s) => SIGNAUX[s]?.indice && indices.add(SIGNAUX[s].indice!));
    if (sanction) indices.add('GEL_FONDS');

    const total = ops.reduce((s, o) => s + Math.abs(Number(o.montant)), 0);
    const natures = new Set(ops.map((o) => (o.sens === 'ENTREE' ? 'Encaissement de prime' : 'Règlement de sinistre')));
    const branches = new Set(ops.map((o) => o.libelle_branche).filter(Boolean));
    const { personnes, comptes, sourceIndisponible } = await identifierPersonnes(ops);
    if (sourceIndisponible) avertissement = 'ORASS injoignable : identification des personnes pré-remplie partiellement.';

    preRemplissage = {
      statut_operation: 'EXECUTEE',
      date_statut_operation: au,
      motif: [...criteres].map((c) => CRITERES[c].libelle).join(' ; '),
      date_periode: du === au ? fmtDate(du) : `Du ${fmtDate(du)} au ${fmtDate(au)}`,
      nature_operation: `${[...natures].join(', ')} — ${[...branches].join(', ')}`,
      nombre_operations: ops.length,
      lieu: params.organisme_ville,
      montant: total,
      devise: ops[0].devise || 'FCFA',
      supports: ops.map((o) => ({
        type: o.libelle_mode_paiement || o.mode_paiement || '',
        reference: o.reference || o.ref_source,
        description: [
          fmtDate(o.date_operation),
          o.sens === 'ENTREE' ? 'Encaissement' : 'Règlement',
          fmtMontant(Number(o.montant)),
          o.numero_police && `police ${o.numero_police}`,
          o.libelle_branche,
          o.tireur && `tireur : ${o.tireur}`,
          o.sens === 'SORTIE' && o.personne_nom && `bénéficiaire : ${o.personne_nom}`,
        ].filter(Boolean).join(' — '),
      })),
      indices: [...indices],
      personnes,
      personnes_impliquees: {
        pp: personnes.some((p) => p.type === 'PP'),
        nb_pp: personnes.filter((p) => p.type === 'PP').length,
        pm: personnes.some((p) => p.type === 'PM'),
        nb_pm: personnes.filter((p) => p.type === 'PM').length,
        comptes,
        liens: '',
        autres_informations: '',
      },
    };
  }

  return AppDataSource.transaction(async (m) => {
    const reference = await nouvelleReference(m);
    const champs = { ...preRemplissage, ...champsModifiables(body) };
    const [row] = await m.query(
      `INSERT INTO lbc_declaration (reference, organisme, declarant, fait_a, cree_par, modifie_par)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [reference, organisme, declarant, params.organisme_ville, par],
    );
    await appliquerChamps(m, row.id, champs);
    if (ops.length) {
      await m.query(
        `INSERT INTO lbc_declaration_operation (declaration_id, operation_id) SELECT $1, unnest($2::bigint[])`,
        [row.id, operationIds],
      );
    }
    await historiser(m, row.id, 'CREATION', { reference, operations: operationIds.length }, par);
    return { id: row.id, reference, avertissement };
  });
}

// ------------------------------------------------------- Mise à jour

const CHAMPS_TEXTE = [
  'reference_anterieure', 'pieces_complementaires', 'motif', 'date_periode', 'nature_operation', 'lieu',
  'devise', 'autres_motifs', 'description_analyse', 'fait_a',
];
const CHAMPS_DATE = ['date_declaration', 'date_statut_operation', 'date_signature'];
const CHAMPS_JSON = ['organisme', 'declarant', 'supports', 'indices', 'personnes', 'personnes_impliquees'];

function champsModifiables(body: any): Record<string, unknown> {
  const champs: Record<string, unknown> = {};
  for (const c of CHAMPS_TEXTE) if (c in body) champs[c] = body[c] == null ? null : String(body[c]);
  for (const c of CHAMPS_DATE) if (c in body) champs[c] = body[c] || null;
  for (const c of CHAMPS_JSON) if (c in body && body[c] != null) champs[c] = body[c];
  if ('nombre_operations' in body) champs.nombre_operations = body.nombre_operations === '' || body.nombre_operations == null ? null : Number(body.nombre_operations);
  if ('montant' in body) champs.montant = body.montant === '' || body.montant == null ? null : Number(body.montant);
  if ('type_declaration' in body) {
    if (!['NOUVELLE', 'COMPLEMENT'].includes(body.type_declaration)) throw new ErreurValidation('type_declaration invalide');
    champs.type_declaration = body.type_declaration;
  }
  if ('statut_operation' in body) {
    if (body.statut_operation && !(body.statut_operation in STATUTS_OPERATION)) throw new ErreurValidation('statut_operation invalide');
    champs.statut_operation = body.statut_operation || null;
  }
  if (Array.isArray(champs.indices)) {
    const connus = new Set(INDICES_CENTIF.map((i) => i.code));
    champs.indices = (champs.indices as string[]).filter((c) => connus.has(c));
  }
  return champs;
}

async function appliquerChamps(m: EntityManager, id: number, champs: Record<string, unknown>) {
  const cles = Object.keys(champs);
  if (!cles.length) return;
  const valeurs = cles.map((c) => (CHAMPS_JSON.includes(c) ? JSON.stringify(champs[c]) : champs[c]));
  await m.query(
    `UPDATE lbc_declaration SET ${cles.map((c, i) => `${c} = $${i + 2}`).join(', ')}, modifie_le = now() WHERE id = $1`,
    [id, ...valeurs],
  );
}

export async function modifierDeclaration(id: number, body: any, par: string | null) {
  const champs = champsModifiables(body);
  return AppDataSource.transaction(async (m) => {
    const [existante] = await m.query(`SELECT id FROM lbc_declaration WHERE id = $1 FOR UPDATE`, [id]);
    if (!existante) return null;
    await appliquerChamps(m, id, champs);
    await m.query(`UPDATE lbc_declaration SET modifie_par = $2 WHERE id = $1`, [id, par]);
    await historiser(m, id, 'MODIFICATION', { champs: Object.keys(champs) }, par);
    return { id };
  });
}

export async function changerStatut(id: number, body: any, par: string | null) {
  const maj: Record<string, unknown> = {};
  if ('statut_transmission' in body) {
    if (!(body.statut_transmission in STATUTS_TRANSMISSION)) throw new ErreurValidation('statut_transmission invalide');
    maj.statut_transmission = body.statut_transmission;
    maj.date_transmission = body.statut_transmission === 'TRANSMISE'
      ? body.date_transmission || new Date().toISOString().slice(0, 10)
      : null;
  }
  if ('statut_dossier' in body) {
    if (!(body.statut_dossier in STATUTS_DOSSIER)) throw new ErreurValidation('statut_dossier invalide');
    maj.statut_dossier = body.statut_dossier;
  }
  if ('observations' in body) maj.observations = body.observations ?? null;
  if (!Object.keys(maj).length) throw new ErreurValidation('Aucun statut à mettre à jour');

  return AppDataSource.transaction(async (m) => {
    const [avant] = await m.query(
      `SELECT statut_transmission, date_transmission, statut_dossier, observations FROM lbc_declaration WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!avant) return null;
    const cles = Object.keys(maj);
    await m.query(
      `UPDATE lbc_declaration SET ${cles.map((c, i) => `${c} = $${i + 2}`).join(', ')},
         modifie_par = $${cles.length + 2}, modifie_le = now() WHERE id = $1`,
      [id, ...cles.map((c) => maj[c]), par],
    );
    await historiser(m, id, 'STATUT', { avant, apres: maj }, par);
    return { id };
  });
}

export async function supprimerDeclaration(id: number) {
  const [d] = await AppDataSource.query(`SELECT statut_transmission FROM lbc_declaration WHERE id = $1`, [id]);
  if (!d) return false;
  if (d.statut_transmission === 'TRANSMISE') {
    throw new ErreurValidation('Une déclaration transmise à la CENTIF ne peut pas être supprimée (changer plutôt son statut).');
  }
  const pieces = await AppDataSource.query(`SELECT chemin FROM lbc_declaration_piece WHERE declaration_id = $1`, [id]);
  await AppDataSource.query(`DELETE FROM lbc_declaration WHERE id = $1`, [id]);
  for (const p of pieces) fs.rm(path.join(DOSSIER_PIECES, p.chemin), { force: true }, () => undefined);
  return true;
}

// ---------------------------------------------------------- Lecture

export async function listerDeclarations(f: { du?: string; au?: string; transmission?: string; dossier?: string; q?: string }) {
  return AppDataSource.query(
    `SELECT d.id, d.reference, d.date_declaration, d.type_declaration, d.motif, d.montant, d.devise,
            d.nombre_operations, d.statut_transmission, d.date_transmission, d.statut_dossier, d.observations,
            d.cree_par, d.cree_le, d.modifie_le,
            (SELECT string_agg(COALESCE(NULLIF(TRIM(COALESCE(p->>'nom', '') || ' ' || COALESCE(p->>'prenoms', '')), ''), p->>'raison_sociale'), ' ; ')
             FROM jsonb_array_elements(d.personnes) p) AS personnes,
            (SELECT COUNT(*)::int FROM lbc_declaration_piece pc WHERE pc.declaration_id = d.id) AS nb_pieces
     FROM lbc_declaration d
     WHERE ($1::date IS NULL OR d.date_declaration >= $1::date)
       AND ($2::date IS NULL OR d.date_declaration <= $2::date)
       AND ($3::text IS NULL OR d.statut_transmission = $3)
       AND ($4::text IS NULL OR d.statut_dossier = $4)
       AND ($5::text IS NULL OR d.reference ILIKE '%' || $5 || '%' OR d.personnes::text ILIKE '%' || $5 || '%')
     ORDER BY d.date_declaration DESC, d.id DESC`,
    [f.du || null, f.au || null, f.transmission || null, f.dossier || null, f.q?.trim() || null],
  );
}

export async function lireDeclaration(id: number) {
  const [declaration] = await AppDataSource.query(`SELECT * FROM lbc_declaration WHERE id = $1`, [id]);
  if (!declaration) return null;
  const [operations, pieces, historique] = await Promise.all([
    AppDataSource.query(
      `SELECT o.* FROM lbc_declaration_operation dop JOIN lbc_operation o ON o.id = dop.operation_id
       WHERE dop.declaration_id = $1 ORDER BY o.date_operation`,
      [id],
    ),
    AppDataSource.query(
      `SELECT id, libelle, nom_fichier, type_mime, taille, ajoute_par, ajoute_le
       FROM lbc_declaration_piece WHERE declaration_id = $1 ORDER BY ajoute_le`,
      [id],
    ),
    AppDataSource.query(
      `SELECT action, detail, par, le FROM lbc_declaration_historique WHERE declaration_id = $1 ORDER BY le DESC`,
      [id],
    ),
  ]);
  return { ...declaration, operations, pieces, historique };
}

// ----------------------------------------------------------- Pièces

export async function ajouterPiece(
  id: number,
  fichier: { filename: string; originalname: string; mimetype: string; size: number },
  libelle: string | null,
  par: string | null,
) {
  return AppDataSource.transaction(async (m) => {
    const [d] = await m.query(`SELECT id FROM lbc_declaration WHERE id = $1`, [id]);
    if (!d) return null;
    const [row] = await m.query(
      `INSERT INTO lbc_declaration_piece (declaration_id, libelle, nom_fichier, chemin, type_mime, taille, ajoute_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, libelle, nom_fichier, type_mime, taille, ajoute_par, ajoute_le`,
      [id, libelle || fichier.originalname, fichier.originalname, fichier.filename, fichier.mimetype, fichier.size, par],
    );
    await historiser(m, id, 'PIECE_AJOUTEE', { piece: row.libelle }, par);
    return row;
  });
}

export async function lirePiece(id: number, pieceId: number) {
  const [p] = await AppDataSource.query(
    `SELECT * FROM lbc_declaration_piece WHERE id = $1 AND declaration_id = $2`,
    [pieceId, id],
  );
  return p ? { ...p, cheminComplet: path.join(DOSSIER_PIECES, p.chemin) } : null;
}

export async function supprimerPiece(id: number, pieceId: number, par: string | null) {
  const p = await lirePiece(id, pieceId);
  if (!p) return false;
  await AppDataSource.transaction(async (m) => {
    await m.query(`DELETE FROM lbc_declaration_piece WHERE id = $1`, [pieceId]);
    await historiser(m, id, 'PIECE_SUPPRIMEE', { piece: p.libelle }, par);
  });
  fs.rm(p.cheminComplet, { force: true }, () => undefined);
  return true;
}
