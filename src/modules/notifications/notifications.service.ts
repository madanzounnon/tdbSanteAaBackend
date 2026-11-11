import { AppDataSource } from '../../data-source';
import { aujourdhui } from '../commun/periode';
import { echapperHtml, emailConfigure, envoyerEmail, gabaritEmail } from '../commun/email';
import { envoyerSms, smsConfigure, telephoneValide } from '../commun/sms';
import { detecter } from '../lbc/detection.service';
import { CRITERES } from '../lbc/catalogue';
import { ErreurValidation } from '../lbc/referentiels.service';

// Alertes par email / SMS, lancées après le chargement quotidien des
// opérations (et à la demande) :
//  - LBC      : nouveaux cas des règles anti-blanchiment (mêmes critères que
//               l'écran "Opérations suspectes", période = année civile),
//               hors opérations écartées ou déjà déclarées ;
//  - SINISTRE : règlements de sinistres ≥ seuil, toutes branches ou branches
//               choisies.
// Un récapitulatif par type et par analyse. Une opération n'est signalée
// qu'une fois, et seulement si au moins un envoi a réussi : sinon elle
// reste à signaler à l'analyse suivante (SMTP / SMS non configurés, aucun
// destinataire...).

export { ErreurValidation };

export type TypeAlerte = 'LBC' | 'SINISTRE';

// ------------------------------------------------------------ Paramètres
export interface ParametresNotif {
  lbcActif: boolean;
  sinistreActif: boolean;
  seuilReglement: number;
  branches: number[];
  dateDebut: string;
}

export const getParametres = () =>
  AppDataSource.query(`SELECT cle, valeur, libelle, modifie_par, modifie_le FROM notification_parametre ORDER BY cle`);

export async function getParametresNotif(): Promise<ParametresNotif> {
  const rows: { cle: string; valeur: string }[] = await AppDataSource.query(`SELECT cle, valeur FROM notification_parametre`);
  const p = Object.fromEntries(rows.map((r) => [r.cle, r.valeur]));
  return {
    lbcActif: p.lbc_actif === 'true',
    sinistreActif: p.sinistre_actif === 'true',
    seuilReglement: Number(p.seuil_reglement_sinistre) || 5_000_000,
    branches: (p.sinistre_branches || '')
      .split(',')
      .map((c) => Number(c.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
    dateDebut: /^\d{4}-\d{2}-\d{2}$/.test(p.date_debut || '') ? p.date_debut : aujourdhui(),
  };
}

export async function updateParametres(valeurs: Record<string, unknown>, par: string | null) {
  const connues: string[] = (await AppDataSource.query(`SELECT cle FROM notification_parametre`)).map((r: any) => r.cle);
  const nettoyees: [string, string][] = [];
  for (const [cle, brut] of Object.entries(valeurs ?? {})) {
    if (!connues.includes(cle)) throw new ErreurValidation(`Paramètre inconnu : ${cle}`);
    let valeur = brut == null ? '' : String(brut).trim();
    if (cle === 'lbc_actif' || cle === 'sinistre_actif') valeur = valeur === 'true' ? 'true' : 'false';
    if (cle === 'seuil_reglement_sinistre' && !(Number(valeur) > 0)) {
      throw new ErreurValidation('Le seuil de règlement doit être un montant supérieur à 0.');
    }
    if (cle === 'sinistre_branches' && valeur && !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(valeur)) {
      throw new ErreurValidation('Branches : codes séparés par des virgules.');
    }
    if (cle === 'date_debut') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valeur) || Number.isNaN(Date.parse(valeur))) {
        throw new ErreurValidation('Date de départ invalide (AAAA-MM-JJ).');
      }
      if (valeur > aujourdhui()) throw new ErreurValidation('La date de départ ne peut pas être dans le futur.');
      if (valeur < '2020-01-01') throw new ErreurValidation('La date de départ doit être postérieure au 01/01/2020.');
    }
    nettoyees.push([cle, valeur]);
  }
  await AppDataSource.transaction(async (m) => {
    for (const [cle, valeur] of nettoyees) {
      await m.query(
        `UPDATE notification_parametre SET valeur = $2, modifie_par = $3, modifie_le = now() WHERE cle = $1`,
        [cle, valeur, par],
      );
    }
  });
  return getParametres();
}

// --------------------------------------------------------- Destinataires
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texte = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const vrai = (v: unknown) => v === true || v === 'true';

