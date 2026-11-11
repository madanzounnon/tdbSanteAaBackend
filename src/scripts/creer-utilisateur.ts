import { AppDataSource } from '../data-source';
import { hacherMotDePasse, motDePasseProvisoire } from '../modules/auth/auth.service';

// Crée un compte (ou réinitialise son mot de passe s'il existe déjà) avec un
// mot de passe provisoire affiché une seule fois. L'utilisateur devra le
// changer à sa première connexion.
//
//   npm run auth:creer-utilisateur -- --email prenom.nom@africaine.bj --nom NOM --prenom Prénom [--telephone ...] [--fonction ...] [--role "Administrateur"] [--sexe M|F]
//
// --role ajoute ce rôle au compte (nom exact, voir la page Rôles). Sans rôle,
// le compte n'a accès à aucun écran.

const args = process.argv.slice(2);
const option = (nom: string) => {
  const i = args.indexOf(`--${nom}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1].trim() : undefined;
};

(async () => {
  const email = option('email');
  const nom = option('nom');
  if (!email || !/^\S+@\S+\.\S+$/.test(email) || !nom) {
    console.error('Usage : npm run auth:creer-utilisateur -- --email <email> --nom <NOM> [--prenom <Prénom>] [--telephone <tél>] [--fonction <fonction>] [--role <nom du rôle>] [--sexe M|F]');
    process.exit(1);
  }

  AppDataSource.setOptions({ logging: false }); // pas de requête (hash) dans la console
  await AppDataSource.initialize();
  const mdp = motDePasseProvisoire();
  const hash = await hacherMotDePasse(mdp);

  const [ligne] = await AppDataSource.query(
    `INSERT INTO utilisateur (nom, prenom, email, telephone, fonction, mot_de_passe_hash, doit_changer_mot_de_passe, sexe)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
     ON CONFLICT (lower(email)) DO UPDATE
        SET mot_de_passe_hash = EXCLUDED.mot_de_passe_hash, doit_changer_mot_de_passe = TRUE, actif = TRUE,
            echecs_connexion = 0, verrouille_jusqu_au = NULL, mot_de_passe_modifie_le = now(), modifie_le = now()
     RETURNING id, (xmax = 0) AS cree`,
    [nom, option('prenom') ?? null, email.toLowerCase(), option('telephone') ?? null, option('fonction') ?? null, hash,
      ['M', 'F'].includes((option('sexe') ?? '').toUpperCase()) ? option('sexe')!.toUpperCase() : null],
  );

  const nomRole = option('role');
  if (nomRole) {
    const [role] = await AppDataSource.query(`SELECT id, nom FROM role WHERE lower(nom) = lower($1)`, [nomRole]);
    if (!role) {
      const existants = await AppDataSource.query(`SELECT nom FROM role ORDER BY nom`);
      console.error(`Rôle inconnu : ${nomRole}. Rôles existants : ${existants.map((x: any) => x.nom).join(', ')}`);
    } else {
      await AppDataSource.query(
        `INSERT INTO utilisateur_role (utilisateur_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [ligne.id, role.id],
      );
    }
  }
  const roles = await AppDataSource.query(
    `SELECT r.nom FROM utilisateur_role ur JOIN role r ON r.id = ur.role_id WHERE ur.utilisateur_id = $1`,
    [ligne.id],
  );

  console.log(`\nCompte ${ligne.cree ? 'créé' : 'existant : mot de passe réinitialisé'} (id ${ligne.id})`);
  console.log(`  Email                 : ${email.toLowerCase()}`);
  console.log(`  Mot de passe provisoire : ${mdp}`);
  console.log(`  Rôles                 : ${roles.map((x: any) => x.nom).join(', ') || 'aucun (aucun écran accessible : ajoutez --role)'}`);
  console.log('À communiquer à l\'utilisateur, qui devra le changer à sa première connexion.\n');
  await AppDataSource.destroy();
})().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
