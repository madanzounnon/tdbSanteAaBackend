import * as Yup from "yup";

// Message d'erreur renvoyé par l'API d'authentification ({ error }).
export const messageAuth = (err: any, defaut: string): string => {
  if (!err?.response) return "Impossible de joindre le serveur. Vérifiez votre connexion puis réessayez.";
  return err.response.data?.error || defaut;
};

// Même règle que l'API : 8 caractères minimum, au moins une lettre et un chiffre.
export const schemaNouveauMotDePasse = Yup.object({
  nouveauMotDePasse: Yup.string()
    .required("Nouveau mot de passe requis")
    .min(8, "Au moins 8 caractères")
    .max(72, "72 caractères maximum")
    .matches(/[A-Za-z]/, "Au moins une lettre")
    .matches(/\d/, "Au moins un chiffre"),
  confirmation: Yup.string()
    .required("Confirmation requise")
    .oneOf([Yup.ref("nouveauMotDePasse")], "Les mots de passe ne correspondent pas"),
});
