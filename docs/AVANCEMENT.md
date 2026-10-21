# BaseSecrète — Avancement

État du projet au 20/10/2026 (mis à jour après le lot sécurité : empreinte, auto-destruction, captures, hors connexion) : les derniers ajouts et changements, puis le plan du projet avec ce qui est fait et ce qui reste. La spec de référence est [SPEC.md](SPEC.md).

## Derniers ajouts et changements

### Stories (20/10)

- **Une bande « STORIES · 24 H »** en haut de chaque conversation, **repliée** par défaut : on ne voit que son bord (LED verte s'il y a des nouvelles, « 3 NOUVELLES », touche verte « + »). On la **tire vers le bas** (ou on touche le bord) et elle se déroule comme un **rideau de fer** (lames d'acier, fentes d'aération décalées comme la grille d'un coffre-fort, le bord replié en est la barre du bas avec sa poignée) **sur les messages, jusqu'à la zone de saisie** (jamais par-dessus) : c'est **la photo elle-même qui descend avec la poignée** et elle est tout le rideau, jusqu'à la zone de saisie : la photo **entière** (jamais recadrée), aussi grande que possible et centrée, et derrière elle la même photo floutée qui remplit le reste, comme une story (la grille d'acier ne se voit plus que sans story). **Toucher la moitié droite** passe à la suivante, **la moitié gauche** revient à la précédente (un glissement horizontal marche aussi) ; après la dernière, un toucher à droite replie le rideau. Ouverte directement sur la première pas encore vue, de la plus ancienne à la plus récente ; la barre affiche « 2 / 5 ». Sans story, le **logo (l'œil à la serrure dorée) + « Story »** sur une plaque sombre au centre du rideau, qu'on touche pour en ajouter une. Chaque photo porte l'avatar, le pseudo, « il y a 2 h » et les heures restantes. Un court tirage (quelques dizaines de pixels) suffit à l'ouvrir, elle ne rebondit pas comme un « tirer pour rafraîchir » ; on la replie en la remontant (ou en touchant la barre). Les bandeaux (hors ligne, autodestruction, demandes d'accès, admins changés) restent au-dessus de la barre : le rideau ne les recouvre jamais. Testé sur l'émulateur Android (Pixel 9, build dev) avec trois photos de formats différents. Le rideau est une translation animée nativement (pas une hauteur animée) : au repliage, la barre ne saute plus en bas de l'écran avant de remonter (un re-rendu recréait le nœud animé à partir d'une valeur périmée).
- **Ajouter une story** : « + » → panneau avec **Prendre une photo** ou **Choisir dans la galerie**, puis aperçu plein écran et « Publier la story ». La photo part par la même file d'envoi que les images (hors ligne : elle attend le réseau ; refus du serveur : « ÉCHEC » et LED rouge sur le bord de la bande, avec « Réessayer » ou « Abandonner »).
- **Regarder** : la photo à l'écran compte comme vue. Un **appui long** l'ouvre en plein écran, où **Enregistrer dans la galerie** est possible, avec le rappel que la photo n'y est plus chiffrée et ne disparaît plus. (Remplace la bande de 200 px avec les petites cartes côte à côte du premier jet, et avant elle le visionneur plein écran façon Instagram avec défilement automatique.)
- **Chiffrement** : identique aux images (recompression JPEG sans métadonnées, clé de fichier aléatoire, clé transportée dans un message de groupe chiffré et signé). Nouveau corps de message `kind: 'story'`. Le serveur reçoit `expiresInSeconds: 86400` et fixe la date de suppression à 24 h (ou moins si le groupe efface déjà plus vite) ; la purge (toutes les 6 h) supprime message et fichier. Le serveur ne sait pas que c'est une story, seulement que le message vit 24 h.
- **Vu / pas vu** reste sur le téléphone (store local chiffré, `stories/<groupe>`), effacé avec le groupe. Pas de « vu par » envoyé aux autres.
- Les stories ne sont **pas dans le fil** de la conversation et ne peuvent pas être citées en réponse. Elles ne sont visibles qu'une fois le groupe ouvert avec son code (la liste des groupes ne les montre pas : la clé n'est pas disponible avant).
- **Permission caméra rétablie** (elle avait été retirée) : « BaseSecrète utilise l'appareil photo pour les stories et les photos que tu envoies, chiffrées, dans tes groupes. » Nouveau build nécessaire.
- Tests : corps `story` (aller-retour, refus d'une réponse, validation comme une image), ordre de la bande, photo d'ouverture, tapes gauche/droite et taille de la photo dans le rideau (`ui/stories/stories.ts`), libellé « il y a… ».
- Au passage : le texte « Coffre ouvert » d'une conversation vide s'affichait à l'envers (la liste inversée le remettait déjà à l'endroit, l'app le retournait une seconde fois). Corrigé.

### Notifications (20/10)

- Un message reçu fait sonner le téléphone avec **une seule phrase : « uçer egassem »** (« message reçu » à l'envers). Pas de titre, pas de nom, pas de groupe, pas de texte du message.
- Quand le groupe attend quelqu'un, la phrase est **« esiuqer noitca »** (« action requise ») : l'admin a une demande d'accès à accepter ou un membre est parti (la clé se renouvelle dès qu'il ouvre le groupe), le nouveau membre a été accepté et doit entrer le code du groupe, ou l'admin a changé le code et chacun doit entrer le nouveau.
- **Toucher la notification** ouvre l'app sur l'écran du coffre : code app (ou empreinte), puis code du groupe, puis **directement la bonne conversation**.
- Au plus une notification toutes les 30 s par téléphone : un groupe actif ne sonne pas sans arrêt.
- La permission est demandée au premier déverrouillage. Réglages → Sécurité → Notifications montre l'état, avec un bouton si elles sont refusées.
- **Ce que voient les services de notification** (Expo, Google, Apple) : qu'un téléphone a reçu « un message », et l'identifiant du groupe (un UUID aléatoire, pour ouvrir la bonne conversation). Rien d'autre.
- Serveur : table `push_tokens` (migration `0011_push_tokens`), routes `PUT/DELETE /me/push-token`. L'envoi part après chaque message vers les autres membres actifs. Les téléphones qui ont désinstallé l'app sont oubliés.
- Il faut un nouveau build. Sur Android, il faut aussi des identifiants Firebase pour le service Expo (`google-services.json` + clé FCM V1 envoyée sur EAS).

### Autorisations vérifiées (20/10)

- **Micro corrigé** : l'option `microphonePermission: false` du sélecteur de photos retirait le micro de toute l'app. Sur Android, `RECORD_AUDIO` était supprimé, et sur iOS il manquait la phrase d'autorisation. Les vocaux ne pouvaient donc pas s'enregistrer. C'est corrigé.
- **Lecture en arrière-plan retirée** : `FOREGROUND_SERVICE` et `FOREGROUND_SERVICE_MEDIA_PLAYBACK` ne sont plus demandés. Un vocal s'arrête quand on quitte l'app, qui de toute façon se masque.
- Restent : internet, vibration, micro, biométrie, photos (lecture pour le sélecteur, écriture pour « Enregistrer dans la galerie »), notifications. La caméra, retirée à ce moment-là, est revenue avec les stories (voir plus haut).
- À revoir avant le Play Store : `READ_MEDIA_IMAGES` (Google limite cette permission), et `SYSTEM_ALERT_WINDOW`, ajouté par le build de développement.

### Mot de passe affiché à l'envers (20/10)

- À l'inscription et à la connexion, le mot de passe s'affiche **à l'envers** au lieu des points. Le bouton **⇄ Lire** à droite du champ le remet à l'endroit, et **⇄ Envers** le retourne.
- Les suggestions du clavier sont coupées : il n'apprend pas le mot de passe.

### Ouvrir l'app avec l'empreinte (20/10)

- **Réglages → Sécurité → Empreinte digitale → Activer** : le code de l'app est redemandé, puis le téléphone demande le doigt une fois pour vérifier.
- Ensuite, la porte du coffre s'ouvre sur un **lecteur d'empreinte façon coffre-fort**, **à la place du clavier du code app**. C'est une plaque métal vissée comme le clavier, avec une fenêtre de capteur carrée en verre sombre rétroéclairé en vert, une trame et des repères de visée, et un écran LCD d'état (PRÊT, LECTURE…, ACCÈS OK, REFUSÉ) avec son voyant. On touche la fenêtre : une barre de scan la balaie de haut en bas pendant qu'on pose le doigt, puis la fenêtre flashe en vert et le coffre s'ouvre. En cas d'échec, elle flashe en rouge et la plaque tremble. « Taper le code » ramène au clavier.
- La vérification passe toujours par la fenêtre d'empreinte du système : aucune app ne peut lire le capteur elle-même, et c'est ce qui garantit que seul le vrai doigt libère la clé.
- **Empreinte seulement**, pas de reconnaissance faciale : l'option n'apparaît que sur un téléphone avec un capteur d'empreinte et un doigt enregistré.
- Comment c'est protégé : une copie de la clé maître est gardée par le Keychain (iOS, Touch ID) ou le Keystore (Android), qui ne la rend qu'après la vérification faite par le système. L'app ne voit jamais le doigt.
- **Garde-fous** :
  - le code reste demandé si on ne l'a pas tapé depuis 48 h ;
  - le code reste demandé pour ouvrir chaque groupe ;
  - ajouter un doigt au téléphone invalide la copie, et l'option se désactive ;
  - retirer le code du téléphone la supprime ;
  - l'auto-destruction l'efface en premier.

### Auto-destruction après trop de codes faux (20/10, SPEC §4.5)

- **Réglages → Sécurité → Auto-destruction** : désactivée (par défaut), 10 essais ou 20 essais, avec confirmation.
- Au Nᵉ code app faux d'affilée, tout ce que l'app garde sur le téléphone est effacé : secret de l'appareil, clé maître (et sa copie pour l'empreinte), clé matérielle, identité, groupes, base locale, photos et vocaux gardés. On revient avec « Se connecter » (pseudo + mot de passe).
- Le secret de l'appareil, la clé maître et la copie pour l'empreinte partent **en premier**. Un effacement interrompu ne laisse rien de lisible, et le lancement suivant le termine.
- Un essai compté puis interrompu (app tuée) compte aussi pour le seuil.
- À l'approche du seuil, l'écran de verrouillage prévient : « effacement de l'app après 3 essais de plus ».
- Seul le code app compte : les codes de groupe gardent leurs délais.

