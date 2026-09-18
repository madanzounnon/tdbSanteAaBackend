import { AppDataSource } from '../../data-source';
import { ObjectifAnnuel } from '../../entities/objectif-annuel.entity';

// CRUD sur les objectifs annuels de CA fixés par la DG (cahier §2.1 —
// "Taux de réalisation = CA YTD / Objectif Annuel × 100"). Saisie
// manuelle, un objectif par exercice.
export class ObjectifsService {
  private repo = AppDataSource.getRepository(ObjectifAnnuel);

  async getAll() {
    return this.repo.find({ order: { exercice: 'ASC' } });
  }

  async getByExercice(exercice: number) {
    return this.repo.findOneBy({ exercice });
  }

  async create(exercice: number, montantCaObjectif: number) {
    const existant = await this.repo.findOneBy({ exercice });
    if (existant) {
      throw new Error(`Un objectif existe déjà pour l'exercice ${exercice}`);
    }
    const objectif = this.repo.create({ exercice, montantCaObjectif });
    return this.repo.save(objectif);
  }

  async update(exercice: number, montantCaObjectif: number) {
    const existant = await this.repo.findOneBy({ exercice });
    if (!existant) {
      return null;
    }
    existant.montantCaObjectif = montantCaObjectif;
    return this.repo.save(existant);
  }

  async delete(exercice: number) {
    const result = await this.repo.delete({ exercice });
    return (result.affected ?? 0) > 0;
  }
}
