# BaseSecrète — icônes app (Œil-Serrure · sangles + passants)

| Fichier | Usage |
|---|---|
| icon-1024.png | iOS App Store / Expo `icon` (carré, fond noir, sans coins arrondis — l'OS les ajoute) |
| icon-512.png | Google Play (icône du store) |
| icon-180.png | iPhone (aperçu rapide) |
| icon-rounded-1024.png | Version coins arrondis pour site / réseaux |
| adaptive-foreground-1024.png | Android `adaptiveIcon.foregroundImage` (fond transparent, logo réduit dans la zone sûre) |
| splash-icon-1024.png | Expo `splash.image` (fond transparent) → `backgroundColor: "#000000"` |
| favicon-64.png | Web / favicon |
| *.svg | Sources vectorielles |

## app.json (Expo)
```json
"icon": "./assets/icon-1024.png",
"splash": { "image": "./assets/splash-icon-1024.png", "resizeMode": "contain", "backgroundColor": "#000000" },
"android": { "adaptiveIcon": { "foregroundImage": "./assets/adaptive-foreground-1024.png", "backgroundColor": "#000000" } },
"web": { "favicon": "./assets/favicon-64.png" }
```
Couleurs : fond #000000 · blanc #FFFFFF · or #D4AF37
