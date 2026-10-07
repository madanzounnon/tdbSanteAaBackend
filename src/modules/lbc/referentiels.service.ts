import { AppDataSource } from '../../data-source';
import { motifsRecherche, normaliserNom } from './normalise';

export class ErreurValidation extends Error {}

export interface ParametresDetection {
  seuilUnitaire: number;
  seuilCumul: number;
  qualitesExclues: number[];
  fractionnementPct: number;
  fractionnementNbMin: number;
}

const CATEGORIES_STRUCTURE = ['ETATIQUE', 'INTERNATIONALE', 'WHITELIST'];
const LISTES_PAYS = ['NOIRE', 'GRISE', 'AUTRE'];
const CATEGORIES_PERSONNE = ['PPE', 'PEE', 'SANCTION', 'AUTRE'];

const texte = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const date = (v: unknown): string | null => {
  const s = texte(v);
  if (!s) return null;
  if (Number.isNaN(Date.parse(s))) throw new ErreurValidation(`Date invalide : ${s}`);
  return s.slice(0, 10);
};
const booleen = (v: unknown, defaut = true): boolean => (v === undefined || v === null ? defaut : v === true || v === 'true' || v === 1);

// ---------------------------------------------------------------- Paramètres

export async function getParametres() {
  return AppDataSource.query(`SELECT cle, valeur, libelle, modifie_par, modifie_le FROM lbc_parametre ORDER BY cle`);
}

export async function getParametresMap(): Promise<Record<string, string>> {
  const rows: { cle: string; valeur: string }[] = await AppDataSource.query(`SELECT cle, valeur FROM lbc_parametre`);
  return Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
}

export async function getParametresDetection(): Promise<ParametresDetection> {
  const p = await getParametresMap();
  return {
    seuilUnitaire: Number(p.seuil_unitaire) || 10_000_000,
    seuilCumul: Number(p.seuil_cumul) || 10_000_000,
    qualitesExclues: (p.qualites_exclues || '')
      .split(',')
      .map((c) => Number(c.trim()))
      .filter((n) => Number.isInteger(n)),
    fractionnementPct: Number(p.fractionnement_pct) || 80,
    fractionnementNbMin: Number(p.fractionnement_nb_min) || 3,
  };
}

const PARAMETRES_NUMERIQUES = new Set(['seuil_unitaire', 'seuil_cumul', 'fractionnement_pct', 'fractionnement_nb_min']);

export async function updateParametres(valeurs: Record<string, unknown>, par: string | null) {
  const existants = await getParametresMap();
  for (const [cle, brut] of Object.entries(valeurs)) {
    if (!(cle in existants)) throw new ErreurValidation(`Paramètre inconnu : ${cle}`);
    const valeur = brut == null ? '' : String(brut).trim();
    if (PARAMETRES_NUMERIQUES.has(cle) && !(Number(valeur) > 0)) {
      throw new ErreurValidation(`Le paramètre ${cle} doit être un nombre > 0`);
    }
    if (cle === 'fractionnement_pct' && Number(valeur) >= 100) {
      throw new ErreurValidation('Le pourcentage de fractionnement doit être < 100');
    }
    if (cle === 'qualites_exclues' && valeur && !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(valeur)) {
      throw new ErreurValidation('qualites_exclues : liste de codes séparés par des virgules');
    }
  }
  await AppDataSource.transaction(async (m) => {
    for (const [cle, brut] of Object.entries(valeurs)) {
      await m.query(
        `UPDATE lbc_parametre SET valeur = $2, modifie_par = $3, modifie_le = now() WHERE cle = $1`,
        [cle, brut == null ? '' : String(brut).trim(), par],
      );
    }
  });
  return getParametres();
}

// Qualités ORASS (référentiel pour choisir les exclusions) : on ne lit que
// celles effectivement présentes dans les opérations chargées.
export async function getQualites() {
  return AppDataSource.query(
    `SELECT code_qualite AS code, MAX(libelle_qualite) AS libelle, COUNT(*)::int AS nb_operations
     FROM lbc_operation WHERE code_qualite IS NOT NULL
     GROUP BY code_qualite ORDER BY code_qualite`,
  );
}

