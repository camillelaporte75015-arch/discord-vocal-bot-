require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const SUPER_OWNER_ID = process.env.SUPER_OWNER_ID || '1507830698743038122';

const LOG_CHANNELS = {
  mv:       '1507874747357069422',
  join:     '1507874799555313865',
  mvall:    '1507874855134171136',
  wakeup:   '1507874894527074398',
  deco:     '1507874992254095471',
  wl:       '1507882449378738206',
  ow:       '1507882449378738206',
  unow:     '1507883737571131432',
  unwl:     '1507883737571131432',
  follow:   '1507899425970720882',
  unfollow: '1507899466747875368',
};

const COLORS = {
  mv:       0x5865F2,
  join:     0x57F287,
  mvall:    0xFEE75C,
  wakeup:   0xED4245,
  deco:     0xEB459E,
  wl:       0x1ABC9C,
  ow:       0xF1C40F,
  unow:     0x992D22,
  unwl:     0xE67E22,
  follow:   0x9B59B6,
  unfollow: 0x7F8C8D,
  error:    0x36393F,
};

// ─── BASE DE DONNÉES (JSON) ───────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, 'data');
const WL_FILE  = path.join(DATA_DIR, 'whitelist.json');
const OW_FILE  = path.join(DATA_DIR, 'owners.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, def) {
  ensureDataDir();
  if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(def, null, 2)); return def; }
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return def; }
}

function saveJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const getWL      = ()  => loadJSON(WL_FILE, []);
const getOW      = ()  => loadJSON(OW_FILE, []);
const addWL      = (id) => { const l = getWL(); if (!l.includes(id)) saveJSON(WL_FILE, [...l, id]); };
const removeWL   = (id) => saveJSON(WL_FILE, getWL().filter(x => x !== id));
const addOW      = (id) => { const l = getOW(); if (!l.includes(id)) saveJSON(OW_FILE, [...l, id]); };
const removeOW   = (id) => saveJSON(OW_FILE, getOW().filter(x => x !== id));
const isSuperOwner = (id) => id === SUPER_OWNER_ID;
const isOW       = (id) => getOW().includes(id);
const isWL       = (id) => getWL().includes(id);
const hasAccess  = (id) => isSuperOwner(id) || isOW(id) || isWL(id);

// ─── COOLDOWNS ────────────────────────────────────────────────────────────────

const cooldowns = new Map();

function checkCooldown(key) {
  if (!cooldowns.has(key)) return 0;
  const remaining = cooldowns.get(key) - Date.now();
  if (remaining <= 0) { cooldowns.delete(key); return 0; }
  return remaining;
}

function setCooldown(key, ms) {
  cooldowns.set(key, Date.now() + ms);
}

