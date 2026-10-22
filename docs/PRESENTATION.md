# BaseSecrète — Présentation du projet et du chiffrement

*Mis à jour le 20/10/2026.*

Ce document explique simplement ce qu'est BaseSecrète, comment les données sont chiffrées, et quel niveau de sécurité l'app offre, avec ses limites.
Les détails techniques de référence sont dans [SPEC.md](SPEC.md) (§4) ; l'audit de sécurité et les corrections dans [SECURITE.md](SECURITE.md).

---

## 1. Le projet en bref

**BaseSecrète est une messagerie privée pour un petit cercle d'amis** (5 à 50 personnes), sur iPhone et Android.

- **Sur invitation uniquement** : pas d'inscription publique. Un membre crée une invitation (valable 2 h), la donne en main propre, et le nouveau crée son compte avec.
- **Groupes fermés** : pour entrer dans un groupe, il faut son **code**, ses **3 mots-clés**, **et l'accord d'un admin** donné depuis son téléphone.
- **Double verrou** : un code à 6 chiffres (ou l'empreinte) pour ouvrir l'app, puis le code de chaque groupe pour ouvrir la conversation.
- **Tout est chiffré de bout en bout** : messages, photos, vocaux, nom des groupes. Le serveur transporte et stocke des données qu'il ne peut pas lire.
- **Esthétique de coffre-fort** : porte de coffre à l'ouverture, pavé numérique en métal, voyants lumineux.

Fonctions : messages texte, photos, vocaux, réponses citées, messages éphémères (24 h ou 7 jours), groupes qui s'autodétruisent à une date choisie, effacement de jours entiers par un admin, notifications qui ne disent rien du contenu (le nom du groupe est ajouté par le téléphone, jamais envoyé), fonctionnement hors ligne.

### Technique

| Partie | Outil |
|---|---|
| App mobile | Expo (React Native) + TypeScript |
| Serveur (API + temps réel) | Hono sur Neon Functions, WebSocket |
| Base de données | Neon (Postgres) |
| Fichiers (photos, vocaux) | Neon Storage, toujours chiffrés avant l'envoi |
| Chiffrement | Algorithmes de libsodium (bibliothèques reconnues), Argon2id en module natif, clé matérielle du téléphone |

---

## 2. Le principe : le serveur ne peut rien lire

Dans une messagerie classique, le serveur reçoit les messages en clair, ou détient les clés pour les lire. Dans BaseSecrète :

- les **clés sont créées sur les téléphones** et n'en sortent jamais en clair ;
- un message est **chiffré sur le téléphone de l'expéditeur** et n'est **déchiffré que sur celui des membres** ;
- le serveur ne voit que des données illisibles, et il **ne peut pas les falsifier** : tout ce qui compte est **signé**, et les téléphones vérifient chaque signature.

Même quelqu'un qui pirate le serveur, l'hébergeur, ou intercepte le réseau ne peut ni lire les conversations, ni se faire passer pour un membre, ni ajouter quelqu'un en douce dans un groupe.

---

## 3. Comment c'est chiffré, couche par couche

### 3.1 L'identité de chaque utilisateur

À la création du compte, le téléphone génère deux paires de clés :

- **X25519**, pour recevoir des données chiffrées pour soi ;
- **Ed25519**, pour signer ce qu'on envoie (comme une signature manuscrite impossible à imiter).

Les **clés publiques** vont au serveur, pour que les autres puissent les utiliser. Les **clés privées restent sur le téléphone**.

**Numéro de sécurité** : chaque compte a une empreinte de 30 chiffres (Réglages). Avant d'accepter quelqu'un dans un groupe, l'admin compare **en vrai** ce numéro avec celui affiché sur le téléphone de la personne. S'ils sont identiques, personne ne s'est fait passer pour elle.

**Clés épinglées** : la première fois qu'un téléphone voit les clés d'un contact, il les retient. Si le serveur essaie plus tard d'en donner d'autres, elles sont refusées et l'app le signale.

### 3.2 Les messages

Chaque groupe a une **clé de groupe** de 256 bits, tirée au hasard par le créateur.

Chaque message, photo ou vocal est :

1. **chiffré** avec la clé du groupe, en **XChaCha20-Poly1305** (un chiffrement moderne qui détecte aussi toute modification) ;
2. **signé** par l'expéditeur avec sa clé Ed25519.

Le téléphone qui reçoit vérifie la signature avec la clé épinglée de l'expéditeur. Un message modifié ou fabriqué est rejeté.

**Photos et vocaux** : chaque fichier est chiffré avec sa propre clé aléatoire, puis envoyé au stockage. Cette clé voyage dans un message du groupe, lui-même chiffré et signé. Les photos sont recompressées avant l'envoi, ce qui supprime la position GPS et le modèle du téléphone.

### 3.3 Comment la clé du groupe arrive à chaque membre

C'est le cœur du système. La clé du groupe n'est jamais envoyée en clair. Chaque membre reçoit sa propre **remise de clé**, qui est :

1. **chiffrée sous une clé tirée du code et des mots-clés du groupe** (`wrapKey`), que le serveur ne connaît pas ;
2. **scellée** à la clé publique du membre, que lui seul peut ouvrir ;
3. **signée par l'admin** qui la remet.

Pour lire un groupe, il faut donc **à la fois** :

- le **compte** du membre (ses clés privées) ;
- le **code et les mots-clés** du groupe ;
- une remise **signée par un admin**.

Le serveur ne peut ni lire une remise, ni en fabriquer une fausse, ni en donner une à quelqu'un qui n'a pas été accepté.

**La fiche du groupe** (nom, mots-clés, liste des admins et des membres) est aussi chiffrée avec la clé du groupe et **signée par un admin**. Les téléphones suivent cette liste signée, jamais celle du serveur : un membre fantôme ajouté par le serveur est détecté et bloqué.

### 3.4 Le code et les mots-clés d'un groupe

Le code et les mots-clés **ne quittent jamais le téléphone**. Le téléphone les passe dans **Argon2id** (64 Mo de mémoire par calcul, ce qui rend chaque essai coûteux pour un attaquant) et en tire deux clés :

- `joinKey` : envoyée au serveur, seulement pour trouver le groupe et demander à y entrer ;
- `wrapKey` : gardée sur le téléphone, elle ouvre les remises de clé.

Avec la seule `joinKey`, le serveur ne peut pas retrouver le code ni ouvrir les remises.

**Changer le code** (admin) : toutes les remises sont rechiffrées sous le nouveau code, et aucune ne reste ouvrable avec l'ancien. Les membres tapent le nouveau code une fois.

**Quand un membre part ou est retiré** : un admin crée une **nouvelle clé de groupe**, remise aux seuls membres restants. Le membre parti ne peut pas lire les nouveaux messages. Un membre retiré est **banni** : il ne peut pas redemander à entrer avec le code qu'il connaît.

### 3.5 Ce qui est gardé sur le téléphone

```
  Code app (6 chiffres)  +  secret de l'appareil
              │  Argon2id, 64 Mo
              ▼
  Clé matérielle du téléphone (Secure Enclave / Keystore, non exportable)
              │
              ▼
        CLÉ MAÎTRE LOCALE  ───────►  chiffre tout ce qui est stocké :
              │                      clés privées, base de messages,
              │                      clés des contacts, fiches des groupes
              ▼
  Clé de chaque groupe : enfermée sous la clé maître
                         ET sous Argon2id(code du groupe)
```

- **Code app** : il n'est jamais envoyé au serveur. Il est combiné à un secret de l'appareil, passé dans Argon2id, puis dans une **clé matérielle** que le téléphone ne laisse jamais sortir : la **Secure Enclave** sur iPhone, le **Keystore** sur Android (avec la puce **StrongBox** quand elle existe). Une copie du stockage du téléphone ne suffit donc pas à tester des codes : chaque essai doit passer par le téléphone lui-même, avec sa limite d'essais.
- **Base de messages hors ligne** : chaque ligne est chiffrée avec une clé tirée de la clé maître. Les messages y restent chiffrés sous la clé du groupe : il faut encore le code du groupe pour les lire, même hors ligne.
- **Empreinte (option)** : une copie de la clé maître est protégée par l'empreinte dans le Keychain / Keystore. Elle est invalidée si un doigt est ajouté, et le code app est redemandé toutes les 48 h. Pas de reconnaissance faciale.

### 3.6 Le compte sur un nouveau téléphone

Une copie des clés du compte est gardée par le serveur, **chiffrée avec le mot de passe** du compte (Argon2id 64 Mo). Le serveur ne peut pas l'ouvrir. Sur un nouveau téléphone, « Se connecter » (pseudo + mot de passe) restaure le compte ; chaque groupe redemande alors son code **et** ses mots-clés.

L'app refuse un coût Argon2 plus faible que le sien, même si le serveur le demande.

### 3.7 Ce que voient les notifications

Le serveur n'envoie jamais le nom d'un groupe ni un mot d'un message : seulement l'identifiant du groupe et le type d'événement. Sur Android, c'est le téléphone qui écrit la notification, avec le nom du groupe tel qu'il le connaît et « Nouveau message » (une par groupe, remplacée à mesure) ; sur iOS, une ligne générique. Rien ne sonne tant que l'app est ouverte. La toucher ouvre l'app sur le coffre : code app, puis code du groupe.

---

## 4. Contre le forçage des codes

| Protection | Comment |
|---|---|
| Essais limités | Après 5 codes faux, attente croissante : 30 s, 1 min, 5 min, 15 min, 1 h. Pour le code app et pour chaque groupe. |
| Pas de triche avec l'heure | L'attente se mesure sur l'horloge de démarrage du téléphone : avancer la date ne sert à rien. |
| Pas d'essai gratuit | Chaque essai est compté **avant** d'être tenté : tuer l'app pendant un essai ne le rend pas gratuit. |
| Autodestruction (option) | Après 10 ou 20 codes app faux, tout est effacé du téléphone. |
| Côté serveur | Demandes d'entrée limitées (5 par heure par utilisateur, 20 par heure par groupe), connexions par mot de passe limitées (5 échecs par heure par pseudo), invitations limitées (3 ouvertes, 10 par jour). |

---

## 5. Ce que le serveur voit, et ne voit pas

| Le serveur voit | Le serveur ne voit pas |
|---|---|
| Les pseudos et les clés publiques | Le contenu des messages, photos et vocaux |
| Qui est dans quel groupe (identifiants) | Le nom des groupes, les mots-clés |
| L'heure et la taille des messages chiffrés | Le code app, les codes de groupe (seulement un dérivé Argon2id) |
| Les demandes d'entrée en attente | Les clés privées, les clés de groupe |
| Si un message contient une pièce jointe, et son poids | Le mot de passe du compte |

---

## 6. Le niveau de sécurité

### Contre quoi l'app protège bien

| Menace | Protégé ? |
|---|---|
| Quelqu'un qui intercepte le réseau (Wi-Fi public, opérateur) | ✅ Oui : chiffrement de bout en bout, en plus de HTTPS. |
| Un pirate qui prend le contrôle du serveur ou de la base | ✅ Il ne peut ni lire les groupes, ni fabriquer de messages, ni ajouter un membre en douce. |
| L'hébergeur (Neon) ou une demande légale faite à l'hébergeur | ✅ Il ne peut remettre que des données chiffrées et les métadonnées du §5. |
| Un téléphone volé, verrouillé | ✅ Il faut le code app, protégé par la puce du téléphone et la limite d'essais. |
| Une copie du stockage du téléphone (outils d'extraction) | ✅ Les essais de code doivent passer par la puce du téléphone : pas de forçage hors ligne. |
| Quelqu'un qui connaît le code d'un groupe | ✅ Sans les mots-clés **et** l'accord d'un admin, il n'entre pas. |
| Un membre retiré du groupe | ✅ Nouvelle clé, il est banni : il ne lit plus les nouveaux messages. |
| Un serveur qui remplace les clés d'un contact | ✅ Clés épinglées + numéro de sécurité : c'est refusé et signalé. |

### Ses limites (à connaître)

- **Pas de « confidentialité persistante » message par message.** La clé d'un groupe sert à tous les messages jusqu'à la prochaine rotation (départ ou retrait d'un membre). Quelqu'un qui obtiendrait cette clé, **et** une copie des messages chiffrés du serveur, lirait les messages de cette période. Signal et WhatsApp changent de clé à chaque message ; BaseSecrète compense par les couches en plus (code + mots-clés, accord d'un admin, clé matérielle).
- **Un téléphone piraté** (logiciel espion) ou **déverrouillé entre de mauvaises mains** voit ce que voit son propriétaire. Aucune messagerie ne protège contre ça.
- **Les métadonnées** : le serveur sait qui est dans quel groupe, quand les messages passent, et leur taille approximative (voir §5).
- **Un membre peut toujours copier** : capture d'écran (bloquable sur son propre téléphone, en option), photo de l'écran, copie du texte.
- **Le code de groupe à 6 chiffres est court** : l'essentiel de la protection vient des mots-clés. Mieux vaut des mots-clés peu devinables.
- **Pas encore d'audit indépendant.** Les audits faits jusqu'ici (voir [SECURITE.md](SECURITE.md)) sont internes. Un audit par un cabinet spécialisé serait l'étape suivante avant un usage à grande échelle.

### En résumé

**Pour l'usage prévu (un cercle d'amis qui veut que ni le serveur, ni l'hébergeur, ni un voleur de téléphone ne puisse lire ses conversations), le niveau est élevé.** Les algorithmes sont ceux des messageries de référence (famille libsodium : X25519, Ed25519, XChaCha20-Poly1305, Argon2id), rien n'est inventé, et le serveur est traité comme non fiable. La principale différence avec Signal est l'absence de changement de clé à chaque message, compensée en partie par le double verrou et l'accord des admins.

---

## 7. Glossaire

| Terme | Sens |
|---|---|
| **Chiffrement de bout en bout** | Seuls l'expéditeur et les destinataires peuvent lire. Le serveur au milieu ne peut pas. |
| **Clé publique / privée** | La publique sert aux autres pour chiffrer pour toi ou vérifier ta signature ; la privée, qui ne quitte pas ton téléphone, sert à déchiffrer et signer. |
| **Signature** | Preuve qu'un message vient bien de toi et n'a pas été modifié. |
| **Argon2id** | Fonction qui transforme un code en clé, volontairement lente et gourmande en mémoire pour décourager les essais en masse. |
| **XChaCha20-Poly1305** | Algorithme qui chiffre et détecte toute modification. |
| **Secure Enclave / Keystore / StrongBox** | Puces ou zones protégées du téléphone qui gardent des clés impossibles à extraire. |
| **Rotation de clé** | Remplacement de la clé d'un groupe, par exemple quand un membre part. |
| **Métadonnées** | Les informations autour des messages (qui, quand, combien), pas leur contenu. |