const validerDestinataire = (b: any) => {
  const d = {
    nom: texte(b?.nom, 150),
    fonction: texte(b?.fonction, 150),
    email: texte(b?.email, 150)?.toLowerCase() ?? null,
    telephone: texte(b?.telephone, 30),
    canal_email: vrai(b?.canal_email),
    canal_sms: vrai(b?.canal_sms),
    alerte_lbc: vrai(b?.alerte_lbc),
    alerte_sinistre: vrai(b?.alerte_sinistre),
    actif: b?.actif === undefined ? true : vrai(b?.actif),
  };
  if (!d.nom) throw new ErreurValidation('Le nom est obligatoire.');
  if (d.email && !EMAIL_RE.test(d.email)) throw new ErreurValidation('Email invalide.');
  if (d.telephone && !telephoneValide(d.telephone)) {
    throw new ErreurValidation('Téléphone invalide : numéro béninois (01 XX XX XX XX) ou international (+XXX...).');
  }
  if (!d.canal_email && !d.canal_sms) throw new ErreurValidation('Choisissez au moins un canal : email ou SMS.');
  if (d.canal_email && !d.email) throw new ErreurValidation("L'email est obligatoire pour recevoir les alertes par email.");
  if (d.canal_sms && !d.telephone) throw new ErreurValidation('Le téléphone est obligatoire pour recevoir les alertes par SMS.');
  if (!d.alerte_lbc && !d.alerte_sinistre) throw new ErreurValidation("Choisissez au moins un type d'alerte.");
  return d;
};

export const listDestinataires = () =>
  AppDataSource.query(`SELECT * FROM notification_destinataire ORDER BY actif DESC, nom`);

