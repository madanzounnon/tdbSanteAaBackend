import { AppDataSource } from '../../data-source';
import { FaitPrime } from '../../entities/fait-prime.entity';
import { FaitSinistre } from '../../entities/fait-sinistre.entity';
import { FaitFacturePrestataire } from '../../entities/fait-facture-prestataire.entity';
import { Police } from '../../entities/police.entity';
import { Assure } from '../../entities/assure.entity';
import { ActeMedical } from '../../entities/acte-medical.entity';
import { Prestataire } from '../../entities/prestataire.entity';
import { PrimeSource } from '../extractors/prime.extractor';
import { SinistreSource } from '../extractors/sinistre.extractor';
import { FactureSource } from '../extractors/facture-prestataire.extractor';
import { transformNatureActe, transformTypeAssure, calculerStatutFacture, extraireExercice, extraireMois } from '../transformers/facts.transformer';
import { getPoliceIdByNumero, getTypeAvenantByCode, findOrCreateAssure, findOrCreatePrestataire, findOrCreateActeMedical } from './dimensions.loader';

export async function loadPrimes(sources: PrimeSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(FaitPrime);
  let loaded = 0;

  for (const source of sources) {
    const policeId = await getPoliceIdByNumero(source.numero_police);
    if (!policeId) {
      console.warn(`[ETL] Police ${source.numero_police} introuvable — ligne prime ignorée`);
      continue;
    }

    // Upsert sur numero_quittance (clé naturelle, une ligne par mouvement) :
    // une même quittance peut être réextraite (avenant révisé) sans dupliquer
    // la ligne, mais deux quittances distinctes du même mois restent deux
    // lignes distinctes (cf. entité).
    let fait = await repo.findOneBy({ numeroQuittance: source.numero_quittance });

    if (!fait) {
      fait = repo.create();
      fait.numeroQuittance = source.numero_quittance;
      fait.police = { id: policeId } as Police;
      fait.exercice = extraireExercice(source.date_emission);
      fait.mois = extraireMois(source.date_emission);
      fait.date = source.date_emission;
    }
    fait.typeAvenant = getTypeAvenantByCode(source.code_type_avenant);
    fait.dateAvenant = source.date_avenant;
    fait.montantEmis = Number(source.montant_emis);
    fait.montantEncaisse = Number(source.montant_encaisse);
    fait.commissionVersee = Number(source.commission_versee);

    await repo.save(fait);
    loaded++;
  }
  return loaded;
}

export async function loadSinistres(sources: SinistreSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(FaitSinistre);
  let loaded = 0;

  for (const source of sources) {
    const policeId = await getPoliceIdByNumero(source.numero_police);
    if (!policeId) {
      console.warn(`[ETL] Police ${source.numero_police} introuvable — sinistre ignoré`);
      continue;
    }

    // type_assure résolu via RISQUE_FAMILLE.lienpare, cf. sinistre.extractor.ts.
    const assure = await findOrCreateAssure(policeId, source.matricule_assure, transformTypeAssure(source.lien_parente), 0);
    const acte = await findOrCreateActeMedical(transformNatureActe(source.famille_prestation));
    const prestataire = source.nom_prestataire
      ? await findOrCreatePrestataire(source.nom_prestataire, source.code_categorie_prestataire ?? '')
      : null;

    // Upsert sur numero_reglement_ligne (clé naturelle) : une même ligne de
    // règlement réextraite (fenêtre chevauchante, relance) met à jour au
    // lieu de dupliquer.
    let fait = await repo.findOneBy({ numeroReglementLigne: source.numero_reglement_ligne });
    if (!fait) {
      fait = repo.create();
      fait.numeroReglementLigne = source.numero_reglement_ligne;
    }
    fait.police = { id: policeId } as Police;
    fait.assure = { id: assure.id } as Assure;
    fait.acteMedical = { id: acte.id } as ActeMedical;
    fait.prestataire = prestataire ? ({ id: prestataire.id } as Prestataire) : null;
    fait.date = source.date_reglement;
    fait.exercice = extraireExercice(source.date_reglement);
    fait.mois = extraireMois(source.date_reglement);
    fait.montantPaye = Number(source.montant_paye);

    await repo.save(fait);
    loaded++;
  }
  return loaded;
}

export async function loadFacturesPrestataires(sources: FactureSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(FaitFacturePrestataire);
  let loaded = 0;

  for (const source of sources) {
    const prestataire = await findOrCreatePrestataire(source.nom_prestataire, source.code_categorie_prestataire);

    let fait = await repo
      .createQueryBuilder('f')
      .where('f.prestataire_id = :prestataireId', { prestataireId: prestataire.id })
      .andWhere('f.date_depot = :dateDepot', { dateDepot: source.date_depot })
      .andWhere('f.montant = :montant', { montant: source.montant })
      .getOne();

    const statut = calculerStatutFacture(source.date_depot, source.date_reglement);

    if (!fait) {
      fait = repo.create();
      fait.prestataire = prestataire;
      fait.dateDepot = source.date_depot;
      fait.montant = Number(source.montant);
    }
    fait.dateReglement = source.date_reglement;
    fait.statut = statut;

    await repo.save(fait);
    loaded++;
  }
  return loaded;
}
