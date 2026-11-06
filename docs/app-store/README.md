# BaseSecrète — App Store

Tout ce qui sert à la fiche App Store Connect (app 6824479601, `com.lipreux.basesecrete`), état au 20/10/2026.

## Fichiers

| Fichier | Rôle | En ligne |
|---|---|---|
| [confidentialite.html](confidentialite.html) | Politique de confidentialité (URL exigée par Apple) | https://claude.ai/artifact/JHLnoKzzVYr7vyDmVGzX59 |
| [assistance.html](assistance.html) | Page d'assistance (URL exigée par Apple) | https://claude.ai/artifact/G9JCXy2DPGZNzMq46phW1K |
| [fiche.md](fiche.md) | Textes saisis dans App Store Connect (EN + FR), réponses aux questionnaires | — |

Les deux pages n'ont pas de `<!doctype>`, `<html>`, `<head>` ni `<body>` : la publication les ajoute. Pour les héberger ailleurs, entoure le contenu de ce squelette. Elles évitent volontairement les tirets dans le texte.

Pour mettre à jour une page en ligne : modifier le fichier ici, puis le republier sur la même URL (artifact). Les pages doivent être partagées en **public** pour qu'Apple puisse les ouvrir.

## Reste à faire avant la soumission

- Rendre les deux pages publiques, puis coller les URLs : politique dans *Confidentialité de l'app* (puis **Publier**), assistance dans *URL de l'assistance* (versions EN et FR).
- Captures d'écran iPhone.
- Build : `eas build -p ios` puis `eas submit`.
- Compte de démo (`mobile/src/services/__tests__/demo-account.test.ts`) : pseudo + mot de passe dans *Informations de connexion*, et remplacer `[GROUP CODE]` / `[KEYWORD …]` dans les Remarques. Coordonnées de contact.
- Accepter la mise à jour du contrat Apple Developer Program (titulaire du compte).

## Distribution non répertoriée (choisie le 04/11)

Procédure Apple (developer.apple.com/support/unlisted-app-distribution) : soumettre la version 1.0 à la vérification App Store avec, dans les Remarques, la mention qu'elle est destinée à une distribution non répertoriée, puis envoyer le formulaire https://developer.apple.com/contact/request/unlisted-app/. Une demande pour une app pas encore soumise est refusée. La version 1.0 est réglée en **publication manuelle** (sinon elle sortirait en public dès la validation).

## Risques de refus

- ~~Pas de suppression de compte dans l'app (règle 5.1.1(v))~~ : fait le 04/11 (Réglages, section Compte ; `DELETE /me`, qui ne garde que l'id et les clés publiques).
- ~~Signaler / bloquer un membre (règle 1.2)~~ : fait le 04/11 (appui long sur un message ; `POST /groups/:id/reports`, lus avec `server/scripts/reports.ts --prod`, à surveiller ; blocage local, liste dans les Réglages).
- **Chiffrement** : `app.json` déclare `ITSAppUsesNonExemptEncryption: false` alors que l'app fait son propre chiffrement de bout en bout (algorithmes standard). Une diffusion en France peut demander une déclaration de chiffrement.
- **Hébergement** : la politique dit « Neon, dans l'Union européenne » (déduit de la branche de dev, eu-central-1). À confirmer pour la production.