### Captures d'écran : au choix (20/10)

- **Réglages → Sécurité → Captures d'écran** : autorisées (par défaut, comme avant) ou bloquées.
- Bloquées : ni capture ni enregistrement de l'écran dans l'app (`FLAG_SECURE` sur Android, iOS 13+). Le réglage vaut pour ce téléphone et s'applique dès le lancement, écran de verrouillage compris.

### Hors connexion : lecture, file d'envoi, photos et vocaux (20/10, SPEC §5.2)

- Les messages reçus sont gardés sur le téléphone, dans une base SQLite (`expo-sqlite`).
- Sans réseau : la liste des groupes s'affiche (bandeau « Hors ligne »), un groupe s'ouvre avec son code (mêmes vérifications : signatures, révision de la meta), et la conversation se relit.
- **Chiffrement** : chaque ligne est scellée (XChaCha20-Poly1305) avec une clé tirée de la clé maître. Les identifiants de groupe sont hachés avec une clé. Les messages restent sous leur forme serveur, chiffrés et signés avec la clé de groupe : relire un groupe demande toujours son code.
- Aussi gardés : la dernière liste des groupes (avec les remises de clé) et les profils des membres (noms, avatars). Les clés des contacts restent celles épinglées dans le coffre.
- **File d'envoi** : un message écrit sans réseau reste en attente (⏳), même si l'app est fermée ou verrouillée, et part tout seul dans l'ordre au retour du réseau. Une photo ou un vocal déjà envoyé sur le serveur n'est pas renvoyé.
- **Photos et vocaux** vus ou envoyés : gardés chiffrés comme sur le serveur (fichier au nom haché), utilisables hors connexion. Leur clé n'existe que dans le message. Les 300 plus récents sont gardés.
- Les messages éphémères expirés sont supprimés à chaque déverrouillage. Un effacement d'historique est appliqué au retour du réseau. Quitter un groupe ou une autodestruction efface aussi sa copie locale.

