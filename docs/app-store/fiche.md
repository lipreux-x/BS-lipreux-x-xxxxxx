# Fiche App Store Connect — version 1.0

Textes et réponses saisis le 20/10/2026. Langue principale de la fiche : anglais (États-Unis), plus une localisation française.

## Informations sur l'app

| Champ | Anglais (US) | Français |
|---|---|---|
| Nom | BaseSecrète | BaseSecrète |
| Sous-titre (30) | Private encrypted messenger | Messagerie privée chiffrée |

- Catégorie principale : Réseaux sociaux (aucune secondaire)
- Droits relatifs au contenu : non, pas de contenu tiers
- Contrat de licence : CLUF standard d'Apple
- Copyright : `2026 Maxence Allier`

### Classification par âge → 4+

- Contrôle parental, validation de l'âge : non
- Accès web sans restrictions : non
- Contenu généré par les utilisateurs : **oui**
- Réseaux sociaux : non (et « désactivés pour moins de 13 ans » : non)
- Messagerie et chat : **oui**
- Publicité : non
- Thèmes matures, médical, sexualité, violence, jeux de hasard : aucun partout
- Remplacement de la classification : non applicable

## Tarifs et disponibilité

- Prix : gratuit (pays de base : États-Unis)
- Pays : France, Belgique, Suisse, Luxembourg, Canada

## Confidentialité de l'app

Données collectées (toutes : *Fonctionnalité de l'app*, *liées à l'identité*, *pas de suivi*) :

- Identifiant de l'utilisateur (pseudo, id de compte)
- Identifiant de l'appareil (jeton de notification)

Le contenu chiffré de bout en bout (messages, photos, vocaux) n'est pas déclaré : le serveur ne peut pas le lire.

## Version 1.0 — anglais (États-Unis)

### Texte promotionnel (170)

```
A private, end-to-end encrypted messenger for your inner circle. Invitation only. One code opens the app, another code and three keywords open each group.
```

### Mots-clés (100)

```
private,messenger,encrypted,chat,e2ee,secure,groups,friends,vault,invite,secret,privacy
```

### Description (4000)

```
BaseSecrète is a private messenger for a small circle of friends. There is no public sign-up: you get in only with an invitation from an existing member.

EVERYTHING IS END-TO-END ENCRYPTED
Messages, photos and voice notes are encrypted on your phone before they leave it. The server never sees their content, nor the names of your groups. BaseSecrète relies only on proven, published algorithms (X25519, Ed25519, XChaCha20-Poly1305, Argon2id), never on home-made cryptography.

A DOUBLE LOCK
• A 6-digit code opens the app, or your fingerprint if you turn it on.
• Each group has its own code and three keywords, shared in person between its members.
• The app locks itself again after 5 minutes away, and hides its content in the app switcher.

YOU DECIDE WHO GETS IN
Knowing a group's code is not enough: an admin approves every request from their own phone, after comparing the newcomer's security number with them. A removed member is banned and the group key is changed immediately.

DISCREET BY DESIGN
• Notifications never show a name, a group or a message.
• Disappearing messages, per group: 24 hours or 7 days.
• Photos are recompressed before sending, which removes their metadata (location, device).
• Optional screenshot blocking.
• Optional auto-wipe after too many wrong codes.
• Your profile picture is an icon, never a real photo.
• No ads, no third-party analytics.

WORKS EVERYWHERE
On Wi-Fi or mobile data, and even offline: your conversations stay readable (still encrypted on the phone), and what you write is sent automatically as soon as the network is back.

LOST YOUR PHONE?
Your password protects an encrypted copy of your keys that the server cannot open. Sign in on a new phone with your username and password, then enter each group's code and keywords again.

BaseSecrète is currently available in French.
```

## Version 1.0 — français

### Texte promotionnel (170)

```
Messagerie privée, chiffrée de bout en bout, pour ton cercle d'amis. Sur invitation uniquement. Un code ouvre l'app, un code et trois mots-clés ouvrent chaque groupe.
```

### Mots-clés (100)

```
messagerie,privée,chiffrée,chat,secret,coffre,groupe,amis,invitation,sécurisée,confidentiel,e2ee
```

### Description (4000)

