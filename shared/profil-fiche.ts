// Prépare un profil à partir d'une fiche. La création et le dépôt des clés
// n'ont lieu que lorsque l'approbation est exactement vraie. Une clé ne
// ressort jamais dans le profil, le journal ou une erreur. Un second appel
// avec le même magasin ne dépose pas une clé déjà déposée, et le même
// registre ne crée pas deux fois le même profil.

export type PermissionEntite = "aucune" | "lecture" | "ecriture-avec-confirmation";

export type BotPrepare = {
  nom: string;
  domaine: string;
  permissions: Record<string, PermissionEntite>;
  connecteurs: string[];
  niveau_perspicax: string[];
  niveau_autonomie: 0;
};

export type ProfilPrepare = {
  version: 1;
  employe: { nom: string; role: string };
  bots: BotPrepare[];
};

export type ErreurFiche = { code: string; message: string };

export type DemandeProfil = {
  approbation?: boolean;
  cles?: Readonly<Record<string, string>>;
  magasin?: { deposer(entrees: ReadonlyArray<{ nom: string; valeur: string }>): void };
  registre?: { creer(profil: ProfilPrepare): void };
  journal?: { ecrire(message: string): void };
};

export type ResultatProfil =
  | { ok: false; cree: false; profil: null; erreurs: ErreurFiche[] }
  | { ok: true; cree: false; profil: ProfilPrepare; erreurs: [] }
  | { ok: true; cree: true; profil: ProfilPrepare; erreurs: [] };

type Noeud = string | number | Noeud[] | { [cle: string]: Noeud };
type Cadre = {
  indent: number;
  genre: "map" | "seq";
  valeur: { [cle: string]: Noeud } | Noeud[];
  cleEnAttente: string | null;
};

const SECRET_CLE = /(?:^|[_-])(?:api[_-]?key|apikey|password|passwd|token|authorization|access[_-]?key|private[_-]?key|jeton|mot[_-]?de[_-]?passe|secret)$/i;
const FORME_CLE = /(?:sk-|xai-|csk-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[abposr]-|AKIA|AIza|om[dg]_|gsk_|hf_|npm_|sgx_|whsec_|omb_|eyJ[A-Za-z0-9_-]{8,}\.)[A-Za-z0-9._~+/=-]{8,}/i;
const URL_USERINFO = /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;
const ID_SIMPLE = /^[a-z][a-z0-9-]{0,40}$/;
const NIVEAU = /^(organisation|equipe|personnel):(lecture|proposition|ecriture)$/;
const NOM_CLE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const depotsFaits = new WeakMap<object, Set<string>>();
const profilsFaits = new WeakMap<object, Set<string>>();

