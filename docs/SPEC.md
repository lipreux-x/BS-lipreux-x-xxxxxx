# BaseSecrète — Fiche projet pour Claude Code

> Messagerie privée, chiffrée de bout en bout, réservée à un petit cercle d'amis.
> Pas d'inscription publique : on entre seulement sur invitation.

---

## 1. Vision

- App mobile (iOS + Android) pour discuter **uniquement entre potes** (≈ 5 à 50 personnes).
- **Tout est chiffré de bout en bout (E2EE)** : le serveur ne voit jamais le contenu des messages, ni les noms des groupes.
- Double verrou : un **code app à 6 chiffres** pour ouvrir l'app, puis un **code par groupe** pour ouvrir chaque conversation.
- Une esthétique de « coffre-fort » : sobre, noir, un seul accent de couleur.

---

## 2. Parcours utilisateur

### 2.1 Écran d'ouverture (verrou)
1. L'utilisateur ouvre l'app → écran noir avec **un gros carré centré** (logo/icône BaseSecrète, légère animation de « respiration »).
2. **Tap sur le carré** → le carré s'ouvre (animation) et laisse place à un **pavé numérique** + 6 points.
3. L'utilisateur saisit son **code à 6 chiffres**.
   - Correct → animation de déverrouillage → page Messagerie.
   - Incorrect → vibration + shake des points. Compteur d'essais (voir §4.4).
4. L'app se **reverrouille automatiquement** après **5 min** hors de l'app (retour avant : pas de code). Dès qu'elle quitte le premier plan, l'écran est masqué (aperçu des apps récentes).
5. Option : déverrouillage biométrique (Face ID / empreinte) **en plus** du code, jamais à la place au premier lancement.

### 2.2 Page Messagerie (liste des groupes)
- Liste de tous les groupes dont l'utilisateur est membre : icône, nom (déchiffré localement), cadenas 🔒, badge de messages non lus.
- **Aucun aperçu du dernier message** tant que le groupe est verrouillé.
- Bouton « + » : créer un groupe / rejoindre un groupe.
- Accès réglages (profil, changer code app, durée de verrouillage, appareils).

### 2.3 Ouvrir un groupe
1. Tap sur un groupe → modal « Code du groupe » (pavé numérique, même style).
2. Bon code → ouverture de la conversation.
3. Le groupe reste déverrouillé pendant la session, et se reverrouille quand l'app se verrouille ou **10 min** après qu'on l'a quitté.

### 2.4 Conversation
- Messages texte (MVP), puis images, vocaux, réactions.
- Stories : une bande repliée en haut de la conversation, qu'on tire vers le bas comme un rideau sur les messages (jusqu'à la zone de saisie) ; la photo entière est le rideau, une à la fois, toucher à droite ou à gauche pour passer à la suivante ou revenir ; chaque photo est chiffrée et visible 24 h (voir §4.7).
- Indicateurs : envoyé / reçu / lu (optionnel, désactivable).
- Option « messages éphémères » par groupe (24 h / 7 j / off).
- Apps récentes : flou sur iOS, aperçu vide sur Android 13+ (cache noir avant). Les captures d'écran sont autorisées par défaut ; une option des Réglages les bloque sur le téléphone (`expo-screen-capture` : `FLAG_SECURE` sur Android, iOS 13+).

### 2.5 Onboarding (première fois)
1. L'utilisateur reçoit un **code d'invitation** d'un membre existant (valable 2 h ; 3 invitations ouvertes et 10 par jour au plus par membre).
2. Il choisit un pseudo + crée son code app à 6 chiffres (saisi 2 fois).
3. L'app génère ses clés **sur l'appareil** (voir §4).
4. Il rejoint le(s) groupe(s) auxquels il a été invité.
5. Il choisit aussi un **mot de passe** (10 caractères min., ni suite ni répétition ; sous 16 caractères, 3 types de caractères). Il protège une copie chiffrée de ses clés (Argon2id 64 Mo), gardée par le serveur. Sur un téléphone qui a perdu ses données, « Se connecter » (pseudo + mot de passe, puis nouveau code app) restaure le compte ; chaque groupe redemande alors son code **et** ses mots-clés. Le serveur ne peut pas ouvrir cette copie, limite les échecs à 5 par heure par pseudo (300 par heure en tout), et ne peut pas imposer à l'app un coût plus faible que le sien.

---

## 3. Stack recommandée

