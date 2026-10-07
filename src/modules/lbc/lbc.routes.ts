import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RequestHandler, Router } from 'express';
import multer from 'multer';
import * as c from './lbc.controller';
import { DOSSIER_PIECES } from './declarations.service';

// Scans des pièces complémentaires : stockés sur disque (LBC_UPLOAD_DIR),
// sous un nom aléatoire — le nom d'origine n'est conservé qu'en base.
fs.mkdirSync(DOSSIER_PIECES, { recursive: true });
const TYPES_ACCEPTES = /^(application\/pdf|image\/(jpeg|png|tiff|gif|webp|bmp))$/;
const upload = multer({
  storage: multer.diskStorage({
    destination: DOSSIER_PIECES,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, TYPES_ACCEPTES.test(file.mimetype)),
});

// Erreurs multer (taille dépassée...) renvoyées en 400 JSON plutôt qu'en
// page d'erreur Express.
const recevoirPiece: RequestHandler = (req, res, next) =>
  upload.single('fichier')(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? 'Fichier trop volumineux (15 Mo maximum)'
        : (err as Error).message;
      res.status(400).json({ error: message });
      return;
    }
    next();
  });

const router = Router();

// Référentiels de libellés (indices CENTIF, statuts, branches, qualités)
router.get('/catalogue', c.catalogue);

// Paramètres (seuils, exclusions, organisme déclarant, URL des API)
router.get('/parametres', c.getParametres);
router.put('/parametres', c.updateParametres);

// Répertoire des structures de confiance (white-list)
router.get('/structures-confiance', c.listStructures);
router.get('/structures-confiance/clients', c.rechercherClients);
router.post('/structures-confiance', c.createStructure);
router.put('/structures-confiance/:id', c.updateStructure);
router.delete('/structures-confiance/:id', c.deleteStructure);

// Répertoire des pays à risque (GAFI)
router.get('/pays-risque', c.listPays);
router.post('/pays-risque/synchroniser', c.synchroniserPays);
router.post('/pays-risque', c.savePays);
router.put('/pays-risque/:code', c.savePays);
router.delete('/pays-risque/:code', c.deletePays);

// Répertoire des personnes sous contrôle (PPE, PEE, sanctions...)
router.get('/personnes-surveillees', c.listPersonnes);
router.post('/personnes-surveillees/synchroniser', c.synchroniserPersonnes);
router.post('/personnes-surveillees', c.createPersonne);
router.put('/personnes-surveillees/:id', c.updatePersonne);
router.delete('/personnes-surveillees/:id', c.deletePersonne);

// Opérations : état du chargement, chargement à la demande, détection
router.get('/operations/etat', c.etatOperations);
router.post('/operations/synchroniser', c.synchroniserOperations);
// GET /api/lbc/operations-suspectes?du=2026-01-01&au=2026-03-31&branche=20&sens=ENTREE&inclureEcartees=true
router.get('/operations-suspectes', c.operationsSuspectes);
router.post('/operations-suspectes/ecarter', c.ecarterOperations);
router.post('/operations-suspectes/retablir', c.retablirOperations);

// Déclarations de soupçon
router.get('/declarations', c.listDeclarations);
router.post('/declarations', c.createDeclaration);
router.get('/declarations/:id', c.getDeclaration);
router.put('/declarations/:id', c.updateDeclaration);
router.patch('/declarations/:id/statut', c.updateStatutDeclaration);
router.delete('/declarations/:id', c.deleteDeclaration);
router.get('/declarations/:id/pdf', c.pdfDeclaration);
router.post('/declarations/:id/pieces', recevoirPiece, c.uploadPiece);
router.get('/declarations/:id/pieces/:pieceId', c.getPiece);
router.delete('/declarations/:id/pieces/:pieceId', c.deletePiece);

// Éditions
router.get('/editions/declarations', c.editionDeclarations);
router.get('/editions/operations-cibles', c.editionOperationsCibles);
router.get('/editions/personnes-soupconnees', c.editionPersonnes);

export default router;
