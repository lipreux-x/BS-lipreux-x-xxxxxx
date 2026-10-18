# BaseSecrète — Avancement

État du projet au 19/10/2026 : les derniers ajouts et changements, puis le plan du projet avec ce qui est fait et ce qui reste. La spec de référence est [SPEC.md](SPEC.md).

## Derniers ajouts et changements

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

- Migration `0002_group_keywords` appliquée.
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
| ⬜ | Images et vocaux chiffrés | À faire |
| ⬜ | Notifications push génériques | À faire |
| 🟡 | Messages éphémères | Serveur prêt (durée par groupe + purge toutes les heures). Il manque le réglage dans l'app. |
| ⬜ | Rotation de clé quand un membre part | À faire (il faut d'abord « quitter / retirer un membre ») |

### v0.3

| | Fonction | État |
|---|---|---|
| ⬜ | Biométrie, empreinte de sécurité, réactions, réponses | À faire |
| ⬜ | Blocage des captures d'écran, auto-destruction après X échecs | À faire |
| ⬜ | Multi-appareils via QR code | À faire |
| ⬜ | Mode « à côté » sans internet (Bluetooth / Wi-Fi Direct) | À faire |

### Prochaines étapes proposées

1. **Réglages du groupe** (SPEC §7, `GroupSettings`) : la fiche info en est la première partie. Il reste : quitter le groupe, retirer un membre (admin), changer le code et les mots-clés, messages éphémères.
2. **Rotation de clé** au départ d'un membre, à faire en même temps que le point 1.
3. **Stockage local chiffré des messages** pour lire hors connexion.
4. **Qualité** : corriger les 12 erreurs ESLint restantes (`VaultSquare.tsx`, `SessionProvider.tsx`, `CodeEntry.tsx`) et accélérer les tests crypto (la suite complète prend environ 40 min).
5. **Production** : préparer la branche Neon de production et un build EAS de développement.