export async function createDestinataire(body: unknown, par: string | null) {
  const d = validerDestinataire(body);
  const [ligne] = await AppDataSource.query(
    `INSERT INTO notification_destinataire
       (nom, fonction, email, telephone, canal_email, canal_sms, alerte_lbc, alerte_sinistre, actif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [d.nom, d.fonction, d.email, d.telephone, d.canal_email, d.canal_sms, d.alerte_lbc, d.alerte_sinistre, d.actif, par],
  );
  return ligne;
}

export async function updateDestinataire(id: number, body: unknown) {
  const d = validerDestinataire(body);
  const resultat = await AppDataSource.query(
    `UPDATE notification_destinataire
        SET nom = $2, fonction = $3, email = $4, telephone = $5, canal_email = $6, canal_sms = $7,
            alerte_lbc = $8, alerte_sinistre = $9, actif = $10, modifie_le = now()
      WHERE id = $1 RETURNING *`,
    [id, d.nom, d.fonction, d.email, d.telephone, d.canal_email, d.canal_sms, d.alerte_lbc, d.alerte_sinistre, d.actif],
  );
  const lignes = Array.isArray(resultat?.[0]) ? resultat[0] : resultat;
  return lignes[0] ?? null;
}

export async function deleteDestinataire(id: number) {
  const [, n] = await AppDataSource.query(`DELETE FROM notification_destinataire WHERE id = $1`, [id]);
  return n > 0;
}

// ------------------------------------------------------- Cas à signaler
const isoLocal = (d: Date | string) => {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const dejaSignalees = async (type: TypeAlerte, ids: number[]): Promise<Set<number>> => {
  if (!ids.length) return new Set();
  const rows = await AppDataSource.query(
    `SELECT operation_id FROM notification_alerte WHERE type = $1 AND operation_id = ANY($2::bigint[])`,
    [type, ids],
  );
  return new Set(rows.map((r: any) => Number(r.operation_id)));
};

export interface CasLbc {
  personne_cle: string;
  personne: string;
  criteres: string[];
  operations: any[];
  montant_total: number;
}

// Détection par année civile (comme l'écran, période par défaut), depuis
// l'année de la date de départ ; seules les opérations datées à partir de
// la date de départ et jamais signalées sont retenues.
export async function casLbcASignaler(p: ParametresNotif): Promise<CasLbc[]> {
  const fin = aujourdhui();
  const operations: any[] = [];
  for (let annee = Number(p.dateDebut.slice(0, 4)); annee <= Number(fin.slice(0, 4)); annee++) {
    const du = `${annee}-01-01`;
    const au = annee === Number(fin.slice(0, 4)) ? fin : `${annee}-12-31`;
    const { operations: ops } = await detecter({ du, au, inclureEcartees: false, inclureDeclarees: false });
    operations.push(...ops.filter((o: any) => isoLocal(o.date_operation) >= p.dateDebut));
  }
  const deja = await dejaSignalees('LBC', operations.map((o) => o.id));
  const parPersonne = new Map<string, CasLbc>();
  for (const o of operations) {
    if (deja.has(o.id)) continue;
    const cas: CasLbc = parPersonne.get(o.personne_cle) ?? {
      personne_cle: o.personne_cle,
      personne: o.personne_nom || o.nom_client || o.personne_cle,
      criteres: [],
      operations: [],
      montant_total: 0,
    };
    for (const c of o.criteres) if (!cas.criteres.includes(c)) cas.criteres.push(c);
    cas.operations.push({
      id: o.id,
      date: isoLocal(o.date_operation),
      source: o.source,
      montant: o.montant,
      branche: o.libelle_branche,
      police: o.numero_police,
      sinistre: o.numero_sinistre,
      mode: o.libelle_mode_paiement,
      criteres: o.criteres,
    });
    cas.montant_total += Math.abs(o.montant);
    parPersonne.set(o.personne_cle, cas);
  }
  return [...parPersonne.values()].sort((a, b) => b.montant_total - a.montant_total);
}

export async function reglementsASignaler(p: ParametresNotif): Promise<any[]> {
  const rows = await AppDataSource.query(
    `SELECT o.id, o.date_operation, o.montant, o.numero_sinistre, o.numero_police, o.personne_nom,
            o.libelle_nature_beneficiaire, o.code_branche, o.libelle_branche, o.libelle_mode_paiement
       FROM lbc_operation o
      WHERE o.source = 'REGLEMENT' AND NOT o.annulee
        AND o.montant >= $1 AND o.date_operation >= $2::date
        AND (cardinality($3::int[]) = 0 OR o.code_branche = ANY($3::int[]))
        AND NOT EXISTS (SELECT 1 FROM notification_alerte a WHERE a.type = 'SINISTRE' AND a.operation_id = o.id)
      ORDER BY o.montant DESC, o.date_operation`,
    [p.seuilReglement, p.dateDebut, p.branches],
  );
  return rows.map((r: any) => ({
    id: Number(r.id),
    date: isoLocal(r.date_operation),
    montant: Number(r.montant),
    sinistre: r.numero_sinistre,
    police: r.numero_police,
    beneficiaire: r.personne_nom,
    nature_beneficiaire: r.libelle_nature_beneficiaire,
    branche: r.libelle_branche,
    mode: r.libelle_mode_paiement,
  }));
}

// -------------------------------------------------------------- Messages
const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ')} FCFA`;
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
// SMS en alphabet GSM (sans accents) : un SMS de 160 caractères au lieu de 70.
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'");
const tronquer = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const pluriel = (n: number, mot: string, motPluriel = `${mot}s`) => `${n} ${n > 1 ? motPluriel : mot}`;
const LIMITE_EMAIL = 50;

const lienPage = (chemin: string) => {
  const base = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return base ? `${base}/#${chemin}` : null;
};
const boutonLien = (chemin: string, libelle: string) => {
  const url = lienPage(chemin);
  return url
    ? `<p style="margin-top:20px"><a href="${echapperHtml(url)}" style="background:#0b6e4f;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${echapperHtml(libelle)}</a></p>`
    : `<p style="margin-top:20px;color:#6b7280">${echapperHtml(libelle)} : menu correspondant du tableau de bord.</p>`;
};

const TH = 'style="text-align:left;padding:6px 8px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;font-size:12px"';
const TD = 'style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;vertical-align:top"';
const TDN = 'style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;white-space:nowrap;vertical-align:top"';
const TDR = 'style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;white-space:nowrap;vertical-align:top"';

interface Message {
  sujet: string;
  texte: string;
  html: string;
  sms: string;
}

export function messageLbc(cas: CasLbc[]): Message {
  const nbOps = cas.reduce((s, c) => s + c.operations.length, 0);
  const total = cas.reduce((s, c) => s + c.montant_total, 0);
  const libelle = (c: string) => CRITERES[c]?.libelle ?? c;
  const sujet = `[LBC] ${pluriel(cas.length, 'nouveau cas', 'nouveaux cas')} à analyser — ${pluriel(nbOps, 'opération')}`;

  const affiches = cas.slice(0, LIMITE_EMAIL);
  const lignes = affiches
    .map((c) => {
      const refs = [...new Set(c.operations.map((o) => o.police || o.sinistre).filter(Boolean))].slice(0, 3).join(', ');
      return `<tr>
        <td ${TD}><strong>${echapperHtml(c.personne)}</strong>${refs ? `<br><span style="color:#6b7280;font-size:12px">${echapperHtml(refs)}</span>` : ''}</td>
        <td ${TD}>${c.criteres.map((k) => echapperHtml(libelle(k))).join('<br>')}</td>
        <td ${TDR}>${c.operations.length}</td>
        <td ${TDR}>${echapperHtml(fcfa(c.montant_total))}</td>
      </tr>`;
    })
    .join('');
  const html = gabaritEmail(
    'Alerte anti-blanchiment',
    `<p>Bonjour,</p>
     <p>L'analyse anti-blanchiment a détecté <strong>${pluriel(cas.length, 'nouveau cas', 'nouveaux cas')}</strong>
        (${pluriel(nbOps, 'opération')}, ${echapperHtml(fcfa(total))}) répondant aux règles de sélection.</p>
     <table style="border-collapse:collapse;width:100%">
       <thead><tr><th ${TH}>Personne</th><th ${TH}>Critères</th><th ${TH}>Op.</th><th ${TH}>Montant</th></tr></thead>
       <tbody>${lignes}</tbody>
     </table>
     ${cas.length > affiches.length ? `<p style="color:#6b7280">… et ${pluriel(cas.length - affiches.length, 'autre cas', 'autres cas')}.</p>` : ''}
     <p>Ces opérations sont à analyser : les écarter ou établir une déclaration de soupçon à la CENTIF.</p>
     ${boutonLien('/lbc/operations-suspectes', 'Ouvrir les opérations suspectes')}
     <p style="color:#6b7280;font-size:12px;margin-top:20px">Information confidentielle (art. 82 de la loi 2018-17 portant LBC/FT) : ne pas communiquer aux personnes concernées.</p>`,
  );
  const texte =
    `L'analyse anti-blanchiment a détecté ${pluriel(cas.length, 'nouveau cas', 'nouveaux cas')} (${pluriel(nbOps, 'opération')}, ${fcfa(total)}).\n\n` +
    affiches.map((c) => `- ${c.personne} : ${c.criteres.map(libelle).join(', ')} — ${c.operations.length} op., ${fcfa(c.montant_total)}`).join('\n') +
    (cas.length > affiches.length ? `\n… et ${cas.length - affiches.length} autre(s).` : '') +
    `\n\nÀ analyser dans le tableau de bord (Anti-blanchiment > Opérations suspectes).` +
    `\nInformation confidentielle : ne pas communiquer aux personnes concernées.`;
  const premier = cas[0];
  const sms = sansAccents(
    tronquer(
      `L'Africaine LBC: ${pluriel(cas.length, 'nouveau cas suspect', 'nouveaux cas suspects')}, ${pluriel(nbOps, 'operation')}, ${fcfa(total)}. ` +
        `Principal: ${tronquer(premier.personne, 40)} (${fcfa(premier.montant_total)}). A analyser sur le tableau de bord. Confidentiel.`,
      300,
    ),
  );
  return { sujet, texte, html, sms };
}

export function messageSinistres(reglements: any[], seuil: number): Message {
  const total = reglements.reduce((s, r) => s + r.montant, 0);
  const sujet = `[Sinistres] ${pluriel(reglements.length, 'règlement')} ≥ ${fcfa(seuil)}`;
  const affiches = reglements.slice(0, LIMITE_EMAIL);
  const lignes = affiches
    .map(
      (r) => `<tr>
        <td ${TD}>${dateFr(r.date)}</td>
        <td ${TDN}>${echapperHtml(r.sinistre || '—')}<br><span style="color:#6b7280;font-size:12px">${echapperHtml(r.police || '')}</span></td>
        <td ${TD}>${echapperHtml(r.branche || '')}</td>
        <td ${TD}>${echapperHtml(r.beneficiaire || '')}${r.nature_beneficiaire ? `<br><span style="color:#6b7280;font-size:12px">${echapperHtml(r.nature_beneficiaire)}</span>` : ''}</td>
        <td ${TDR}><strong>${echapperHtml(fcfa(r.montant))}</strong></td>
      </tr>`,
    )
    .join('');
  const html = gabaritEmail(
    'Règlements de sinistres importants',
    `<p>Bonjour,</p>
     <p><strong>${pluriel(reglements.length, 'règlement')} de sinistre</strong> d'un montant supérieur ou égal à
        ${echapperHtml(fcfa(seuil))} ${reglements.length > 1 ? 'ont été enregistrés' : 'a été enregistré'} (total ${echapperHtml(fcfa(total))}).</p>
     <table style="border-collapse:collapse;width:100%">
       <thead><tr><th ${TH}>Date</th><th ${TH}>Sinistre / police</th><th ${TH}>Branche</th><th ${TH}>Bénéficiaire</th><th ${TH}>Montant</th></tr></thead>
       <tbody>${lignes}</tbody>
     </table>
     ${reglements.length > affiches.length ? `<p style="color:#6b7280">… et ${pluriel(reglements.length - affiches.length, 'autre règlement')}.</p>` : ''}
     ${boutonLien('/lbc/notifications', 'Voir l\'historique des alertes')}`,
  );
  const texte =
    `${pluriel(reglements.length, 'règlement')} de sinistre ≥ ${fcfa(seuil)} (total ${fcfa(total)}) :\n\n` +
    affiches.map((r) => `- ${dateFr(r.date)} ${r.sinistre || ''} (${r.branche || ''}) — ${r.beneficiaire || ''} : ${fcfa(r.montant)}`).join('\n') +
    (reglements.length > affiches.length ? `\n… et ${reglements.length - affiches.length} autre(s).` : '');
  const premier = reglements[0];
  const sms = sansAccents(
    tronquer(
      `L'Africaine Sinistres: ${pluriel(reglements.length, 'reglement')} >= ${fcfa(seuil)}, total ${fcfa(total)}. ` +
        `Plus important: ${fcfa(premier.montant)}, sinistre ${premier.sinistre || '?'} (${tronquer(premier.beneficiaire || '', 30)}).`,
      300,
    ),
  );
  return { sujet, texte, html, sms };
}

// --------------------------------------------------------------- Diffusion
type StatutCanal = 'ENVOYE' | 'ECHEC' | 'NON_CONFIGURE';
interface ResultatCanal {
  destinataire_id: number | null;
  destinataire_nom: string;
  canal: 'EMAIL' | 'SMS';
  adresse: string;
  statut: StatutCanal;
  erreur: string | null;
}

const tenter = async (
  d: { id: number | null; nom: string },
  canal: 'EMAIL' | 'SMS',
  adresse: string,
  configure: boolean,
  envoi: () => Promise<unknown>,
): Promise<ResultatCanal> => {
  const base = { destinataire_id: d.id, destinataire_nom: d.nom, canal, adresse };
  if (!configure) {
    return { ...base, statut: 'NON_CONFIGURE', erreur: canal === 'EMAIL' ? 'Serveur SMTP non configuré' : 'Passerelle SMS non configurée' };
  }
  try {
    const info = await envoi();
    return { ...base, statut: 'ENVOYE', erreur: canal === 'SMS' && typeof info === 'string' ? `Réf. ${info}` : null };
  } catch (err: any) {
    return { ...base, statut: 'ECHEC', erreur: String(err?.message ?? err).slice(0, 500) };
  }
};

const diffuser = async (destinataires: any[], m: Message): Promise<ResultatCanal[]> => {
  const resultats: ResultatCanal[] = [];
  for (const d of destinataires) {
    if (d.canal_email && d.email) {
      resultats.push(await tenter(d, 'EMAIL', d.email, emailConfigure(), () => envoyerEmail({ a: d.email, sujet: m.sujet, texte: m.texte, html: m.html })));
    }
    if (d.canal_sms && d.telephone) {
      resultats.push(await tenter(d, 'SMS', d.telephone, smsConfigure(), () => envoyerSms(d.telephone, m.sms)));
    }
  }
  return resultats;
};

const statutEnvoi = (r: ResultatCanal[]) => {
  if (!r.length) return 'SANS_DESTINATAIRE';
  const ok = r.filter((x) => x.statut === 'ENVOYE').length;
  return ok === r.length ? 'ENVOYE' : ok > 0 ? 'PARTIEL' : 'ECHEC';
};

interface Lot {
  type: TypeAlerte;
  nbCas: number;
  operations: { id: number; criteres?: string[] }[];
  montant: number;
  message: Message;
  detail: unknown[];
}

const enregistrerEtDiffuser = async (lot: Lot, declenchement: 'AUTO' | 'MANUEL', par: string | null) => {
  const colonne = lot.type === 'LBC' ? 'alerte_lbc' : 'alerte_sinistre';
  const destinataires = await AppDataSource.query(
    `SELECT * FROM notification_destinataire WHERE actif AND ${colonne} ORDER BY nom`,
  );
  const resultats = await diffuser(destinataires, lot.message);
  const statut = statutEnvoi(resultats);

  return AppDataSource.transaction(async (m) => {
    const [{ id }] = await m.query(
      `INSERT INTO notification_envoi
         (type, declenchement, statut, nb_cas, nb_operations, montant_total, sujet, resume_sms, operations, lance_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [lot.type, declenchement, statut, lot.nbCas, lot.operations.length, lot.montant, lot.message.sujet,
        lot.message.sms, JSON.stringify(lot.detail), par],
    );
    for (const r of resultats) {
      await m.query(
        `INSERT INTO notification_envoi_detail (envoi_id, destinataire_id, destinataire_nom, canal, adresse, statut, erreur)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, r.destinataire_id, r.destinataire_nom, r.canal, r.adresse, r.statut, r.erreur],
      );
    }
    // Opérations considérées comme signalées seulement si au moins un
    // destinataire a reçu l'alerte.
    if (statut === 'ENVOYE' || statut === 'PARTIEL') {
      await m.query(
        `INSERT INTO notification_alerte (type, operation_id, envoi_id, criteres)
         SELECT $1, x.id, $2, ARRAY(SELECT jsonb_array_elements_text(COALESCE(x.criteres, '[]'::jsonb)))
           FROM jsonb_to_recordset($3::jsonb) AS x(id bigint, criteres jsonb)
         ON CONFLICT (type, operation_id) DO NOTHING`,
        [lot.type, id, JSON.stringify(lot.operations)],
      );
    }
    return {
      envoiId: id,
      statut,
      nbCas: lot.nbCas,
      nbOperations: lot.operations.length,
      montant: lot.montant,
      envois: resultats.length,
      reussis: resultats.filter((r) => r.statut === 'ENVOYE').length,
    };
  });
};

