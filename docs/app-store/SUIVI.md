# Suivi de la sortie App Store (état au 04/11/2026, 18 h 30)

Objectif : BaseSecrète 1.0 sur l'App Store en **distribution non répertoriée** (installable seulement par lien direct). Version 1.0 réglée en **publication manuelle** : rien ne part en public sans action de notre part.

## Fait

### App et serveur (branche `charte-lame`, **rien n'est commité**)
- [x] Suppression de compte dans l'app : Réglages, « Compte », « Supprimer mon compte » (`DELETE /me`). Le serveur ne garde que l'id et les clés publiques (pseudo `deleted_…`).
- [x] Signaler un message (appui long, motif, texte déchiffré envoyé) : table `reports`, lecture avec `cd server && npx tsx scripts/reports.ts --prod` (`--done <id>` pour marquer traité).
- [x] Bloquer un membre (appui long), liste « Membres bloqués » dans les Réglages. Blocage local au téléphone.
- [x] Rotation après un départ : envoi refusé tant que la clé n'a pas changé (message gardé en attente + bandeau), rotation par un membre s'il n'y a plus d'admin.
- [x] Rotation automatique quand la clé a plus de 7 jours (à l'ouverture du groupe par un admin).
- [x] Taille des messages masquée (complétés jusqu'à 256 o, 1 Ko, 4 Ko ou 16 Ko).
- [x] Pages `assistance.html` et `confidentialite.html` mises à jour (suppression dans l'app, signalement).
- [x] `docs/SECURITE.md` à jour.

### Base de données et API
- [x] Dev : migrations 0019 + 0020, API déployée.
- [x] **Prod : migrations 0019 + 0020 (21 au total), API déployée**, `/health` OK.

### Tests
- [x] 416 tests unitaires OK.
- [x] Tests réels contre l'API dev : `accountDeletion` (suppression, signalement, rotations), `e2e` (avec `E2E_NO_WS=1` : le WebSocket ne passe pas sur la fonction Neon), `e2eDirect`. Rotation hebdomadaire vérifiée à la main (clé vieillie de 8 jours).
- [ ] Pas encore testé sur un vrai téléphone : signaler, bloquer, supprimer le compte, bandeau de rotation.

### Builds
- [x] TestFlight externe : build 16 soumis à la vérification bêta (groupe « BS », lien public). Compte de démo `review_apple`.
- [x] Build iOS 17 (suppression de compte + signaler/bloquer) envoyé à App Store Connect.
- [x] **Build iOS 18** (tout ce qui précède + rotations + tailles masquées) terminé sur EAS, envoyé à App Store Connect.
- [x] APK Android Dev (API dev) installé sur le S22 : `docs/Claude outputs/BaseSecrete-Dev-moderation.apk`. Construit depuis `C:\bsm` (dossier C++ déplacé vers `C:\cx` à cause de la limite de 260 caractères).

### App Store Connect
- [x] Version 1.0 en publication manuelle.
- [x] Infos de vérification TestFlight : compte de démo, remarques, descriptions FR/EN, « À tester ».
- [~] Infos de vérification de la version 1.0 (compte de démo, note « distribution non répertoriée », où trouver signaler, bloquer et supprimer) : envoyées, **pas confirmées** (l'onglet s'est figé). À vérifier.

## À faire, dans l'ordre

### 1. Toi
- [ ] **Captures d'écran iPhone** (obligatoires, aucune pour l'instant). Sur un iPhone avec le build 18 via TestFlight, avec le compte de démo ou un compte de test. Taille 6,9" ou 6,5".
- [ ] **URL d'assistance publique** (obligatoire, vide) : rendre publique la page d'assistance (artifact https://claude.ai/artifact/G9JCXy2DPGZNzMq46phW1K), ou me laisser créer une page Notion sous la page de confidentialité.
- [ ] **Page Notion de confidentialité** : remplacer le passage « suppression par e-mail » par le texte de `confidentialite.html` (je peux le faire si tu dis oui).
- [ ] **Déclaration ANSSI** : compléter `docs/app-store/declaration-anssi.md` (identité, adresse, téléphone), puis l'envoyer sur https://demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie. Délai jusqu'à 1 mois.
- [ ] **Décision France** : soumettre sans la France en attendant l'attestation de l'ANSSI, ou avec la France tout de suite (le build 18 déclare encore « pas de chiffrement », ce qui est inexact).

### 2. Moi, ensuite
- [ ] Vérifier les infos de vérification de la version 1.0 dans App Store Connect.
- [ ] Coller l'URL d'assistance (EN + FR) et l'URL de confidentialité dans la fiche.
- [ ] Mettre le build 18 sur la version 1.0.
- [ ] Mettre le build 18 dans le groupe TestFlight « BS » (et sa note « À tester »).
- [ ] Soumettre la version 1.0 à la vérification App Store.
- [ ] Préparer le texte du formulaire **distribution non répertoriée** (https://developer.apple.com/contact/request/unlisted-app/), te le montrer, puis l'envoyer. Apple le refuse tant que l'app n'est pas soumise.
- [ ] Une fois validée et acceptée en non répertorié : publier à la main, récupérer le lien.

### 3. Après l'attestation ANSSI
- [ ] `mobile/app.json` : `ITSAppUsesNonExemptEncryption` à `true`, nouveau build.
- [ ] App Store Connect : répondre « algorithmes standard », « disponible en France », téléverser l'attestation.

### 4. À ne pas oublier
- [ ] **Commiter** tout le travail du 04/11 (une soixantaine de fichiers modifiés ou nouveaux), en plusieurs commits.
- [ ] Surveiller les signalements (`scripts/reports.ts --prod`) : Apple attend une réponse rapide.
- [ ] Ne pas supprimer le compte de démo `review_apple` (mot de passe dans `demo-secrets.local.md`, hors git).
- [ ] Fichiers de test non commités (`_*.driver.test.ts`) : pilotes de test, à laisser hors du dépôt.

## Plus tard (après la sortie)
- Post-quantique : X-Wing (X25519 + ML-KEM-768) via `@noble/post-quantum`, pas encore audité par un tiers. Plusieurs jours de travail ; ajoute un algorithme à la déclaration ANSSI.
- Confidentialité persistante complète : double ratchet ou MLS (RFC 9420). Plusieurs semaines.
- Audit externe de `mobile/src/crypto` par une société indépendante.

## Infos utiles
- App Store Connect : app 6824479601, `com.lipreux.basesecrete`, version 1.0 id `e0774920-e283-462f-834f-d3655c4d3d42`.
- Compte de démo prod : `review_apple`, groupe « Demo group », mots-clés `sun beach summer` (mot de passe et code dans `demo-secrets.local.md`, hors git).
- API prod : https://br-green-silence-bahz9z6m-api.compute.c-8.eu-central-1.aws.neon.tech
- API dev : https://br-muddy-bar-barqix1g-api.compute.c-8.eu-central-1.aws.neon.tech
- Comptes de test dev : ChefTesteur (sur le S22, connexion à moitié faite : bloqué sur la confirmation du code), AdminCoffre (piloté depuis le PC, groupe « Coffre modération », code `4826`, mots-clés `pelle tunnel lingot`).
- Documents : `README.md` (fiche et risques), `fiche.md` (textes saisis), `declaration-anssi.md` (brouillon ANSSI).