### Audit de sécurité et protocole v2 (19/10)

Un audit (serveur, chiffrement, app) a trouvé deux failles critiques : le serveur pouvait remettre aux téléphones une clé de groupe qu'il avait choisie, et ajouter un membre fantôme ou remplacer la clé d'un membre (les téléphones lui partageaient alors la clé). Tout ce qui a été trouvé est corrigé :

- **Entrée dans un groupe sur validation** : le code + mots-clés ne font qu'une demande ; un admin l'accepte depuis son téléphone après avoir comparé le numéro de sécurité du nouveau (Réglages > Mon numéro de sécurité). Plus de partage automatique de la clé.
- **Remises de clé signées** par l'admin et chiffrées sous une clé tirée du code + mots-clés ; **meta signée** (admins, membres, révision). Clés des contacts **épinglées** sur le téléphone.
- **Le code et les mots-clés ne partent plus au serveur** (seulement un dérivé Argon2id). Avec le seul mot de passe du compte, on n'ouvre aucun groupe : il faut aussi le code + les mots-clés.
- **Membre retiré banni** et rotation immédiate de la clé ; seul un admin fait tourner la clé ; le dernier admin passe la main avant de partir.
- **Argon2id 64 Mo** partout via un **module natif** (`mobile/modules/bs-native`, Argon2 de référence + clé matérielle Secure Enclave / Keystore) ; la sauvegarde par mot de passe refuse un coût plus faible demandé par le serveur ; mot de passe plus exigeant.
- Compteur d'essais sur l'horloge de démarrage (changer la date ne sert à rien), essai compté avant d'être tenté ; plus de contournement du verrouillage par le sélecteur de photos.
- Serveur : quotas (invitations, groupes, messages), défi de connexion à usage unique, pseudos uniques sans tenir compte de la casse, échecs de connexion seuls comptés, WebSocket coupé à l'expiration du jeton, nettoyage des fichiers sans fuite, scripts de maintenance protégés.
- App : images piégées refusées, citations non vérifiables signalées, fichiers en clair effacés au lancement, presse-papiers vidé, liens directs vers un groupe fermé bloqués, sauvegarde Android coupée, coffre effacé à la réinstallation sur iOS.
- **Données remises à zéro** (migration `0009`) : chacun recrée son compte et ses groupes avec le nouveau build. Expo Go ne suffit plus (module natif).
- Détail des failles, des corrections et de ce qui reste à améliorer : [SECURITE.md](SECURITE.md).