// ------------------------------------------------------------- Analyse
// Verrou PostgreSQL : l'analyse peut être lancée par le planificateur (autre
// processus) et depuis l'écran ; une seule à la fois.
const VERROU = 742_021;

export class AnalyseEnCours extends Error {}

export async function lancerAnalyse(declenchement: 'AUTO' | 'MANUEL', par: string | null = null) {
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  try {
    const [{ ok }] = await qr.query(`SELECT pg_try_advisory_lock($1) AS ok`, [VERROU]);
    if (!ok) throw new AnalyseEnCours('Une analyse des alertes est déjà en cours.');
    try {
      const p = await getParametresNotif();
      const resultat: Record<string, unknown> = { lbc: null, sinistre: null };

      if (p.lbcActif) {
        const cas = await casLbcASignaler(p);
        resultat.lbc = cas.length
          ? await enregistrerEtDiffuser(
              {
                type: 'LBC',
                nbCas: cas.length,
                operations: cas.flatMap((c) => c.operations.map((o) => ({ id: o.id, criteres: o.criteres }))),
                montant: cas.reduce((s, c) => s + c.montant_total, 0),
                message: messageLbc(cas),
                detail: cas.map((c) => ({ personne: c.personne, criteres: c.criteres, montant_total: c.montant_total, operations: c.operations })),
              },
              declenchement,
              par,
            )
          : { nbCas: 0 };
      }

      if (p.sinistreActif) {
        const reglements = await reglementsASignaler(p);
        resultat.sinistre = reglements.length
          ? await enregistrerEtDiffuser(
              {
                type: 'SINISTRE',
                nbCas: reglements.length,
                operations: reglements.map((r) => ({ id: r.id })),
                montant: reglements.reduce((s, r) => s + r.montant, 0),
                message: messageSinistres(reglements, p.seuilReglement),
                detail: reglements,
              },
              declenchement,
              par,
            )
          : { nbCas: 0 };
      }
      return resultat;
    } finally {
      await qr.query(`SELECT pg_advisory_unlock($1)`, [VERROU]);
    }
  } finally {
    await qr.release();
  }
}