export async function getBranches() {
  return AppDataSource.query(
    `SELECT code_branche AS code, MAX(libelle_branche) AS libelle
     FROM lbc_operation WHERE code_branche IS NOT NULL
     GROUP BY code_branche ORDER BY code_branche`,
  );
}

// ---------------------------------------------------------- Pagination

export interface FiltreListe {
  page: number;
  taille: number;
  q?: string;
  actifs?: boolean;
}

export interface Page<T = any> {
  donnees: T[];
  total: number;
  page: number;
  taille: number;
  pages: number;
}

// Liste paginée côté base d'un répertoire : recherche ILIKE (sans accents
// grâce à translate) sur les colonnes indiquées, filtre "actifs seulement",
// COUNT(*) OVER() pour le total en une seule requête. Table, colonnes et tri
// sont des constantes du code, jamais des entrées utilisateur.
const SANS_ACCENTS = (expr: string) =>
  `translate(lower(${expr}), 'àâäáãçéèêëíìîïñóòôöõúùûüýÿœ', 'aaaaaceeeeiiiinooooouuuuyyo')`;

async function paginer(
  table: string,
  colonnes: string,
  recherche: string[],
  tri: string,
  f: FiltreListe,
): Promise<Page> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (f.actifs) conditions.push('actif');
  const q = f.q?.trim();
  if (q) {
    params.push(`%${q}%`);
    const motif = SANS_ACCENTS(`$${params.length}`);
    conditions.push(`(${recherche.map((c) => `${SANS_ACCENTS(`COALESCE(${c}::text, '')`)} LIKE ${motif}`).join(' OR ')})`);
  }
  params.push(f.taille, (f.page - 1) * f.taille);
  const rows: any[] = await AppDataSource.query(
    `SELECT ${colonnes}, COUNT(*) OVER()::int AS total_lignes
     FROM ${table}
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY ${tri}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = rows[0]?.total_lignes ?? 0;
  if (!rows.length && f.page > 1) {
    // Page au-delà de la fin (ex. après une suppression) : total réel.
    const [{ n }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS n FROM ${table} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params.slice(0, -2),
    );
    return { donnees: [], total: n, page: f.page, taille: f.taille, pages: Math.max(1, Math.ceil(n / f.taille)) };
  }
  return {
    donnees: rows.map(({ total_lignes, ...r }) => r),
    total,
    page: f.page,
    taille: f.taille,
    pages: Math.max(1, Math.ceil(total / f.taille)),
  };
}

// ------------------------------------------------- Structures de confiance

export async function listStructures(f: FiltreListe) {
  return paginer('lbc_structure_confiance', '*', ['nom', 'code_client', 'categorie', 'motif'], 'actif DESC, nom, id', f);
}

function structureDepuis(body: any) {
  const nom = texte(body.nom);
  if (!nom) throw new ErreurValidation('Le nom de la structure est requis');
  const categorie = texte(body.categorie) ?? 'WHITELIST';
  if (!CATEGORIES_STRUCTURE.includes(categorie)) throw new ErreurValidation(`Catégorie invalide : ${categorie}`);
  return [texte(body.code_client), nom, normaliserNom(nom), categorie, texte(body.motif), booleen(body.actif)];
}

export async function createStructure(body: any, par: string | null) {
  const [row] = await AppDataSource.query(
    `INSERT INTO lbc_structure_confiance (code_client, nom, nom_normalise, categorie, motif, actif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [...structureDepuis(body), par],
  );
  return row;
}

export async function updateStructure(id: number, body: any) {
  const [rows] = await AppDataSource.query(
    `UPDATE lbc_structure_confiance
     SET code_client = $2, nom = $3, nom_normalise = $4, categorie = $5, motif = $6, actif = $7, modifie_le = now()
     WHERE id = $1 RETURNING *`,
    [id, ...structureDepuis(body)],
  );
  return rows[0] ?? null;
}

export async function deleteStructure(id: number) {
  const [, n] = await AppDataSource.query(`DELETE FROM lbc_structure_confiance WHERE id = $1`, [id]);
  return n > 0;
}