### Se connecter avec pseudo + mot de passe

- À l'**inscription**, on choisit en plus un **mot de passe** (10 caractères minimum, saisi 2 fois), en plus du code app à 6 chiffres.
- Sur la page d'accueil, le lien **« Déjà un compte ? Se connecter »** demande le pseudo et le mot de passe. On choisit ensuite un nouveau code app pour ce téléphone. Ça sert après une réinstallation, un nouveau build ou un changement de téléphone.
- Après la reconnexion, les groupes s'ouvrent avec leur code comme à la première ouverture : les clés de groupe sont déjà sur le serveur, chiffrées pour le compte.

**Côté sécurité**
- Le téléphone chiffre une copie des clés privées avec une clé tirée du mot de passe (Argon2id 4 Mio / 3 passes, lié au pseudo). Le serveur garde cette copie, sans pouvoir l'ouvrir.
- Le code à 6 chiffres n'est jamais utilisé pour ça : avec seulement un million de valeurs, il se devinerait hors ligne.
- Le serveur ne rend la copie que si on prouve qu'on connaît le mot de passe. Il garde seulement un HMAC de cette preuve. Il limite à **5 essais par heure et par pseudo**. Il chiffre aussi la copie avec sa propre clé secrète : une fuite de la base seule ne suffit pas pour tester des mots de passe.
- Pour un pseudo inconnu, le serveur répond avec des paramètres factices mais stables. On ne peut donc pas savoir quels pseudos existent.
- Les comptes créés avant n'ont pas de sauvegarde. `server/scripts/reset-account.ts <pseudo>` libère le pseudo (compte et groupes où il était seul) et donne une invitation pour se réinscrire. Utilisé le 19/10 pour `lipreux-x`, dont les clés étaient perdues.