// Aperçu sans envoi : ce qui partirait à la prochaine analyse.
export async function apercu() {
  const p = await getParametresNotif();
  const [cas, reglements] = await Promise.all([
    p.lbcActif ? casLbcASignaler(p) : Promise.resolve([]),
    p.sinistreActif ? reglementsASignaler(p) : Promise.resolve([]),
  ]);
  return {
    lbc: p.lbcActif
      ? { nbCas: cas.length, nbOperations: cas.reduce((s, c) => s + c.operations.length, 0), montant: cas.reduce((s, c) => s + c.montant_total, 0) }
      : null,
    sinistre: p.sinistreActif
      ? { nbCas: reglements.length, montant: reglements.reduce((s, r) => s + r.montant, 0), plusImportant: reglements[0] ?? null }
      : null,
  };
}

export async function etat() {
  const [dernier] = await AppDataSource.query(
    `SELECT cree_le, declenchement FROM notification_envoi ORDER BY cree_le DESC LIMIT 1`,
  );
  const [destinataires] = await AppDataSource.query(
    `SELECT COUNT(*) FILTER (WHERE actif AND alerte_lbc)::int AS lbc,
            COUNT(*) FILTER (WHERE actif AND alerte_sinistre)::int AS sinistre
       FROM notification_destinataire`,
  );
  return {
    emailConfigure: emailConfigure(),
    smsConfigure: smsConfigure(),
    destinataires,
    dernierEnvoi: dernier ?? null,
    apercu: await apercu(),
  };
}

