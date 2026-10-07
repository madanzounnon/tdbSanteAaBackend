import { AppDataSource } from '../../data-source';
import { LbcOperationSource } from '../extractors/lbc-operation.extractor';
import { normaliserNom } from '../../modules/lbc/normalise';

// Modes de paiement en espèces (MODE_PAIEMENT ORASS) : "Enc./Espèce" et
// "Règl/Espèce".
const MODES_ESPECES = new Set(['EE', 'RE']);

const COLONNES = [
  'ref_source', 'source', 'sens', 'date_operation', 'montant', 'devise',
  'mode_paiement', 'libelle_mode_paiement', 'espece', 'reference', 'tireur',
  'code_branche', 'libelle_branche', 'code_categorie', 'numero_police',
  'date_effet_police', 'date_echeance_police', 'police_resiliee', 'numero_sinistre',
  'code_client', 'nom_client', 'personne_cle', 'personne_nom', 'personne_nom_normalise',
  'type_personne', 'nature_beneficiaire', 'libelle_nature_beneficiaire',
  'code_qualite', 'libelle_qualite', 'nationalite', 'pays_residence', 'annulee', 'maj_source',
];

const TAILLE_LOT = 500;

// Individu auquel l'opération est imputée pour le cumul "par individu" :
//  - entrée, ou règlement à l'assuré lui-même (codnatbe 'S') -> code assuré ;
//  - autre bénéficiaire de règlement -> code bénéficiaire ORASS, à défaut
//    son nom normalisé (règlements saisis sans fiche bénéficiaire).
function personne(op: LbcOperationSource): { cle: string; nom: string | null } {
  if ((op.sens === 'ENTREE' || op.nature_beneficiaire === 'S') && op.code_client) {
    return { cle: `ASS-${op.code_client}`, nom: op.nom_client };
  }
  if (op.sens === 'SORTIE' && op.code_beneficiaire) {
    return { cle: `BEN-${op.code_beneficiaire}`, nom: op.nom_beneficiaire };
  }
  const nom = op.nom_beneficiaire ?? op.nom_client;
  return { cle: `NOM-${normaliserNom(nom) || op.ref_source}`.slice(0, 80), nom };
}

function versLigne(op: LbcOperationSource): unknown[] {
  const p = personne(op);
  return [
    op.ref_source, op.source, op.sens, op.date_operation, op.montant ?? 0, op.devise ?? 'FCFA',
    op.mode_paiement, op.libelle_mode_paiement, MODES_ESPECES.has(op.mode_paiement ?? ''),
    op.reference?.slice(0, 150) ?? null, op.tireur?.slice(0, 250) ?? null,
    op.code_branche, op.libelle_branche, op.code_categorie, op.numero_police,
    op.date_effet_police, op.date_echeance_police, op.police_resiliee === 1, op.numero_sinistre,
    op.code_client, op.nom_client?.slice(0, 250) ?? null, p.cle, p.nom?.slice(0, 250) ?? null,
    normaliserNom(p.nom).slice(0, 250) || null,
    op.type_personne, op.nature_beneficiaire, op.libelle_nature_beneficiaire,
    op.code_qualite, op.libelle_qualite, op.nationalite?.trim() || null, op.pays_residence?.trim() || null,
    op.annulee === 1, op.maj_source,
  ];
}

// Upsert sur ref_source : une opération modifiée/annulée en source est mise
// à jour en place, son id (référencé par les revues/déclarations) est
// conservé.
export async function loadLbcOperations(operations: LbcOperationSource[]): Promise<number> {
  let charges = 0;
  const miseAJour = COLONNES.filter((c) => c !== 'ref_source').map((c) => `${c} = EXCLUDED.${c}`).join(', ');

  for (let i = 0; i < operations.length; i += TAILLE_LOT) {
    const lot = operations.slice(i, i + TAILLE_LOT);
    const valeurs: unknown[] = [];
    const tuples = lot.map((op, idx) => {
      valeurs.push(...versLigne(op));
      const base = idx * COLONNES.length;
      return `(${COLONNES.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    });
    await AppDataSource.query(
      `INSERT INTO lbc_operation (${COLONNES.join(', ')})
       VALUES ${tuples.join(', ')}
       ON CONFLICT (ref_source) DO UPDATE SET ${miseAJour}, charge_le = now()`,
      valeurs,
    );
    charges += lot.length;
  }
  return charges;
}