### Effacer des jours de conversation

- Dans la conversation, l'**admin** fait un **appui long sur une date** (« LUN. 19 OCT. ») et choisit : **ce jour**, **ce jour et la veille**, ou **les 7 jours jusqu'à ce jour**. Une confirmation suit.
- Les messages, **les photos et les vocaux** de la période sont effacés **pour tous les membres**, sur le serveur comme dans le stockage des images.
- Les téléphones qui ont la conversation ouverte la rechargent tout de suite. Ceux qui étaient hors ligne la rechargent à leur retour.
- Le serveur ne garde aucune trace de la période effacée, seulement le fait que l'historique a changé (table `group_purges`).
- Un membre qui n'est pas admin ne peut rien effacer.

### Groupes éphémères (autodestruction)

- **À la création**, une étape « Durée de vie » arrive entre les mots-clés et le code. Choix : permanent, 24 h, 3 jours, 1 semaine, 1 mois, puis réglage au jour près avec − / + (365 jours au maximum).
- Un bandeau « AUTODESTRUCTION DANS 3 J » s'affiche dans la conversation. La liste des groupes montre « 💣 dans 3 j » et les réglages affichent la date.
- **À la date prévue**, le serveur cache le groupe à tout le monde : plus de messages, et il ne peut plus être rejoint. La purge (toutes les 6 h) supprime ensuite définitivement le groupe, ses membres, ses clés, ses messages, ses photos et ses tentatives d'adhésion.
- Sur les téléphones, les clés, le nom et les compteurs du groupe sont effacés. Une conversation ouverte affiche « Ce groupe n'existe plus ». C'est aussi le cas pour un groupe dont on a été retiré.
- La date ne peut pas être changée après la création.

### Réglages du groupe

Le bouton **« Réglages »** en haut de la conversation ouvre les réglages du groupe (la fiche info en fait partie) :
- **Mots-clés** et **membres** : l'admin en premier avec un badge ; les membres qui attendent encore la clé sont signalés.
- **Retirer un membre** (admin) : la clé du groupe change tout de suite, la personne retirée ne lit plus les nouveaux messages.
- **Messages éphémères** (admin) : désactivés, 24 h ou 7 jours, pour les messages envoyés ensuite.
- **Changer le code et les mots-clés** (admin). Les autres membres tapent l'ancien code à leur prochaine ouverture du groupe, puis le téléphone leur demande le nouveau.
- **Quitter le groupe** : les clés du groupe sont effacées du téléphone. Si le dernier admin part, le membre le plus ancien devient admin. Le dernier membre qui part supprime le groupe.

**Rotation de clé** (SPEC §4.3) : quand un membre part ou est retiré, le premier membre restant qui ouvre le groupe crée une nouvelle clé et la donne, chiffrée, à chacun des membres restants. Le serveur refuse une rotation qui oublierait un membre ou en inclurait un parti. Les anciens messages restent lisibles. Le déverrouillage ne coûte toujours qu'un seul calcul Argon2id, même après plusieurs rotations.


### Rejoindre un groupe : code + 3 mots-clés

- **Création d'un groupe** : nom → **3 mots-clés** → code → confirmation du code.
- **Rejoindre** : code du groupe → les 3 mots-clés. Plus besoin de l'identifiant du groupe : le code seul trouve le groupe (les codes sont uniques).
- Les majuscules, les accents, les espaces en trop et l'ordre des mots ne comptent pas : « Été plage soleil » = « soleil PLAGE ete ».
- Un échec répond toujours « Code ou mots-clés incorrects », sans dire lequel des deux est faux. La limite de 5 essais par heure s'applique toujours.
- Les groupes créés avant cette fonction n'ont pas de mots-clés : le code suffit pour les rejoindre.

