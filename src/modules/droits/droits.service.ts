import { NextFunction, Request, Response } from 'express';
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../data-source';
import { PRIVILEGES, PRIVILEGES_ADMIN } from './privileges';
// Type seul (Request.utilisateur déclaré dans le middleware d'authentification),
// pour les scripts ts-node qui ne chargent pas le middleware.
import type {} from '../auth/auth.middleware';

// Droits d'accès : privilèges d'un utilisateur (union de ses rôles) et
// contrôle sur les routes de l'API.

export class ErreurDroits extends Error {
  constructor(message: string, public statut = 400) {
    super(message);
  }
}

type Executant = Pick<EntityManager, 'query'>;

// Recopie le catalogue du code vers la table privilege (démarrage de l'API).
export async function synchroniserCatalogue(): Promise<void> {
  await AppDataSource.transaction(async (m) => {
    for (const [i, p] of PRIVILEGES.entries()) {
      await m.query(
        `INSERT INTO privilege (code, libelle, groupe, description, ordre) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO UPDATE
           SET libelle = EXCLUDED.libelle, groupe = EXCLUDED.groupe, description = EXCLUDED.description, ordre = EXCLUDED.ordre`,
        [p.code, p.libelle, p.groupe, p.description, i],
      );
    }
    await m.query(`DELETE FROM privilege WHERE NOT (code = ANY($1::text[]))`, [PRIVILEGES.map((p) => p.code)]);
  });
}

// Privilèges effectifs d'un utilisateur : union de ses rôles ; un rôle
// « tous privilèges » donne tout le catalogue.
export async function droitsUtilisateur(
  utilisateurId: number,
  ex: Executant = AppDataSource,
): Promise<{ roles: { id: number; nom: string }[]; privileges: string[] }> {
  const roles = await ex.query(
    `SELECT r.id, r.nom, r.tous_privileges
       FROM utilisateur_role ur JOIN role r ON r.id = ur.role_id
      WHERE ur.utilisateur_id = $1
      ORDER BY lower(r.nom)`,
    [utilisateurId],
  );
  const privileges: string[] = roles.some((r: any) => r.tous_privileges)
    ? (await ex.query(`SELECT code FROM privilege ORDER BY ordre`)).map((r: any) => r.code)
    : (
        await ex.query(
          `SELECT DISTINCT p.code, p.ordre
             FROM utilisateur_role ur
             JOIN role_privilege rp ON rp.role_id = ur.role_id
             JOIN privilege p ON p.code = rp.privilege_code
            WHERE ur.utilisateur_id = $1
            ORDER BY p.ordre`,
          [utilisateurId],
        )
      ).map((r: any) => r.code);
  return { roles: roles.map((r: any) => ({ id: r.id, nom: r.nom })), privileges };
}

// Garde-fou : au moins un compte actif doit conserver la gestion des
// utilisateurs ET des rôles. À appeler dans la transaction d'une
// modification (rôle, attribution, désactivation) avant validation.
export async function verifierAdministrateurRestant(ex: Executant): Promise<void> {
  const [{ n }] = await ex.query(
    `SELECT COUNT(*)::int AS n
       FROM utilisateur u
      WHERE u.actif
        AND (
          EXISTS (SELECT 1 FROM utilisateur_role ur JOIN role r ON r.id = ur.role_id
                   WHERE ur.utilisateur_id = u.id AND r.tous_privileges)
          OR (SELECT COUNT(DISTINCT rp.privilege_code)
                FROM utilisateur_role ur JOIN role_privilege rp ON rp.role_id = ur.role_id
               WHERE ur.utilisateur_id = u.id AND rp.privilege_code = ANY($1::text[])) = $2
        )`,
    [PRIVILEGES_ADMIN, PRIVILEGES_ADMIN.length],
  );
  if (n < 1) {
    throw new ErreurDroits(
      "Opération refusée : au moins un compte actif doit garder la gestion des utilisateurs et des rôles (rôle Administrateur, par exemple).",
      409,
    );
  }
}

const refuser = (res: Response) =>
  res.status(403).json({ error: "Vous n'avez pas les droits nécessaires pour cette action.", code: 'ACCES_REFUSE' });

export const aUnDe = (req: Request, codes: readonly string[]) =>
  !!req.utilisateur && codes.some((c) => req.utilisateur!.privileges.includes(c));

// Exige au moins un des privilèges indiqués.
export const exiger =
  (...codes: string[]) =>
  (req: Request, res: Response, next: NextFunction) =>
    aUnDe(req, codes) ? next() : refuser(res);

// Règles par méthode et chemin (relatif au point de montage) : la première
// règle qui correspond s'applique ; aucune règle = accès refusé.
export interface Regle {
  methodes?: string[]; // GET, POST... ; absent = toutes
  chemin: RegExp;
  privileges: string[]; // au moins un ; [] = tout utilisateur connecté
}

export const selonRegles = (regles: Regle[]) => (req: Request, res: Response, next: NextFunction) => {
  const regle = regles.find((r) => (!r.methodes || r.methodes.includes(req.method)) && r.chemin.test(req.path));
  if (!regle) return refuser(res);
  if (!regle.privileges.length || aUnDe(req, regle.privileges)) return next();
  return refuser(res);
};
