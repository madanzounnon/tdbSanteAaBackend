import { querySource } from '../config/source-pool';

export interface TypeAvenantSource {
  code: string;
  libelle: string;
  nature: string | null;
}

// Référentiel générique (toutes branches, ~52 lignes) — pas de filtre
// branche Santé, c'est une table de paramétrage transverse à ORASS.
export async function extractTypesAvenant(): Promise<TypeAvenantSource[]> {
  const { rows } = await querySource<TypeAvenantSource>(`
    SELECT
      TO_CHAR(codtypav) AS "code",
      libtypav AS "libelle",
      natuaven AS "nature"
    FROM type_avenant
  `);
  return rows;
}
