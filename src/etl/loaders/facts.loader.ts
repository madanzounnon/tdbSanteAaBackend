import { AppDataSource } from '../../data-source';
import { FaitPrime } from '../../entities/fait-prime.entity';
import { FaitSinistre } from '../../entities/fait-sinistre.entity';
import { FaitFacturePrestataire } from '../../entities/fait-facture-prestataire.entity';
import { FaitRegularisation } from '../../entities/fait-regularisation.entity';
import { Police } from '../../entities/police.entity';
import { Canal } from '../../entities/canal.entity';
import { PrimeSource } from '../extractors/prime.extractor';
import { SinistreSource } from '../extractors/sinistre.extractor';
import { FactureSource } from '../extractors/facture-prestataire.extractor';
import { RegularisationSource } from '../extractors/regularisation.extractor';
import { transformNatureActe, transformTypeSouscription, calculerStatutFacture, extraireExercice, extraireMois } from '../transformers/facts.transformer';
import { TypeAssure } from '../../entities/assure.entity';
import { getPoliceIdByNumero, findOrCreateAssure, findOrCreatePrestataire, findOrCreateActeMedical } from './dimensions.loader';

export async function loadPrimes(sources: PrimeSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(FaitPrime);
  let loaded = 0;

  for (const source of sources) {
    const policeId = await getPoliceIdByNumero(source.numero_police);
    if (!policeId) {
      console.warn(`[ETL] Police ${source.numero_police} introuvable — ligne prime ignorée`);
      continue;
    }

    const exercice = extraireExercice(source.date_emission);
    const mois = extraireMois(source.date_emission);

    // Upsert sur (police, exercice, mois) : une émission peut être révisée
    // (avenant en cours de mois) avant d'être définitivement close.
    let fait = await repo
      .createQueryBuilder('f')
      .where('f.police_id = :policeId', { policeId })
      .andWhere('f.exercice = :exercice', { exercice })
      .andWhere('f.mois = :mois', { mois })
      .getOne();

    if (!fait) {
      fait = repo.create();
      fait.police = { id: policeId } as Police;
      fait.exercice = exercice;
      fait.mois = mois;
      fait.date = source.date_emission;
    }
    fait.typeSouscription = transformTypeSouscription(source.type_souscription);
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

    // type_assure (adulte/enfant) n'a aucune source fiable identifiée à ce
    // stade (cf. ambiguïtés dim_assure) — défaut ADULTE en attendant.
    const assure = await findOrCreateAssure(policeId, source.code_assure, TypeAssure.ADULTE, 0);
    const acte = await findOrCreateActeMedical(transformNatureActe(source.famille_prestation));
    const prestataire = await findOrCreatePrestataire(source.nom_prestataire, source.code_prestataire);

    const fait = repo.create({
      police: { id: policeId } as Police,
      assure: { id: assure.id },
      acteMedical: { id: acte.id },
      prestataire: { id: prestataire.id },
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

export async function loadRegularisations(sources: RegularisationSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(FaitRegularisation);
  let loaded = 0;

  for (const source of sources) {
    const policeId = await getPoliceIdByNumero(source.numero_police);
    if (!policeId) {
      console.warn(`[ETL] Police introuvable pour la régularisation ${source.numero_police} — ligne ignorée`);
      continue;
    }

    let fait = await repo
      .createQueryBuilder('f')
      .where('f.police_id = :policeId', { policeId })
      .andWhere('f.exercice = :exercice', { exercice: source.exercice })
      .getOne();

    if (!fait) {
      fait = repo.create();
      fait.police = { id: policeId } as Police;
      fait.canal = { id: source.canal_id } as Canal;
      fait.exercice = source.exercice;
    }
    // montantEncaisse n'est PAS recalculé ici : c'est un fait opérationnel
    // (encaissement réel de l'avenant), pas dérivable de fait_prime/fait_sinistre.
    // On ne touche qu'au montant théorique à régulariser.
    fait.montantARegulariser = Number(source.montant_a_regulariser);

    await repo.save(fait);
    loaded++;
  }
  return loaded;
}