```
BaseSecrète est une messagerie privée pour un petit cercle d'amis. Pas d'inscription publique : on entre seulement sur invitation d'un membre.

TOUT EST CHIFFRÉ DE BOUT EN BOUT
Messages, photos et vocaux sont chiffrés sur ton téléphone avant d'en partir. Le serveur ne voit jamais leur contenu, ni le nom de tes groupes. BaseSecrète utilise uniquement des algorithmes éprouvés et publics (X25519, Ed25519, XChaCha20-Poly1305, Argon2id), jamais de chiffrement maison.

UN DOUBLE VERROU
• Un code à 6 chiffres ouvre l'app, ou ton empreinte si tu l'actives.
• Chaque groupe a son propre code et trois mots-clés, partagés en vrai entre ses membres.
• L'app se reverrouille après 5 minutes d'absence et se masque dans les apps récentes.

C'EST TOI QUI CHOISIS QUI ENTRE
Connaître le code d'un groupe ne suffit pas : un admin accepte chaque demande depuis son téléphone, après avoir comparé avec le nouveau son numéro de sécurité. Un membre retiré est banni et la clé du groupe change tout de suite.

DISCRÈTE PAR NATURE
• Les notifications n'affichent jamais de nom, de groupe ni de message.
• Messages éphémères par groupe : 24 h ou 7 jours.
• Les photos sont recompressées avant l'envoi, ce qui retire leurs métadonnées (position, appareil).
• Blocage des captures d'écran, en option.
• Auto-destruction après trop de codes faux, en option.
• Ta photo de profil est une icône, jamais une vraie photo.
• Pas de pub, pas d'outil d'analyse tiers.

MARCHE PARTOUT
En Wi-Fi ou en 4G/5G, et même hors connexion : tes conversations restent lisibles (toujours chiffrées sur le téléphone), et ce que tu écris part tout seul au retour du réseau.

TÉLÉPHONE PERDU ?
Ton mot de passe protège une copie chiffrée de tes clés que le serveur ne peut pas ouvrir. Connecte-toi sur un nouveau téléphone avec ton pseudo et ton mot de passe, puis retape le code et les mots-clés de chaque groupe.
```

## Informations pour la vérification (Remarques)

Connexion requise : oui. Les valeurs entre crochets sont à remplacer par celles du compte de démo.

```
BaseSecrète is an invitation-only, end-to-end encrypted messenger for small groups of friends. There is no public sign-up, so we created a demo account (username and password in the Sign-in Information above). It is already a member of a group with a short conversation.

The app is in French. How to sign in:
1. Open the app. On the welcome screen, choose « Se connecter » (Sign in).
2. Enter the username (« Pseudo ») and password (« Mot de passe ») above, then tap « Se connecter ». The key derivation takes a few seconds.
3. Choose any 6-digit app code that is not too simple (not 123456 or 111111) and type it twice. It locks the app on this device only.
4. On the home screen, tap the group, then enter the group code and the three keywords below.

Group: « Demo group »
Group code: [GROUP CODE]
Keywords: sun beach summer

About the features:
- Messages, photos and voice notes are encrypted on the device (X25519, Ed25519, XChaCha20-Poly1305, Argon2id). The server only stores ciphertext.
- Notifications never contain any content: they only say « uçer egassem » (« message reçu », i.e. "message received", written backwards).
- The microphone is used only to record voice notes. Photo library access is used to send photos and, on explicit request, to save a received photo.
- Face ID / Touch ID unlock is optional (off by default, turned on in Settings) and replaces the app code only.
- No ads, no tracking, no third-party analytics.
```

Publication : automatique après validation (réglage par défaut laissé tel quel).

## Compte de démo App Review (production, créé le 04/11/2026)

Créé par `demo-account.test.ts` (`DEMO_USERNAME=review_apple DEMO_FRIEND=camille_review`). L'ancien `apple_review` existe aussi en prod mais son mot de passe n'a été noté nulle part.

- Pseudo : `review_apple`
- Mot de passe : dans `demo-secrets.local.md` (fichier local, hors git : le dépôt est public)
- Groupe « Demo group », code dans `demo-secrets.local.md`, mots-clés `sun beach summer` (avec `camille_review` et 4 messages)

## TestFlight — test externe (bêta publique)

Informations de test (anglais) :

- Description de la bêta (4000) :

```
BaseSecrète is a private, end-to-end encrypted messenger for a small circle of friends, by invitation only. One 6-digit code opens the app; each group (a "vault") has its own 4-digit code and three keywords, shared in person. Messages, photos and voice notes are encrypted on the phone before they leave it: the server only stores ciphertext.
```

- À tester (« What to Test ») :

```
Thanks for testing BaseSecrète! Please try: creating or joining a group, sending messages, photos and voice notes, reactions and replies (long-press a message), stories, notifications when the app is in the background, and locking / unlocking the app. Report anything that looks wrong or feels slow with a screenshot from TestFlight.
```

- E-mail pour les retours : allier.maxence7@gmail.com
- URL marketing : page d'assistance ; URL de la politique de confidentialité : voir README.
- Informations pour la vérification : connexion requise, compte ci-dessus, Remarques = texte de la section précédente.
