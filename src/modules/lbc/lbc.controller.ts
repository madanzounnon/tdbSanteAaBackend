import fs from 'fs';
import { Request, Response } from 'express';
import * as referentiels from './referentiels.service';
import * as detection from './detection.service';
import * as declarations from './declarations.service';
import * as editions from './editions.service';
import { genererPdfDeclaration } from './declaration-pdf';
import { CRITERES, INDICES_CENTIF, SIGNAUX, STATUTS_DOSSIER, STATUTS_OPERATION, STATUTS_TRANSMISSION, TYPES_CLIENT } from './catalogue';
import { runLbcJob } from '../../etl/jobs/lbc.job';

// Auteur de l'action, transmis par le frontend (en-tête X-Utilisateur,
// encodé URI pour les accents) — tracé dans l'historique des déclarations.
const utilisateur = (req: Request): string | null => {
  const brut = req.header('x-utilisateur');
  if (!brut) return null;
  try {
    return decodeURIComponent(brut).slice(0, 120);
  } catch {
    return brut.slice(0, 120);
  }
};

const id = (req: Request, nom = 'id') => {
  const n = Number(req.params[nom]);
  if (!Number.isInteger(n) || n <= 0) throw new referentiels.ErreurValidation(`Identifiant invalide : ${req.params[nom]}`);
  return n;
};

const optionnel = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

// Enveloppe commune : ErreurValidation -> 400, résultat null/false -> 404,
// autre erreur -> 500 (journalisée). Un résultat undefined signifie que le
// handler a pris la réponse en charge (flux PDF / fichier, 202, 409).
const traiter = (fn: (req: Request, res: Response) => Promise<unknown>, statut = 200) =>
  async (req: Request, res: Response) => {
    try {
      const resultat = await fn(req, res);
      if (res.headersSent || resultat === undefined) return;
      if (resultat === null || resultat === false) {
        res.status(404).json({ error: 'Élément introuvable' });
        return;
      }
      if (resultat === true) {
        res.status(204).send();
        return;
      }
      res.status(statut).json(resultat);
    } catch (err: any) {
      if (err instanceof referentiels.ErreurValidation) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('[LBC]', err);
      if (!res.headersSent) res.status(500).json({ error: err?.message || 'Erreur interne du module anti-blanchiment' });
    }
  };

// Pagination des répertoires : ?page=1&taille=20&q=texte&actifs=true
// (taille bornée à 100).
const filtreListe = (req: Request): referentiels.FiltreListe => {
  const page = Number(req.query.page);
  const taille = Number(req.query.taille);
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    taille: Number.isInteger(taille) && taille > 0 ? Math.min(taille, 100) : 20,
    q: optionnel(req.query.q),
    actifs: req.query.actifs === 'true',
  };
};

// ------------------------------------------------------------ Catalogue

export const catalogue = traiter(async () => ({
  indices: INDICES_CENTIF,
  criteres: CRITERES,
  signaux: SIGNAUX,
  statuts_operation: STATUTS_OPERATION,
  statuts_transmission: STATUTS_TRANSMISSION,
  statuts_dossier: STATUTS_DOSSIER,
  types_client: TYPES_CLIENT,
  branches: await referentiels.getBranches(),
  qualites: await referentiels.getQualites(),
}));

// ----------------------------------------------------------- Paramètres

export const getParametres = traiter(() => referentiels.getParametres());
export const updateParametres = traiter((req) => referentiels.updateParametres(req.body ?? {}, utilisateur(req)));

// --------------------------------------------- Structures de confiance

export const listStructures = traiter((req) => referentiels.listStructures(filtreListe(req)));
export const createStructure = traiter((req) => referentiels.createStructure(req.body ?? {}, utilisateur(req)), 201);
export const updateStructure = traiter((req) => referentiels.updateStructure(id(req), req.body ?? {}));
export const deleteStructure = traiter((req) => referentiels.deleteStructure(id(req)));
export const rechercherClients = traiter(async (req) => {
  const q = optionnel(req.query.q);
  if (!q || q.length < 2) throw new referentiels.ErreurValidation('Saisir au moins 2 caractères');
  return referentiels.rechercherClients(q);
});

// ------------------------------------------------------- Pays à risque

export const listPays = traiter((req) => referentiels.listPays(filtreListe(req)));
export const savePays = traiter((req) => referentiels.savePays({ ...req.body, code_pays: req.params.code ?? req.body?.code_pays }));
export const deletePays = traiter((req) => referentiels.deletePays(req.params.code));
export const synchroniserPays = traiter(() => referentiels.synchroniserPays());

// ------------------------------------------------- Personnes surveillées

export const listPersonnes = traiter((req) => referentiels.listPersonnes(filtreListe(req)));
export const createPersonne = traiter((req) => referentiels.createPersonne(req.body ?? {}), 201);
export const updatePersonne = traiter((req) => referentiels.updatePersonne(id(req), req.body ?? {}));
export const deletePersonne = traiter((req) => referentiels.deletePersonne(id(req)));
export const synchroniserPersonnes = traiter(() => referentiels.synchroniserPersonnes());

