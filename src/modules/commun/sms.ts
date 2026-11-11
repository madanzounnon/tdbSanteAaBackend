// Envoi de SMS via la passerelle Wirepick (Bénin / Togo), configurée dans
// le .env : WIREPICK_API_KEY, WIREPICK_SENDER_ID, WIREPICK_BASE_URL (option).

export const smsConfigure = () => !!process.env.WIREPICK_API_KEY && !!process.env.WIREPICK_SENDER_ID;

// Numéro au format international sans "+" (ex. 2290197000000). Un numéro
// béninois saisi sans indicatif (8 ou 10 chiffres) reçoit le préfixe 229.
export const normaliserTelephone = (brut: string): string => {
  let n = brut.replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.length === 8 || n.length === 10) n = `229${n}`;
  return n.replace(/\D/g, '');
};

export const telephoneValide = (brut: string) => /^\d{11,15}$/.test(normaliserTelephone(brut));

export const envoyerSms = async (telephone: string, texte: string): Promise<string> => {
  if (!smsConfigure()) throw new Error('SMS non configuré (WIREPICK_API_KEY / WIREPICK_SENDER_ID manquants)');
  const base = process.env.WIREPICK_BASE_URL || 'https://api.wirepick.com/httpsms';
  const reponse = await fetch(`${base}/sendsms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', wpkKey: process.env.WIREPICK_API_KEY! },
    body: JSON.stringify({
      phone: normaliserTelephone(telephone),
      text: texte,
      from: process.env.WIREPICK_SENDER_ID,
      clmsgid: `TDB-${Date.now()}`,
      flash: 'N',
      dlr: 'Y',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const corps = await reponse.text();
  if (!reponse.ok) throw new Error(`Passerelle SMS : HTTP ${reponse.status} ${corps.slice(0, 200)}`);
  let donnees: any = null;
  try {
    donnees = JSON.parse(corps);
  } catch {
    // réponse non JSON : on garde le texte brut comme identifiant
  }
  // Accepté par la passerelle : on conserve l'identifiant et le statut
  // renvoyés (la remise effective est suivie par Wirepick).
  const message = donnees?.messages?.[0];
  return message ? `${message.msgid ?? '?'} (${message.status ?? 'statut inconnu'})` : corps.slice(0, 80);
};
