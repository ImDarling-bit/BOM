# Protocole serveur

Ce que l'app BOM attend du serveur. Tout est en JSON. L'implémentation de référence est dans
[`server/`](../server/).

## Confidentialité

- L'app n'envoie **jamais** l'UUID complet : seulement le nom affiché `Pseudo#48F2` et le rôle.
- La position publique (chat local, carte) est arrondie à 3 décimales (~110 m).
- La position **précise** n'est envoyée que si le partage avec les proches est activé ; le
  serveur la relaie aux seuls proches qui ont le code, et ne l'affiche jamais dans le panneau
  d'administration.
- Les signalements de la carte sont envoyés à l'endroit exact choisi sous le viseur.
- Le panneau d'administration voit : pseudo, rôle, appareil (plateforme + version de l'app),
  position arrondie, chat, signalements, appels à l'aide, purges.
- Recommandations côté serveur : aucun log d'IP, rien sur disque à part les comptes admin,
  TLS obligatoire (`wss://`, `https://`), rate limiting.

## WebSocket — `EXPO_PUBLIC_WS_URL` (chemin `/ws`)

### Client → serveur

| `type`            | Champs                                                                 | Quand                                        |
|-------------------|------------------------------------------------------------------------|----------------------------------------------|
| `hello`           | `name`, `role`, `radius` (m), `client` `{version, platform}`, `shareCode?`, `follows` (codes), `latitude?`, `longitude?` | à chaque (re)connexion |
| `position`        | `latitude`, `longitude` (ou `null` si partage désactivé)               | quand la position arrondie change            |
| `chat`            | `id`, `author`, `role`, `text`, `ts`, `latitude?`, `longitude?`        | envoi d'un message                           |
| `help`            | `id`, `roles` (`medic`/`supply`/`protection`/`user`/`all`), `note`, `latitude`, `longitude` | appel à l'aide |
| `help_cancel`     | `id`                                                                   | l'auteur annule son appel                    |
| `share`           | `code` (8 caractères) ou `null`                                        | partage avec les proches activé / coupé      |
| `follow`          | `codes` (liste)                                                        | liste des proches modifiée                   |
| `friend_position` | `latitude`, `longitude` (précises)                                     | si le partage avec les proches est activé    |
| `panic`           | `latitude?`, `longitude?`                                              | juste avant une purge                        |
| `ping`            | —                                                                      | toutes les 25 s                              |

### Serveur → client

| `type`           | Champs                                                            |
|------------------|-------------------------------------------------------------------|
| `chat`           | même forme que l'envoi client (auteur et rôle imposés par le `hello`) |
| `report`         | `report` : objet Signalement (voir ci-dessous)                    |
| `report_removed` | `id`                                                              |
| `help`           | `help` : `{id, author, role, roles, note, latitude, longitude, createdAt, expiresAt}` |
| `help_ack`       | `id`, `notified` (nombre de personnes prévenues)                  |
| `help_removed`   | `id`                                                              |
| `friend`         | `code`, `name`, `latitude`, `longitude`, `ts`                     |
| `friend_panic`   | `code`, `name`, `latitude`, `longitude` (ou `null`), `ts`         |
| `nearby`         | `count` (autres manifestant·es connecté·es dans le rayon, `null` sans position), `radius` — envoyé quand il change, contrôle toutes les 5 s |
| `pong`           | — (ignoré par l'app)                                              |

Le serveur diffuse un `chat` à tous les clients dont la dernière position connue est dans le
`radius` de l'auteur. Un client sans position ne reçoit que les messages sans position.

Un `help` est envoyé aux clients situés à moins de `radius` (2 km par défaut) dont le rôle fait
partie de `roles` (ou à tous si `roles` contient `all`). Il expire après 30 min.

Un `friend_panic` est envoyé à tous les clients qui suivent le code de la personne qui purge. Le
serveur le garde 6 h pour les proches qui se reconnectent après coup.

L'app ignore tout message invalide, d'un `type` inconnu ou de plus de 10 000 caractères, et
dédoublonne par `id` : le serveur peut renvoyer son propre message à l'auteur.

`role` ∈ `user` | `medic` | `supply` | `protection`.

## REST — `EXPO_PUBLIC_API_URL`

L'app ajoute l'en-tête `X-BOM-Client: bom/<version> (<android|ios>)`.

### `GET /reports?lat=…&lng=…&radius=…`

Renvoie un tableau de Signalements actifs dans le rayon.

### `POST /reports`

Point : `{ "type", "latitude", "longitude", "author" }`.
Zone : `{ "type", "area": [[lng, lat], …], "author" }` (3 à 40 sommets, moins de 3 km du centre).

Renvoie le Signalement créé. Le serveur le diffuse aussi en WebSocket (`type: "report"`) aux
clients proches.

### Signalement

```json
{
  "id": "string",
  "type": "danger | teargas | medic | supply | test | kettle | safe_zone | danger_zone",
  "latitude": 48.8674,
  "longitude": 2.3636,
  "area": [[2.3640, 48.8670], [2.3650, 48.8672], [2.3650, 48.8674]],
  "author": "Mouette#48F2",
  "createdAt": 1767225600000,
  "expiresAt": 1767229200000
}
```

- `kettle` (nasse), `safe_zone`, `danger_zone` ont toujours `area` ; `latitude`/`longitude`
  sont alors le centre de la zone. La nasse est une bande de 30 m le long de la rue.
- `test` expire après 30 min, les autres après 1 h.
- Les dates sont en millisecondes depuis l'epoch Unix.

## Panneau d'administration — `/admin`

Accessible uniquement depuis un navigateur. Comptes en base SQLite (mot de passe scrypt),
double authentification TOTP, sessions par cookie `HttpOnly` + `SameSite=Strict`. Le panneau
reçoit un instantané toutes les 2 s et les événements en direct sur `/admin/ws`.