**Côté sécurité**
- Le serveur ne garde qu'un hash Argon2id des mots-clés (colonne `keywords_hash`), comme pour le code du groupe.
- Les membres retrouvent les mots-clés en clair dans la fiche du groupe. Ils sont stockés chiffrés avec la clé de groupe, à côté du nom (`encrypted_meta`). Le serveur ne les stocke jamais en clair.

### Fiche info du groupe

Un bouton **« Infos »** en haut de la conversation ouvre la fiche du groupe :
- les **3 mots-clés** pour rejoindre ;
- les **membres**, l'**admin** en premier avec un badge, « (toi) » à côté de son propre nom ;
- les membres qui attendent encore la clé du groupe.

### Saisie des codes façon coffre-fort

Le changement s'applique à tous les écrans de code : verrouillage, inscription, création, ouverture et adhésion à un groupe.
- **Écran rétroéclairé** : `-` pour une case vide, `*` pour un chiffre tapé (le chiffre n'est jamais affiché).
- **Voyant** : gris au repos, ambre pendant la vérification, rouge si le code est faux.
- **Clavier** : touches métal carrées en relief sur une plaque vissée. La touche `C` efface tout, `⌫` efface un chiffre.

### Divers

- **ESLint** : la config Expo est ajoutée ; lancer `npm run lint` dans `mobile/`.
- **Expo Go** : l'app tourne dans Expo Go grâce à une version 100 % JavaScript de la crypto.
- **Couleur d'accent** : gris anthracite au lieu de l'or.

### Coûts d'hébergement (Neon, plan Free)

- Mesuré le 20/10 : 7 profils, 3 groupes, 92 messages, 12 fichiers (1,4 Mo). Base : ~1 Mo de données utiles sur 1 Go autorisé ; bucket : 1,4 Mo sur 5 Go. Le stockage n'est pas la contrainte (de l'ordre du million de messages texte, ou ~40 000 images, avant d'y toucher).
- Ce qui compte, c'est le **temps éveillé** : 100 CU-heures de Postgres par mois (soit 400 h à 0,25 CU) et 400 h « waiting » de Function. Les deux se consomment tant qu'un WebSocket est ouvert (le serveur interroge Postgres chaque seconde pour ses clients connectés). Quota dépassé = compute suspendu jusqu'au mois suivant.
- Réductions faites le 21/10 :
  - L'app ferme son WebSocket quand elle passe en arrière-plan et le rouvre au retour (resync HTTP) ; les notifications push couvrent l'absence. Avant, un téléphone laissé sur une conversation gardait le serveur éveillé.
  - Purge planifiée toutes les 6 h au lieu de chaque heure : chaque réveil coûte ~5 min de compute (délai de mise en veille), soit ~16 CU-h/mois pour le cron horaire, par branche déployée. Les données expirées sont déjà invisibles dans toutes les requêtes, la purge ne fait que libérer de la place.
- Reste à surveiller dans la console Neon (page Usage du projet) : heures de Function et CU-heures. Au-delà du Free, le plan Launch facture 0,106 $/CU-h et 0,025 $/h de Function en attente, soit ~37 $/mois dans le pire cas (serveur éveillé 24 h/24).
- La branche `dev` consomme le même quota : son cron et ses tests comptent aussi.

### Production (branche Neon `main`)

- 20/10 : migrations `0000` à `0011` appliquées, API, bucket `attachments` et purge planifiée déployés, avec des secrets propres à la prod (`server/.env.production`, jamais commité). Smoke test passé contre l'API déployée. Première invitation créée.
- API : `https://br-green-silence-bahz9z6m-api.compute.c-8.eu-central-1.aws.neon.tech/`.
- Les profils EAS `preview` (APK Android à partager) et `production` (iOS, TestFlight) pointent sur cette API ; `development` reste sur `dev`.
- Déployer : `neon deploy --branch main --env .env.production --no-env-pull` dans `server/`.

### Mise en production (branche Neon `dev`)

- Notifications (20/10) : migration `0011_push_tokens` appliquée, API redéployée. Vérifié : `/health` répond, `PUT /me/push-token` refuse sans connexion (401). Pas encore testé de bout en bout : il manque les identifiants Firebase et un nouveau build.
- Se connecter (19/10) : migration `0008_account_backup` appliquée (colonnes `backup_*` dans `profiles`, table `login_attempts`), API redéployée, smoke test et test e2e de l'app passés contre l'API déployée.

- Effacement + groupes éphémères (19/10) : migration `0007_group_expiry_purges` appliquée, API redéployée, smoke test passé contre l'API déployée (effacement réservé à l'admin, rechargement signalé, date d'autodestruction vérifiée, groupe expiré caché et impossible à rejoindre).
- Migration `0002_group_keywords` appliquée.
- Avatars (19/10) : migrations `0005_profile_avatar` et `0006_avatar_icons` (passage aux icônes Lucide, anciens choix convertis) appliquées, API redéployée, test e2e passé (choix visible par un membre du groupe, valeur hors liste refusée).
- Images (19/10) : migration `0004_attachments` appliquée, bucket privé `attachments` créé, API redéployée. Test e2e passé contre l'API déployée (envoi, réception et déchiffrement d'une image, réutilisation refusée). Un upload d'une taille différente de celle annoncée est bien refusé (403).
- API déployée : `https://br-muddy-bar-barqix1g-api.compute.c-8.eu-central-1.aws.neon.tech/`.
- Smoke test passé contre l'API déployée (inscription, groupes, code + mots-clés, chat chiffré, temps réel, limite d'essais).

