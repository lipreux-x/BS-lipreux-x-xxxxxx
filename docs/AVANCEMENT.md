# BaseSecrète — Avancement

État du projet au 19/10/2026 (mis à jour après l'effacement de l'historique et les groupes éphémères) : les derniers ajouts et changements, puis le plan du projet avec ce qui est fait et ce qui reste. La spec de référence est [SPEC.md](SPEC.md).

## Derniers ajouts et changements

### Effacer des jours de conversation

- Dans la conversation, l'**admin** fait un **appui long sur une date** (« LUN. 19 OCT. ») et choisit : **ce jour**, **ce jour et la veille**, ou **les 7 jours jusqu'à ce jour**. Une confirmation suit.
- Les messages **et les photos** de la période sont effacés **pour tous les membres**, sur le serveur comme dans le stockage des images.
- Les téléphones qui ont la conversation ouverte la rechargent tout de suite. Ceux qui étaient hors ligne la rechargent à leur retour.
- Le serveur ne garde aucune trace de la période effacée, seulement le fait que l'historique a changé (table `group_purges`).
- Un membre qui n'est pas admin ne peut rien effacer.

### Groupes éphémères (autodestruction)

- **À la création**, une étape « Durée de vie » arrive entre les mots-clés et le code. Choix : permanent, 24 h, 3 jours, 1 semaine, 1 mois, puis réglage au jour près avec − / + (365 jours au maximum).
- Un bandeau « AUTODESTRUCTION DANS 3 J » s'affiche dans la conversation. La liste des groupes montre « 💣 dans 3 j » et les réglages affichent la date.
- **À la date prévue**, le serveur cache le groupe à tout le monde : plus de messages, et il ne peut plus être rejoint. La purge horaire supprime ensuite définitivement le groupe, ses membres, ses clés, ses messages, ses photos et ses tentatives d'adhésion.
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

### Mise en production (branche Neon `dev`)

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
| 🟡 | Hors connexion : lecture locale, file d'envoi, resynchro | Messages en attente + renvoi + resynchro faits. Il manque le stockage local des messages (SQLite chiffré) pour lire sans réseau. |
| ✅ | Reverrouillage automatique en arrière-plan | Fait |

### v0.2

| | Fonction | État |
|---|---|---|
| 🟡 | Images et vocaux chiffrés | Images faites : envoi depuis la galerie (recompressées en JPEG, métadonnées GPS retirées), chiffrées avec une clé par fichier, stockées dans un bucket Neon privé, affichées en mémoire seulement, et enregistrables dans la galerie depuis la vue plein écran. Vocaux à faire. |
| ⬜ | Notifications push génériques | À faire |
| ✅ | Messages éphémères | Fait : réglage admin dans les réglages du groupe, purge toutes les heures sur le serveur |
| ✅ | Rotation de clé quand un membre part | Fait, avec « quitter » et « retirer un membre » |

### v0.3

| | Fonction | État |
|---|---|---|
| 🟡 | Biométrie, empreinte de sécurité, réactions, réponses | Réponses faites : appui long sur un message → Répondre (ou Copier), la citation est chiffrée dans la réponse et un tap dessus ramène au message d'origine. Le reste est à faire. |
| ⬜ | Blocage des captures d'écran, auto-destruction après X échecs | À faire |
| ⬜ | Multi-appareils via QR code | À faire |
| ⬜ | Mode « à côté » sans internet (Bluetooth / Wi-Fi Direct) | À faire |

### Prochaines étapes proposées

1. **Stockage local chiffré des messages** pour lire hors connexion.
2. **Qualité** : corriger les 12 erreurs ESLint restantes (`VaultSquare.tsx`, `SessionProvider.tsx`, `CodeEntry.tsx`) et accélérer les tests crypto (la suite complète prend environ 40 min).
3. **Production** : préparer la branche Neon de production et un build EAS de développement.