// -------------------------------------------------------- Message de test
export async function envoyerTest(id: number) {
  const [d] = await AppDataSource.query(`SELECT * FROM notification_destinataire WHERE id = $1`, [id]);
  if (!d) return null;
  const m: Message = {
    sujet: 'Test des alertes — Tableau de bord',
    texte: `Bonjour ${d.nom},\n\nCeci est un message de test : vous recevrez à cette adresse les alertes du tableau de bord.`,
    html: gabaritEmail(
      'Message de test',
      `<p>Bonjour ${echapperHtml(d.nom)},</p><p>Ceci est un message de test : vous recevrez à cette adresse les alertes du tableau de bord
        (${[d.alerte_lbc && 'anti-blanchiment', d.alerte_sinistre && 'règlements de sinistres importants'].filter(Boolean).join(', ')}).</p>`,
    ),
    sms: "L'Africaine - Tableau de bord : message de test. Vous recevrez ici les alertes.",
  };
  return diffuser([d], m);
}

// -------------------------------------------------------------- Historique
export async function listEnvois(f: { page: number; taille: number; type?: string | null }) {
  const params: unknown[] = [f.type ?? null];
  const [{ total }] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS total FROM notification_envoi WHERE ($1::text IS NULL OR type = $1)`,
    params,
  );
  const pages = Math.max(1, Math.ceil(total / f.taille));
  const page = Math.min(f.page, pages);
  const donnees = await AppDataSource.query(
    `SELECT e.id, e.type, e.declenchement, e.statut, e.nb_cas, e.nb_operations, e.montant_total, e.sujet,
            e.lance_par, e.cree_le,
            COUNT(d.id)::int AS nb_envois,
            COUNT(d.id) FILTER (WHERE d.statut = 'ENVOYE')::int AS nb_reussis
       FROM notification_envoi e
       LEFT JOIN notification_envoi_detail d ON d.envoi_id = e.id
      WHERE ($1::text IS NULL OR e.type = $1)
      GROUP BY e.id
      ORDER BY e.cree_le DESC
      LIMIT $2 OFFSET $3`,
    [f.type ?? null, f.taille, (page - 1) * f.taille],
  );
  return { donnees, total, page, taille: f.taille, pages };
}

// ------------------------------------------------- Centre d'alertes (appli)
// Chaque récapitulatif (notification_envoi) est une alerte, lue ou non par
// chaque utilisateur (notification_lecture), qu'il ait été reçu par email /
// SMS ou non.
// « types » : types d'alerte visibles par l'utilisateur (selon ses privilèges).
export async function listAlertes(
  utilisateurId: number,
  types: string[],
  f: { page: number; taille: number; type?: string | null; nonLues: boolean },
) {
  const filtre = `($2::text IS NULL OR e.type = $2) AND (NOT $3::boolean OR l.envoi_id IS NULL) AND e.type = ANY($6::text[])`;
  const params = [utilisateurId, f.type ?? null, f.nonLues];
  const [{ total }] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS total
       FROM notification_envoi e
       LEFT JOIN notification_lecture l ON l.envoi_id = e.id AND l.utilisateur_id = $1
      WHERE ${filtre.replace('$6', '$4')}`,
    [...params, types],
  );
  const pages = Math.max(1, Math.ceil(total / f.taille));
  const page = Math.min(f.page, pages);
  const donnees = await AppDataSource.query(
    `SELECT e.id, e.type, e.declenchement, e.statut, e.nb_cas, e.nb_operations, e.montant_total, e.sujet,
            e.lance_par, e.cree_le, l.lu_le, (l.envoi_id IS NOT NULL) AS lu
       FROM notification_envoi e
       LEFT JOIN notification_lecture l ON l.envoi_id = e.id AND l.utilisateur_id = $1
      WHERE ${filtre}
      ORDER BY e.cree_le DESC, e.id DESC
      LIMIT $4 OFFSET $5`,
    [...params, f.taille, (page - 1) * f.taille, types],
  );
  const [stats] = await AppDataSource.query(
    `SELECT COUNT(*) FILTER (WHERE l.envoi_id IS NULL)::int AS non_lues,
            COALESCE(SUM(e.nb_cas) FILTER (WHERE e.type = 'LBC' AND e.cree_le >= now() - interval '30 days'), 0)::int AS cas_lbc_30j,
            COALESCE(SUM(e.nb_cas) FILTER (WHERE e.type = 'SINISTRE' AND e.cree_le >= now() - interval '30 days'), 0)::int AS reglements_30j,
            COALESCE(SUM(e.montant_total) FILTER (WHERE e.type = 'SINISTRE' AND e.cree_le >= now() - interval '30 days'), 0) AS montant_reglements_30j,
            MAX(e.cree_le) AS derniere
       FROM notification_envoi e
       LEFT JOIN notification_lecture l ON l.envoi_id = e.id AND l.utilisateur_id = $1
      WHERE e.type = ANY($2::text[])`,
    [utilisateurId, types],
  );
  return { donnees, total, page, taille: f.taille, pages, stats, types };
}

