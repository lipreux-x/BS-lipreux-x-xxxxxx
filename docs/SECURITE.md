# BaseSecrète — Sécurité : audit du 19/10/2026

Ce document résume l'audit de sécurité, ce qui a été corrigé, comment l'app protège les données maintenant, et ce qu'on peut encore améliorer.
Le détail technique de référence reste [SPEC.md](SPEC.md) (§4).

---

## 1. En bref

Trois audits ont été menés en parallèle : le serveur et l'API, le chiffrement de bout en bout, et l'app mobile. Pour chacun, on s'est mis à la place d'un pirate (ou d'une IA) qui veut attaquer.

- **Avant** : un serveur piraté (ou un hébergeur malveillant) pouvait **lire les groupes**. Il pouvait donner aux téléphones une clé de groupe qu'il connaissait, ou ajouter un membre fantôme, à qui les téléphones envoyaient la clé tout seuls.
- **Maintenant** : le serveur ne fait que transporter et stocker des données qu'il ne peut ni lire ni falsifier. Pour entrer dans un groupe, il faut le code, les mots-clés **et** l'accord d'un admin, donné depuis son téléphone.
- **Toutes les failles confirmées sont corrigées**, sauf les points listés en §5.
- **Les données ont été remises à zéro** le 19/10 : chacun recrée son compte et ses groupes avec le nouveau build.

---

## 2. Ce qui a changé pour les utilisateurs

| Avant | Maintenant |
|---|---|
| Avec le bon code et les bons mots-clés, on entrait dans le groupe et un membre envoyait la clé automatiquement. | Le code et les mots-clés envoient une **demande**. Un **admin l'accepte** depuis son téléphone : une bannière « Demande d'accès » apparaît dans la conversation. |
| Aucune vérification d'identité. | Chacun a une **empreinte** (30 chiffres, Réglages > Mon empreinte). L'admin la compare en vrai avec celle qu'il voit avant d'accepter. On peut aussi voir l'empreinte de chaque membre (fiche du groupe). |
| Un membre retiré pouvait revenir avec le code qu'il connaissait. | Un membre retiré est **banni** de ce groupe, et une nouvelle clé est créée tout de suite. |
| Le dernier admin pouvait partir, le serveur choisissait le suivant. | Le dernier admin **désigne** le suivant en partant : c'est le membre le plus ancien, et la désignation est signée. |
| Après « Se connecter » sur un nouveau téléphone, n'importe quel code ouvrait les groupes. | Chaque groupe redemande son **code et ses mots-clés**. |
| Mot de passe : 10 caractères. | 10 caractères au moins, sans suite (123456, azerty…) ni répétition ; sous 16 caractères, il faut mélanger les types de caractères. |
| Invitations valables 7 jours, en nombre illimité. | Valables **2 h** ; 3 invitations ouvertes et 10 par jour au plus par membre. |
| L'app se verrouillait dès qu'on la quittait. | Elle se verrouille après **5 min hors de l'app**, et un groupe **10 min après l'avoir quitté**. L'écran est masqué dans les apps récentes (flou sur iPhone, aperçu vide sur Android 13+). |
| — | Les images piégées sont refusées. Une citation impossible à vérifier est marquée « non vérifié », une citation falsifiée est signalée. Le presse-papiers est vidé au bout d'une minute. |
| L'app tournait dans Expo Go. | Il faut **un vrai build** (EAS), à cause du module natif de sécurité. |

---

## 3. Failles trouvées et corrections

### Critiques

| # | Faille | Correction |
|---|---|---|
| C1 | Le serveur pouvait remettre aux téléphones une clé de groupe **choisie par lui** et lire la suite. | Chaque **remise de clé** est chiffrée sous une clé tirée du code et des mots-clés (que le serveur ne connaît pas), et **signée par un admin**. Le téléphone vérifie la signature avec la clé de l'admin qu'il a enregistrée. |
| C2 | Le serveur pouvait ajouter un **membre fantôme** ou **remplacer la clé** d'un membre ; les téléphones lui envoyaient la clé tout seuls. | Plus de partage automatique : **validation par un admin**. La liste des membres et des admins est dans la **meta signée** (pas celle du serveur). Les clés des contacts sont **enregistrées à la première vue** : une clé changée ensuite est refusée et signalée. Empreintes visibles. |

### Graves

| # | Faille | Correction |
|---|---|---|
| H1 | Un membre retiré revenait avec le code qu'il connaissait. | Liste de **bannis** côté serveur ; nouvelle clé immédiate. |
| H2 | La copie des clés gardée sur le serveur (protégée par le mot de passe) était peu coûteuse à attaquer (Argon2 4 Mo), et le serveur pouvait imposer des paramètres encore plus faibles. | **Argon2id 64 Mo** ; l'app refuse tout paramètre plus faible que le sien ; mot de passe plus exigeant. |
| H3 | Avec une copie du téléphone (outils de police scientifique), le code app à 6 chiffres tombait en quelques minutes. | Le code est combiné à une **clé matérielle non exportable** (Secure Enclave sur iPhone, Keystore sur Android, StrongBox si présent). Chaque essai doit passer par le téléphone lui-même. |
| H4 | Le **code de groupe ne protégeait rien** : avec le seul mot de passe du compte, on récupérait toutes les clés de groupe. | Les remises de clé sont chiffrées sous une clé tirée du code et des mots-clés : il faut **les deux**. |
| H5 | N'importe quel membre pouvait créer des **invitations à l'infini** (donc des comptes à l'infini), ce qui rendait inutiles les limites par utilisateur. | Quotas d'invitations, invitation valable 2 h, purge des invitations expirées. |

### Moyennes

| # | Faille | Correction |
|---|---|---|
| M1 | Le serveur voyait **le code et les mots-clés en clair**. | Ils ne quittent plus le téléphone, seul un dérivé Argon2id est envoyé. Le serveur ne fait plus de calcul Argon2, ce qui ferme aussi une attaque par saturation de mémoire. |
| M2 | En créant des groupes, on pouvait **tester quels codes existent**, sans limite. | Recherche du groupe par code **et** mots-clés, avec un quota de créations et de changements de code. |
| M3 | Le blocage après plusieurs mauvais codes se contournait **en avançant l'heure du téléphone**. | Attente mesurée sur l'horloge de démarrage du téléphone. Chaque essai est compté **avant** d'être tenté. |
| M4 | Ouvrir le **sélecteur de photos** empêchait l'app de se verrouiller. | Le temps passé hors de l'app compte toujours. |
| M5 | **Fichiers en clair** (vocaux, photos) laissés sur le disque après un plantage. | Effacés à chaque lancement de l'app ; la copie du sélecteur de photos est supprimée. |
| M6 | Un membre pouvait **attribuer une fausse citation** à quelqu'un. | Citation marquée « non vérifié » ou « Citation falsifiée ». |
| M7 | Une **image piégée** (dimensions énormes) faisait planter l'app à chaque ouverture du groupe. | JPEG vérifié avant affichage, refusé au-delà de 4096 px. |
| M8 | **N'importe quel membre** pouvait faire tourner la clé ou piéger la clé d'un nouveau. | Seul un admin fait tourner la clé ; remises signées et vérifiées. |
| M9 | Les **tentatives de connexion par mot de passe** étaient comptées même en cas de succès, et on pouvait en essayer en masse sur beaucoup de pseudos. | Seuls les échecs comptent (5 par heure par pseudo, 300 par heure en tout). |
| M10 | On pouvait deviner **quels pseudos existent** via l'inscription. | Une invitation brûle après 3 pseudos déjà pris ; un même pseudo ne peut pas exister avec deux casses différentes (« Alice » / « alice »). |

### Faibles

- **Connexion :** un défi de connexion ne peut plus être rejoué. La connexion WebSocket est coupée quand le jeton expire, avec 5 connexions au plus par utilisateur.
- **Envoi de messages :** 60 messages par minute au plus. Les envois de fichiers sont limités de façon fiable. Un même identifiant de message ne peut plus servir dans deux groupes.
- **Suppression des fichiers :** un fichier n'est plus oublié quand son message est supprimé.
- **Scripts de maintenance :** confirmation obligatoire, refus des comptes qui ont une sauvegarde, et les comptes de vrais utilisateurs sont épargnés par le nettoyage des comptes de test.
- **Liens directs :** un lien vers les réglages d'un groupe fermé redirige vers le code.
- **Presse-papiers :** marqué sensible et vidé au bout d'une minute.
- **Sauvegarde Android :** la sauvegarde automatique des données de l'app est coupée.
- **iPhone :** une réinstallation efface le coffre que le Keychain aurait gardé.
- **Textes :** les Réglages indiquaient que l'app se verrouillait dès qu'on la quittait ; corrigé.

### Vérifié, pas exploitable

- **`/internal/purge` :** l'audit craignait qu'on puisse déclencher la purge depuis l'extérieur. Test sur le serveur en ligne : refusé (401), parce que Neon retire ces en-têtes des requêtes publiques.
- **Secrets :** aucun secret n'a jamais été commité, et les dépendances n'ont aucune vulnérabilité connue.

---

## 4. Comment ça marche maintenant

### Les clés d'un groupe
1. **Code et mots-clés.** Le téléphone calcule `Argon2id(code + mots-clés)` (64 Mo) et en tire deux clés :
   - `joinKey`, envoyée au serveur pour trouver le groupe ;
   - `wrapKey`, qui ne quitte jamais le téléphone.
2. **La clé du groupe** (aléatoire) est remise à chaque membre, pour chaque version de la clé. Chaque remise est :
   - chiffrée sous `wrapKey`,
   - scellée à la clé publique du membre,
   - signée par l'admin qui la remet.
3. **La meta** (nom, mots-clés, admins, membres, numéro de révision) est chiffrée sous la clé du groupe et signée par un admin. Le téléphone refuse une meta plus ancienne que celle qu'il a déjà vue, ou écrite par quelqu'un qui n'est pas admin.
4. **Sur le téléphone**, la clé du groupe est enfermée sous le code du groupe **et** la clé maître, elle-même enfermée sous le code app, le secret de l'appareil et la clé matérielle.

### Ce que le serveur voit
| Il voit | Il ne voit pas |
|---|---|
| Pseudos, clés publiques, qui est dans quel groupe, demandes en attente | Messages, photos, vocaux, nom des groupes |
| Heure et taille des messages chiffrés | Codes app, codes de groupe, mots-clés (seulement un dérivé Argon2id) |
| | Clés privées, clés de groupe |

### Les fichiers importants
- `mobile/src/crypto/groupSecret.ts` : code + mots-clés → `joinKey` / `wrapKey`.
- `mobile/src/crypto/group.ts` : remises de clé signées, meta signée, messages.
- `mobile/src/crypto/kdf.ts` et `mobile/modules/bs-native/` : Argon2id natif, clé matérielle, horloge de démarrage.
- `mobile/src/services/groups.ts` : vérification de tout ce que renvoie le serveur, validation, rotation, changement de code, enregistrement des clés des contacts.
- `server/src/app.ts` : routes, quotas, bannis, demandes en attente.
- `server/drizzle/0009_security_v2.sql` : migration (remise à zéro des données).

### Tests
- **Tests unitaires** (228) : chiffrement, coffre local, horloge anti-triche, images piégées, citations.
- **Test du serveur** (`server/scripts/smoke.ts`) : passe en entier contre le **serveur en ligne**, WebSocket compris.
- **Test de bout en bout de l'app** (`mobile/src/services/__tests__/e2e.test.ts`) : passe contre l'API, avec le vrai chiffrement. Il couvre la demande d'accès et sa validation, une clé falsifiée refusée, le ban d'un membre retiré, la reconnexion sur un nouveau téléphone et le changement de code.
- **Module natif** :
  - Android : compilé avec succès sur PC.
  - Argon2 : sortie identique, octet pour octet, à libsodium.
  - iPhone : **pas encore compilé** (pas de Xcode sur Windows). Le premier build EAS le vérifiera.

---

## 5. À améliorer (par priorité)

### À faire bientôt
1. **Premier build EAS iPhone.** Il vérifie le module natif iOS : Argon2Swift et Secure Enclave. S'il échoue, le journal du build indiquera quoi corriger.
2. **Changer le code après un retrait.** Un membre retiré est banni, mais il connaît toujours le code et les mots-clés. Avec la complicité du serveur, il pourrait encore fabriquer des remises de clé. L'app le conseille ; elle pourrait **l'imposer** (proposer de changer le code juste après un retrait).
3. **Rotation quand un membre quitte de lui-même.** La nouvelle clé n'est créée qu'à la prochaine ouverture du groupe par un admin. D'ici là, les messages restent sous l'ancienne clé, que le membre parti connaît ; il ne peut les lire qu'avec la complicité du serveur. Piste : bloquer l'envoi tant que la rotation n'est pas faite, ou laisser n'importe quel membre la faire avec une signature vérifiée.
4. **Blocage de la reconnexion.** Quelqu'un qui connaît ton pseudo peut bloquer ta reconnexion par mot de passe pendant une heure en enchaînant les échecs. Pistes : petit calcul imposé au client avant chaque essai (preuve de travail), ou limite par adresse réseau si Neon la fournit de façon fiable.
5. **Option « auto-destruction » après 10 codes faux** (prévue dans le SPEC, pas faite).

### Ensuite
6. **Historique des admins.** Si un téléphone rate un changement d'admin, il accepte comme nouvel admin un membre déjà connu, et une bannière le signale. Garder l'historique des metas signées sur le serveur permettrait de vérifier toute la chaîne.
7. **Jeton dans l'adresse du WebSocket.** Il peut finir dans des journaux de proxy. Mieux : l'envoyer dans le premier message, ou utiliser un ticket à usage unique.
8. **Métadonnées.**
   - La taille d'un message chiffré trahit à peu près sa longueur : on pourrait arrondir les tailles.
   - Le serveur sait quels messages ont une pièce jointe et leur poids.
   - L'heure, l'ordre et le caractère éphémère d'un message sont décidés par le serveur, pas signés par l'expéditeur.
9. **Citations.** Elles pointent vers l'identifiant donné par le serveur. Les rattacher à (expéditeur, identifiant choisi par l'expéditeur) serait plus solide.
10. **Épinglage du certificat** de l'API. Il protégerait contre un faux certificat installé sur le téléphone (profil d'entreprise, MDM).
11. **Android 12 et moins.** L'aperçu dans les apps récentes peut être capturé avant que le cache noir s'affiche. Seul `FLAG_SECURE` l'empêche, mais il bloquerait aussi les captures d'écran : refusé pour l'instant, choix du produit.
12. **Clavier.** Le champ de message laisse le clavier apprendre les mots tapés : c'est un compromis entre confort et discrétion.
13. **Mémoire.** En JavaScript, certaines valeurs secrètes (chaînes de caractères) ne peuvent pas être effacées de la mémoire. Le verrouillage est donc un verrou d'interface, pas un nettoyage garanti de la mémoire.
14. **Codes de groupe courts.** 6 chiffres, c'est peu ; les mots-clés apportent l'essentiel de la protection. On pourrait encourager les codes plus longs.
15. **Historique après un changement de code.** Une version de clé que l'admin ne détient pas est supprimée du serveur. Un membre qui se reconnecte sur un nouveau téléphone perd alors ces anciens messages.

### Organisation
16. **Secrets dans OneDrive.** Le dossier du projet est dans OneDrive : le fichier `.env` (base de données, secrets du serveur) est donc copié chez Microsoft. À sortir de OneDrive, ou à exclure de la synchronisation.
17. **Déclaration du chiffrement (App Store).** `ITSAppUsesNonExemptEncryption: false` est discutable pour une messagerie chiffrée de bout en bout : déclarer le chiffrement et l'exemption qui s'applique.
18. **URL de production.** `eas.json` ne fixe pas l'adresse de l'API pour le profil production. L'app vise donc la branche dev par défaut.
19. **Lint.** 4 erreurs existaient avant l'audit (`SessionProvider`, `CodeEntry`).
20. **Test de bout en bout en JavaScript pur.** Il est trop lent (Argon2 64 Mo sans le module natif) et finit par expirer. Seule la version libsodium est utilisable.
