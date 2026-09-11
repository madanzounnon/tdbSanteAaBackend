import { AppDataSource } from '../../data-source';
import { FaitPrime } from '../../entities/fait-prime.entity';
import { FaitSinistre } from '../../entities/fait-sinistre.entity';
import { FaitFacturePrestataire } from '../../entities/fait-facture-prestataire.entity';
import { Police } from '../../entities/police.entity';
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

    const fait = repo.create({
      police: { id: policeId } as Police,
      assure: { id: assure.id },
      acteMedical: { id: acte.id },
      prestataire: prestataire ? { id: prestataire.id } : null,
      date: source.date_reglement,
      exercice: extraireExercice(source.date_reglement),
      mois: extraireMois(source.date_reglement),
      montantPaye: Number(source.montant_paye),
    });

    // Fait immuable une fois réglé : simple insertion, pas d'upsert.
    // La déduplication est assurée en amont par le watermark d'extraction.
    await repo.insert(fait);
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
