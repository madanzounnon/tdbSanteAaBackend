import { AppDataSource } from '../../data-source';
import { Canal } from '../../entities/canal.entity';
import { Apporteur } from '../../entities/apporteur.entity';
import { Police } from '../../entities/police.entity';
import { Prestataire } from '../../entities/prestataire.entity';
import { ActeMedical, NatureActe } from '../../entities/acte-medical.entity';
import { Assure } from '../../entities/assure.entity';
import { TypeAvenant } from '../../entities/type-avenant.entity';
import { CanalSource } from '../extractors/canal.extractor';
import { ApporteurSource } from '../extractors/apporteur.extractor';
import { PoliceSource } from '../extractors/police.extractor';
import { TypeAvenantSource } from '../extractors/type-avenant.extractor';
import { transformCanal, transformApporteur, transformPolice, transformTypeAvenant, transformCategoriePrestataire } from '../transformers/dimensions.transformer';

// Toutes les dimensions sont chargées en SCD1 (écrasement simple) :
// on privilégie la valeur la plus récente, sans conserver l'historique
// des changements. À faire évoluer en SCD2 si la DG a besoin de
// retracer l'historique tarifaire d'une police avenant par avenant.

const canauxCache = new Map<string, Canal>();
const apporteursCache = new Map<string, Apporteur>();
const typesAvenantCache = new Map<string, TypeAvenant>();

export async function loadTypesAvenant(sources: TypeAvenantSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(TypeAvenant);
  let loaded = 0;
  for (const source of sources) {
    const data = transformTypeAvenant(source);
    let typeAvenant = await repo.findOneBy({ code: data.code });
    if (!typeAvenant) {
      typeAvenant = repo.create(data);
    } else {
      typeAvenant.libelle = data.libelle;
      typeAvenant.nature = data.nature;
    }
    typeAvenant = await repo.save(typeAvenant);
    typesAvenantCache.set(data.code, typeAvenant);
    loaded++;
  }
  return loaded;
}

export function getTypeAvenantByCode(code: string | null): TypeAvenant | null {
  if (!code) return null;
  return typesAvenantCache.get(code) ?? null;
}

export async function loadCanaux(sources: CanalSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(Canal);
  let loaded = 0;
  for (const source of sources) {
    const data = transformCanal(source);
    let canal = await repo.findOneBy({ nom: data.nom });
    if (!canal) {
      canal = repo.create({ nom: data.nom, typeCanal: data.typeCanal });
    } else {
      canal.typeCanal = data.typeCanal;
    }
    canal = await repo.save(canal);
    canauxCache.set(data.codeSource, canal);
    loaded++;
  }
  return loaded;
}

export async function loadApporteurs(sources: ApporteurSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(Apporteur);
  let loaded = 0;
  for (const source of sources) {
    const data = transformApporteur(source);
    let apporteur = await repo.findOneBy({ nom: data.nom });
    if (!apporteur) {
      apporteur = repo.create({ nom: data.nom, typeApporteur: data.typeApporteur });
    } else {
      apporteur.typeApporteur = data.typeApporteur;
    }
    apporteur = await repo.save(apporteur);
    apporteursCache.set(data.codeSource, apporteur);
    loaded++;
  }
  return loaded;
}

export async function loadPolices(sources: PoliceSource[]): Promise<number> {
  const repo = AppDataSource.getRepository(Police);
  let loaded = 0;
  for (const source of sources) {
    const data = transformPolice(source);
    const canal = canauxCache.get(data.codeApporteur);
    if (!canal) {
      console.warn(`[ETL] Canal introuvable pour la police ${data.numeroPolice} (code ${data.codeApporteur}) — ligne ignorée`);
      continue;
    }

    let police = await repo.findOneBy({ numeroPolice: data.numeroPolice });
    if (!police) {
      police = repo.create();
      police.numeroPolice = data.numeroPolice;
    }
    police.souscripteur = data.souscripteur;
    police.statutSouscripteur = data.statutSouscripteur;
    police.statutPolice = data.statutPolice;
    police.dateEffet = data.dateEffet;
    police.dateEcheance = data.dateEcheance;
    police.canal = canal;
    // Apporteur commercial non garanti en source (~33% de couverture) —
    // on ne bloque pas le chargement de la police en son absence.
    police.apporteur = data.codeApporteurCommercial
      ? apporteursCache.get(data.codeApporteurCommercial) ?? null
      : null;

    await repo.save(police);
    loaded++;
  }
  return loaded;
}

export async function findOrCreateAssure(
  policeId: string,
  matricule: string,
  typeAssure: Assure['typeAssure'],
  primeAnnuelle: number,
): Promise<Assure> {
  const repo = AppDataSource.getRepository(Assure);
  // Le matricule sert de clé naturelle côté source, mais n'est volontairement
  // pas stocké tel quel dans dim_assure (anonymisation) — seul le rattachement
  // police + type suffit aux agrégats du cahier (§3.4).
  let assure = await repo
    .createQueryBuilder('a')
    .where('a.police_id = :policeId', { policeId })
    .andWhere('a.type_assure = :typeAssure', { typeAssure })
    .getOne();

  if (!assure) {
    assure = repo.create({ typeAssure, primeAnnuelle });
    assure.police = { id: policeId } as Police;
    assure = await repo.save(assure);
  }
  return assure;
}

export async function findOrCreatePrestataire(nom: string, categorieSource: string): Promise<Prestataire> {
  const repo = AppDataSource.getRepository(Prestataire);
  let prestataire = await repo.findOneBy({ nom });
  if (!prestataire) {
    prestataire = repo.create({
      nom,
      categorie: transformCategoriePrestataire(categorieSource),
      conventionne: true,
    });
    prestataire = await repo.save(prestataire);
  }
  return prestataire;
}

export async function findOrCreateActeMedical(nature: NatureActe): Promise<ActeMedical> {
  const repo = AppDataSource.getRepository(ActeMedical);
  let acte = await repo.findOneBy({ nature });
  if (!acte) {
    acte = repo.create({ nature });
    acte = await repo.save(acte);
  }
  return acte;
}

export async function getPoliceIdByNumero(numeroPolice: string): Promise<string | null> {
  const repo = AppDataSource.getRepository(Police);
  const police = await repo.findOneBy({ numeroPolice });
  return police ? police.id : null;
}