## Historique des commits

| Commit | Date | Changement |
|---|---|---|
| `74a64fc` | 18/10 | Spec du projet |
| `3202fd8` | 18/10 | App Expo + module crypto E2EE |
| `315f1eb` | 18/10 | API Hono sur Neon Functions + schéma Drizzle |
| `b0d1a56` | 18/10 | Client API, coffre local, services de groupe |
| `dcd0c11` | 18/10 | Écran de verrouillage, inscription, session |
| `f2f7968` | 18/10 | Liste des groupes, créer/rejoindre, déverrouillage, chat chiffré |
| `1db1410` | 18/10 | Fonctionne dans Expo Go (crypto en JS pur) |
| `4d2f0e9` | 18/10 | Correctif : saisie de code bloquée, inscription lente |
| `90698b2` | 18/10 | Accent gris anthracite |
| `51cbc27` | 18/10 | Serveur : rejoindre avec le code seul |
| `c633c08` | 18/10 | Saisie de code façon coffre-fort |
| `04e99d1` | 18/10 | ESLint |
| `f653e59` | 18/10 | App : rejoindre avec le code seul |
| `480ddc2` | 18/10 | Serveur : 3 mots-clés avec le code |
| `de78eec` | 19/10 | App : 3 mots-clés pour créer et rejoindre |
| `a3fa1e0` | 19/10 | App : fiche info du groupe |
| `472984b` | 19/10 | Ce document |
| `e38bea8` | 19/10 | Serveur : quitter, retirer, rotation de clé, code, éphémère |
| `d550f5d` | 19/10 | App : plusieurs versions de clé + rotation automatique |
| `2e3abce` | 19/10 | App : écran Réglages du groupe |
| `0b2c0d9` | 19/10 | App : changer le code et les mots-clés |

## Plan du projet

✅ fait · 🟡 en partie · ⬜ à faire

### MVP (v0.1)

