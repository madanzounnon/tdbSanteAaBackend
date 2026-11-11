import { Request, Response, Router } from 'express';
import { AppDataSource } from '../../data-source';

// /api/journal-connexions — journal de sécurité (table auth_journal) :
// connexions, échecs, déconnexions, mots de passe, actions d'administration
// sur les comptes. Privilège JOURNAL_CONNEXIONS (contrôlé dans app.ts).

const router = Router();

// Familles d'événements proposées en filtre.
const FAMILLES: Record<string, string[]> = {
  CONNEXIONS: ['CONNEXION', 'DECONNEXION'],
  ECHECS: [
    'ECHEC_MOT_DE_PASSE', 'ECHEC_EMAIL_INCONNU', 'REFUS_COMPTE_INACTIF', 'ECHEC_CODE', 'CODE_TENTATIVES_EPUISEES',
    'COMPTE_VERROUILLE', 'REFUS_COMPTE_VERROUILLE',
  ],
  MOTS_DE_PASSE: ['MOT_DE_PASSE_CHANGE', 'MOT_DE_PASSE_REINITIALISE', 'OUBLI_CODE_ENVOYE', 'OUBLI_EMAIL_INCONNU', 'MDP_REINITIALISE_ADMIN'],
  ADMINISTRATION: ['COMPTE_CREE', 'COMPTE_MODIFIE', 'COMPTE_ACTIVE', 'COMPTE_DESACTIVE', 'COMPTE_DEBLOQUE'],
};

const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const taille = Math.min(200, Math.max(1, Number(req.query.taille) || 25));
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? `%${req.query.q.trim().toLowerCase()}%` : null;
    const famille = FAMILLES[String(req.query.famille)] ?? null;
    const utilisateurId = Number(req.query.utilisateur) > 0 ? Number(req.query.utilisateur) : null;
    const du = date(req.query.du);
    const au = date(req.query.au);

    // $1 recherche, $2 famille, $3 utilisateur, $4 du, $5 au
    const filtre = `
      ($1::text IS NULL OR lower(coalesce(u.nom, '') || ' ' || coalesce(u.prenom, '') || ' ' || coalesce(u.email, '') || ' ' || coalesce(j.email, '') || ' ' || coalesce(j.ip, '')) LIKE $1)
      AND ($2::text[] IS NULL OR j.evenement = ANY($2::text[]))
      AND ($3::int IS NULL OR j.utilisateur_id = $3)
      AND ($4::date IS NULL OR j.cree_le >= $4::date)
      AND ($5::date IS NULL OR j.cree_le < $5::date + 1)`;
    const params = [q, famille, utilisateurId, du, au];

    const [{ total }] = await AppDataSource.query(
      `SELECT COUNT(*)::int AS total FROM auth_journal j LEFT JOIN utilisateur u ON u.id = j.utilisateur_id WHERE ${filtre}`,
      params,
    );
    const pages = Math.max(1, Math.ceil(total / taille));
    const p = Math.min(page, pages);
    const donnees = await AppDataSource.query(
      `SELECT j.id, j.evenement, j.email, j.ip, j.cree_le, j.utilisateur_id,
              u.nom, u.prenom, u.email AS email_compte
         FROM auth_journal j
         LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
        WHERE ${filtre}
        ORDER BY j.cree_le DESC, j.id DESC
        LIMIT $6 OFFSET $7`,
      [...params, taille, (p - 1) * taille],
    );
    // Indicateurs (indépendants des filtres).
    const [stats] = await AppDataSource.query(
      `SELECT COUNT(*) FILTER (WHERE evenement = 'CONNEXION' AND cree_le >= current_date)::int AS connexions_jour,
              COUNT(DISTINCT utilisateur_id) FILTER (WHERE evenement = 'CONNEXION' AND cree_le >= now() - interval '7 days')::int AS utilisateurs_7j,
              COUNT(*) FILTER (WHERE evenement = ANY($1::text[]) AND cree_le >= now() - interval '7 days')::int AS echecs_7j,
              COUNT(*) FILTER (WHERE evenement = ANY($2::text[]) AND cree_le >= now() - interval '30 days')::int AS actions_admin_30j
         FROM auth_journal`,
      [FAMILLES.ECHECS, FAMILLES.ADMINISTRATION],
    );
    res.json({ donnees, total, page: p, taille, pages, stats });
  } catch (err) {
    console.error('[JOURNAL]', err);
    res.status(500).json({ error: 'Erreur interne du serveur' });
  }
});

export default router;