// --------------------------------------------------------- Opérations

let chargementEnCours = false;

export const etatOperations = traiter(async () => ({ ...(await detection.etatChargement()), chargement_en_cours: chargementEnCours }));

// Lance le job ETL LBC à la demande (en plus du passage quotidien du
// scheduler) ; répond tout de suite, l'interface suit l'avancement via
// GET /operations/etat.
export const synchroniserOperations = traiter(async (_req, res) => {
  if (chargementEnCours) {
    res.status(409).json({ error: 'Un chargement est déjà en cours' });
    return;
  }
  chargementEnCours = true;
  runLbcJob()
    .catch((err) => console.error('[LBC] Échec du chargement à la demande', err))
    .finally(() => {
      chargementEnCours = false;
    });
  res.status(202).json({ message: 'Chargement des opérations lancé' });
});

export const operationsSuspectes = traiter(async (req) => {
  const { du, au } = detection.validerPeriode(req.query.du, req.query.au);
  const sens = optionnel(req.query.sens);
  if (sens && sens !== 'ENTREE' && sens !== 'SORTIE') throw new referentiels.ErreurValidation('sens : ENTREE ou SORTIE');
  return detection.detecter({
    du,
    au,
    branche: optionnel(req.query.branche) ? Number(req.query.branche) : null,
    sens: (sens as 'ENTREE' | 'SORTIE') ?? null,
    inclureEcartees: req.query.inclureEcartees === 'true',
    inclureDeclarees: req.query.inclureDeclarees !== 'false',
  });
});

const idsOperations = (req: Request): number[] =>
  (Array.isArray(req.body?.operationIds) ? req.body.operationIds : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);

export const ecarterOperations = traiter((req) =>
  detection.ecarter(idsOperations(req), optionnel(req.body?.commentaire) ?? null, utilisateur(req)));
export const retablirOperations = traiter((req) => detection.retablir(idsOperations(req)));

// -------------------------------------------------------- Déclarations

export const listDeclarations = traiter((req) =>
  declarations.listerDeclarations({
    du: optionnel(req.query.du),
    au: optionnel(req.query.au),
    transmission: optionnel(req.query.transmission),
    dossier: optionnel(req.query.dossier),
    q: optionnel(req.query.q),
  }));
export const getDeclaration = traiter((req) => declarations.lireDeclaration(id(req)));
export const createDeclaration = traiter((req) => declarations.creerDeclaration(req.body ?? {}, utilisateur(req)), 201);
export const updateDeclaration = traiter((req) => declarations.modifierDeclaration(id(req), req.body ?? {}, utilisateur(req)));
export const updateStatutDeclaration = traiter((req) => declarations.changerStatut(id(req), req.body ?? {}, utilisateur(req)));
export const deleteDeclaration = traiter((req) => declarations.supprimerDeclaration(id(req)));

// ?telecharger=1 -> pièce jointe (téléchargement), sinon affichage dans le
// navigateur (impression).
export const pdfDeclaration = traiter(async (req, res) => {
  const d = await declarations.lireDeclaration(id(req));
  if (!d) return null;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${req.query.telecharger ? 'attachment' : 'inline'}; filename="Declaration-soupcon-${d.reference}.pdf"`,
  );
  genererPdfDeclaration(d).pipe(res);
  return undefined;
});

export const uploadPiece = traiter(async (req) => {
  const fichier = (req as any).file;
  if (!fichier) throw new referentiels.ErreurValidation('Aucun fichier reçu : PDF ou image (JPEG, PNG, TIFF...) attendu');
  const piece = await declarations.ajouterPiece(id(req), fichier, optionnel(req.body?.libelle) ?? null, utilisateur(req));
  if (!piece) fs.rm(fichier.path, { force: true }, () => undefined);
  return piece;
}, 201);

export const getPiece = traiter(async (req, res) => {
  const p = await declarations.lirePiece(id(req), id(req, 'pieceId'));
  if (!p || !fs.existsSync(p.cheminComplet)) return null;
  res.setHeader('Content-Type', p.type_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(p.nom_fichier)}`);
  fs.createReadStream(p.cheminComplet).pipe(res);
  return undefined;
});

export const deletePiece = traiter((req) => declarations.supprimerPiece(id(req), id(req, 'pieceId'), utilisateur(req)));

// ------------------------------------------------------------ Éditions

export const editionDeclarations = traiter(async (req) => {
  const { du, au } = detection.validerPeriode(req.query.du, req.query.au);
  return editions.etatDeclarations(du, au, optionnel(req.query.transmission));
});

export const editionOperationsCibles = traiter(async (req) => {
  const { du, au } = detection.validerPeriode(req.query.du, req.query.au);
  return editions.etatOperationsCibles(du, au, optionnel(req.query.branche) ? Number(req.query.branche) : null);
});

export const editionPersonnes = traiter(async (req) => {
  const { du, au } = detection.validerPeriode(req.query.du, req.query.au);
  return editions.etatPersonnesSoupconnees(du, au);
});