| | Fonction | État |
|---|---|---|
| ✅ | Projet Expo + TypeScript + Expo Router | Fait. Les styles utilisent `StyleSheet`, pas NativeWind. |
| ✅ | Neon : tables Drizzle + migrations | Fait sur la branche `dev`. La branche de production reste à préparer. |
| ✅ | API Hono : invitations, auth, groupes, messages, limite d'essais | Fait |
| ✅ | Clés d'identité + stockage sécurisé | Fait |
| ✅ | Écran de verrouillage : code app, Argon2id, Secure Store, limite d'essais | Fait |
| ✅ | Créer / rejoindre un groupe avec code | Fait, avec en plus les 3 mots-clés |
| ✅ | Messages texte E2EE en temps réel (WebSocket) | Fait |
| 🟡 | Wi-Fi et 4G/5G, reconnexion automatique | Reconnexion + resynchro codées, à tester en vrai en changeant de réseau |
| ✅ | Hors connexion : lecture locale, file d'envoi, resynchro | Fait : lecture hors connexion (SQLite, lignes scellées), file d'envoi gardée qui part au retour du réseau, photos et vocaux gardés chiffrés, resynchro. |
| ✅ | Reverrouillage automatique en arrière-plan | Fait |

### v0.2

| | Fonction | État |
|---|---|---|
| ✅ | Images et vocaux chiffrés | Images : envoi depuis la galerie (recompressées en JPEG, métadonnées GPS retirées), chiffrées avec une clé par fichier, stockées dans un bucket Neon privé, affichées en mémoire seulement, et enregistrables dans la galerie depuis la vue plein écran. Vocaux : bouton micro quand le champ est vide, enregistrement AAC mono 32 kb/s (5 min max), chiffrés comme les images (clé par fichier, même bucket, aucun changement serveur), forme d'onde dans le message chiffré, lecture au toucher. Comme sur les messageries courantes : toucher la forme d'onde saute à cet endroit, la glisser fait défiler ; bouton de vitesse 1× / 1,5× / 2× (gardée d'un vocal à l'autre pendant la session) ; un vocal terminé enchaîne sur le suivant de la conversation, jusqu'à une pause, un autre vocal lancé ou la sortie de la conversation. Le fichier de l'enregistreur est lu puis supprimé aussitôt ; pour l'écoute, l'audio déchiffré passe par un fichier temporaire du cache, supprimé au vocal suivant et au verrouillage (avec tout ce que l'enregistreur aurait laissé). Quitter l'app pendant un enregistrement l'annule. À tester sur téléphone (nouvelle build : module natif expo-audio). |
| ✅ | Notifications push génériques | Fait : « uçer egassem » (message) et « esiuqer noitca » (demande d'accès, acceptation, nouveau code, départ d'un membre) ; le toucher demande les codes puis ouvre le groupe. Il manque les identifiants Firebase pour Android. |
| ✅ | Messages éphémères | Fait : réglage admin dans les réglages du groupe, purge toutes les 6 h sur le serveur |
| ✅ | Rotation de clé quand un membre part | Fait, avec « quitter » et « retirer un membre » |

### v0.3

| | Fonction | État |
|---|---|---|
| 🟡 | Biométrie, empreinte de sécurité, réactions, réponses | Réponses faites : appui long sur un message → Répondre (ou Copier), la citation est chiffrée dans la réponse et un tap dessus ramène au message d'origine. Empreinte de sécurité faite (audit v2). Ouverture de l'app par l'empreinte faite (pas de reconnaissance faciale). Réactions à faire. |
| ✅ | Blocage des captures d'écran, auto-destruction après X échecs | Fait : captures bloquées en option dans les Réglages ; effacement de tout le téléphone après 10 ou 20 codes app faux (option) |
| ⬜ | Multi-appareils via QR code | À faire |
| ⬜ | Mode « à côté » sans internet (Bluetooth / Wi-Fi Direct) | À faire |

### Prochaines étapes proposées

1. **Build EAS de développement** et test sur téléphone : empreinte, mode avion, retour du réseau avec des messages en file, auto-destruction.
2. **Qualité** : corriger les 12 erreurs ESLint restantes (`VaultSquare.tsx`, `SessionProvider.tsx`, `CodeEntry.tsx`) et accélérer les tests crypto (la suite complète prend environ 40 min).
3. **Production** : préparer la branche Neon de production et un build EAS de développement.
