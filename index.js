require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits } = require('discord.js');

const MAIN_KEYWORDS = Object.freeze({
  encargo: '#encargo',
  mazmorra: '#mazmorra',
  rookie: '#rookie',
  sorteo: '#sorteo'
});

const BONUS_KEYWORD = '#armada';

const POINT_RULES = Object.freeze({
  encargo: { author: 8, mention: 8, armadaBonus: 2 },
  mazmorra: { author: 5, mention: 5, armadaBonus: 2 },
  rookie: { author: 6, mention: 6, armadaBonus: 2 },
  sorteo: { author: 4, mention: 0, armadaBonus: 0 }
});

const DATA_FILE_PATH = path.resolve(process.cwd(), 'data.json');

function createInitialData() {
  return {
    users: {},
    activity_logs: {},
    monthly_snapshots: [],
    monthly_resets: []
  };
}

function parseAdminIds(value) {
  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta variable de entorno obligatoria: ${name}`);
  }
  return value;
}

function loadConfig() {
  return {
    token: requiredEnv('DISCORD_TOKEN'),
    prefix: process.env.PREFIX?.trim() || '!',
    adminUserIds: parseAdminIds(process.env.ADMIN_USER_IDS),
    channelIdParticipacion: requiredEnv('CHANNEL_ID_PARTICIPACION')
  };
}

function normalizeDataShape(rawData) {
  const base = createInitialData();

  if (!rawData || typeof rawData !== 'object') {
    return base;
  }

  if (rawData.users && typeof rawData.users === 'object') {
    base.users = rawData.users;
  }

  if (rawData.activity_logs && typeof rawData.activity_logs === 'object') {
    base.activity_logs = rawData.activity_logs;
  }

  if (Array.isArray(rawData.monthly_snapshots)) {
    base.monthly_snapshots = rawData.monthly_snapshots;
  }

  if (Array.isArray(rawData.monthly_resets)) {
    base.monthly_resets = rawData.monthly_resets;
  }

  return base;
}

function readDataFile() {
  if (!fs.existsSync(DATA_FILE_PATH)) {
    const initial = createInitialData();
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }

  try {
    const rawContent = fs.readFileSync(DATA_FILE_PATH, 'utf8');
    if (!rawContent.trim()) {
      return createInitialData();
    }

    const parsed = JSON.parse(rawContent);
    return normalizeDataShape(parsed);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('No se pudo leer data.json. Se usara estructura vacia.', error.message);
    return createInitialData();
  }
}

function writeDataFile(data) {
  const tempPath = `${DATA_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, DATA_FILE_PATH);
}

const config = loadConfig();
let store = readDataFile();