// Recherche d'un client ORASS déjà présent dans les opérations chargées,
// pour inscrire une structure par son code client plutôt que par son nom.
export async function rechercherClients(q: string) {
  const motif = `%${normaliserNom(q)}%`;
  return AppDataSource.query(
    `SELECT code_client, MAX(nom_client) AS nom_client, MAX(libelle_qualite) AS libelle_qualite,
            COUNT(*)::int AS nb_operations, SUM(ABS(montant)) AS montant_total
     FROM lbc_operation
     WHERE code_client IS NOT NULL AND (code_client = $1 OR personne_nom_normalise LIKE $2)
     GROUP BY code_client ORDER BY montant_total DESC LIMIT 30`,
    [q.trim(), motif],
  );
}

// --------------------------------------------------------- Pays à risque

export async function listPays(f: FiltreListe) {
  return paginer('lbc_pays_risque', '*', ['code_pays', 'libelle', 'liste', 'observations'], 'actif DESC, liste, libelle, code_pays', f);
}

function paysDepuis(body: any) {
  const code = texte(body.code_pays)?.toUpperCase();
  const libelle = texte(body.libelle);
  const liste = texte(body.liste)?.toUpperCase() ?? 'GRISE';
  if (!code || !/^[A-Z0-9]{2,3}$/.test(code)) throw new ErreurValidation('Code pays (ISO 2 lettres, comme dans ORASS) requis');
  if (!libelle) throw new ErreurValidation('Le libellé du pays est requis');
  if (!LISTES_PAYS.includes(liste)) throw new ErreurValidation(`Liste invalide : ${liste}`);
  return { code, libelle, liste, dateInscription: date(body.date_inscription), observations: texte(body.observations), actif: booleen(body.actif) };
}

async function upsertPays(body: any, source: string) {
  const p = paysDepuis(body);
  const [row] = await AppDataSource.query(
    `INSERT INTO lbc_pays_risque (code_pays, libelle, liste, source, date_inscription, observations, actif)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code_pays) DO UPDATE SET libelle = EXCLUDED.libelle, liste = EXCLUDED.liste,
       source = EXCLUDED.source, date_inscription = EXCLUDED.date_inscription,
       observations = EXCLUDED.observations, actif = EXCLUDED.actif, modifie_le = now()
     RETURNING *`,
    [p.code, p.libelle, p.liste, source, p.dateInscription, p.observations, p.actif],
  );
  return row;
}

export const savePays = (body: any) => upsertPays(body, 'MANUEL');

export async function deletePays(code: string) {
  const [, n] = await AppDataSource.query(`DELETE FROM lbc_pays_risque WHERE code_pays = $1`, [code.toUpperCase()]);
  return n > 0;
}

// --------------------------------------------------- Personnes surveillées

export async function listPersonnes(f: FiltreListe) {
  return paginer(
    'lbc_personne_surveillee',
    `id, nom, prenoms, categorie, fonction, nationalite, date_naissance, source,
     reference_externe, observations, actif, cree_le, modifie_le`,
    ['nom', 'prenoms', 'categorie', 'fonction', 'nationalite', 'reference_externe'],
    'actif DESC, nom, prenoms, id',
    f,
  );
}

function personneDepuis(body: any) {
  const nom = texte(body.nom);
  if (!nom) throw new ErreurValidation('Le nom est requis');
  const prenoms = texte(body.prenoms);
  const categorie = texte(body.categorie)?.toUpperCase() ?? 'PPE';
  if (!CATEGORIES_PERSONNE.includes(categorie)) throw new ErreurValidation(`Catégorie invalide : ${categorie}`);
  const nomNormalise = normaliserNom(`${nom} ${prenoms ?? ''}`);
  const { tokenPrincipal, motifs } = motifsRecherche(nomNormalise);
  if (!tokenPrincipal) throw new ErreurValidation('Le nom doit comporter au moins un mot de deux lettres');
  return [
    nom, prenoms, nomNormalise, tokenPrincipal, motifs, categorie, texte(body.fonction),
    texte(body.nationalite)?.toUpperCase() ?? null, date(body.date_naissance),
    texte(body.reference_externe), texte(body.observations), booleen(body.actif),
  ];
}