// Pour la cloche de l'en-tête : nombre de non lues et 5 dernières alertes.
export async function resumeAlertes(utilisateurId: number, types: string[]) {
  const [{ non_lues }] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS non_lues
       FROM notification_envoi e
      WHERE e.type = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM notification_lecture l WHERE l.envoi_id = e.id AND l.utilisateur_id = $1)`,
    [utilisateurId, types],
  );
  const dernieres = await AppDataSource.query(
    `SELECT e.id, e.type, e.nb_cas, e.montant_total, e.sujet, e.cree_le, (l.envoi_id IS NOT NULL) AS lu
       FROM notification_envoi e
       LEFT JOIN notification_lecture l ON l.envoi_id = e.id AND l.utilisateur_id = $1
      WHERE e.type = ANY($2::text[])
      ORDER BY e.cree_le DESC, e.id DESC
      LIMIT 5`,
    [utilisateurId, types],
  );
  return { nonLues: non_lues, dernieres };
}

export async function marquerLue(utilisateurId: number, types: string[], envoiId: number) {
  const [existe] = await AppDataSource.query(
    `SELECT 1 FROM notification_envoi WHERE id = $1 AND type = ANY($2::text[])`,
    [envoiId, types],
  );
  if (!existe) return null;
  await AppDataSource.query(
    `INSERT INTO notification_lecture (utilisateur_id, envoi_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [utilisateurId, envoiId],
  );
  return { ok: true };
}