function countOccurrences(content, keyword) {
  const pattern = new RegExp(`${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

function parseMainKeyword(content) {
  let totalMatches = 0;
  let detectedType = null;

  Object.entries(MAIN_KEYWORDS).forEach(([activityType, keyword]) => {
    const count = countOccurrences(content, keyword);
    if (count > 0 && !detectedType) {
      detectedType = activityType;
    }
    totalMatches += count;
  });

  return { totalMatches, detectedType };
}

function hasBonusKeyword(content) {
  return countOccurrences(content, BONUS_KEYWORD) > 0;
}

function getDisplayName(user) {
  return user.globalName || user.username || user.tag || user.id;
}

function getValidMentions(message) {
  const uniqueMentions = new Map();

  message.mentions.users.forEach((user) => {
    if (user.bot) {
      return;
    }

    if (user.id === message.author.id) {
      return;
    }

    if (!uniqueMentions.has(user.id)) {
      uniqueMentions.set(user.id, user);
    }
  });

  return [...uniqueMentions.values()].map((user) => ({
    id: user.id,
    username: getDisplayName(user)
  }));
}

function isAdminById(userId) {
  return config.adminUserIds.has(userId);
}

function ensureUser(userId, username) {
  const now = new Date().toISOString();

  if (!store.users[userId]) {
    store.users[userId] = {
      discord_user_id: userId,
      username,
      total_points: 0,
      monthly_points: 0,
      created_at: now,
      updated_at: now
    };
    return;
  }

  store.users[userId].username = username;
  store.users[userId].updated_at = now;
}

function addPoints(userId, username, points) {
  if (points <= 0) {
    return;
  }

  ensureUser(userId, username);
  store.users[userId].total_points += points;
  store.users[userId].monthly_points += points;
  store.users[userId].updated_at = new Date().toISOString();
}

function getUserPoints(userId) {
  return store.users[userId] || null;
}

function registerActivity(payload) {
  if (store.activity_logs[payload.messageId]) {
    return { ok: false, reason: 'duplicate_message_id' };
  }

  addPoints(payload.author.id, payload.author.username, payload.author.points);

  if (payload.pointsPerMention > 0) {
    payload.mentions.forEach((mentionUser) => {
      addPoints(mentionUser.id, mentionUser.username, payload.pointsPerMention);
    });
  }

  store.activity_logs[payload.messageId] = {
    message_id: payload.messageId,
    channel_id: payload.channelId,
    guild_id: payload.guildId,
    author_id: payload.author.id,
    activity_type: payload.activityType,
    mentioned_user_ids: payload.mentions.map((user) => user.id),
    author_points: payload.author.points,
    points_per_mention: payload.pointsPerMention,
    total_points_awarded: payload.totalPointsAwarded,
    contains_armada: payload.containsArmada,
    created_at: new Date().toISOString()
  };

  writeDataFile(store);
  return { ok: true };
}

function getRankingRows(isTotal) {
  const rows = Object.values(store.users);

  const filtered = rows.filter((row) => (isTotal ? row.total_points > 0 : row.monthly_points > 0));

  filtered.sort((a, b) => {
    if (isTotal) {
      if (b.total_points !== a.total_points) {
        return b.total_points - a.total_points;
      }
      return b.monthly_points - a.monthly_points;
    }

    if (b.monthly_points !== a.monthly_points) {
      return b.monthly_points - a.monthly_points;
    }
    return b.total_points - a.total_points;
  });

  return filtered.slice(0, 10);
}

function resetMonthlyPoints() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const resetKey = `${year}-${String(month).padStart(2, '0')}`;

  if (store.monthly_resets.includes(resetKey)) {
    return { ok: false, reason: 'already_reset', year, month };
  }

  const users = Object.values(store.users);
  let snapshotCount = 0;

  users.forEach((user) => {
    if (user.monthly_points <= 0) {
      return;
    }

    store.monthly_snapshots.push({
      id: `${resetKey}-${user.discord_user_id}`,
      year,
      month,
      discord_user_id: user.discord_user_id,
      monthly_points_at_close: user.monthly_points,
      created_at: new Date().toISOString()
    });

    snapshotCount += 1;
  });

  users.forEach((user) => {
    user.monthly_points = 0;
    user.updated_at = new Date().toISOString();
  });

  store.monthly_resets.push(resetKey);
  writeDataFile(store);

  return { ok: true, year, month, snapshotCount };
}

async function sendMessage(message, text) {
  try {
    await message.reply(text);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('No se pudo enviar respuesta:', error.message);
  }
}

async function handleRankingCommand(message, isTotal) {
  const rows = getRankingRows(isTotal);
  const title = isTotal ? 'Ranking historico (Top 10)' : 'Ranking mensual (Top 10)';

  if (rows.length === 0) {
    await sendMessage(message, `${title}\nNo hay puntos registrados todavia.`);
    return;
  }

  const lines = rows.map((row, index) => {
    const points = isTotal ? row.total_points : row.monthly_points;
    return `${index + 1}. <@${row.discord_user_id}> - ${points} pts`;
  });

  await sendMessage(message, `${title}\n${lines.join('\n')}`);
}

async function handlePuntosCommand(message) {
  const targetUser = message.mentions.users.first() || message.author;
  const row = getUserPoints(targetUser.id);
  const monthly = row ? row.monthly_points : 0;
  const total = row ? row.total_points : 0;

  await sendMessage(
    message,
    `Puntos de <@${targetUser.id}>\nMensual: ${monthly} pts\nHistorico: ${total} pts`
  );
}

async function handleResetMensualCommand(message) {
  if (!isAdminById(message.author.id)) {
    await sendMessage(message, 'No tienes permiso para usar !reset-mensual.');
    return;
  }

  const result = resetMonthlyPoints();

  if (!result.ok && result.reason === 'already_reset') {
    await sendMessage(message, `El reset mensual de ${result.month}/${result.year} ya fue ejecutado.`);
    return;
  }

  await sendMessage(
    message,
    `Reset mensual completado (${result.month}/${result.year}). Snapshots guardados: ${result.snapshotCount}.`
  );
}

async function handleCommand(message) {
  const content = message.content.trim();
  if (!content.startsWith(config.prefix)) {
    return false;
  }

  const rawCommand = content.slice(config.prefix.length).trim();
  if (!rawCommand) {
    return true;
  }

  const parts = rawCommand.split(/\s+/);
  const command = parts[0].toLowerCase();

  if (command === 'ranking') {
    const isTotal = (parts[1] || '').toLowerCase() === 'total';
    await handleRankingCommand(message, isTotal);
    return true;
  }

  if (command === 'puntos') {
    await handlePuntosCommand(message);
    return true;
  }

  if (command === 'reset-mensual') {
    await handleResetMensualCommand(message);
    return true;
  }

  await sendMessage(message, 'Comando no reconocido. Usa !ranking, !ranking total, !puntos o !reset-mensual.');
  return true;
}

function buildSuccessResponse(payload) {
  const lines = [
    'Registro valido.',
    `Tipo: ${payload.activityType}`,
    `Autor: <@${payload.author.id}> +${payload.author.points}`
  ];

  if (payload.mentions.length > 0) {
    lines.push('Mencionados:');
    payload.mentions.forEach((user) => {
      lines.push(`- <@${user.id}> +${payload.pointsPerMention}`);
    });
  }

  const authorRow = getUserPoints(payload.author.id);
  lines.push(`Total mensual del autor: ${authorRow ? authorRow.monthly_points : 0} pts`);
  lines.push(`Total historico del autor: ${authorRow ? authorRow.total_points : 0} pts`);

  return lines.join('\n');
}

async function handleActivityMessage(message) {
  if (message.channel.id !== config.channelIdParticipacion) {
    return;
  }

  if (store.activity_logs[message.id]) {
    await sendMessage(message, 'Registro invalido: este mensaje ya fue procesado anteriormente.');
    return;
  }

  const keywordInfo = parseMainKeyword(message.content || '');

  if (keywordInfo.totalMatches === 0) {
    await sendMessage(message, 'Registro invalido: falta una keyword principal valida.');
    return;
  }

  if (keywordInfo.totalMatches > 1) {
    await sendMessage(message, 'Registro invalido: solo se permite una keyword principal por mensaje.');
    return;
  }

  const validMentions = getValidMentions(message);

  if (validMentions.length === 0) {
    await sendMessage(message, 'Registro invalido: debes mencionar al menos un usuario valido.');
    return;
  }

  const rules = POINT_RULES[keywordInfo.detectedType];
  const containsArmada = hasBonusKeyword(message.content || '');
  const authorBonus = containsArmada ? rules.armadaBonus : 0;
  const authorPoints = rules.author + authorBonus;
  const pointsPerMention = rules.mention;
  const totalPointsAwarded = authorPoints + pointsPerMention * validMentions.length;

  const payload = {
    messageId: message.id,
    channelId: message.channel.id,
    guildId: message.guild.id,
    activityType: keywordInfo.detectedType,
    author: {
      id: message.author.id,
      username: getDisplayName(message.author),
      points: authorPoints
    },
    mentions: validMentions,
    pointsPerMention,
    totalPointsAwarded,
    containsArmada
  };

  const result = registerActivity(payload);
  if (!result.ok && result.reason === 'duplicate_message_id') {
    await sendMessage(message, 'Registro invalido: este mensaje ya fue procesado anteriormente.');
    return;
  }

  await sendMessage(message, buildSuccessResponse(payload));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  // eslint-disable-next-line no-console
  console.log(`Bot conectado como ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) {
    return;
  }

  if (!message.guild) {
    return;
  }

  const commandHandled = await handleCommand(message);
  if (commandHandled) {
    return;
  }

  await handleActivityMessage(message);
});

client.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error('Error del cliente de Discord:', error);
});

client.login(config.token).catch((error) => {
  // eslint-disable-next-line no-console
  console.error('No se pudo iniciar sesion en Discord:', error);
  process.exit(1);
});