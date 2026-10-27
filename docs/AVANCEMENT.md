# BaseSecrète — Avancement

État du projet au 25/10/2026 (mis à jour après le retour « story publiée » et le diagnostic des notifications en prod) : les derniers ajouts et changements, puis le plan du projet avec ce qui est fait et ce qui reste. La spec de référence est [SPEC.md](SPEC.md).

## Derniers ajouts et changements

### Une couleur par compte dans les discussions (27/10)

- **Réglages → Profil → « Couleur dans les discussions »** : chacun choisit sa couleur parmi 8 (Ciel, Phosphore, Turquoise, Violet, Rose, Ambre, Orange, Or ; pas de rouge, gardé pour les erreurs) ou « Par défaut » (vert pour soi, bleu ciel pour les autres, comme avant).
- Tous les membres la voient : **la bulle de ses messages est teintée de sa couleur** (une version foncée, pour que le texte blanc reste lisible), et son nom est dans la couleur vive (en **Terminal**, le `❯` et le nom ; **avec avatars**, le nom au-dessus de la plaque).
- Comme l'avatar, c'est un simple nom de couleur stocké sur le serveur (`profiles.color`, route `PUT /me/color`, renvoyé par `/me` et `/profiles`) : migration `0016_profile_color`, appliquée sur dev et déployée ; pas en prod. La couleur d'un autre membre se met à jour à la prochaine ouverture de l'app (comme son avatar).

### Gestes : coffre qui s'ouvre seul, glisser entre Groupes et Tête-à-tête, glisser pour revenir (27/10)