| Couche | Choix | Pourquoi |
|---|---|---|
| App mobile | **Expo (React Native) + TypeScript** | iOS + Android avec une seule base, Expo Router |
| Base de données | **Neon** (Postgres serverless) | Postgres managé, branches pour dev/test |
| API | ✅ **Hono déployé sur Neon Functions** (choix recommandé par Neon, même région que la base) | Logique d'invitation, vérif des codes, rate limit |
| Temps réel | ✅ **WebSocket** dans la Neon Function (`@neon/functions/hono`), diffusion entre instances par polling Postgres | Réception instantanée des messages |
| Auth | **Neon Auth** (ou JWT maison signé par l'API) | Comptes sur invitation uniquement |
| Fichiers | **Neon Storage** (ou Cloudflare R2) | Images/vocaux, toujours chiffrés côté client |
| ORM | **Drizzle** + driver `@neondatabase/serverless` | Typé, léger, migrations simples |
| Crypto | Algorithmes libsodium en JS audité (@noble, tweetnacl), octet pour octet ; **module natif** `mobile/modules/bs-native` pour Argon2id (implémentation de référence) et la clé matérielle | Primitives éprouvées, pas de crypto maison |
| Stockage secret local | `expo-secure-store` (Keychain / Keystore) | Clés protégées par le matériel |
| Biométrie | `expo-local-authentication` + `expo-secure-store` | Option : ouvrir l'app avec la biométrie du téléphone (Face ID ou Touch ID sur iOS ; empreinte, ou visage « fort », sur Android) |
| Base locale | `expo-sqlite` (chiffrée, ex. SQLCipher via op-sqlite) | Cache des messages déchiffrés, hors-ligne |
| Notifications | Expo Notifications | **Contenu générique uniquement** (« Nouveau message ») |
| UI | NativeWind (Tailwind) + Reanimated | Animations du carré / pavé |

---

## 4. Sécurité et chiffrement (le cœur du projet)

> ⚠️ Règle d'or : **ne jamais inventer d'algorithme**. Utiliser uniquement libsodium.
> ⚠️ Un code à 6 chiffres = seulement 1 000 000 combinaisons. **Il ne doit jamais être la seule protection d'une clé de chiffrement**, sinon il se casse hors-ligne en quelques secondes. Il sert de *verrou local*, protégé par le matériel du téléphone et une limite d'essais.

### 4.1 Clés de l'utilisateur
- Au premier lancement, l'appareil génère :
  - une paire de clés d'identité **X25519** (chiffrement) + **Ed25519** (signature).
- La **clé publique** est envoyée au serveur (table `profiles` sur Neon).
- La **clé privée ne quitte jamais l'appareil**.

### 4.2 Code app (6 chiffres)
- Une **clé maître locale** aléatoire (32 octets) chiffre toutes les données locales (clés privées, clés de groupes, base SQLite).
- Cette clé maître est stockée dans `expo-secure-store`, **enveloppée** avec une clé dérivée :
  `k1 = Argon2id(code_app + device_secret, sel)` (64 Mo, 3 passes), puis `HMAC_matériel(k1)` calculé par une clé **non exportable** du Secure Enclave (iOS) / Android Keystore (StrongBox si présent). `device_secret` est un secret aléatoire lui aussi dans le Keychain/Keystore.
- Conséquence : une copie du stockage de l'app ne suffit pas à tester des codes ; chaque essai doit passer par ce téléphone, où le compteur d'essais s'applique.
- Le code app n'est **jamais** envoyé au serveur.
- Toute dérivation Argon2id passe par le module natif : sans lui (Expo Go), l'app refuse plutôt que d'utiliser un coût plus faible.

### 4.3 Groupes
- Chaque groupe a une **clé de groupe** aléatoire 256 bits, générée par le créateur.
- Chaque membre reçoit la clé en **remise** (table `group_keys`, une ligne par membre et par version) : chiffrée sous la clé dérivée du code + mots-clés (`wrapKey`, §4.4), scellée à sa clé publique (`crypto_box_seal`), et **signée par l'admin** qui la remet. Le serveur ne peut ni lire une remise, ni en fabriquer une, ni en donner une à quelqu'un. À côté de la clé, la remise porte aussi le **nom du groupe scellé au membre seul** (`sealed_label`, `crypto_box_seal` à sa clé publique, signé par le même admin, l'id du groupe dedans) : lisible avec le code app seulement, avant le code du groupe, pour que la liste nomme un coffre jamais ouvert sur ce téléphone (reconnexion, nouvelle adhésion) et qu'on sache quel code taper. Les remises d'avant n'en ont pas (« Groupe verrouillé ») jusqu'à ce qu'un admin ouvre le groupe : son téléphone scelle alors le nom sur chaque remise qui n'en a pas (`POST /groups/:id/keys/labels`, rempli une fois, signé par lui : `label_signer_id`).
- La **meta** du groupe (nom, avatar, mots-clés, admins, membres, numéro de révision) est chiffrée avec la clé de groupe et **signée par un admin**. Les téléphones suivent ses listes, jamais celles du serveur, et refusent une révision plus ancienne que celle déjà vue.
- **Entrer dans un groupe** : le code + mots-clés ne font qu'une **demande**. Un admin l'accepte depuis son téléphone (après avoir comparé l'empreinte du nouveau, §4.7) : c'est ce qui lui remet la clé et l'ajoute à la meta. Le serveur ne peut pas ajouter de membre fantôme.
- Messages chiffrés avec **XChaCha20-Poly1305** (`crypto_aead_xchacha20poly1305_ietf`) + nonce aléatoire, et **signés** par l'expéditeur (Ed25519), vérifiés avec sa clé **épinglée** sur le téléphone.
- Quand un membre quitte / est retiré → **rotation de clé** par un admin : nouvelle clé remise aux seuls membres de la meta encore présents (tout de suite quand l'admin retire quelqu'un). Les anciens messages restent lisibles avec l'ancienne clé (versionnage `key_version`). Un membre retiré est **banni** : le code qu'il connaît ne lui permet plus de redemander à entrer.
- Le dernier admin désigne un autre admin (meta signée) avant de pouvoir partir.
- **Discussion privée** (deux personnes) : ouverte depuis la fiche d'un groupe commun, uniquement avec un membre d'un groupe où l'on est tous les deux (le serveur le vérifie ; une seule par paire). C'est un groupe de deux (`groups.kind = 'direct'`) sans code ni mots-clés côté serveur : ses remises sont enveloppées sous une clé publique fixe (`directWrapKey`) au lieu de `wrapKey`, donc ouvrables avec l'identité seule, toujours scellées à chacun et signées par celui qui l'a ouverte. Sa meta (`direct: true`, les deux membres, tous deux admins, aucun mot-clé) est vérifiée comme celle d'un groupe ; un groupe présenté comme discussion privée (ou l'inverse) est refusé. Chaque téléphone verrouille la clé sous **son propre code**, choisi à la première ouverture, avec la clé maître. Personne n'entre ni ne sort ; la supprimer l'efface pour les deux.

### 4.4 Code de groupe et mots-clés
- Le code de groupe (6+ caractères) et les **3 mots-clés** sont partagés entre les membres, en vrai. Ils **ne quittent jamais le téléphone** : `Argon2id(code + mots-clés)` (64 Mo ; casse, accents, espaces et ordre ignorés) donne deux clés indépendantes (`mobile/src/crypto/groupSecret.ts`) :
  - `joinKey`, envoyée pour trouver le groupe et demander à entrer. Le serveur n'en garde qu'un HMAC avec son secret, et limite les demandes à 5 par heure par utilisateur et 20 par heure par groupe ;
  - `wrapKey`, jamais envoyée : toutes les remises de clé du serveur sont chiffrées sous elle. Ouvrir un groupe demande donc l'identité du compte **et** le code + mots-clés (après « Se connecter » sur un nouveau téléphone, les deux sont redemandés).
- Sur le téléphone, la clé de groupe est en plus ré-enveloppée avec `Argon2id(code_groupe, sel)` **puis** avec la clé maître locale. Il faut donc les deux.
- **Changer le code** (admin) : nouvelle `joinKey`, nouveaux mots-clés dans la meta, et **toutes les remises re-chiffrées** sous le nouveau code (aucune ne reste ouvrable avec l'ancien ; une version que l'admin ne détient pas est supprimée). `code_version` augmente ; les autres membres tapent une fois le nouveau code, qui doit ouvrir leur remise.
- Les membres retrouvent les mots-clés dans la fiche info du groupe (dans la meta chiffrée).

### 4.5 Protection contre le forçage
- Code app : après 5 échecs → délai croissant (30 s, 1 min, 5 min, 15 min, 1 h). Option « auto-destruction » après 10 échecs = effacement des données locales.
  - Fait : option dans Réglages (désactivée, 10 ou 20 essais), `bs.wipe_after` dans le Secure Store. Secret de l'appareil, clé maître et copie pour l'empreinte effacés en premier, puis le reste, la clé matérielle et la base SQLite ; un effacement interrompu est terminé au lancement suivant.
- Empreinte (fait) : optionnelle, pour ouvrir l'app à la place du code app. Une copie de la clé maître est gardée dans le Keychain/Keystore avec authentification biométrique obligatoire (`requireAuthentication`, invalidée si un doigt est ajouté, `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`). Offerte dès qu'une biométrie est enregistrée (25/10 : avant, seulement si l'empreinte était l'unique capteur, ce qui excluait les Samsung avec reconnaissance faciale). Le choix empreinte / visage n'appartient pas à l'app : iOS donne ce que l'iPhone a (Face ID ou Touch ID, jamais les deux) ; Android accepte toute biométrie **forte** enregistrée (l'empreinte, et le visage seulement là où il est de classe forte : pas sur les Samsung) sans pouvoir se limiter à l'une. L'app nomme ce qu'elle a (`biometricKind` : « Face ID », « Touch ID », « Empreinte digitale », « Empreinte ou visage ») et dessine un visage sur le lecteur du coffre pour Face ID. Activation avec le code app ; code redemandé après 48 h sans l'avoir tapé ; les groupes demandent toujours leur code.
- Code groupe : même logique, compteur par groupe.
- Compteurs stockés dans le Secure Store. Chaque essai est compté **avant** d'être tenté (tuer l'app pendant un essai ne le rend pas gratuit), et l'attente se mesure sur l'horloge de démarrage du téléphone : avancer la date ne la raccourcit pas, un redémarrage la fait repartir.
- Serveur : invitations, créations de groupe et changements de code limités par utilisateur ; 60 messages par minute ; défis de connexion à usage unique ; un pseudo ne peut pas exister en deux casses (« Alice »/« alice ») ; une invitation brûle après 3 pseudos déjà pris.

