# Discord Vocal Bot

Bot Discord de gestion avancee de salons vocaux. Deplace, surveille et controle les membres en vocal avec un systeme de permissions, de logs automatiques et de cooldowns.

-----

## Sommaire

- [Commandes](#commandes)
- [Systeme de permissions](#systeme-de-permissions)
- [Cooldowns](#cooldowns)
- [Logs automatiques](#logs-automatiques)
- [Installation](#installation)
- [Deploiement VPS](#deploiement-vps)
- [Mise a jour](#mise-a-jour)
- [Permissions Discord requises](#permissions-discord-requises)

-----

## Commandes

### Commandes vocales — accessibles WL et OW

|Commande       |Description                                                  |Conditions                                           |
|---------------|-------------------------------------------------------------|-----------------------------------------------------|
|`=mv @user`    |Deplace un membre dans votre salon vocal                     |Vous devez etre en vocal                             |
|`=find @user`  |Affiche le salon vocal d’un membre                           |Aucune                                               |
|`=mvall #salon`|Deplace tous les membres de votre vocal vers un autre salon  |Vous devez etre en vocal — cooldown 2min             |
|`=wakeup @user`|Deplace un membre dans tous les vocaux du serveur pendant 30s|La cible doit etre en vocal — cooldown 5min par cible|
|`=join @user`  |Vous deplace dans le vocal de la cible                       |Vous et la cible devez etre en vocal                 |
|`=deco @user`  |Deconnecte un membre de son vocal                            |Aucune — cooldown 1m30                               |

-----

### Commandes de gestion — accessibles OW et BOT OWNER

|Commande     |Description                     |
|-------------|--------------------------------|
|`=wl @user`  |Ajoute un membre a la whitelist |
|`=unwl @user`|Retire un membre de la whitelist|
|`=wl list`   |Affiche la liste des OW et WL   |

-----

### Commandes exclusives — BOT OWNER uniquement

|Commande          |Description                           |
|------------------|--------------------------------------|
|`=ow @user`       |Passe un membre OW (owner bot)        |
|`=unow @user`     |Retire le statut OW d’un membre       |
|`=play <activite>`|Definit l’activite affichee par le bot|


> Le BOT OWNER est l’ID fixe directement dans le code. Il ne peut pas etre modifie depuis Discord.

-----

## Systeme de permissions

```
BOT OWNER  (ID hardcode dans index.js)
    Toutes les commandes sans exception

OW  (ajoutes via =ow par le BOT OWNER)
    Toutes les commandes vocales
    =wl / =unwl / =wl list

WL  (ajoutes via =wl par un OW ou le BOT OWNER)
    Toutes les commandes vocales
```

Les donnees OW et WL sont sauvegardees dans `data.json` sur le serveur. Ce fichier est genere automatiquement au premier lancement.

-----

## Cooldowns

|Commande |Duree               |Portee                                              |
|---------|--------------------|----------------------------------------------------|
|`=mvall` |2 minutes           |Par utilisateur                                     |
|`=deco`  |1 minute 30 secondes|Par utilisateur                                     |
|`=wakeup`|5 minutes           |Par cible (global, peu importe qui fait la commande)|

Si un cooldown est actif, le bot repond avec le temps restant exact.

-----

## Logs automatiques

Chaque commande envoie un embed dans un salon de logs dedie.

|Commande          |Salon de logs (ID)   |
|------------------|---------------------|
|`=mv`             |`1507874747357069422`|
|`=join`           |`1507874799555313865`|
|`=mvall`          |`1507874855134171136`|
|`=wakeup`         |`1507874894527074398`|
|`=deco`           |`1507874992254095471`|
|`=wl` et `=ow`    |`1507882449378738206`|
|`=unwl` et `=unow`|`1507883737571131432`|

-----

## Installation

### 1. Creer le bot sur Discord

1. Aller sur [discord.com/developers/applications](https://discord.com/developers/applications)
1. Cliquer **New Application** et lui donner un nom
1. Aller dans **Bot** > cliquer **Add Bot**
1. Activer les **Privileged Gateway Intents** suivants :
- `SERVER MEMBERS INTENT`
- `MESSAGE CONTENT INTENT`
1. Copier le **Token** du bot (ne jamais le partager)

### 2. Inviter le bot sur le serveur

Dans **OAuth2 > URL Generator** :

- Scopes : `bot`
- Permissions : `Move Members`, `View Channel`, `Send Messages`, `Embed Links`, `Read Message History`

Ouvrir l’URL generee et selectionner ton serveur.

### 3. Preparer les fichiers

```
discord-vocal-bot/
├── index.js          <- code principal
├── package.json      <- dependances
├── .env              <- token (ne jamais commit)
├── .env.example      <- modele du .env
├── .gitignore
└── README.md
```

Contenu du fichier `.env` :

```
DISCORD_TOKEN=ton_token_discord_ici
```

### 4. Lancer en local (test)

```bash
npm install
node index.js
```

-----

## Deploiement VPS

### Prerequis

- VPS sous Ubuntu 20.04 / 22.04 / Debian
- Acces SSH

### Etape 1 — Installer Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verifier :

```bash
node -v   # doit afficher v20.x.x
npm -v
```

### Etape 2 — Cloner le repo

```bash
git clone https://github.com/TON_USERNAME/discord-vocal-bot.git
cd discord-vocal-bot
npm install
```

### Etape 3 — Creer le fichier .env

```bash
cp .env.example .env
nano .env
```

Remplacer `ton_token_ici` par ton vrai token Discord.
Sauvegarder : `Ctrl+X` puis `Y` puis `Entree`.

### Etape 4 — Lancer avec PM2

PM2 garde le bot actif en permanence et le relance automatiquement si il plante.

```bash
npm install -g pm2
pm2 start index.js --name "discord-bot"
pm2 startup
pm2 save
```

### Verifier que le bot tourne

```bash
pm2 status
```

Le statut doit etre `online`.

-----

## Mise a jour

Quand tu modifies le code sur ton PC :

```bash
# Sur ton PC
git add .
git commit -m "description de la modification"
git push
```

```bash
# Sur le VPS
cd discord-vocal-bot
git pull
pm2 restart discord-bot
```

-----

## Permissions Discord requises

Le role du bot dans le serveur doit avoir ces permissions :

|Permission            |Utilite                                       |
|----------------------|----------------------------------------------|
|`Move Members`        |Deplacer et deconnecter des membres des vocaux|
|`View Channel`        |Voir les salons pour les logs                 |
|`Send Messages`       |Repondre aux commandes                        |
|`Embed Links`         |Envoyer les embeds de logs                    |
|`Read Message History`|Lire les commandes dans les salons            |


> Si le bot n’a pas `Move Members` dans un salon vocal specifique, il considere ce salon comme prive et refuse d’agir dessus. C’est le comportement voulu pour proteger les salons prives.

-----

## Commandes PM2 utiles

```bash
pm2 status                  # etat du bot
pm2 logs discord-bot        # logs en direct
pm2 restart discord-bot     # redemarrer
pm2 stop discord-bot        # arreter
pm2 delete discord-bot      # supprimer le processus
```