- **La porte du coffre s'ouvre toute seule** au lancement : elle se met en place, ses verrous claquent, puis la molette tourne et le portail aspire, sans toucher. Un toucher l'ouvre sans attendre. La plaque dit « Ouverture du coffre ».
- **« Privé » devient « Tête-à-tête »** (touche, titre de la liste, fiche, notification) : « Privé » laissait croire que les groupes ne l'étaient pas.
- **Groupes / Tête-à-tête côte à côte** : on passe de l'un à l'autre en glissant la liste vers la gauche ou la droite. Le pavé bleu de la touche choisie passe d'une touche à l'autre en suivant le doigt (l'espace entre les deux reste vide), et toucher une touche fait glisser la page.
- **Dans une conversation, glisser vers la droite = retour** à la liste, n'importe où sur l'écran (pas seulement depuis le bord). L'écran suit le doigt et une flèche apparaît à gauche ; un geste rapide suffit.
- **Répondre à un message se fait maintenant en le glissant vers la gauche** (avant : vers la droite), comme sur Telegram, pour laisser la droite au retour.

### Discussions privées : deux espaces, Groupes et Privé (26/10)

- **L'accueil a deux espaces**, choisis par deux touches en haut : « Groupes » et « Privé », chacune avec le nombre de messages en attente. Le « + » (nouveau groupe) et « Rejoindre un groupe » ne sont que dans l'espace Groupes.
- **Ouvrir une discussion privée** : depuis la fiche d'un groupe (roue dentée), la bulle à cadenas à côté d'un membre (route `group/direct`). Seulement avec quelqu'un d'un groupe en commun : pas d'annuaire de pseudos, et ses clés sont déjà épinglées (numéro de sécurité vérifiable). S'il y a déjà une discussion entre vous, elle s'ouvre. Sinon on choisit un code, deux fois.
- **Chacun son code** : rien à se donner en vrai. La clé de la discussion est tirée sur le téléphone, scellée à chacun des deux et signée ; ses remises sont enveloppées sous une clé publique fixe (`directWrapKey`) au lieu du code + mots-clés : elles s'ouvrent avec l'identité seule. Chaque téléphone verrouille ensuite la clé sous **son propre code** (même coffre, mêmes essais comptés que pour un groupe). L'autre voit la discussion sous ton pseudo (nom scellé à côté de la clé), « NOUVELLE · choisis ton code ».
- **Meta signée** : `direct: true`, les deux membres, tous deux admins, aucun mot-clé (vérifié à l'ouverture : un groupe qui se ferait passer pour une discussion privée, ou l'inverse, est refusé). Le serveur ne laisse personne entrer, sortir ou changer de code ; **« Supprimer la discussion »** l'efface pour les deux (messages, photos, vocaux, clés).
- Tout le reste est celui des groupes : photos, vocaux, documents, stories, réactions, messages éphémères, affichage terminal / avatars, notifications (« Nouvelle discussion privée : choisis ton code » à l'ouverture).
- Serveur : migration `0015_direct_conversations` (`groups.kind`, `groups.direct_pair` unique : une discussion par paire, `join_lookup` devient facultatif), route `POST /groups/direct` (groupe commun exigé, 30 par jour), `GET /groups` renvoie `kind` et `peerId`. **Pas encore appliquée ni déployée sur dev** (à faire : `drizzle-kit migrate` puis `neon deploy --env .env --no-env-pull` dans `server/`), puis le test `e2eDirect` contre l'API.
- Compromis : sur un nouveau téléphone (« Se connecter »), une discussion privée s'ouvre avec l'identité seule, puis on choisit un nouveau code ; un groupe, lui, redemande son code et ses mots-clés.

### Écran verrouillé : le logo au lieu du nom (26/10)

- L'écran du code app et le cache quand on quitte l'app montrent la lame (logo), plus « BaseSecrète ». La demande d'empreinte du système dit « Ouvrir le coffre ».

### Thème de la discussion, au choix par groupe (26/10)

- Fiche du groupe → « Affichage de la discussion » : **Terminal** (`❯ auteur [heure]`, sans avatar) ou **Avec avatars** (plaques, avatar et nom des autres). Sur ce téléphone seulement, rangé chiffré dans le store local (`look/<groupe>`).

### Le nom du groupe sur un coffre jamais ouvert (25/10)

- **Avant** : après « Se connecter » sur un téléphone, ou une adhésion acceptée, la liste disait « Groupe verrouillé » tant que le code n'avait pas été tapé : le nom est dans la meta chiffrée sous la clé du groupe, elle-même remise sous le code. Avec plusieurs coffres, impossible de savoir lequel est lequel avant de taper les codes.
- **Maintenant** : chaque remise de clé porte en plus le **nom scellé au membre seul** (`group_keys.sealed_label` + `label_signature` : `crypto_box_seal` à sa clé publique, signé par l'admin qui remet, l'id du groupe à l'intérieur ; `sealHandout(..., label)` / `openHandoutLabel` dans `crypto/group.ts`). Le téléphone le lit avec le code app, sans le code du groupe, et la liste, l'en-tête du clavier et les notifications nomment le coffre. Les remises d'avant (sans nom) donnent toujours « Groupe verrouillé » ; elles sont remplacées à la prochaine rotation ou au prochain changement de code.
- Écrit à la création, à l'acceptation d'un membre, à la rotation et au changement de code. Serveur : migrations `0013_handout_label` et `0014_label_signer`, les quatre routes acceptent les deux champs (optionnels), `GET /groups` les renvoie. Appliquées et redéployées sur dev le 25/10 ; **reste la prod** (avec `0012`).
- **Rattrapage des groupes existants** : quand un admin ouvre un groupe, son téléphone demande au serveur quelles remises n'ont pas de nom (`GET /groups/:id/members`, `unlabelledKeyVersions`), scelle le nom à chaque membre concerné et l'envoie (`POST /groups/:id/keys/labels`, rempli une fois, jamais remplacé, signé par cet admin : `label_signer_id`). En arrière-plan, sans gêner l'ouverture. Un groupe d'avant se nomme donc dès qu'un de ses admins l'a ouvert une fois avec la nouvelle version.
- Vérifié sur le téléphone (app dev) : un compte admin piloté depuis Node crée « Coffre des potes », ChefTesteur demande à entrer depuis le téléphone, l'admin accepte : la liste affiche « Coffre des potes · CLÉ REÇUE · tape le code du groupe » avant toute saisie du code.
- Compromis assumé : le nom d'un coffre jamais ouvert devient lisible avec le seul code app, comme l'est déjà celui d'un coffre ouvert une fois sur ce téléphone.

### Notifications Android : la tâche d'arrière-plan n'était jamais définie (25/10)

- Premier test de bout en bout sur le téléphone (app prod, build du 23/10, pushes silencieux envoyés à la main via l'API Expo avec le même contenu que le serveur) : le reçu Expo est « ok », l'app se réveille bien en arrière-plan (`TaskService: Registered task 'bs-push'`, `Started headless task`), mais le JS répond **« No task registered for key expo-task-manager »** et rien ne s'affiche.
- Cause : au démarrage sans écran, Expo Router ne charge que les fichiers de route qu'il dessine ; `services/push.ts`, qui définit la tâche au chargement, n'était importé que par `SessionProvider` depuis `app/_layout.tsx`, jamais chargé en mode headless.
- Correction : point d'entrée `mobile/index.js` (`"main"` dans `package.json`) qui importe `services/push` avant `expo-router/entry`. Changement de bundle seulement, mais la prod charge son bundle depuis l'APK : **nouveau build `preview` nécessaire** pour le voir sur le téléphone.
- Pour rejouer le test sans serveur : `POST https://exp.host/--/api/v2/push/send` avec `{ to: <ExponentPushToken>, data: { groupId, kind }, priority: 'high' }`, puis `getReceipts` avec les ids des tickets (un jeton périmé répond `DeviceNotRegistered` dans le reçu, pas dans le ticket).

### Biométrie : empreinte ou visage, selon le téléphone (25/10)

- **Pourquoi la section « Empreinte digitale » ne proposait rien** : l'option n'était offerte que si l'empreinte était l'unique capteur biométrique du téléphone (règle « jamais Face ID » du 20/10). Un Samsung avec la reconnaissance faciale activée tombait dans « pas de capteur ».
- **Faisabilité du choix empreinte / Face ID** : ce n'est pas un réglage que l'app peut offrir. Sur iOS, un iPhone a Face ID ou Touch ID, jamais les deux : le Keychain (`biometryCurrentSet`) prend celui du téléphone. Sur Android, le Keystore accepte toute biométrie **forte** enregistrée (classe 3 : l'empreinte ; le visage seulement sur les téléphones où il l'est, pas les Samsung) et l'invite système ne peut pas se limiter à l'une d'elles ; le choix se fait dans les réglages du téléphone.
- **Fait** : l'option est offerte dès qu'une biométrie est enregistrée ; les Réglages la nomment selon le téléphone (« Face ID », « Touch ID », « Empreinte digitale », « Empreinte ou visage ») avec l'icône qui va avec, et expliquent la règle Android ; le lecteur du coffre dessine un visage pour Face ID ; « Utiliser Face ID » / « Utiliser l'empreinte » sur l'écran du coffre. Texte iOS `NSFaceIDUsageDescription` corrigé (il disait que l'app n'utilise pas Face ID) : **nouveau build iOS nécessaire** ; sur Android, rien de natif ne change.
- À tester sur ton Samsung (app dev, Metro) : Réglages → Empreinte ou visage → Activer → code → doigt ; puis verrouiller et rouvrir au doigt.

### iOS : marges sûres des modales (25/10)

- Symptôme rapporté : parfois, au retour de la caméra (aperçu de story) ou dans d'autres écrans, le contenu monte tout en haut sous la barre d'état. Les trois écrans en `<Modal>` natif (aperçu de story, visionneuse plein écran, panneau d'actions) utilisaient un `SafeAreaView` natif **dans** la modale : présentée au moment où la caméra se referme, une modale iOS peut mesurer des marges à zéro et les garder.
- Correction : ces écrans prennent les marges du fournisseur de l'écran parent (`useSafeAreaInsets`, valeurs stables) et les appliquent en padding. Les écrans de pile gardent leur en-tête natif (haut) et `SafeAreaView` en bas ; le coffre et l'inscription gardent leur `SafeAreaView` plein écran, qui n'est pas dans une modale. À confirmer sur iPhone.

### Stories : la grille d'abord, la photo ensuite (25/10)

- En tirant le rideau, **c'est la grille d'acier qui descend** : la photo n'apparaît qu'en transparence à mesure que le rideau descend (18 % à mi-course), et n'est entière qu'une fois le rideau tout en bas. Un rideau tiré à moitié ne montre rien à quelqu'un qui regarde par-dessus l'épaule. Opacité pilotée nativement par la même valeur que la translation.

### Stories : savoir que la sienne est partie (25/10)

- **Après « Publier la story »**, la barre « STORIES · 24 H » dit **« PUBLIÉE »** pendant 4 s (LED verte, la touche « + » devient une coche, une vibration de succès), dès que le serveur a accepté le message. Un envoi en attente de réseau reste « ENVOI… », un refus reste « ÉCHEC ».
- **Tant qu'elle est en ligne**, la barre repliée la nomme : « LA TIENNE » (« LES TIENNES » s'il y en a plusieurs), « LA TIENNE + 2 » quand d'autres sont là et déjà vues, « LA TIENNE · 2 NOUVELLES » quand il y en a à regarder. Sans story à soi, rien ne change (« 2 NOUVELLES », ou le nombre). Libellé calculé par `railLabel` (`ui/stories/stories.ts`, tests).
- L'aperçu avant publication ferme avec l'icône Lucide « X » au lieu d'un caractère « ✕ ».

### Notifications en prod : diagnostic (25/10)

- Sur le téléphone, l'app prod (build `preview` du 23/10, commit `6965af2`) contient bien la logique du 22/10 (une notification par groupe, rien tant que l'app est ouverte). Mais **l'API de prod (branche Neon `main`) est restée à la version du 20/10** : pas de migration `0012` (`profiles.awake_until`, `push_tokens.platform`, `messages.quiet` absents), donc l'ancien `push.ts` : une notification **visible** par message, sans `kind`, sans présence. L'app ouverte prend un push sans `kind` pour une action et l'affiche en bannière ; app fermée, Android empile les pushes du serveur. D'où « une notification à chaque envoi, même dans l'app ».
- **À faire pour corriger** (rien à coder) : appliquer `0012` sur `main` puis redéployer l'API : dans `server/`, `drizzle-kit migrate` avec le `DATABASE_URL` de `.env.production`, puis `neon deploy --branch main --env .env.production --no-env-pull`. Vérifier ensuite sur le téléphone : plus rien quand l'app est ouverte, une seule notification par groupe (« Nouveaux messages » remplace), retirée en ouvrant la conversation.

### Notifications : nom du groupe, regroupement, silence quand l'app est ouverte ; compteur et ordre des groupes (22/10)

- **Rien ne sonne tant que l'app est ouverte** : l'app déverrouillée dit au serveur qu'elle l'est (`PUT /me/presence`, renouvelé toutes les 30 s, retiré au passage en arrière-plan ; colonne `profiles.awake_until`, valable 75 s). Le serveur n'envoie alors **aucune notification « message »** : la conversation ouverte les montre. Ce que le groupe attend de toi (demande d'accès, acceptation, nouveau code, départ d'un membre) est toujours envoyé, et s'affiche en bannière dans l'app.
- **Le nom du groupe sur la notification** (Android) : le serveur ne connaît pas les noms, il n'envoie que l'identifiant du groupe et le type d'événement, en **silencieux**. L'app se réveille en arrière-plan (nouveau module natif `expo-task-manager` : **nouvelle build**) et affiche elle-même la notification avec le nom du groupe tel qu'il est sur ce téléphone. Les noms sont copiés dans le Keystore à chaque affichage de la liste (lisibles sans le code app, puisque l'app est verrouillée quand la notification arrive) ; un groupe dont le nom n'est pas encore connu donne « BaseSecrète · Nouveau message · groupe verrouillé ».
- **Regroupées** : une seule notification par groupe. La suivante **remplace** la précédente (« Nouveau message » devient « Nouveaux messages ») au lieu de s'empiler, et ouvrir la conversation la retire. Sur iOS, même chose par `collapseId`, mais sans nom de groupe (l'app ne peut pas y réécrire la notification).
- **Textes lisibles** à la place des phrases à l'envers : « Nouveau message », « Quelqu'un demande à entrer », « Demande acceptée : entre le code du groupe », « Un membre est parti : clé à renouveler », « Le code a changé : entre le nouveau ».
- **Liste des groupes** : les **derniers ouverts en haut** (date de la dernière fois où la conversation a été à l'écran, gardée sur le téléphone), et sur chaque groupe, verrouillé ou non, un **compteur vert des messages en attente** (à la place du chevron), à partir du dernier message affiché sur ce téléphone. Le serveur ne renvoie qu'un nombre par groupe (`POST /groups/unread`) : sans les siens, sans les réactions (colonne `messages.quiet`, le serveur l'apprenait déjà), sans les expirés.
- **À tester sur téléphone** après le nouveau build (le dev build n'a pas de Firebase) : réception avec l'app fermée (Doze, économiseur de batterie des constructeurs), remplacement de la notification, bannière des actions dans l'app, et le compteur.
- Serveur : migration `0012_push_presence_unread` (`profiles.awake_until`, `push_tokens.platform`, `messages.quiet`), routes `PUT/DELETE /me/presence` et `POST /groups/unread` ; `PUT /me/push-token` prend la plateforme. Appliquée et redéployée sur la branche dev le 22/10.

### Mots-clés masqués dans les réglages du groupe (21/10)

- Dans Réglages du groupe, les **trois mots-clés sont masqués** (pastilles de points). **Afficher · code du groupe** fait apparaître le clavier du code en place ; le bon code les révèle jusqu'à ce qu'on quitte l'écran. Un code faux compte comme un essai, comme à l'ouverture du groupe (même compteur, mêmes délais) : un téléphone laissé déverrouillé entre d'autres mains ne donne pas les mots-clés.

### Réactions (21/10)

- **Cinq réactions par message**, dessinées dans le style de l'app (touches métal biseautées, icônes au trait, jamais d'emoji) : pouce (j'aime), couronne, pièces, flamme, cadenas (secret). **Appui long** sur un message → les cinq touches en haut du panneau (la mienne allumée en vert) ; toucher la même la retire, une autre la remplace. Sous la bulle : ce que le message a reçu, en petites plaques avec le compte (la mienne allumée) ; toucher une plaque donne ou retire la même réaction.
- **Une réaction par membre et par message** : la dernière envoyée compte. Elle part comme un message chiffré et signé (`kind: 'reaction'` : id du message visé + identifiant de la réaction, ou `null` pour la retirer), par la même file d'envoi (hors ligne, elle attend), et n'apparaît jamais dans le fil. Une réaction à un message disparu ne s'affiche pas.
- **Serveur** : le message est marqué `quiet` : stocké et relayé comme les autres, mais **personne n'est notifié**. Le serveur apprend seulement qu'il ne vaut pas une notification, pas ce que c'est.
- Tests : corps `reaction` (aller-retour, réaction inconnue ou emoji refusés, pas de réponse), comptage par message (dernière réaction de chaque membre, retrait, envois en attente) dans `ui/chat/reactions.ts`.

### Documents chiffrés (21/10)

- **Envoyer un fichier** (PDF, tableur, archive… jusqu'à 10 Mo) : le « + » du composer ouvre un panneau **Une photo / Un document**. Le document est choisi avec le sélecteur du système, envoyé **tel quel** et chiffré exactement comme une photo (clé de fichier aléatoire, transportée dans un message chiffré et signé). Son **nom et son type voyagent dans le chiffré** : le serveur ne voit qu'un blob et sa taille. Même file d'envoi que les photos (hors ligne, il attend le réseau).
- **Dans le fil** : une plaque métal avec l'icône, l'extension, le nom et la taille (« 1,2 Mo · chiffré »). Un **toucher** télécharge, déchiffre, puis confie le document à une autre app via la **feuille de partage** du système (ouvrir dans une visionneuse, enregistrer…). Appui long : les actions du message. Un document peut être **cité en réponse** (« 📎 nom »).
- **Sécurité** : un nom avec un chemin ou des caractères de contrôle (membre hostile) est refusé à la lecture. La copie en clair confiée à l'autre app vit dans le cache de l'app : elle est supprimée avant le document suivant, au verrouillage et à chaque lancement (balayage des fichiers en clair). Rien n'est ajouté côté serveur (même route d'envoi de pièce jointe, 10 Mo max).
- Nouveaux modules natifs : `expo-document-picker`, `expo-sharing` (nouveau build nécessaire).
- Tests : corps `file` (aller-retour, noms et types refusés, citation), libellés de taille et noms sûrs (`ui/chat/files.ts`).

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
- Déployer : `neon deploy --branch main --env .env.production --no-env-pull` dans `server/`. Migrer : `npx drizzle-kit migrate --config drizzle.prod.config.ts` (lit `.env.production`).
- **25/10, incident** : un déploiement n° 4 de la fonction prod à 17 h 18 (pas depuis cette session, qui n'a déployé que sur dev) a mis en ligne un code attendant les colonnes de `0012` et `0013` sur une base qui ne les avait pas : `POST /auth/recover` (et tout `select` sur `profiles` / `group_keys`) répondait 500, « Connexion impossible » dans l'app. Réparé en appliquant `0012`, `0013`, `0014` sur `main` (colonnes ajoutées seulement, rien supprimé), puis redéploiement de l'API avec le code courant. Règle : **toujours migrer avant de déployer**, et ne jamais déployer sur `main` un arbre de travail dont les migrations ne sont pas appliquées.
- **Suite de l'incident, vraie cause** : la connexion échouait encore après la « migration » parce que **la migration n'avait pas touché la prod**. `drizzle-kit` charge `.env` (dev) de lui-même avant d'évaluer le fichier de config, et `process.loadEnvFile('.env.production')` n'écrase jamais une variable déjà posée : la config « prod » migrait dev en silence, avec un « migrations applied successfully » trompeur. Vérifié par `information_schema.columns` sur `main` (aucune colonne de 0012-0014) ; une inscription jetable sur la prod échouait en 500 comme la connexion, et réussissait sur dev. Le log `[error] Error` était l'erreur de requête de drizzle (`DrizzleQueryError` étend `Error` sans changer `name`) pour la colonne manquante, pas un souci de secrets (fausse piste suivie pendant une heure : les secrets de `.env.production` ouvrent bien les sauvegardes, et le redéploiement avec `--update-existing` n'a rien changé). Corrigé en migrant avec `DATABASE_URL` forcée ; `drizzle.prod.config.ts` lit désormais `.env.production` directement (`util.parseEnv`), sans passer par `process.env`. Après migration : inscription et connexion jetables OK sur la prod (compte supprimé ensuite). Le gestionnaire d'erreurs journalise maintenant la classe réelle et le SQLSTATE de la cause.
- Commande de déploiement prod complète : `neon deploy --branch main --env .env.production --no-env-pull --update-existing` (sans `--update-existing`, le CLI garde les réglages existants de la branche quand ils diffèrent, et répond « non » tout seul hors terminal).

### Mise en production (branche Neon `dev`)

- Notifications nommées et compteur (22/10) : migration `0012_push_presence_unread` appliquée (`drizzle-kit migrate`), API redéployée (`neon deploy --env .env --no-env-pull`). Vérifié : `/health` répond, `PUT /me/presence` et `POST /groups/unread` refusent sans connexion (401). Reste à tester sur téléphone avec un nouveau build.
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
| ✅ | Notifications push | Fait : une par groupe, avec le nom du groupe ajouté par le téléphone (Android, push silencieux + tâche d'arrière-plan) ou une ligne générique (iOS) ; « Nouveau message » ou ce que le groupe attend ; rien tant que l'app est ouverte ; le toucher demande les codes puis ouvre le groupe. Il manque les identifiants Firebase pour Android et un build avec `expo-task-manager`. |
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
