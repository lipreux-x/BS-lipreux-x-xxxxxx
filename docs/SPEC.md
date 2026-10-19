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
| Biométrie | `expo-local-authentication` + `expo-secure-store` | Option : ouvrir l'app avec l'empreinte (pas de reconnaissance faciale) |
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
- Chaque membre reçoit la clé en **remise** (table `group_keys`, une ligne par membre et par version) : chiffrée sous la clé dérivée du code + mots-clés (`wrapKey`, §4.4), scellée à sa clé publique (`crypto_box_seal`), et **signée par l'admin** qui la remet. Le serveur ne peut ni lire une remise, ni en fabriquer une, ni en donner une à quelqu'un.
- La **meta** du groupe (nom, avatar, mots-clés, admins, membres, numéro de révision) est chiffrée avec la clé de groupe et **signée par un admin**. Les téléphones suivent ses listes, jamais celles du serveur, et refusent une révision plus ancienne que celle déjà vue.
- **Entrer dans un groupe** : le code + mots-clés ne font qu'une **demande**. Un admin l'accepte depuis son téléphone (après avoir comparé l'empreinte du nouveau, §4.7) : c'est ce qui lui remet la clé et l'ajoute à la meta. Le serveur ne peut pas ajouter de membre fantôme.
- Messages chiffrés avec **XChaCha20-Poly1305** (`crypto_aead_xchacha20poly1305_ietf`) + nonce aléatoire, et **signés** par l'expéditeur (Ed25519), vérifiés avec sa clé **épinglée** sur le téléphone.
- Quand un membre quitte / est retiré → **rotation de clé** par un admin : nouvelle clé remise aux seuls membres de la meta encore présents (tout de suite quand l'admin retire quelqu'un). Les anciens messages restent lisibles avec l'ancienne clé (versionnage `key_version`). Un membre retiré est **banni** : le code qu'il connaît ne lui permet plus de redemander à entrer.
- Le dernier admin désigne un autre admin (meta signée) avant de pouvoir partir.

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
- Empreinte (fait) : optionnelle, pour ouvrir l'app à la place du code app. Une copie de la clé maître est gardée dans le Keychain/Keystore avec authentification biométrique obligatoire (`requireAuthentication`, invalidée si un doigt est ajouté, `WHEN_PASSCODE_SET_THIS_DEVICE_ONLY`). Offerte seulement avec un capteur d'empreinte. Activation avec le code app ; code redemandé après 48 h sans l'avoir tapé ; les groupes demandent toujours leur code.
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
- Notifications push : texte générique, aucun nom de groupe ni contenu.
  - Fait : une seule phrase, « uçer egassem » (« message reçu » à l'envers), sans titre. Les données ne portent que l'id du groupe (UUID). Le toucher ouvre l'écran du coffre (code app ou empreinte), puis le code du groupe, puis la conversation. Au plus une notification toutes les 30 s par téléphone. Serveur : `push_tokens`, `server/src/lib/push.ts` ; app : `mobile/src/services/push.ts`.
- Images/vocaux : chiffrés côté client avant upload dans Neon Storage / R2 (URLs présignées) (clé de fichier aléatoire, elle-même chiffrée avec la clé de groupe).
  - Images (fait) : recompressées en JPEG 1600 px avant envoi, ce qui retire les métadonnées (GPS, appareil). Fichier chiffré en XChaCha20-Poly1305 avec une clé aléatoire, AD = `bs/v1/attachment` + groupe + id de la pièce jointe (`mobile/src/crypto/attachment.ts`). La clé, les dimensions et un mini-aperçu flou voyagent dans un message de groupe normal (chiffré + signé).
  - Serveur : table `attachments` + bucket privé `attachments` (clé d'objet `<groupe>/<id>`). URL d'upload valable 5 min et limitée à la taille annoncée (10 Mo max, 60 envois/h). Téléchargement réservé aux membres tant que le message existe. Le fichier est supprimé avec le message éphémère, à la fermeture du groupe, ou après 24 h s'il n'a jamais été envoyé.
  - Téléphone : images déchiffrées gardées en mémoire seulement (vidées au verrouillage). « Enregistrer dans la galerie » est un choix explicite ; l'image n'y est plus chiffrée.
- Photo de profil : jamais de vraie photo. On choisit dans Réglages une icône de la bibliothèque Lucide (lucide.dev, licence ISC) : silhouette par défaut, ou masque, espion, banque, coffre-fort, diamant, pièces d'or, butin, tirelire, clé, perceuse, guetteur. Le serveur ne stocke que l'identifiant (`profiles.avatar`, liste fermée), visible par les membres des groupes comme le pseudo. Dans le chat, l'avatar et le nom ouvrent chaque série de messages d'un membre.
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
3. `GroupsList` — liste des groupes verrouillés
4. `GroupUnlockModal` — saisie du code de groupe
5. `Chat` — conversation
6. `CreateGroup` / `JoinGroup` — création (nom, code, membres) / rejoindre
7. `GroupSettings` — membres, éphémère, changer le code, quitter
8. `Settings` — profil, code app, auto-lock, biométrie, empreinte de sécurité

Composants partagés : `PinPad`, `PinDots`, `VaultSquare` (animation), `MessageBubble`, `LockBadge`.

---

## 8. Direction artistique

- **Fond : noir (style Sephora)** `#000000`, surfaces `#0D0D0D` / `#1A1A1A`, bordures `#2A2A2A`.
- Texte : blanc `#FFFFFF`, secondaire `#8A8A8A`.
- ✅ **Accent principal : gris anthracite** — `#383E42` (RAL 7016) pour les aplats (boutons, face du coffre, texte blanc dessus : 11:1) et `#9AA1A7` pour les traits et textes sur le noir (points du code, bordures, liens : 7,8:1). Remplace l’Or Coffre initialement choisi.
- ✅ **Seconde couleur : Vert forêt `#1E6B34`** — touche d'envoi, statuts « ouvert / envoyé ». (Texte blanc dessus : contraste 6,6:1.) Mes messages sont en anthracite `#383E42` (texte blanc : 11:1), ceux des autres en métal plus sombre.
- Typo : une sans-serif géométrique (ex. *Inter* ou *Space Grotesk*), chiffres du pavé en grand.
- Ambiance : coffre-fort / club privé. Peu d'éléments, beaucoup de noir, animations courtes et nettes.
- Rayures fines noir/blanc possibles en clin d'œil Sephora (écran d'onboarding uniquement).

### Palettes d'accent proposées
| Nom | Accent | Ambiance |
|---|---|---|
| Or Coffre ⭐ | `#D4AF37` | Luxe, coffre-fort, très bien avec le noir |
| Rouge Code | `#E50035` | Alerte, passion, énergie |
| Vert Terminal | `#00FF9C` | Hacker, « base secrète » |
| Violet Néon | `#9B5CFF` | Moderne, nocturne, fun entre potes |
| Bleu Glace | `#5CE1FF` | Froid, tech, sécurisé |

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
- [ ] Notifications push génériques
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
