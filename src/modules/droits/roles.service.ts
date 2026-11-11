import { AppDataSource } from '../../data-source';
import { CODES_PRIVILEGES } from './privileges';
import { ErreurDroits, verifierAdministrateurRestant } from './droits.service';

// Rôles : création, modification (nom, description, privilèges),
// suppression. Le rôle Administrateur (systeme) détient toujours tous les
// privilèges : seul son descriptif est modifiable et il ne peut être supprimé.

const texte = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export async function listPrivileges() {
  return AppDataSource.query(`SELECT code, libelle, groupe, description FROM privilege ORDER BY ordre`);
}

export async function listRoles() {
  return AppDataSource.query(
    `SELECT r.id, r.nom, r.description, r.tous_privileges, r.systeme, r.cree_par, r.cree_le, r.modifie_le,
            CASE WHEN r.tous_privileges THEN (SELECT array_agg(code ORDER BY ordre) FROM privilege)
                 ELSE COALESCE((SELECT array_agg(rp.privilege_code ORDER BY p.ordre)
                                  FROM role_privilege rp JOIN privilege p ON p.code = rp.privilege_code
                                 WHERE rp.role_id = r.id), '{}') END AS privileges,
            (SELECT COUNT(*)::int FROM utilisateur_role ur JOIN utilisateur u ON u.id = ur.utilisateur_id
              WHERE ur.role_id = r.id AND u.actif) AS nb_utilisateurs,
            COALESCE((SELECT json_agg(json_build_object('id', u.id, 'nom', u.nom, 'prenom', u.prenom, 'actif', u.actif)
                                      ORDER BY lower(u.nom))
                        FROM utilisateur_role ur JOIN utilisateur u ON u.id = ur.utilisateur_id
                       WHERE ur.role_id = r.id), '[]') AS utilisateurs
       FROM role r
      ORDER BY r.systeme DESC, lower(r.nom)`,
  );
}

const getRole = async (id: number) => (await listRoles()).find((r: any) => r.id === id) ?? null;

const valider = (b: any) => {
  const nom = texte(b?.nom, 80);
  if (!nom) throw new ErreurDroits('Le nom du rôle est obligatoire.');
  const privileges = Array.isArray(b?.privileges) ? [...new Set(b.privileges.map(String))] as string[] : [];
  const inconnus = privileges.filter((c) => !CODES_PRIVILEGES.includes(c));
  if (inconnus.length) throw new ErreurDroits(`Privilège(s) inconnu(s) : ${inconnus.join(', ')}`);
  return { nom, description: texte(b?.description, 500), privileges };
};

const nomDejaPris = (err: any) => err?.code === '23505';

export async function createRole(body: any, par: string) {
  const v = valider(body);
  try {
    const id = await AppDataSource.transaction(async (m) => {
      const [{ id }] = await m.query(
        `INSERT INTO role (nom, description, cree_par) VALUES ($1, $2, $3) RETURNING id`,
        [v.nom, v.description, par],
      );
      for (const code of v.privileges) {
        await m.query(`INSERT INTO role_privilege (role_id, privilege_code) VALUES ($1, $2)`, [id, code]);
      }
      return id as number;
    });
    return getRole(id);
  } catch (err) {
    if (nomDejaPris(err)) throw new ErreurDroits('Un rôle porte déjà ce nom.', 409);
    throw err;
  }
}

export async function updateRole(id: number, body: any) {
  const v = valider(body);
  try {
    const trouve = await AppDataSource.transaction(async (m) => {
      const [role] = await m.query(`SELECT * FROM role WHERE id = $1 FOR UPDATE`, [id]);
      if (!role) return false;
      await m.query(`UPDATE role SET nom = $2, description = $3, modifie_le = now() WHERE id = $1`, [id, v.nom, v.description]);
      if (!role.tous_privileges) {
        await m.query(`DELETE FROM role_privilege WHERE role_id = $1`, [id]);
        for (const code of v.privileges) {
          await m.query(`INSERT INTO role_privilege (role_id, privilege_code) VALUES ($1, $2)`, [id, code]);
        }
      }
      await verifierAdministrateurRestant(m);
      return true;
    });
    return trouve ? getRole(id) : null;
  } catch (err) {
    if (nomDejaPris(err)) throw new ErreurDroits('Un rôle porte déjà ce nom.', 409);
    throw err;
  }
}

export async function deleteRole(id: number) {
  return AppDataSource.transaction(async (m) => {
    const [role] = await m.query(`SELECT * FROM role WHERE id = $1`, [id]);
    if (!role) return null;
    if (role.systeme) throw new ErreurDroits('Le rôle Administrateur ne peut pas être supprimé.');
    await m.query(`DELETE FROM role WHERE id = $1`, [id]);
    await verifierAdministrateurRestant(m);
    return { ok: true };
  });
}