### 4.6 Ce que le serveur voit / ne voit pas
| Le serveur voit | Le serveur ne voit PAS |
|---|---|
| Pseudos, clés publiques | Contenu des messages |
| Qui est dans quel groupe (IDs) | Nom des groupes, avatars |
| Horodatage, taille des messages chiffrés | Codes app, codes groupe, mots-clés (seulement un dérivé Argon2id) |
| Les demandes d'entrée en attente | Clés privées, clés de groupe en clair |

### 4.7 Autres règles
- Notifications push : le serveur n'envoie jamais un nom de groupe ni un contenu ; le téléphone ajoute le nom lui-même.
  - Fait : le serveur n'envoie que l'id du groupe (UUID) et le type d'événement (`message`, ou ce que le groupe attend : `join_request`, `approved`, `member_left`, `code_changed`). Sur **Android**, la notification est **silencieuse** : l'app se réveille en arrière-plan (tâche `expo-task-manager`, app fermée ou non) et affiche elle-même **une notification par groupe, avec le nom du groupe tel que le téléphone le connaît** (gardé dans le Keystore, lisible sans le code app) et « Nouveau message » / « Nouveaux messages » (la nouvelle remplace la précédente : jamais une ligne par message) ou ce que le groupe attend. Sur **iOS**, la notification est visible, texte en clair sans nom de groupe (« Nouveau message », « Quelqu'un demande à entrer dans un groupe »…), une par groupe et par type (`collapseId`). « Message » : au plus une toutes les 30 s par téléphone, et **aucune tant que l'app est ouverte** (`PUT /me/presence` renouvelé toutes les 30 s, retiré au passage en arrière-plan ; `profiles.awake_until`). Les autres types sont toujours envoyés (bannière dans l'app). Ouvrir la conversation retire sa notification. Le toucher ouvre l'écran du coffre (code app ou empreinte), puis le code du groupe, puis la conversation ou ce qui attend. Serveur : `push_tokens` (avec `platform`), `server/src/lib/push.ts` ; app : `mobile/src/services/push.ts`.
- Liste des groupes : les derniers ouverts en haut ; un **compteur de messages en attente** sur chaque groupe, verrouillé ou non (`POST /groups/unread` : un nombre par groupe à partir du dernier message affiché sur ce téléphone, sans les siens, les réactions ni les expirés).
- Images/vocaux : chiffrés côté client avant upload dans Neon Storage / R2 (URLs présignées) (clé de fichier aléatoire, elle-même chiffrée avec la clé de groupe).
  - Images (fait) : recompressées en JPEG 1600 px avant envoi, ce qui retire les métadonnées (GPS, appareil). Fichier chiffré en XChaCha20-Poly1305 avec une clé aléatoire, AD = `bs/v1/attachment` + groupe + id de la pièce jointe (`mobile/src/crypto/attachment.ts`). La clé, les dimensions et un mini-aperçu flou voyagent dans un message de groupe normal (chiffré + signé).
  - Serveur : table `attachments` + bucket privé `attachments` (clé d'objet `<groupe>/<id>`). URL d'upload valable 5 min et limitée à la taille annoncée (10 Mo max, 60 envois/h). Téléchargement réservé aux membres tant que le message existe. Le fichier est supprimé avec le message éphémère, à la fermeture du groupe, ou après 24 h s'il n'a jamais été envoyé.
  - Téléphone : images déchiffrées gardées en mémoire seulement (vidées au verrouillage). « Enregistrer dans la galerie » est un choix explicite ; l'image n'y est plus chiffrée.
  - Réactions (fait) : cinq réactions par message (pouce, couronne, pièces, flamme, cadenas), dessinées par l'app, jamais en emoji. Une par membre et par message, la dernière compte, `null` la retire. Corps de message `kind: 'reaction'` (id du message visé + identifiant), envoyé chiffré et signé comme un message mais marqué `quiet` : le serveur ne notifie personne et n'apprend que cela. Jamais dans le fil : comptées sous le message visé.
  - Documents (fait) : n'importe quel fichier (PDF, tableur, archive…) choisi avec le sélecteur du système, envoyé tel quel et chiffré exactement comme une image (corps de message `kind: 'file'` : clé de fichier, type MIME, nom, taille ; le nom et le type voyagent dans le chiffré, le serveur ne voit qu'un blob de 10 Mo max). Un nom avec un chemin ou des caractères de contrôle est refusé à la lecture. Dans le fil : une plaque avec l'icône, le nom, le type et la taille ; un toucher télécharge, déchiffre, puis confie le document à une autre app via la feuille de partage du système (visionneuse, enregistrement). Cette copie en clair, dans le cache de l'app, est supprimée avant le document suivant, au verrouillage et au lancement (balayage). Un document peut être cité en réponse (« 📎 nom »).
  - Stories (fait) : une photo (appareil photo ou galerie) chiffrée exactement comme une image (corps de message `kind: 'story'`, même clé de fichier aléatoire, même recompression sans métadonnées), mais affichée dans une bande repliable en haut de la conversation (tirée vers le bas, elle couvre les messages jusqu'à la zone de saisie ; la photo entière est le rideau (fond flouté autour, jusqu'à la zone de saisie), une à la fois, toucher à droite / à gauche ou glisser pour changer) et non dans le fil. Le message part avec `expiresInSeconds: 86400` : le serveur pose la date d'expiration à 24 h (ou moins si le groupe a des messages éphémères plus courts) et la purge (toutes les 6 h) supprime le message et le fichier. Le serveur apprend seulement qu'un message vit 24 h, pas que c'est une story. Les stories déjà regardées sont notées dans le store local chiffré du téléphone (`stories/<groupe>`), jamais envoyées : pas de « vu par ». Enregistrer dans la galerie reste possible, avec le même avertissement. Quand sa propre story est partie, la barre de la bande le dit (« PUBLIÉE » quelques secondes, LED verte, la touche « + » devient une coche, une vibration), puis la nomme tant qu'elle est en ligne (« LA TIENNE », « LA TIENNE + 2 » avec les autres, « LA TIENNE · 2 NOUVELLES » quand il y en a à voir).
- Photo de profil : jamais de vraie photo. On choisit dans Réglages une icône de la bibliothèque Lucide (lucide.dev, licence ISC) : silhouette par défaut, ou masque, espion, banque, coffre-fort, diamant, pièces d'or, butin, tirelire, clé, perceuse, guetteur. Le serveur ne stocke que l'identifiant (`profiles.avatar`, liste fermée), visible par les membres des groupes comme le pseudo. Dans le chat, l'avatar n'apparaît qu'avec l'affichage « Avec avatars » (ci-dessous).
- Affichage de la discussion, au choix par groupe (fiche du groupe) : **Terminal** (par défaut : chaque message est une entrée `❯ auteur [heure]` en monospace, sans avatar) ou **Avec avatars** (chaque message sur une plaque d'acier biseautée, vert sombre pour les miens, métal sombre pour les autres ; ceux des autres ont l'avatar et le nom à gauche, sur chaque message). Le choix vaut pour ce téléphone seulement : il est rangé dans le store local chiffré (`look/<groupe>`), jamais envoyé, et oublié avec le groupe.
- Réponses : la réponse embarque dans son corps chiffré et signé l'id, l'auteur et un extrait (140 caractères max) du message cité. Quand l'original est encore chargé, l'app affiche l'original et non l'extrait, pour qu'un membre ne puisse pas faire dire autre chose à quelqu'un. Sinon l'extrait est marqué « non vérifié » ; une citation qui contredit l'original chargé s'affiche « Citation falsifiée ».
- Vérification des contacts : chacun a une **empreinte** (30 chiffres, Réglages). L'admin la compare en vrai avec celle qu'il voit avant d'accepter une demande, et peut la voir pour chaque membre (fiche du groupe). Les clés publiques des contacts sont **épinglées** à la première vue : une clé que le serveur changerait ensuite est refusée et signalée.
- Images reçues : refusées avant affichage si ce n'est pas un JPEG bien formé ou si elles dépassent 4096 px (une image piégée ne peut pas faire planter l'app à chaque ouverture).
- Fichiers en clair sur le disque (vocaux en lecture, enregistrements, copies du sélecteur de photos) : effacés à chaque lancement en plus du verrouillage. Le presse-papiers (texte copié, invitation) est marqué sensible et vidé au bout d'une minute.
- Sauvegarde Android des données de l'app désactivée ; sur iOS, une réinstallation efface le coffre que le Keychain aurait gardé.
- Aucun log contenant des données déchiffrées. Pas d'analytics tiers.
- Multi-appareils : hors MVP (chaque appareil = une identité ; ajout d'appareil via QR code plus tard).

---

## 5. Réseau : 4G/5G, Wi-Fi et hors connexion

L'app doit marcher **partout** : en Wi-Fi, en données mobiles (4G/5G), et continuer à fonctionner sans connexion.

### 5.1 Wi-Fi ou données mobiles
- Aucune dépendance au Wi-Fi : tout passe par HTTPS + WebSocket (TLS), donc ça marche pareil en 4G/5G.
- Détection du réseau avec `@react-native-community/netinfo`.
- **Bascule Wi-Fi ↔ 4G transparente** : à chaque changement de réseau, reconnexion automatique du WebSocket (backoff exponentiel 1 s → 30 s) puis resynchro.
- Mode « économie de données » quand on est en mobile : images téléchargées seulement au tap (réglable).
- Messages petits et compacts (ciphertext en binaire/base64, pas de JSON verbeux) pour rester rapide avec un réseau faible.

### 5.2 Hors connexion (offline-first)
- Tous les messages déchiffrés sont gardés dans la **SQLite locale chiffrée** → on peut relire ses conversations sans réseau.
  - Fait (`mobile/src/services/localStore.ts`) : pas de SQLCipher ; chaque ligne est scellée en XChaCha20-Poly1305 avec une clé dérivée de la clé maître, les ids de groupe sont hachés avec clé. Les messages sont gardés sous leur forme serveur (chiffrés + signés avec la clé de groupe) : les relire demande toujours le code du groupe. La liste des groupes (remises de clé comprises) et les profils sont gardés pour déverrouiller hors ligne ; la file d'envoi (`services/outbox.ts`) et les fichiers chiffrés des photos et vocaux aussi.
- Écrire sans réseau : le message est chiffré tout de suite et mis dans une **file d'envoi locale** (statut ⏳).
- Au retour du réseau : envoi automatique de la file dans l'ordre, puis statut ✓.
- Chaque message a un `client_id` (UUID généré sur le téléphone) → le serveur ignore les doublons si un envoi est rejoué.
- Resynchro : l'app demande au serveur « tout ce qui est arrivé depuis mon dernier `created_at` / curseur » pour chaque groupe.
- Bandeau discret en haut : « Hors ligne — les messages partiront dès le retour du réseau ».
- Le déverrouillage (code app, code groupe) marche **100 % hors ligne** car tout est vérifié localement.

### 5.3 Bonus (plus tard) : sans aucun réseau
- Mode « à côté » : échanger des messages entre téléphones proches sans internet, via Bluetooth / Wi-Fi Direct (ex. `react-native-ble-plx`, Multipeer Connectivity sur iOS).
- Les messages restent chiffrés avec la même clé de groupe et sont renvoyés au serveur dès qu'un des téléphones retrouve internet.

---

## 6. Modèle de données (Neon Postgres)

```sql
-- Accès uniquement via l'API (jamais de connexion directe depuis l'app).
-- L'API vérifie toujours que l'utilisateur est membre du groupe.
-- Optionnel : RLS Postgres en plus (via Neon Data API / Neon Auth).

profiles (
  id uuid pk references auth.users,
  username text unique,
  public_key_box text,      -- X25519, base64
  public_key_sign text,     -- Ed25519, base64
  created_at timestamptz
)

invites (
  code_hash text pk,        -- hash du code d'invitation
  created_by uuid references profiles,
  used_by uuid null,
  expires_at timestamptz
)

groups (
  id uuid pk,
  encrypted_meta text,      -- nom + avatar chiffrés avec la clé de groupe
  code_hash text,           -- Argon2id du code de groupe (pour rejoindre)
  current_key_version int,
  created_by uuid,
  ephemeral_seconds int null,
  created_at timestamptz
)

group_members (
  group_id uuid, user_id uuid, role text,  -- 'admin' | 'member'
  joined_at timestamptz,
  primary key (group_id, user_id)
)

group_keys (
  group_id uuid, user_id uuid, key_version int,
  sealed_key text,          -- clé de groupe scellée pour ce membre
  primary key (group_id, user_id, key_version)
)

messages (
  id uuid pk,
  client_id uuid unique,    -- généré sur le téléphone, anti-doublon offline
  group_id uuid,
  sender_id uuid,
  key_version int,
  nonce text,
  ciphertext text,
  signature text,
  created_at timestamptz,
  expires_at timestamptz null
)

join_attempts (user_id uuid, group_id uuid, attempted_at timestamptz)
```

- Index : `messages (group_id, created_at)` pour la resynchro rapide.
- Temps réel : WebSocket dans la Neon Function ; chaque instance interroge `messages` (curseur `seq` + petite fenêtre de recouvrement, dédoublonnage par `id`). `LISTEN/NOTIFY` seulement si on passe en compute toujours allumé.
- Purge des messages expirés : Function Trigger (cron) Neon.
- Inscription publique **désactivée** : création de compte uniquement via une route API qui consomme un code d'invitation valide.
- Tâche planifiée (cron Neon / Vercel Cron) pour supprimer les messages expirés.
- Utiliser une **branche Neon** `dev` pour développer et tester, `main` pour la prod.

---

## 7. Écrans à construire

1. `LockScreen` — carré central + pavé numérique 6 chiffres
2. `Onboarding` — invitation → pseudo → création du code app → génération des clés
3. `GroupsList` — deux espaces : les groupes verrouillés, et les discussions privées
4. `GroupUnlockModal` — saisie du code de groupe
5. `Chat` — conversation
6. `CreateGroup` / `JoinGroup` — création (nom, code, membres) / rejoindre
7. `GroupSettings` — mots-clés (masqués : le code du groupe les révèle, un code faux compte comme un essai), membres, affichage de la discussion (terminal / avec avatars, sur ce téléphone), éphémère, changer le code, quitter
8. `Settings` — profil, code app, auto-lock, biométrie, empreinte de sécurité
9. `NewDirect` — discussion privée avec un membre d'un groupe commun : choix du code (deux fois), ou ouverture de celle qui existe

Composants partagés : `PinPad`, `PinDots`, `VaultSquare` (animation), `MessageBubble`, `LockBadge`.

---

## 8. Direction artistique

Charte « la lame » (octobre 2026) : un coffre noir dont l’acier reste sombre et neutre, éclairé par deux lumières. La froide (bleu ciel) est la lumière de l’information ; la chaude (vert phosphore d’un terminal) celle de l’action. Une troisième, le rouge néon, est réservée à ce qui a échoué ou est fermé. Des filets pâles font les reflets.

**Règle de grammaire : le coffre est l’objet, le terminal est ce qu’affichent ses écrans.** Trois couches, et rien d’autre :

1. **La carrosserie, en acier** : panneaux, touches, barres, volet. Une seule famille de conteneurs (`Panel`) et de touches biseautées (`Key`), la lumière vient du haut à gauche, une touche pressée inverse son biseau.
2. **Les écrans, en verre LCD** (`Screen`) : tout ce qui affiche ou prend de la donnée (code, invitation, mots-clés, champs de saisie, compteur de non-lus, fil des messages). Le texte « donnée » est en monospace, précédé d’une invite `❯`.
3. **Les lumières** : bleu = information, vert = action, rouge = erreur / fermé, filament = reflet. Les étiquettes gravées (`Label`) sont en petites capitales monospace.

Pas d’emoji dans l’interface : icônes lucide (traits) ou SVG maison. L’univers ne doit jamais coûter en lisibilité : corps de texte en police système, tailles ≥ 13, contrastes ≥ 6:1.

| Rôle | Couleur | Usage |
|---|---|---|
| Fond | `#000000` | Partout. Surfaces `#0A0D10` / `#161B20`, bordures `#262D34`, acier des touches et plaques (voir `steel` dans `theme.ts`). |
| Texte | `#FFFFFF`, secondaire `#8A95A0` | |
| Bleu ciel clair (pointe du haut) | `#7FE6FF` | Caractères allumés des écrans LCD (code, invitation, mots-clés, numéro de sécurité, compteur de non-lus). 14,7:1 sur noir. |
| Bleu ciel (haut de la lame) | `#4FC3FF` | Traits, liens, icônes, teinte du header, invite `❯` des champs ; LED « ok / ouvert » ; rétroéclairage du lecteur d’empreinte ; entrées des autres dans le chat. 10,6:1 sur noir. Aplats froids (option choisie) en acier bleu `#0E2E42` (texte blanc 14:1). |
| Phosphore pâle (transition) | `#8CFF8C` | Arêtes éclairées des touches d’action, texte tapé au prompt du chat, lumière du portail. 16:1 sur noir. |
| Vert terminal (bas de la lame et pointe) | `#33FF33` | « Secrète » du wordmark, invite `❯` et entrées à moi dans le chat, cœur du portail. Touches d’action (envoi, ouvrir, confirmer, continuer) : aplat `#0F5A28` (texte blanc 7,5:1), arête phosphore, dessous `#073018`, halo vert à 35 %. |
| Rouge néon (alerte) | `#FF3B4E` | LED « erreur / fermé », envoi échoué, « FERMÉ » sur la liste, ce qui ne se défait pas ; couleur de l’icône de notification. Touche destructrice : `#3A0B10` à l’arête rouge. |
| Filets lumineux | `#EAFCFF` à ~55 % | LED « en cours », glints, écran du code qui flashe quand il est accepté, bulles du portail. |

- Écrans LCD du coffre : verre `#060B10`, caractères éteints `#17303D`, biseau inversé (sombre en haut).
- LED d’état (écran du code, liste des groupes, messages, invitations) : éteinte `#1A2026`, **en cours** filament, **ok / ouvert** bleu ciel, **erreur / fermé** rouge néon.
- Portail du coffre : bord bleu ciel clair, corps du bleu (bord) au vert (cœur), courants phosphore et filaments pâles.
- Logo : l’œil blanc, la serrure en dégradé vertical bleu ciel clair → vert.
- Réactions : bleu ciel, or `#D3B03A` (la couronne, seule teinte hors lame : une couronne est en or), phosphore pâle, rouge néon (la flamme), bleu ciel clair.
- Typo : Space Grotesk (wordmark, titres, chiffres du pavé, touches) ; corps en police système ; monospace sur les écrans LCD, les étiquettes gravées et le fil du chat.
- Ambiance : coffre-fort / club privé. Peu d’éléments, beaucoup de noir, animations courtes et nettes.

Tout ce qui nomme une teinte vit dans `mobile/src/ui/theme.ts` (`blade`, `colors`, `glow`, `wash`, `led`, `lcd`, `steel`, `hotKey`, `dangerKey`, `coldPlate`, `hotPlate`, `calm`) ; les couleurs des réactions dans `chat/reactions.ts`. Les primitives : `ui/Key.tsx`, `ui/Panel.tsx`, `ui/Screen.tsx` (`Screen`, `Field`), `ui/Label.tsx`, `ui/Segment.tsx`. Revenir à la piste rouge (rouge comme lumière d’action) se fait dans `theme.ts`, sans toucher aux écrans : c’est l’historique git de ce fichier.

### Pistes écartées
| Nom | Accent | Ambiance |
|---|---|---|
| Or Coffre | `#D4AF37` | Luxe, coffre-fort (première DA, remplacée par l’anthracite `#383E42` + vert forêt `#1E6B34`, puis par la lame) |
| Rouge néon en lumière d’action | `#FF3B4E` | Première version de la lame (octobre 2026) : le rouge disait à la fois « envoyer » et « fermé » |
| Violet Néon | `#9B5CFF` | Moderne, nocturne, fun entre potes |

---

## 9. Roadmap

**MVP (v0.1)**
- [ ] Projet Expo + TypeScript + Expo Router + NativeWind
- [ ] Neon : projet + branches dev/main + tables (Drizzle) + migrations
- [ ] API (Hono sur Neon Functions) : invitation, auth, groupes, messages, rate limit
- [ ] Génération des clés + stockage sécurisé
- [ ] LockScreen avec code app (Argon2id + Secure Store + limite d'essais)
- [ ] Création / rejoindre un groupe avec code
- [ ] Messages texte E2EE en temps réel (WebSocket)
- [ ] Marche en Wi-Fi et 4G/5G, reconnexion auto au changement de réseau
- [ ] Offline : lecture locale + file d'envoi + resynchro
- [ ] Reverrouillage auto en arrière-plan

**v0.2**
- [x] Images et vocaux chiffrés
- [x] Notifications push (nom du groupe ajouté par le téléphone, jamais le contenu)
- [ ] Messages éphémères
- [ ] Rotation de clé à la sortie d'un membre

**v0.3**
- [ ] Biométrie, empreinte de sécurité, réactions, réponses
- [ ] Blocage captures d'écran, auto-destruction après X échecs
- [ ] Multi-appareils via QR code
- [ ] Mode « à côté » sans internet (Bluetooth / Wi-Fi Direct)

---

## 10. Consignes pour Claude Code

1. Commencer par le module `crypto/` (wrapper libsodium) avec **tests unitaires** : chiffrer → déchiffrer, mauvaise clé → échec, signature invalide → rejet.
2. Aucune donnée déchiffrée ne doit transiter par le réseau, être loggée ou stockée hors du stockage chiffré.
3. L'app ne parle **jamais** directement à Neon : la chaîne de connexion reste côté serveur (variables d'env). Chaque route API vérifie l'appartenance au groupe.
4. Ne jamais utiliser `AsyncStorage` pour quoi que ce soit de sensible.
5. Garder la logique crypto séparée de l'UI (`/crypto`, `/services/api`, `/services/sync`, `/features/*`).
6. Tester les cas réseau : mode avion, bascule Wi-Fi → 4G pendant un envoi, réseau très lent, retour du réseau avec 50 messages en file.
7. Avant chaque fonctionnalité, expliquer brièvement le flux de clés concerné.
8. Prévoir un audit de sécurité externe avant d'utiliser l'app au quotidien.