export async function marquerNonLue(utilisateurId: number, envoiId: number) {
  await AppDataSource.query(`DELETE FROM notification_lecture WHERE utilisateur_id = $1 AND envoi_id = $2`, [
    utilisateurId,
    envoiId,
  ]);
  return { ok: true };
}

export async function toutMarquerLu(utilisateurId: number, types: string[]) {
  const r = await AppDataSource.query(
    `INSERT INTO notification_lecture (utilisateur_id, envoi_id)
     SELECT $1, e.id FROM notification_envoi e WHERE e.type = ANY($2::text[])
     ON CONFLICT DO NOTHING
     RETURNING envoi_id`,
    [utilisateurId, types],
  );
  return { marquees: r.length };
}

// Détail d'une alerte ouverte depuis le centre d'alertes : la marque lue.
export async function ouvrirAlerte(utilisateurId: number, types: string[], envoiId: number) {
  const envoi = await getEnvoi(envoiId);
  if (!envoi || !types.includes(envoi.type)) return null;
  await marquerLue(utilisateurId, types, envoiId);
  return envoi;
}

export async function getEnvoi(id: number) {
  const [envoi] = await AppDataSource.query(`SELECT * FROM notification_envoi WHERE id = $1`, [id]);
  if (!envoi) return null;
  const details = await AppDataSource.query(
    `SELECT destinataire_nom, canal, adresse, statut, erreur, envoye_le
       FROM notification_envoi_detail WHERE envoi_id = $1 ORDER BY destinataire_nom, canal`,
    [id],
  );
  return { ...envoi, details };
}