export async function createPersonne(body: any, source = 'MANUEL') {
  const [row] = await AppDataSource.query(
    `INSERT INTO lbc_personne_surveillee (nom, prenoms, nom_normalise, token_principal, motifs_recherche, categorie,
       fonction, nationalite, date_naissance, reference_externe, observations, actif, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [...personneDepuis(body), source],
  );
  return row;
}

export async function updatePersonne(id: number, body: any) {
  const [rows] = await AppDataSource.query(
    `UPDATE lbc_personne_surveillee
     SET nom = $2, prenoms = $3, nom_normalise = $4, token_principal = $5, motifs_recherche = $6, categorie = $7,
         fonction = $8, nationalite = $9, date_naissance = $10, reference_externe = $11, observations = $12,
         actif = $13, modifie_le = now()
     WHERE id = $1 RETURNING id`,
    [id, ...personneDepuis(body)],
  );
  return rows[0] ?? null;
}

export async function deletePersonne(id: number) {
  const [, n] = await AppDataSource.query(`DELETE FROM lbc_personne_surveillee WHERE id = $1`, [id]);
  return n > 0;
}

// ------------------------------------------------ Mise à jour via API

// Contrat attendu des API externes (à adapter quand le fournisseur sera
// connu) : GET <url> -> tableau JSON (ou { data: [...] }) d'objets portant
// les mêmes champs que la saisie manuelle :
//  - pays     : { code_pays, libelle, liste: NOIRE|GRISE, date_inscription?, observations? }
//  - personnes: { reference_externe, nom, prenoms?, categorie: PPE|PEE|SANCTION|AUTRE,
//                 fonction?, nationalite?, date_naissance?, actif? }
// Les entrées existantes non renvoyées par l'API ne sont pas supprimées :
// une saisie manuelle reste toujours possible en complément.
async function lireApi(cleUrl: string): Promise<any[]> {
  const p = await getParametresMap();
  const url = p[cleUrl];
  if (!url) {
    throw new ErreurValidation(
      "Aucune API configurée (paramètre " + cleUrl + "). La mise à jour reste manuelle tant qu'aucune API n'est disponible.",
    );
  }
  const reponse = await fetch(url, {
    headers: { Accept: 'application/json', ...(p.api_token ? { Authorization: `Bearer ${p.api_token}` } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!reponse.ok) throw new Error(`L'API a répondu ${reponse.status} ${reponse.statusText}`);
  const corps: any = await reponse.json();
  const liste = Array.isArray(corps) ? corps : corps?.data;
  if (!Array.isArray(liste)) throw new Error("Réponse de l'API inattendue : tableau JSON attendu");
  return liste;
}

export async function synchroniserPays() {
  const liste = await lireApi('api_pays_risque_url');
  let maj = 0;
  const erreurs: string[] = [];
  for (const item of liste) {
    try {
      await upsertPays(item, 'API');
      maj++;
    } catch (e: any) {
      erreurs.push(`${item?.code_pays ?? '?'} : ${e.message}`);
    }
  }
  return { recus: liste.length, mis_a_jour: maj, erreurs };
}

export async function synchroniserPersonnes() {
  const liste = await lireApi('api_personnes_url');
  let maj = 0;
  const erreurs: string[] = [];
  for (const item of liste) {
    try {
      const ref = texte(item?.reference_externe);
      if (!ref) throw new ErreurValidation('reference_externe manquante');
      const [existant] = await AppDataSource.query(
        `SELECT id FROM lbc_personne_surveillee WHERE reference_externe = $1`,
        [ref],
      );
      if (existant) await updatePersonne(existant.id, item);
      else await createPersonne(item, 'API');
      maj++;
    } catch (e: any) {
      erreurs.push(`${item?.reference_externe ?? item?.nom ?? '?'} : ${e.message}`);
    }
  }
  return { recus: liste.length, mis_a_jour: maj, erreurs };
}
