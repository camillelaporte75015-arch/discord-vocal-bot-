require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── Config ────────────────────────────────────────────────────────────────

const BOT_OWNER_ID = '1507830698743038122';

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
  wl:       0x57F287,
  ow:       0x5865F2,
  unow:     0xED4245,
  unwl:     0xED4245,
  follow:   0x00B0F4,
  unfollow: 0x99AAB5,
};

// ─── Persistent storage ────────────────────────────────────────────────────

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { owners: [], whitelist: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ─── Rate limits ───────────────────────────────────────────────────────────

// mvall cooldown: 1 usage every 2 minutes per user
const mvallCooldowns = new Map(); // userId -> timestamp

// deco cooldown: 1 usage every 1m30s per user
const decoCooldowns = new Map(); // userId -> timestamp

// wakeup cooldown: per target, 5 minutes for everyone
const wakeupCooldowns = new Map(); // targetId -> timestamp

// active wakeup sessions
const wakeupSessions = new Set(); // targetId currently being woke up

// follow sessions: followerId -> { targetId, targetUsername, followerUsername, guildId }
const followSessions = new Map();

// ─── Helpers ───────────────────────────────────────────────────────────────

function isOwner(userId) {
  return userId === BOT_OWNER_ID || loadData().owners.includes(userId);
}

function isWhitelisted(userId) {
  const data = loadData();
  return userId === BOT_OWNER_ID || data.owners.includes(userId) || data.whitelist.includes(userId);
}

async function resolveTarget(guild, input) {
  input = input.trim();
  // <@id> or <@!id>
  const mentionMatch = input.match(/^<@!?(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : input;
  try {
    return await guild.members.fetch(id);
  } catch {
    return null;
  }
}

async function sendLog(logType, embed) {
  const channelId = LOG_CHANNELS[logType];
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`Failed to send log for ${logType}:`, err.message);
  }
}

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ─── Commands ──────────────────────────────────────────────────────────────

async function cmdMv(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const executorMember = message.member;
  if (!executorMember.voice.channel) {
    return message.reply('Vous devez etre en vocal pour moov cet personne.');
  }

  const destChannel = executorMember.voice.channel;
  const sourceChannel = target.voice.channel;

  if (!sourceChannel) {
    return message.reply(`${target.user.username} n'est pas en vocal.`);
  }

  try {
    await target.voice.setChannel(destChannel);
  } catch {
    return message.reply('Impossible de deplacer cet personne (salon prive ou permissions insuffisantes).');
  }

  await message.reply(`${target.user.username} a ete deplace vers ${destChannel}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.mv)
    .setTitle('Logs moov')
    .setDescription(`${message.author.username} a deplace ${target.user.username}`)
    .addFields(
      { name: 'Salon de base', value: `${sourceChannel}`, inline: true },
      { name: 'Nouveau salon', value: `${destChannel}`, inline: true },
    )
    .setTimestamp();

  await sendLog('mv', embed);
}

async function cmdFind(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const channel = target.voice.channel;
  if (!channel) {
    return message.reply(`${target.user.username} n'est pas en vocal.`);
  }

  return message.reply(`${target.user.username} est dans le vocal ${channel}`);
}

async function cmdMvall(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const now = Date.now();
  const lastUsed = mvallCooldowns.get(message.author.id) || 0;
  const cooldown = 2 * 60 * 1000;

  if (now - lastUsed < cooldown) {
    const remaining = cooldown - (now - lastUsed);
    return message.reply(`Limite de mvall atteinte, merci d'attendre ${formatTime(remaining)}.`);
  }

  const executorMember = message.member;
  if (!executorMember.voice.channel) {
    return message.reply('Vous devez etre en vocal pour mvall.');
  }

  const sourceChannel = executorMember.voice.channel;

  // Resolve destination channel
  const input = (args[0] || '').trim();
  const channelMentionMatch = input.match(/^<#(\d+)>$/);
  const destId = channelMentionMatch ? channelMentionMatch[1] : input;

  let destChannel;
  try {
    destChannel = await message.guild.channels.fetch(destId);
  } catch {
    return message.reply('Salon introuvable.');
  }

  if (!destChannel || destChannel.type !== 2) {
    return message.reply('Veuillez mentionner un salon vocal valide.');
  }

  // Check if executor has access to destination
  const botMember = message.guild.members.me;
  if (!destChannel.permissionsFor(botMember).has('MoveMembers')) {
    return message.reply('Impossible de mvall les membres d\'un salon prive.');
  }

  const members = [...sourceChannel.members.values()];
  if (members.length === 0) {
    return message.reply('Le salon vocal est vide.');
  }

  let moved = 0;
  for (const member of members) {
    try {
      await member.voice.setChannel(destChannel);
      moved++;
    } catch {
      // skip if can't move
    }
  }

  mvallCooldowns.set(message.author.id, now);

  await message.reply(`Tout les membres ont ete deplaces de ${sourceChannel} a ${destChannel}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.mvall)
    .setTitle('Logs mvall')
    .setDescription(`${message.author.username} a mvall tous les membres.`)
    .addFields(
      { name: 'Ancien salon', value: `${sourceChannel}`, inline: true },
      { name: 'Nouveau salon', value: `${destChannel}`, inline: true },
    )
    .setTimestamp();

  await sendLog('mvall', embed);
}

async function cmdWakeup(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const now = Date.now();
  const cooldown = 5 * 60 * 1000;
  const lastUsed = wakeupCooldowns.get(target.id) || 0;

  if (now - lastUsed < cooldown) {
    const remaining = cooldown - (now - lastUsed);
    return message.reply(`Limite de wakeup atteinte sur ${target.user.username}, merci d'attendre ${formatTime(remaining)}.`);
  }

  if (!target.voice.channel) {
    return message.reply(`${target.user.username} n'est pas en vocal. Je n'ai pas pu la wakeup.`);
  }

  if (wakeupSessions.has(target.id)) {
    return message.reply(`${target.user.username} est deja en cours de wakeup.`);
  }

  wakeupCooldowns.set(target.id, now);
  wakeupSessions.add(target.id);

  await message.reply(`Je deplace maintenant ${target.user.username} dans tous les salons vocaux pendant 30 secondes.`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.wakeup)
    .setTitle('Logs wakeup')
    .setDescription(`${message.author.username} a wakeup ${target.user.username}`)
    .setTimestamp();

  await sendLog('wakeup', embed);

  // Wakeup loop: move every 2 seconds for 30 seconds = 15 moves
  let iterations = 0;
  const maxIterations = 15;

  const interval = setInterval(async () => {
    iterations++;

    if (iterations > maxIterations) {
      clearInterval(interval);
      wakeupSessions.delete(target.id);
      return;
    }

    try {
      // Fetch fresh member state
      const freshMember = await message.guild.members.fetch(target.id);
      if (!freshMember.voice.channel) {
        clearInterval(interval);
        wakeupSessions.delete(target.id);
        return;
      }

      const voiceChannels = message.guild.channels.cache.filter(
        (ch) => ch.type === 2 && ch.id !== freshMember.voice.channel?.id
      );

      if (voiceChannels.size === 0) return;

      const randomIndex = Math.floor(Math.random() * voiceChannels.size);
      const randomChannel = [...voiceChannels.values()][randomIndex];

      await freshMember.voice.setChannel(randomChannel);
    } catch {
      // member left voice or no permission, stop
      clearInterval(interval);
      wakeupSessions.delete(target.id);
    }
  }, 2000);
}

async function cmdJoin(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const executorMember = message.member;

  if (!executorMember.voice.channel) {
    return message.reply('Pour effectuer la commande vous devez etre en vocal.');
  }

  if (!target.voice.channel) {
    return message.reply(`${target.user.username} n'est actuellement pas en vocal.`);
  }

  const destChannel = target.voice.channel;

  // Check if executor can join target's channel
  if (!destChannel.permissionsFor(executorMember).has('Connect')) {
    return message.reply('Impossible de rejoindre une vocal privee.');
  }

  try {
    await executorMember.voice.setChannel(destChannel);
  } catch {
    return message.reply('Impossible de rejoindre une vocal privee.');
  }

  await message.reply(`${message.author.username} rejoint le salon vocal de ${target.user.username}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.join)
    .setTitle('Logs join')
    .setDescription(`${message.author.username} a join ${target.user.username} dans le salon ${destChannel}`)
    .setTimestamp();

  await sendLog('join', embed);
}

async function cmdDeco(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const now = Date.now();
  const lastUsed = decoCooldowns.get(message.author.id) || 0;
  const cooldown = 90 * 1000; // 1m30s

  if (now - lastUsed < cooldown) {
    const remaining = cooldown - (now - lastUsed);
    return message.reply(`Limite de deconnexion atteinte, merci d'attendre ${formatTime(remaining)}.`);
  }

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  if (!target.voice.channel) {
    return message.reply(`${target.user.username} n'est pas en vocal, je n'ai pas pu la deconnecter.`);
  }

  const channel = target.voice.channel;

  // Check bot permissions in that channel
  const botMember = message.guild.members.me;
  if (!channel.permissionsFor(botMember).has('MoveMembers')) {
    return message.reply('Impossible de deconnecter cet personne, elle est dans un salon vocal prive.');
  }

  try {
    await target.voice.disconnect();
  } catch {
    return message.reply('Impossible de deconnecter cet personne, elle est dans un salon vocal prive.');
  }

  decoCooldowns.set(message.author.id, now);

  await message.reply(`${target.user.username} a ete deconnecte du salon ${channel}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.deco)
    .setTitle('Logs deconnexion')
    .setDescription(`${message.author.username} a deco ${target.user.username}`)
    .addFields({ name: `${target.user.username} a ete deco du salon`, value: `${channel}` })
    .setTimestamp();

  await sendLog('deco', embed);
}

async function cmdHelp(message) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Commande =')
    .setDescription(
      '=mv : Deplacer un membre a soit .\n\n' +
      '=find : Savoir dans quel salon vocal un utilisateur est .\n\n' +
      '=mvall : Deplacer tout les membres d\'un salon vocal a un autre .\n\n' +
      '=join : Rejoins un utilisateur dans son salon vocal .\n\n' +
      '=wakeup : Deplace un utilisateur pendant 30s dans plusieurs salons vocaux aleatoire .\n\n' +
      '=deco : Deconnecter un utilisateur de son salon vocal .\n\n' +
      '=follow : Suivre un utilisateur dans tous les salons vocaux qu\'il rejoint .\n\n' +
      '=unfollow : Arrete de suivre utilisateur dans ses salons vocaux .'
    )
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

async function cmdFollow(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  // Check if already following someone
  if (followSessions.has(message.author.id)) {
    const existing = followSessions.get(message.author.id);
    if (existing.targetId === target.id) {
      return message.reply(`Vous suivez deja ${target.user.username}.`);
    }
    return message.reply(`Vous etes deja en train de follow ${existing.targetUsername}, unfollow cet personne pour follow quelqu'un d'autre.`);
  }

  followSessions.set(message.author.id, {
    targetId: target.id,
    targetUsername: target.user.username,
    followerUsername: message.author.username,
    guildId: message.guild.id,
  });

  await message.reply(`${message.author.username} follow maintenant ${target.user.username}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.follow)
    .setTitle('Logs follow')
    .setDescription(`${message.author.username} follow maintenant ${target.user.username}`)
    .setTimestamp();

  await sendLog('follow', embed);
}

async function cmdUnfollow(message, args) {
  if (!isWhitelisted(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const session = followSessions.get(message.author.id);
  if (!session || session.targetId !== target.id) {
    return message.reply(`Vous ne suivez pas ${target.user.username}.`);
  }

  followSessions.delete(message.author.id);

  await message.reply(`${message.author.username} a arrete de follow ${target.user.username}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.unfollow)
    .setTitle('Logs unfollow')
    .setDescription(`${message.author.username} a arrete de follow ${target.user.username}`)
    .setTimestamp();

  await sendLog('unfollow', embed);
}

// ─── Whitelist / Owner commands ────────────────────────────────────────────

async function cmdWl(message, args) {
  if (!isOwner(message.author.id)) return;

  // =wl list
  if (args[0] === 'list') {
    const data = loadData();
    const ownerLines = data.owners.length
      ? data.owners.map((id) => `<@${id}> / ${id}`).join('\n')
      : 'Aucun';
    const wlLines = data.whitelist.length
      ? data.whitelist.map((id) => `<@${id}> / ${id}`).join('\n')
      : 'Aucun';

    const embed = new EmbedBuilder()
      .setColor(COLORS.wl)
      .setTitle('wl / ow commande vocal')
      .addFields(
        { name: 'OW', value: ownerLines },
        { name: 'WL', value: wlLines },
      )
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const data = loadData();
  if (data.whitelist.includes(target.id)) {
    return message.reply(`${target.user.username} est deja dans la whitelist.`);
  }

  data.whitelist.push(target.id);
  saveData(data);

  await message.reply(`${target.user.username} a ete ajoute a la whitelist.`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.wl)
    .setTitle('Logs wl')
    .setDescription(`${message.author.username} a ajoute ${target.user.username} a la whitelist bot`)
    .setTimestamp();

  await sendLog('wl', embed);
}

async function cmdUnwl(message, args) {
  if (!isOwner(message.author.id)) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const data = loadData();
  const index = data.whitelist.indexOf(target.id);
  if (index === -1) {
    return message.reply(`${target.user.username} n'est pas dans la whitelist.`);
  }

  data.whitelist.splice(index, 1);
  saveData(data);

  await message.reply(`${target.user.username} a ete retire de la whitelist.`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.unwl)
    .setTitle('Logs unwl')
    .setDescription(`${message.author.username} a supprime ${target.user.username} de la whitelist bot`)
    .setTimestamp();

  await sendLog('unwl', embed);
}

async function cmdOw(message, args) {
  if (message.author.id !== BOT_OWNER_ID) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const data = loadData();
  if (data.owners.includes(target.id)) {
    return message.reply(`${target.user.username} est deja owner bot.`);
  }

  data.owners.push(target.id);
  saveData(data);

  await message.reply(`${target.user.username} a ete ajoute comme owner bot.`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.ow)
    .setTitle('Logs ow')
    .setDescription(`${message.author.username} a ajoute ${target.user.username} au owner bot`)
    .setTimestamp();

  await sendLog('ow', embed);
}

async function cmdUnow(message, args) {
  if (message.author.id !== BOT_OWNER_ID) return;

  const target = await resolveTarget(message.guild, args[0] || '');
  if (!target) return message.reply('Membre introuvable.');

  const data = loadData();
  const index = data.owners.indexOf(target.id);
  if (index === -1) {
    return message.reply(`${target.user.username} n'est pas owner bot.`);
  }

  data.owners.splice(index, 1);
  saveData(data);

  await message.reply(`${target.user.username} a ete retire des owner bot.`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.unow)
    .setTitle('Logs unow')
    .setDescription(`${message.author.username} a supprime ${target.user.username} des owner bot`)
    .setTimestamp();

  await sendLog('unow', embed);
}

async function cmdPlay(message, args) {
  if (message.author.id !== BOT_OWNER_ID) return;

  const activity = args.join(' ');
  if (!activity) return message.reply('Precisez une activite.');

  client.user.setActivity(activity, { type: ActivityType.Playing });
  await message.reply(`Je joue maintenant a ${activity}`);
}

// ─── Message handler ───────────────────────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('=')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  try {
    switch (command) {
      case 'help':     await cmdHelp(message);            break;
      case 'mv':       await cmdMv(message, args);         break;
      case 'find':   await cmdFind(message, args);   break;
      case 'mvall':  await cmdMvall(message, args);  break;
      case 'wakeup': await cmdWakeup(message, args); break;
      case 'join':   await cmdJoin(message, args);   break;
      case 'deco':     await cmdDeco(message, args);     break;
      case 'follow':   await cmdFollow(message, args);   break;
      case 'unfollow': await cmdUnfollow(message, args); break;
      case 'wl':       await cmdWl(message, args);       break;
      case 'unwl':   await cmdUnwl(message, args);   break;
      case 'ow':     await cmdOw(message, args);     break;
      case 'unow':   await cmdUnow(message, args);   break;
      case 'play':   await cmdPlay(message, args);   break;
    }
  } catch (err) {
    console.error(`Error in command ${command}:`, err);
  }
});

// ─── Follow system — voice state watcher ───────────────────────────────────

client.on('voiceStateUpdate', async (oldState, newState) => {
  // We only care when someone joins or switches channel (newState has a channel)
  if (!newState.channel) return;

  const movedUserId = newState.member.id;
  const guild = newState.guild;

  // Check every active follow session
  for (const [followerId, session] of followSessions.entries()) {
    if (session.targetId !== movedUserId) continue;
    if (session.guildId !== guild.id) continue;

    // The followed person moved — try to move the follower too
    try {
      const followerMember = await guild.members.fetch(followerId);

      // Follower must be in a voice channel to be moved
      if (!followerMember.voice.channel) continue;

      // Don't move if already in same channel
      if (followerMember.voice.channelId === newState.channelId) continue;

      // Check bot has permission to move into the new channel
      const botMember = guild.members.me;
      if (!newState.channel.permissionsFor(botMember).has('MoveMembers')) {
        // Private channel — stay and wait, do not delete the session
        continue;
      }

      await followerMember.voice.setChannel(newState.channel);
    } catch {
      // Follower left voice or permission issue — keep session alive
    }
  }
});

// ─── Ready ─────────────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`Bot connecte en tant que ${client.user.tag}`);
  if (!fs.existsSync(DATA_FILE)) {
    saveData({ owners: [], whitelist: [] });
  }
});

client.login(process.env.DISCORD_TOKEN);
