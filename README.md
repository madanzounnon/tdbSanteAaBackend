# TDB Santé — API

API Node.js / Express / TypeORM / PostgreSQL alimentant le tableau de bord
de la Branche Santé (voir le cahier d'indicateurs TDB Santé v1.0).

## Structure

```
src/
  entities/        Entités TypeORM (dimensions + faits, modèle en étoile)
  migrations/       Migrations SQL (dont la vue matérialisée mv_sp_portefeuille)
  modules/          1 dossier par module du cahier (service + controller + routes)
    vue-executive/
    chiffre-affaires/
    sinistralite/
    prestataires/
    regularisation/
    top-contrats/
  data-source.ts    Configuration TypeORM / PostgreSQL
  app.ts            Assemblage des routeurs Express
  server.ts         Point d'entrée
```

## Démarrage

1. `cp .env.example .env` puis renseigner les identifiants PostgreSQL
2. `npm install`
3. Générer le schéma des tables de dimensions/faits via TypeORM CLI
   (`typeorm migration:generate`) à partir des entités, puis :
   `npm run migration:run` (crée notamment `mv_sp_portefeuille`)
4. `npm run dev`

## Rafraîchissement de la vue matérialisée

`mv_sp_portefeuille` centralise le calcul du S/P (formule unique, cf. cahier
§4.1). À rafraîchir après chaque cycle ETL :
`npm run refresh:mv` — à planifier en cron juste après les jobs
de chargement mensuels/nocturnes.

## ETL

```
src/etl/
  config/source-pool.ts   Connexion au(x) système(s) opérationnel(s) source
  extractors/              1 fichier par table source (contrats, sinistres, factures...)
  transformers/             Mapping référentiels + calculs (tranche de prime, statut facture...)
  loaders/                  Upsert dimensions (SCD1) / insertion faits (incrémental)
  jobs/                     daily / monthly / quarterly — alignés sur le §8.1 du cahier
  scheduler.ts               node-cron : orchestre les 3 fréquences en un seul process
  utils/logger.ts            Journal etl_log (succès/échec, volumes, erreurs)
  utils/watermark.ts         Date de la dernière extraction réussie par job (incrémental)
```

**Adapter avant mise en production** :
- Les requêtes dans `extractors/*.ts` supposent un schéma source type
  (`contrats`, `sinistres`, `factures_prestataires`, `encaissements`,
  `regularisations`, `referentiel_apporteurs`) avec une colonne `maj_le`
  pour l'extraction incrémentale. À renommer selon votre système réel.
- Un compte **lecture seule** dédié côté source est recommandé (`SRC_DB_USER`).

**Exécution** :
- Manuelle / test : `npm run etl:daily`, `npm run etl:monthly`, `npm run etl:quarterly`
- Production : soit `npm run etl:scheduler` (process persistant avec node-cron),
  soit chaque job lancé séparément par cron système / Task Scheduler —
  au choix de l'équipe infra.
- Chaque exécution est tracée dans la table `etl_log` (statut, volumes, erreur).

## Endpoints principaux

| Module | Endpoint | KPI du cahier |
|---|---|---|
| Vue Exécutive | `GET /api/vue-executive/synthese?exercice=` | Les 6 cartes de synthèse DG |
| Chiffre d'Affaires | `GET /api/chiffre-affaires/kpis` `/par-canal` `/par-tranche` | §3 |
| Sinistralité | `GET /api/sinistralite/sp-portefeuille` `/par-nature-acte` `/sp-mensuel` | §4 |
| Prestataires | `GET /api/prestataires/factures-impayees` `/performance` | §5 |
| Régularisation | `GET /api/regularisation/polices-critiques` `/montants` `/par-canal` | §6 |
| Top Contrats | `GET /api/top-contrats/par-prime` `/par-sinistralite` | §7 |
