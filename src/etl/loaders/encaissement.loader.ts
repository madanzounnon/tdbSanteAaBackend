import { AppDataSource } from '../../data-source';
import { EncaissementSource } from '../extractors/encaissement.extractor';

const TAILLE_LOT = 500;

// Upsert par lot sur cle_source. La quittance (et donc la police et
// l'exercice) est résolue par jointure sur fait_prime.numero_quittance : un
// encaissement dont la quittance n'est pas (encore) chargée — police de
// test exclue, quittance d'un run ultérieur — est ignoré et sera repris
// au prochain passage.
export async function loadEncaissements(sources: EncaissementSource[]): Promise<number> {
  let charges = 0;
  for (let i = 0; i < sources.length; i += TAILLE_LOT) {
    const lot = sources.slice(i, i + TAILLE_LOT);
    const valeurs: unknown[] = [];
    const tuples = lot.map((e, j) => {
      const b = j * 14;
      valeurs.push(
        e.cle_source, e.numero_quittance, e.date_encaissement, e.montant ?? 0, e.mode_paiement,
        e.libelle_mode_paiement, e.reference?.slice(0, 150) ?? null, e.emetteur?.slice(0, 250) ?? null,
        e.annule === 1, e.date_annulation, e.motif_annulation?.slice(0, 200) ?? null,
        e.annule_par?.slice(0, 120) ?? null, e.saisi_par?.slice(0, 120) ?? null, e.maj_source,
      );
      return `($${b + 1}::varchar, $${b + 2}::varchar, $${b + 3}::timestamp, $${b + 4}::numeric, $${b + 5}::varchar,
               $${b + 6}::varchar, $${b + 7}::varchar, $${b + 8}::varchar, $${b + 9}::boolean, $${b + 10}::date,
               $${b + 11}::varchar, $${b + 12}::varchar, $${b + 13}::varchar, $${b + 14}::timestamp)`;
    });
    const resultat: { id: string }[] = await AppDataSource.query(
      `INSERT INTO fait_encaissement (
         cle_source, quittance_id, police_id, numero_quittance, exercice, date_encaissement, montant,
         mode_paiement, libelle_mode_paiement, reference, emetteur, annule, date_annulation,
         motif_annulation, annule_par, saisi_par, maj_source)
       SELECT v.cle_source, fp.id, fp.police_id, v.numero_quittance, fp.exercice, v.date_encaissement, v.montant,
              v.mode_paiement, v.libelle_mode_paiement, v.reference, v.emetteur, v.annule, v.date_annulation,
              v.motif_annulation, v.annule_par, v.saisi_par, v.maj_source
       FROM (VALUES ${tuples.join(', ')}) AS v(
         cle_source, numero_quittance, date_encaissement, montant, mode_paiement, libelle_mode_paiement,
         reference, emetteur, annule, date_annulation, motif_annulation, annule_par, saisi_par, maj_source)
       JOIN fait_prime fp ON fp.numero_quittance = v.numero_quittance
       ON CONFLICT (cle_source) DO UPDATE SET
         quittance_id = EXCLUDED.quittance_id, police_id = EXCLUDED.police_id, exercice = EXCLUDED.exercice,
         date_encaissement = EXCLUDED.date_encaissement, montant = EXCLUDED.montant,
         mode_paiement = EXCLUDED.mode_paiement, libelle_mode_paiement = EXCLUDED.libelle_mode_paiement,
         reference = EXCLUDED.reference, emetteur = EXCLUDED.emetteur, annule = EXCLUDED.annule,
         date_annulation = EXCLUDED.date_annulation, motif_annulation = EXCLUDED.motif_annulation,
         annule_par = EXCLUDED.annule_par, saisi_par = EXCLUDED.saisi_par, maj_source = EXCLUDED.maj_source,
         charge_le = now()
       RETURNING id`,
      valeurs,
    );
    charges += resultat.length;
  }
  return charges;
}
