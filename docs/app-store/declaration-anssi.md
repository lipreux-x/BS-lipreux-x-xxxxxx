# Déclaration ANSSI : brouillon (04/11/2026)

Brouillon de la déclaration de **fourniture d'un moyen de cryptologie** pour BaseSecrète, à reporter dans la démarche en ligne :
https://demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie
(formulaires et explications : https://cyber.gouv.fr/controle-reglementaire-sur-la-cryptographie-les-formulaires).

Les champs entre crochets sont à remplir par le déclarant. L'ordre exact des questions du formulaire en ligne peut différer : ce document rassemble les informations techniques qu'il demande. Une fois l'attestation (récépissé) reçue, la téléverser dans App Store Connect (Informations sur l'app, conformité à l'exportation) et passer `ITSAppUsesNonExemptEncryption` à `true` dans `mobile/app.json`.

## 1. Déclarant

- Nom, prénom : [Maxence Allier]
- Qualité : développeur indépendant, fournisseur de l'application
- Adresse : [adresse postale]
- Téléphone : [numéro]
- Courriel : [maxall-dev@outlook.com]
- SIRET : [si applicable, sinon personne physique]

## 2. Le moyen de cryptologie

- Nom commercial : **BaseSecrète**
- Version : 1.0.0 (build iOS 18, novembre 2026)
- Nature : application mobile (logiciel) de messagerie de groupe, iOS (App Store) et Android
- Diffusion : gratuite, sur invitation uniquement (distribution non répertoriée sur l'App Store), France, Belgique, Suisse, Luxembourg, Canada
- Opération déclarée : **fourniture** en France (et mise à disposition depuis la France)
- Fonctions de cryptologie : **confidentialité** (chiffrement de bout en bout des messages, photos, vocaux et documents, et du stockage local), **authentification et intégrité** (signatures, codes d'authentification)
- Les clés sont générées et gardées sur le téléphone de l'utilisateur. Le serveur ne détient aucune clé permettant de déchiffrer les contenus.

## 3. Algorithmes et longueurs de clés

Tous les algorithmes sont publics et standard. Aucun algorithme propriétaire.

| Fonction | Algorithme | Taille de clé / paramètres | Usage dans l'app |
|---|---|---|---|
| Chiffrement authentifié | **XChaCha20-Poly1305** (IETF) | clé 256 bits, nonce 192 bits, étiquette 128 bits | messages, méta des groupes, pièces jointes, base de données locale |
| Chiffrement à clé publique | **X25519 + XSalsa20-Poly1305** (`crypto_box`, `crypto_box_seal`) | courbe 25519 (≈128 bits de sécurité), clé symétrique 256 bits | remise de la clé d'un groupe à chaque membre |
| Signature | **Ed25519** | clé 256 bits | messages, remises de clé, méta des groupes, preuve de connexion |
| Hachage / dérivation de clés | **BLAKE2b** (avec et sans clé) | sorties de 128 à 512 bits | dérivation de sous-clés séparées par étiquette |
| Dérivation à partir d'un secret faible | **Argon2id** v1.3 | 64 Mio, 3 passes, 1 voie | code de l'app (6 chiffres), code de groupe + mots-clés, mot de passe de sauvegarde |
| Lien avec le matériel sécurisé du téléphone | **HMAC-SHA256** ; sur iOS, clé dérivée par **ECDH P-256** dans la Secure Enclave ; sur Android, clé HMAC dans l'Android Keystore (StrongBox si présent) | 256 bits | protège la clé maître locale contre une copie du stockage |
| Transport | **TLS** du système (iOS / Android) | selon le système | connexion à l'API |

Bibliothèques : `@noble/ciphers`, `@noble/hashes`, `tweetnacl` (JavaScript, open source, auditées), Argon2 natif (Argon2Swift sur iOS, implémentation de référence en C sur Android), CryptoKit (iOS) et Android Keystore pour le matériel sécurisé.

Côté serveur (exploité par le déclarant, hébergé chez Neon, Union européenne) : SHA-256 et HMAC-SHA256 (empreintes et preuves), AES-256-GCM (copie de sauvegarde des clés, déjà chiffrée par l'utilisateur, rechiffrée au repos), JWT HS256 (jetons de session).

## 4. Gestion des clés

- Chaque compte a une paire X25519 (chiffrement) et une paire Ed25519 (signature), générées sur le téléphone.
- Chaque groupe a une clé symétrique aléatoire de 256 bits, remise à chaque membre chiffrée pour sa clé X25519, enveloppée sous une clé dérivée (Argon2id) du code du groupe et de trois mots-clés partagés en personne, et signée par l'admin qui la remet.
- La clé d'un groupe est remplacée quand un membre part ou est retiré (aucun nouveau message n'est accepté avant), et quand elle a plus de 7 jours, à la première ouverture du groupe par un admin.
- Une copie des clés du compte, chiffrée par une clé dérivée (Argon2id) d'un mot de passe choisi par l'utilisateur, est gardée sur le serveur pour retrouver le compte sur un nouveau téléphone. Le serveur ne peut pas l'ouvrir.
- Aucun séquestre de clés, aucune clé maîtresse détenue par le fournisseur.

## 5. Points à confirmer avec l'ANSSI

- Le serveur ne fait que stocker et relayer des contenus chiffrés sur les téléphones : à confirmer qu'aucune déclaration de **prestation** de cryptologie n'est nécessaire en plus de la fourniture du moyen.
- Une évolution prévue (échange de clés hybride X25519 + ML-KEM-768, post-quantique) ajouterait un algorithme : demander si elle appelle une nouvelle déclaration ou une simple mise à jour.
- Documentation technique : le dépôt (`docs/SPEC.md`, `docs/SECURITE.md`, `mobile/src/crypto`) peut être fourni si l'ANSSI la demande.