export function preparerProfilDepuisFiche(fiche: string, demande: DemandeProfil = {}): ResultatProfil {
  const erreurs: ErreurFiche[] = [];
  const sensibles: string[] = [];
  const exactes: string[] = [];
  if (demande.cles) {
    for (const valeur of Object.values(demande.cles)) {
      if (typeof valeur === "string" && valeur.length > 0) {
        exactes.push(valeur);
        if (valeur.length >= 4) sensibles.push(valeur);
      }
    }
  }
  sensibles.sort((a, b) => b.length - a.length);

  const nettoyer = (message: string): string => {
    let propre = message;
    for (const secret of sensibles) {
      if (propre.includes(secret)) propre = propre.split(secret).join("valeur retirée");
    }
    while (FORME_CLE.test(propre)) propre = propre.replace(FORME_CLE, "valeur retirée");
    return propre;
  };

  const ecrire = (message: string) => {
    try {
      demande.journal?.ecrire(nettoyer(message));
    } catch {
      // Le journal ne bloque pas la création et son exception n'est pas recopiée.
    }
  };

  const refuser = (code: string, message: string): ResultatProfil => {
    ecrire("Fiche refusée.");
    return { ok: false, cree: false, profil: null, erreurs: [{ code, message: nettoyer(message) }] };
  };

  const caractereInterdit = (texte: string, autoriseSaut: boolean): boolean => {
    if (/\p{Cf}/u.test(texte)) return true;
    for (let i = 0; i < texte.length; i++) {
      const code = texte.charCodeAt(i);
      if (autoriseSaut && (code === 0x0a || code === 0x0d)) continue;
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
    }
    return false;
  };

  const valeurSecrete = (texte: string): boolean => {
    if (FORME_CLE.test(texte) || URL_USERINFO.test(texte)) return true;
    const basse = texte.toLowerCase();
    if (basse.includes("-----begin ") && basse.includes("private key-----")) return true;
    if (/bearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(texte)) return true;
    for (const candidat of exactes) if (texte === candidat) return true;
    for (const candidat of sensibles) if (texte.includes(candidat)) return true;
    return false;
  };

  const affiche = (valeur: unknown): string =>
    typeof valeur === "string" || typeof valeur === "number" ? String(valeur) : "illisible";

  if (typeof fiche !== "string" || fiche.trim() === "") return refuser("fiche_vide", "La fiche est vide.");
  if (fiche.length > 32768) return refuser("fiche_trop_grande", "La fiche dépasse 32768 caractères.");
  if (caractereInterdit(fiche, true)) return refuser("fiche_interdite", "La fiche contient un caractère interdit.");
  if (valeurSecrete(fiche)) {
    return refuser(
      "secret",
      "La fiche contient un secret. Retirez-le. Une clé se dépose dans le magasin seulement après une approbation explicite.",
    );
  }

  const brut = fiche.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const morceaux = brut.split("\n");
  const lignes: Array<{ n: number; indent: number; texte: string }> = [];
  for (let i = 0; i < morceaux.length; i++) {
    const ligne = morceaux[i] ?? "";
    let indent = 0;
    while (indent < ligne.length && ligne[indent] === " ") indent += 1;
    let texte = ligne.slice(indent);
    let quote: string | null = null;
    let coupe = -1;
    for (let j = 0; j < texte.length; j++) {
      const c = texte[j] ?? "";
      if (quote) {
        if (c === "\\" && quote === '"') {
          j += 1;
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if (c === "#" && (j === 0 || texte[j - 1] === " ")) {
        coupe = j;
        break;
      }
      if (c === "&" || c === "*" || c === "!" || (c === "<" && texte[j + 1] === "<")) {
        return refuser("yaml_invalide", `Ligne ${i + 1} : le YAML accepté refuse les ancres, les alias et les balises.`);
      }
    }
    if (coupe >= 0) texte = texte.slice(0, coupe).trimEnd();
    if (texte.trim() === "") continue;
    lignes.push({ n: i + 1, indent, texte: texte.trim() });
  }
  if (lignes.length === 0) return refuser("fiche_vide", "La fiche est vide.");
  if (lignes.length > 400) return refuser("fiche_trop_grande", "La fiche dépasse 400 lignes.");

  let racine: Noeud | null = null;
  const pile: Cadre[] = [];
  let yamlCassee = false;

  for (const ligne of lignes) {
    if (yamlCassee) break;
    while (pile.length > 0 && (pile[pile.length - 1]?.indent ?? 0) > ligne.indent) pile.pop();
    if (pile.length > 12) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : la fiche est trop imbriquée.` });
      yamlCassee = true;
      break;
    }
    const sommet = pile.length > 0 ? pile[pile.length - 1] ?? null : null;

    if (ligne.texte.startsWith("- ")) {
      const reste = ligne.texte.slice(2).trim();
      if (reste === "" || reste === "|" || reste === ">" || reste.startsWith("|") || reste.startsWith(">")) {
        erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : valeur YAML refusée.` });
        yamlCassee = true;
        break;
      }
      let seq: Noeud[];
      if (sommet && sommet.genre === "seq" && sommet.indent === ligne.indent) {
        seq = sommet.valeur as Noeud[];
      } else if (sommet && sommet.genre === "map" && sommet.cleEnAttente && ligne.indent > sommet.indent) {
        seq = [];
        (sommet.valeur as { [cle: string]: Noeud })[sommet.cleEnAttente] = seq;
        sommet.cleEnAttente = null;
        pile.push({ indent: ligne.indent, genre: "seq", valeur: seq, cleEnAttente: null });
      } else {
        erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
        yamlCassee = true;
        break;
      }

      let cleListe = "";
      let apres: string | null = null;
      let k = 0;
      if (reste.startsWith('"') || reste.startsWith("'")) {
        apres = null;
      } else {
        while (k < reste.length && reste[k] !== ":") k += 1;
        if (reste[k] === ":") {
          const suite = reste.slice(k + 1);
          if (suite === "" || suite.startsWith(" ")) {
            cleListe = reste.slice(0, k).trim();
            apres = suite.trim();
          }
        }
      }
      if (cleListe !== "") {
        const item = Object.create(null) as { [cle: string]: Noeud };
        seq.push(item);
        if (apres === "") {
          pile.push({ indent: ligne.indent + 2, genre: "map", valeur: item, cleEnAttente: cleListe });
        } else if (apres !== null && apres.startsWith("[")) {
          if (!apres.endsWith("]")) {
            erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
            yamlCassee = true;
            break;
          }
          const dedans = apres.slice(1, -1).trim();
          const liste: Noeud[] = [];
          if (dedans !== "") {
            let courant = "";
            let guillemet: string | null = null;
            for (let j = 0; j < dedans.length; j++) {
              const c = dedans[j] ?? "";
              if (guillemet) {
                courant += c;
                if (c === "\\" && guillemet === '"') {
                  j += 1;
                  courant += dedans[j] ?? "";
                  continue;
                }
                if (c === guillemet) guillemet = null;
                continue;
              }
              if (c === '"' || c === "'") {
                guillemet = c;
                courant += c;
                continue;
              }
              if (c === ",") {
                liste.push(courant.trim());
                courant = "";
                continue;
              }
              courant += c;
            }
            if (guillemet) {
              erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
              yamlCassee = true;
              break;
            }
            if (courant.trim() !== "") liste.push(courant.trim());
          }
          item[cleListe] = liste;
          pile.push({ indent: ligne.indent + 2, genre: "map", valeur: item, cleEnAttente: null });
        } else {
          item[cleListe] = apres ?? "";
          pile.push({ indent: ligne.indent + 2, genre: "map", valeur: item, cleEnAttente: null });
        }
      } else {
        seq.push(reste);
      }
      continue;
    }

    let cle = "";
    let brutValeur: string | null = null;
    let ouvert = false;
    if (ligne.texte.startsWith('"') || ligne.texte.startsWith("'") || ligne.texte.startsWith("|") || ligne.texte.startsWith(">")) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : valeur YAML refusée.` });
      yamlCassee = true;
      break;
    }
    let sep = 0;
    while (sep < ligne.texte.length && ligne.texte[sep] !== ":") sep += 1;
    if (ligne.texte[sep] !== ":") {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
      yamlCassee = true;
      break;
    }
    const suite = ligne.texte.slice(sep + 1);
    if (suite !== "" && !suite.startsWith(" ")) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
      yamlCassee = true;
      break;
    }
    cle = ligne.texte.slice(0, sep).trim();
    brutValeur = suite.trim();
    ouvert = brutValeur === "";
    if (cle === "" || brutValeur === "|" || brutValeur === ">" || brutValeur.startsWith("|") || brutValeur.startsWith(">")) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : valeur YAML refusée.` });
      yamlCassee = true;
      break;
    }

    let map: { [cle: string]: Noeud };
    if (sommet && sommet.genre === "map" && sommet.indent === ligne.indent && sommet.cleEnAttente === null) {
      map = sommet.valeur as { [cle: string]: Noeud };
    } else if (sommet && sommet.genre === "map" && sommet.cleEnAttente && ligne.indent > sommet.indent) {
      map = Object.create(null) as { [cle: string]: Noeud };
      (sommet.valeur as { [cle: string]: Noeud })[sommet.cleEnAttente] = map;
      sommet.cleEnAttente = null;
      const cadre: Cadre = { indent: ligne.indent, genre: "map", valeur: map, cleEnAttente: null };
      pile.push(cadre);
    } else if (!sommet && racine === null) {
      map = Object.create(null) as { [cle: string]: Noeud };
      racine = map;
      pile.push({ indent: ligne.indent, genre: "map", valeur: map, cleEnAttente: null });
    } else {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
      yamlCassee = true;
      break;
    }
    if (Object.prototype.hasOwnProperty.call(map, cle) || pile[pile.length - 1]?.cleEnAttente === cle) {
      erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : clé dupliquée.` });
      yamlCassee = true;
      break;
    }
    if (ouvert) {
      const cadre = pile[pile.length - 1];
      if (!cadre) {
        erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : indentation inattendue.` });
        yamlCassee = true;
        break;
      }
      cadre.cleEnAttente = cle;
    } else if (brutValeur.startsWith("[")) {
      if (!brutValeur.endsWith("]")) {
        erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
        yamlCassee = true;
        break;
      }
      const dedans = brutValeur.slice(1, -1).trim();
      const liste: Noeud[] = [];
      if (dedans !== "") {
        let courant = "";
        let guillemet: string | null = null;
        for (let j = 0; j < dedans.length; j++) {
          const c = dedans[j] ?? "";
          if (guillemet) {
            courant += c;
            if (c === "\\" && guillemet === '"') {
              j += 1;
              courant += dedans[j] ?? "";
              continue;
            }
            if (c === guillemet) guillemet = null;
            continue;
          }
          if (c === '"' || c === "'") {
            guillemet = c;
            courant += c;
            continue;
          }
          if (c === ",") {
            liste.push(courant.trim());
            courant = "";
            continue;
          }
          courant += c;
        }
        if (guillemet) {
          erreurs.push({ code: "yaml_invalide", message: `Ligne ${ligne.n} : liste incomplète.` });
          yamlCassee = true;
          break;
        }
        if (courant.trim() !== "") liste.push(courant.trim());
      }
      map[cle] = liste;
    } else {
      map[cle] = brutValeur;
    }
  }

  for (const cadre of pile) {
    if (cadre.cleEnAttente) {
      erreurs.push({ code: "yaml_invalide", message: "Une valeur imbriquée est manquante." });
      yamlCassee = true;
      break;
    }
  }
  if (yamlCassee || erreurs.length > 0 || racine === null || Array.isArray(racine)) {
    for (let i = 0; i < erreurs.length; i++) {
      const erreur = erreurs[i];
      if (!erreur) continue;
      let message = erreur.message;
      message = nettoyer(message);
      erreurs[i] = { code: erreur.code, message };
    }
    if (erreurs.length === 0) erreurs.push({ code: "yaml_invalide", message: "La fiche n'est pas lisible." });
    ecrire("Fiche refusée.");
    return { ok: false, cree: false, profil: null, erreurs };
  }

  const aConvertir: Array<{ parent: { [cle: string]: Noeud } | Noeud[]; cle: string | number }> = [];
  for (const cle of Object.keys(racine)) aConvertir.push({ parent: racine, cle });
  while (aConvertir.length > 0) {
    const lieu = aConvertir.pop();
    if (!lieu) break;
    const valeur = Array.isArray(lieu.parent) ? lieu.parent[lieu.cle as number] : lieu.parent[lieu.cle as string];
    if (typeof valeur === "string") {
      let converti: Noeud = valeur;
      if (valeur.length >= 2 && valeur.startsWith('"') && valeur.endsWith('"')) {
        let texte = "";
        const corps = valeur.slice(1, -1);
        for (let j = 0; j < corps.length; j++) {
          const c = corps[j] ?? "";
          if (c === "\\" && j + 1 < corps.length) {
            const n = corps[j + 1];
            texte += n === "n" ? "\n" : n === "t" ? "\t" : n;
            j += 1;
          } else {
            texte += c;
          }
        }
        converti = texte;
      } else if (valeur.length >= 2 && valeur.startsWith("'") && valeur.endsWith("'")) {
        converti = valeur.slice(1, -1).replace(/''/g, "'");
      } else if (/^(?:0|[1-9]\d*)$/.test(valeur)) {
        converti = Number(valeur);
      }
      if (Array.isArray(lieu.parent)) lieu.parent[lieu.cle as number] = converti;
      else lieu.parent[lieu.cle as string] = converti;
    } else if (Array.isArray(valeur)) {
      for (let j = 0; j < valeur.length; j++) aConvertir.push({ parent: valeur, cle: j });
    } else if (typeof valeur === "object") {
      for (const cle of Object.keys(valeur)) aConvertir.push({ parent: valeur, cle });
    }
  }

  const clesRacine = Object.keys(racine);
  if (clesRacine.length !== 1 || clesRacine[0] !== "fiche_de_besoins") {
    return refuser("fiche_racine", "La fiche doit commencer par fiche_de_besoins.");
  }
  const corps = racine.fiche_de_besoins;
  if (corps === undefined || typeof corps !== "object" || Array.isArray(corps)) {
    return refuser("fiche_racine", "La fiche doit commencer par fiche_de_besoins.");
  }

  const visite: Noeud[] = [corps];
  while (visite.length > 0) {
    const noeud = visite.pop();
    if (noeud === undefined || typeof noeud === "string" || typeof noeud === "number") continue;
    if (Array.isArray(noeud)) {
      for (const element of noeud) visite.push(element);
      continue;
    }
    for (const cle of Object.keys(noeud)) {
      if (caractereInterdit(cle, false)) return refuser("fiche_interdite", "La fiche contient un caractère interdit.");
      if (cle !== "secrets" && (SECRET_CLE.test(cle) || valeurSecrete(cle))) {
        return refuser(
          "secret",
          "La fiche contient un secret. Retirez-le. Une clé se dépose dans le magasin seulement après une approbation explicite.",
        );
      }
      const valeur = noeud[cle];
      if (typeof valeur === "string" || typeof valeur === "number") {
        const texte = String(valeur);
        if (caractereInterdit(texte, false) || valeurSecrete(texte)) {
          return refuser(
            caractereInterdit(texte, false) ? "fiche_interdite" : "secret",
            caractereInterdit(texte, false)
              ? "La fiche contient un caractère interdit."
              : "La fiche contient un secret. Retirez-le. Une clé se dépose dans le magasin seulement après une approbation explicite.",
          );
        }
      }
      if (valeur !== undefined && typeof valeur !== "string" && typeof valeur !== "number") visite.push(valeur);
    }
  }

  const champsCorps = ["version", "employe", "bots", "secrets"];
  for (const cle of Object.keys(corps)) {
    if (!champsCorps.includes(cle)) {
      erreurs.push({ code: "champ_inconnu", message: `Champ inconnu « ${cle} ».` });
    }
  }
  if (corps.version !== 1) erreurs.push({ code: "version", message: "Le champ version doit être 1." });
  if (corps.secrets !== "aucun") {
    erreurs.push({
      code: "secrets_declaration",
      message: corps.secrets === undefined ? "La fiche doit déclarer « secrets: aucun »." : "La fiche ne peut pas porter de secret.",
    });
  }

  const employe = corps.employe;
  let nomEmploye = "";
  let roleEmploye = "";
  if (employe === undefined || typeof employe !== "object" || Array.isArray(employe)) {
    erreurs.push({ code: "employe", message: "L'employé a besoin d'un nom et d'un rôle." });
  } else {
    for (const cle of Object.keys(employe)) {
      if (cle !== "nom" && cle !== "role") erreurs.push({ code: "champ_inconnu", message: `Champ inconnu « ${cle} ».` });
    }
    if (typeof employe.nom !== "string") erreurs.push({ code: "employe", message: "L'employé a besoin d'un nom." });
    else nomEmploye = employe.nom.trim();
    if (typeof employe.role !== "string") erreurs.push({ code: "employe", message: "L'employé a besoin d'un rôle." });
    else roleEmploye = employe.role.trim();
  }
  if (nomEmploye !== "") {
    let interdit = nomEmploye.length > 80;
    for (let i = 0; i < nomEmploye.length && !interdit; i++) {
      const code = nomEmploye.charCodeAt(i);
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) interdit = true;
    }
    if (interdit) erreurs.push({ code: "employe", message: "Le nom de l'employé doit tenir sur une ligne d'au plus 80 caractères." });
  } else if (typeof employe === "object" && employe !== null && !Array.isArray(employe) && typeof employe.nom === "string") {
    erreurs.push({ code: "employe", message: "L'employé a besoin d'un nom." });
  }
  if (roleEmploye !== "") {
    let interdit = roleEmploye.length > 60;
    for (let i = 0; i < roleEmploye.length && !interdit; i++) {
      const code = roleEmploye.charCodeAt(i);
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) interdit = true;
    }
    if (interdit) erreurs.push({ code: "employe", message: "Le rôle de l'employé doit tenir sur une ligne d'au plus 60 caractères." });
  } else if (typeof employe === "object" && employe !== null && !Array.isArray(employe) && typeof employe.role === "string") {
    erreurs.push({ code: "employe", message: "L'employé a besoin d'un rôle." });
  }

  const botsPrepares: BotPrepare[] = [];
  if (!Array.isArray(corps.bots)) erreurs.push({ code: "bots", message: "La fiche doit nommer au moins un bot." });
  else if (corps.bots.length < 1) erreurs.push({ code: "bots", message: "La fiche doit nommer au moins un bot." });
  else if (corps.bots.length > 6) erreurs.push({ code: "bots", message: "Une fiche compte au plus 6 bots." });
  else {
    for (let b = 0; b < corps.bots.length; b++) {
      const bot = corps.bots[b];
      if (bot === undefined || typeof bot !== "object" || Array.isArray(bot)) {
        erreurs.push({ code: "bot", message: `Le bot ${b + 1} est illisible.` });
        continue;
      }
      for (const cle of Object.keys(bot)) {
        if (!["nom", "domaine", "permissions", "connecteurs", "niveau_perspicax", "niveau_autonomie"].includes(cle)) {
          erreurs.push({ code: "champ_inconnu", message: `Champ inconnu « ${cle} ».` });
        }
      }
      const nom = typeof bot.nom === "string" ? bot.nom.trim() : "";
      if (nom === "") erreurs.push({ code: "bot", message: `Le bot ${b + 1} a besoin d'un nom.` });
      else {
        let interdit = nom.length > 80;
        for (let i = 0; i < nom.length && !interdit; i++) {
          const code = nom.charCodeAt(i);
          if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) interdit = true;
        }
        if (interdit) erreurs.push({ code: "bot", message: "Le nom d'un bot doit tenir sur une ligne d'au plus 80 caractères." });
      }
      const etiquette = nom === "" ? `bot ${b + 1}` : nom;
      const domaine = typeof bot.domaine === "string" ? bot.domaine.trim() : "";
      let domaineInterdit = false;
      for (let i = 0; i < domaine.length && !domaineInterdit; i++) {
        const code = domaine.charCodeAt(i);
        if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) domaineInterdit = true;
      }
      const morceauxDomaine = domaine === "" ? [] : domaine.split(/\s+/);
      let mots = 0;
      for (const mot of morceauxDomaine) if (mot !== "") mots += 1;
      if (domaineInterdit) {
        erreurs.push({ code: "domaine", message: `Le domaine du bot « ${etiquette} » doit tenir sur une ligne.` });
      } else if (mots !== 3) {
        erreurs.push({
          code: "domaine",
          message: `Le domaine du bot « ${etiquette} » doit compter exactement 3 mots.`,
        });
      }
      const permissions: Record<string, PermissionEntite> = {};
      if (bot.permissions === undefined || typeof bot.permissions !== "object" || Array.isArray(bot.permissions)) {
        erreurs.push({ code: "permission", message: `Le bot « ${etiquette} » a besoin de permissions par entité.` });
      } else if (Object.keys(bot.permissions).length === 0) {
        erreurs.push({ code: "permission", message: `Le bot « ${etiquette} » a besoin de permissions par entité.` });
      } else {
        for (const entite of Object.keys(bot.permissions)) {
          if (!ID_SIMPLE.test(entite)) {
            erreurs.push({ code: "permission", message: `L'entité « ${entite} » du bot « ${etiquette} » est refusée.` });
            continue;
          }
          const droit = bot.permissions[entite];
          if (droit !== "aucune" && droit !== "lecture" && droit !== "ecriture-avec-confirmation") {
            erreurs.push({
              code: "permission",
              message: `La permission « ${affiche(droit)} » sur « ${entite} » du bot « ${etiquette} » est refusée. Valeurs permises : aucune, lecture, ecriture-avec-confirmation.`,
            });
          } else {
            permissions[entite] = droit;
          }
        }
      }
      const connecteurs: string[] = [];
      if (!Array.isArray(bot.connecteurs)) erreurs.push({ code: "connecteur", message: `Le bot « ${etiquette} » doit lister ses connecteurs.` });
      else {
        for (const connecteur of bot.connecteurs) {
          if (typeof connecteur !== "string" || !ID_SIMPLE.test(connecteur)) {
            erreurs.push({ code: "connecteur", message: `Le connecteur « ${affiche(connecteur)} » du bot « ${etiquette} » est refusé.` });
          } else connecteurs.push(connecteur);
        }
      }
      const niveau: string[] = [];
      if (!Array.isArray(bot.niveau_perspicax) || bot.niveau_perspicax.length === 0) {
        erreurs.push({ code: "niveau_perspicax", message: `Le bot « ${etiquette} » a besoin d'un niveau Perspicax.` });
      } else {
        for (const palier of bot.niveau_perspicax) {
          if (typeof palier !== "string" || !NIVEAU.test(palier)) {
            erreurs.push({
              code: "niveau_perspicax",
              message: `Le niveau Perspicax « ${affiche(palier)} » du bot « ${etiquette} » est refusé. Écrivez organisation, equipe ou personnel, puis lecture, proposition ou ecriture.`,
            });
          } else niveau.push(palier);
        }
      }
      if (bot.niveau_autonomie !== 0) {
        erreurs.push({ code: "niveau_autonomie", message: `Le niveau d'autonomie du bot « ${etiquette} » doit être 0.` });
      }
      if (nom !== "" && !domaineInterdit && mots === 3 && Object.keys(permissions).length > 0 && Array.isArray(bot.connecteurs) && niveau.length > 0 && bot.niveau_autonomie === 0) {
        botsPrepares.push({
          nom,
          domaine,
          permissions,
          connecteurs,
          niveau_perspicax: niveau,
          niveau_autonomie: 0,
        });
      }
    }
  }

  if (erreurs.length > 0) {
    for (let i = 0; i < erreurs.length; i++) {
      const erreur = erreurs[i];
      if (!erreur) continue;
      let message = erreur.message;
      message = nettoyer(message);
      erreurs[i] = { code: erreur.code, message };
    }
    ecrire("Fiche refusée.");
    return { ok: false, cree: false, profil: null, erreurs };
  }

  const profil: ProfilPrepare = {
    version: 1,
    employe: { nom: nomEmploye, role: roleEmploye },
    bots: botsPrepares,
  };

  if (demande.approbation !== true) {
    ecrire("Profil préparé, création en attente.");
    return { ok: true, cree: false, profil, erreurs: [] };
  }
  if (!demande.registre) return refuser("approbation_registre", "L'approbation exige un registre de profils. Rien n'a été créé.");

  const entrees: Array<{ nom: string; valeur: string }> = [];
  if (demande.cles) {
    for (const nom of Object.keys(demande.cles)) {
      const valeur = demande.cles[nom];
      if (typeof valeur !== "string" || valeur.length === 0) {
        return refuser("cle_invalide", "Une clé est vide. Rien n'a été créé.");
      }
      if (!NOM_CLE.test(nom)) return refuser("cle_invalide", "Un nom de clé est refusé. Rien n'a été créé.");
      entrees.push({ nom, valeur });
    }
  }
  const magasin = demande.magasin;
  const dejaDeposees = magasin ? depotsFaits.get(magasin) : undefined;
  const aDeposer = dejaDeposees ? entrees.filter((entree) => !dejaDeposees.has(entree.nom)) : entrees;
  if (aDeposer.length > 0 && !magasin) {
    return refuser("approbation_magasin", "L'approbation avec des clés exige un magasin de secrets. Rien n'a été créé.");
  }
  if (aDeposer.length > 0 && magasin) {
    try {
      magasin.deposer(aDeposer);
    } catch {
      return refuser("magasin_refuse", "Le magasin de secrets a refusé le dépôt. Rien n'a été créé.");
    }
    const faits = depotsFaits.get(magasin) ?? new Set<string>();
    for (const entree of aDeposer) faits.add(entree.nom);
    depotsFaits.set(magasin, faits);
    ecrire("Clés déposées dans le magasin.");
  }
  const empreinte = JSON.stringify(profil);
  const dejaCree = profilsFaits.get(demande.registre)?.has(empreinte) === true;
  if (!dejaCree) {
    try {
      demande.registre.creer(profil);
    } catch {
      const message =
        entrees.length > 0
          ? "Le registre a refusé le profil. Les clés restent dans le magasin. Le profil n'a pas été créé."
          : "Le registre a refusé le profil. Rien n'a été créé.";
      ecrire("Le registre a refusé le profil.");
      return { ok: false, cree: false, profil: null, erreurs: [{ code: "registre_refuse", message }] };
    }
    const faits = profilsFaits.get(demande.registre) ?? new Set<string>();
    faits.add(empreinte);
    profilsFaits.set(demande.registre, faits);
    ecrire("Profil créé.");
  }
  return { ok: true, cree: true, profil, erreurs: [] };
}
