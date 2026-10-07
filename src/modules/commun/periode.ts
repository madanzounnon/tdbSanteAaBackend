// Bornes temporelles d'un exercice pour le CA acquis (fonction SQL
// prime_acquise, migration 1700000000017). Dates en AAAA-MM-JJ, heure
// locale du serveur (Africa/Porto-Novo).

const deux = (n: number) => String(n).padStart(2, '0');

export const aujourdhui = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
};

export const exerciceCourant = (): number => new Date().getFullYear();

export const debutExercice = (exercice: number): string => `${exercice}-01-01`;
export const finExercice = (exercice: number): string => `${exercice}-12-31`;

// Date d'arrêté du CA "à date" : 31/12 pour un exercice clos, aujourd'hui
// pour l'exercice en cours (un exercice futur donne une période vide).
export const dateArrete = (exercice: number): string => {
  const fin = finExercice(exercice);
  const jour = aujourdhui();
  return fin < jour ? fin : jour;
};

// Même jour calendaire un an plus tôt (comparaison N / N-1 à date) ;
// le 29/02 devient le 28/02.
export const memeDateAnneePrecedente = (date: string): string => {
  const [a, m, j] = date.split('-').map(Number);
  return `${a - 1}-${deux(m)}-${deux(m === 2 && j === 29 ? 28 : j)}`;
};

// Mois écoulés de l'exercice à la date d'arrêté (12 pour un exercice clos).
export const moisEcoule = (exercice: number): number => {
  const courant = exerciceCourant();
  if (exercice < courant) return 12;
  if (exercice > courant) return 0;
  return new Date().getMonth() + 1;
};