function formatRemaining(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} seconde${s > 1 ? 's' : ''}`;
  const min = Math.floor(s / 60), r = s % 60;
  return r === 0
    ? `${min} minute${min > 1 ? 's' : ''}`
    : `${min} minute${min > 1 ? 's' : ''} et ${r} seconde${r > 1 ? 's' : ''}`;
}

// ─── EMBEDS ───────────────────────────────────────────────────────────────────

function replyEmbed(color, description) {
  return new EmbedBuilder().setColor(color).setDescription(description).setTimestamp();
}

function logEmbed(type, title, fields) {
  const embed = new EmbedBuilder().setColor(COLORS[type] ?? COLORS.error).setTitle(title).setTimestamp();
  for (const f of fields) embed.addFields({ name: f.name, value: f.value, inline: f.inline ?? false });
  return embed;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

const m = (member) => `<@${member.id}>`;

async function resolveMember(guild, input) {
  if (!input) return null;
  const id = input.replace(/[<@!>]/g, '').trim();
  if (!/^\d+$/.test(id)) return null;
  try { return await guild.members.fetch(id); } catch { return null; }
}

function resolveVoiceChannel(guild, input) {
  if (!input) return null;
  const id = input.replace(/[<#>]/g, '').trim();
  const ch = guild.channels.cache.get(id);
  if (!ch || (ch.type !== 2 && ch.type !== 13)) return null;
  return ch;
}

function canAccess(member, channel) {
  const perms = channel.permissionsFor(member);
  return perms && perms.has('ViewChannel') && perms.has('Connect');
}

async function sendLog(client, guild, type, title, fields) {
  const channelId = LOG_CHANNELS[type];
  if (!channelId) return;
  try {
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (ch && ch.isTextBased()) await ch.send({ embeds: [logEmbed(type, title, fields)] });
  } catch (e) {
    console.error(`Log ${type} impossible:`, e.message);
  }
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.once('ready', () => {
  console.log(`Bot connecte en tant que ${client.user.tag}`);
  client.user.setActivity(process.env.BOT_ACTIVITY || 'les vocaux', { type: 0 });
});

const wakeupCooldowns = new Map();

// ─── FOLLOW — followerId -> { targetId, guildId } ────────────────────────────
// Stocke qui suit qui. Une seule cible par follower.
const follows = new Map();

client.on('voiceStateUpdate', async (oldState, newState) => {
  // Cherche si quelqu'un suit la personne qui vient de bouger
  for (const [followerId, { targetId, guildId }] of follows.entries()) {
    if (newState.member?.id !== targetId) continue;
    if (guildId !== newState.guild.id) continue;

    // La cible a rejoint ou changé de vocal
    if (!newState.channelId) continue; // cible a quitté, on attend qu'elle revienne

    const guild    = newState.guild;
    const follower = await guild.members.fetch(followerId).catch(() => null);
    if (!follower) continue;

    // Si le follower n'est pas en vocal, impossible de le déplacer
    if (!follower.voice?.channelId) continue;

    // Déjà dans le même salon
    if (follower.voice.channelId === newState.channelId) continue;

    // Vérifie que le follower peut accéder au salon cible
    const destChannel = guild.channels.cache.get(newState.channelId);
    if (!destChannel) continue;
    const perms = destChannel.permissionsFor(follower);
    if (!perms || !perms.has('ViewChannel') || !perms.has('Connect')) continue;

    try { await follower.voice.setChannel(destChannel); } catch { /* vocal privé ou autre, on ignore */ }
  }
});

// ─── HANDLER ──────────────────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('=')) return;

  const [command, ...args] = message.content.slice(1).trim().split(/\s+/);
  const cmd      = command.toLowerCase();
  const authorId = message.author.id;
  const executor = message.member;

  // =ow, =unow, =play — super owner uniquement
  if (['ow', 'unow', 'play'].includes(cmd)) {
    if (!isSuperOwner(authorId))
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Vous navez pas la permission dutiliser cette commande.')] });

    if (cmd === 'play') {
      const activity = args.join(' ');
      if (!activity) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Precisez ce que le bot doit jouer.')] });
      client.user.setActivity(activity, { type: 0 });
      return message.reply({ embeds: [replyEmbed(COLORS.ow, `Je joue maintenant a ${activity}`)] });
    }

    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });

    if (cmd === 'ow') {
      addOW(target.id);
      await message.reply({ embeds: [replyEmbed(COLORS.ow, `${m(target)} a ete ajoute comme owner du bot.`)] });
      await sendLog(client, message.guild, 'ow', 'Logs ow', [
        { name: 'Action', value: `${m(executor)} a ajoute ${m(target)} au owner bot` },
      ]);
    }

    if (cmd === 'unow') {
      removeOW(target.id);
      await message.reply({ embeds: [replyEmbed(COLORS.unow, `${m(target)} nest plus owner du bot.`)] });
      await sendLog(client, message.guild, 'unow', 'Logs unow', [
        { name: 'Action', value: `${m(executor)} a supprime ${m(target)} des owner bot` },
      ]);
    }
    return;
  }

  // =wl, =unwl — owner + super owner
  if (['wl', 'unwl'].includes(cmd)) {
    if (!isSuperOwner(authorId) && !isOW(authorId))
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Vous navez pas la permission dutiliser cette commande.')] });

    if (cmd === 'wl' && args[0] === 'list') {
      const owners = getOW();
      const wl     = getWL();
      const ownerLines = owners.length ? owners.map(id => `<@${id}> — \`${id}\``).join('\n') : 'Aucun owner.';
      const wlLines    = wl.length    ? wl.map(id    => `<@${id}> — \`${id}\``).join('\n') : 'Aucune personne en whitelist.';
      const embed = new EmbedBuilder()
        .setColor(COLORS.wl)
        .setTitle('WL / OW — Commandes vocal')
        .addFields({ name: 'OW', value: ownerLines }, { name: 'WL', value: wlLines })
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });

    if (cmd === 'wl') {
      addWL(target.id);
      await message.reply({ embeds: [replyEmbed(COLORS.wl, `${m(target)} a ete ajoute a la whitelist du bot.`)] });
      await sendLog(client, message.guild, 'wl', 'Logs wl', [
        { name: 'Action', value: `${m(executor)} a ajoute ${m(target)} a la whitelist bot` },
      ]);
    }

    if (cmd === 'unwl') {
      removeWL(target.id);
      await message.reply({ embeds: [replyEmbed(COLORS.unwl, `${m(target)} a ete retire de la whitelist du bot.`)] });
      await sendLog(client, message.guild, 'unwl', 'Logs unwl', [
        { name: 'Action', value: `${m(executor)} a supprime ${m(target)} de la whitelist bot` },
      ]);
    }
    return;
  }

  // Commandes vocales — WL / OW / super owner
  if (!['mv', 'find', 'mvall', 'wakeup', 'join', 'deco', 'follow', 'unfollow'].includes(cmd)) return;

  if (!hasAccess(authorId))
    return message.reply({ embeds: [replyEmbed(COLORS.error, 'Vous navez pas la permission dutiliser cette commande.')] });

  // =find
  if (cmd === 'find') {
    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });
    if (!target.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.mv, `${m(target)} nest pas en vocal.`)] });
    return message.reply({ embeds: [replyEmbed(COLORS.mv, `${m(target)} est dans le vocal ${target.voice.channel}`)] });
  }

  // =wakeup
  if (cmd === 'wakeup') {
    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });

    const remaining = wakeupCooldowns.has(target.id)
      ? Math.max(0, wakeupCooldowns.get(target.id) - Date.now()) : 0;
    if (remaining > 0)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `Limite de wakeup atteinte sur ${m(target)}, merci dattendre ${formatRemaining(remaining)}.`)] });

    if (!target.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `${m(target)} nest pas en vocal. Je nai pas pu la wakeup.`)] });

    wakeupCooldowns.set(target.id, Date.now() + 5 * 60 * 1000);

    await message.reply({ embeds: [replyEmbed(COLORS.wakeup, `Je deplace maintenant ${m(target)} dans tous les salons vocaux pendant 30 secondes.`)] });
    await sendLog(client, message.guild, 'wakeup', 'Logs wakeup', [
      { name: 'Action', value: `${m(executor)} a wakeup ${m(target)}` },
    ]);

    let elapsed = 0;
    const interval = setInterval(async () => {
      elapsed += 2000;
      if (elapsed > 30000) { clearInterval(interval); return; }
      try { await target.fetch(); } catch { clearInterval(interval); return; }
      if (!target.voice?.channel) { clearInterval(interval); return; }
      const vcs = message.guild.channels.cache.filter(ch => ch.type === 2 && ch.id !== target.voice?.channelId);
      if (!vcs.size) return;
      try { await target.voice.setChannel(vcs.random()); } catch { clearInterval(interval); }
    }, 2000);
    return;
  }

  // =mv
  if (cmd === 'mv') {
    if (!executor.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Vous devez etre en vocal pour moov cette personne.')] });

    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });
    if (!target.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `${m(target)} nest pas en vocal.`)] });

    const destChannel = executor.voice.channel;
    const oldChannel  = target.voice.channel;

    try { await target.voice.setChannel(destChannel); } catch {
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Impossible de deplacer cette personne (permissions insuffisantes).')] });
    }

    await message.reply({ embeds: [replyEmbed(COLORS.mv, `${m(target)} a ete deplace vers ${destChannel}`)] });
    await sendLog(client, message.guild, 'mv', 'Logs moov', [
      { name: 'Action', value: `${m(executor)} a deplace ${m(target)}` },
      { name: 'Salon de base', value: `${oldChannel}`, inline: true },
      { name: 'Nouveau salon', value: `${destChannel}`, inline: true },
    ]);
    return;
  }

  // =mvall
  if (cmd === 'mvall') {
    const cooldownKey = `mvall:${executor.id}`;
    const remaining = checkCooldown(cooldownKey);
    if (remaining > 0)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `Limite de mvall atteinte, merci dattendre ${formatRemaining(remaining)}.`)] });

    if (!executor.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Vous devez etre en vocal pour mvall.')] });

    const destChannel = resolveVoiceChannel(message.guild, args[0]);
    if (!destChannel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Salon vocal introuvable. Utilisez un #mention ou un ID de salon vocal.')] });

    if (!canAccess(executor, destChannel))
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Impossible de mvall les membres dun salon prive.')] });

    const sourceChannel = executor.voice.channel;
    for (const member of sourceChannel.members.values()) {
      try { await member.voice.setChannel(destChannel); } catch { /* ignore */ }
    }

    setCooldown(cooldownKey, 2 * 60 * 1000);
    await message.reply({ embeds: [replyEmbed(COLORS.mvall, `Tous les membres ont ete deplaces de ${sourceChannel} vers ${destChannel}`)] });
    await sendLog(client, message.guild, 'mvall', 'Logs mvall', [
      { name: 'Action', value: `${m(executor)} a mvall tous les membres.` },
      { name: 'Ancien salon', value: `${sourceChannel}`, inline: true },
      { name: 'Nouveau salon', value: `${destChannel}`, inline: true },
    ]);
    return;
  }

  // =join
  if (cmd === 'join') {
    if (!executor.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Pour effectuer la commande vous devez etre en vocal.')] });

    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });
    if (!target.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `${m(target)} nest actuellement pas en vocal.`)] });

    const destChannel = target.voice.channel;
    if (!canAccess(executor, destChannel))
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Impossible de rejoindre un vocal prive.')] });

    try { await executor.voice.setChannel(destChannel); } catch {
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Impossible de vous deplacer dans ce salon.')] });
    }

    await message.reply({ embeds: [replyEmbed(COLORS.join, `${m(executor)} rejoint le salon vocal de ${m(target)}`)] });
    await sendLog(client, message.guild, 'join', 'Logs join', [
      { name: 'Action', value: `${m(executor)} a join ${m(target)} dans le salon ${destChannel}` },
    ]);
    return;
  }

  // =deco
  if (cmd === 'deco') {
    const cooldownKey = `deco:${executor.id}`;
    const remaining = checkCooldown(cooldownKey);
    if (remaining > 0)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `Limite de deconnexion atteinte, merci dattendre ${formatRemaining(remaining)}.`)] });

    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });
    if (!target.voice?.channel)
      return message.reply({ embeds: [replyEmbed(COLORS.error, `${m(target)} nest pas en vocal, je nai pas pu la deconnecter.`)] });

    const channel = target.voice.channel;
    if (!canAccess(executor, channel))
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Impossible de deconnecter cette personne, elle est dans un salon vocal prive.')] });

    try { await target.voice.disconnect(); } catch {
      return message.reply({ embeds: [replyEmbed(COLORS.error, 'Impossible de deconnecter cette personne.')] });
    }

    setCooldown(cooldownKey, 90 * 1000);
    await message.reply({ embeds: [replyEmbed(COLORS.deco, `${m(target)} a ete deconnecte du salon ${channel}`)] });
    await sendLog(client, message.guild, 'deco', 'Logs deconnexion', [
      { name: 'Action', value: `${m(executor)} a deco ${m(target)}` },
      { name: 'Salon', value: `${channel}` },
    ]);
    return;
  }
  // =follow
  if (cmd === 'follow') {
    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });

    if (follows.has(executor.id)) {
      const current = follows.get(executor.id);
      if (current.targetId === target.id) {
        return message.reply({ embeds: [replyEmbed(COLORS.error, `Vous followez deja ${m(target)}.`)] });
      }
      const currentMember = await message.guild.members.fetch(current.targetId).catch(() => null);
      const currentMention = currentMember ? m(currentMember) : `\`${current.targetId}\``;
      return message.reply({ embeds: [replyEmbed(COLORS.error, `Vous etes deja en train de follow ${currentMention}, unfollow cette personne pour follow quelqun dautre.`)] });
    }

    follows.set(executor.id, { targetId: target.id, guildId: message.guild.id });

    await message.reply({ embeds: [replyEmbed(COLORS.follow, `${m(executor)} follow maintenant ${m(target)}`)] });
    await sendLog(client, message.guild, 'follow', 'Logs follow', [
      { name: 'Action', value: `${m(executor)} follow maintenant ${m(target)}` },
    ]);
    return;
  }

  // =unfollow
  if (cmd === 'unfollow') {
    const target = await resolveMember(message.guild, args[0]);
    if (!target) return message.reply({ embeds: [replyEmbed(COLORS.error, 'Membre introuvable.')] });

    if (!follows.has(executor.id) || follows.get(executor.id).targetId !== target.id) {
      return message.reply({ embeds: [replyEmbed(COLORS.error, `Vous ne followez pas ${m(target)}.`)] });
    }

    follows.delete(executor.id);

    await message.reply({ embeds: [replyEmbed(COLORS.unfollow, `${m(executor)} a arrete de follow ${m(target)}`)] });
    await sendLog(client, message.guild, 'unfollow', 'Logs unfollow', [
      { name: 'Action', value: `${m(executor)} a arrete de follow ${m(target)}` },
    ]);
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
