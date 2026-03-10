require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits } = require('discord.js');

const MAIN_KEYWORDS = Object.freeze({
  encargo: '#encargo',
  mazmorra: '#mazmorra',
  ayuda: '#ayuda',
  rookie: '#rookie',
  sorteo: '#sorteo'
});

const BONUS_KEYWORD = '#armada';

const POINT_RULES = Object.freeze({
  encargo: { author: 8, mention: 8, armadaBonus: 2 },
  mazmorra: { author: 5, mention: 5, armadaBonus: 2 },
  ayuda: { author: 4, mention: 4, armadaBonus: 2 },
  rookie: { author: 6, mention: 6, armadaBonus: 2 },
  sorteo: { author: 4, mention: 0, armadaBonus: 0 }
});

const PROGRESS_TIERS = Object.freeze([
  { min: 1000, roleKey: 'leyenda' },
  { min: 600, roleKey: 'campeon' },
  { min: 300, roleKey: 'vanguardia' },
  { min: 150, roleKey: 'aventurero' },
  { min: 50, roleKey: 'miembro' },
  { min: 0, roleKey: 'iniciado' }
]);

const MONTHLY_ROLE_ORDER = Object.freeze([
  { key: 'paladin', label: 'Paladin del Mes' },
  { key: 'heroe', label: 'Heroe del Mes' },
  { key: 'guerrero', label: 'Guerrero del Mes' }
]);

const DATA_DIR = '/data';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_FILE_PATH = path.resolve(DATA_DIR, 'data.json');

function createInitialData() {
  return {
    users: {},
    activity_logs: {},
    monthly_snapshots: [],
    monthly_resets: [],
    monthly_role_holders: {
      paladin: null,
      heroe: null,
      guerrero: null
    }
  };
}

function parseIdSet(value) {
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
    adminUserIds: parseIdSet(process.env.ADMIN_USER_IDS),
    protectedRoleIds: parseIdSet(process.env.PROTECTED_ROLE_IDS),
    channelIdParticipacion: requiredEnv('CHANNEL_ID_PARTICIPACION'),
    progressRoles: {
      iniciado: requiredEnv('ROLE_ID_INICIADO'),
      miembro: requiredEnv('ROLE_ID_MIEMBRO'),
      aventurero: requiredEnv('ROLE_ID_AVENTURERO'),
      vanguardia: requiredEnv('ROLE_ID_VANGUARDIA'),
      campeon: requiredEnv('ROLE_ID_CAMPEON'),
      leyenda: requiredEnv('ROLE_ID_LEYENDA')
    },
    monthlyRoles: {
      paladin: requiredEnv('ROLE_ID_PALADIN_DEL_MES'),
      heroe: requiredEnv('ROLE_ID_HEROE_DEL_MES'),
      guerrero: requiredEnv('ROLE_ID_GUERRERO_DEL_MES')
    }
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

  if (rawData.monthly_role_holders && typeof rawData.monthly_role_holders === 'object') {
    base.monthly_role_holders = {
      ...base.monthly_role_holders,
      ...rawData.monthly_role_holders
    };
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

function getProgressRoleId(totalPoints) {
  const tier = PROGRESS_TIERS.find((entry) => totalPoints >= entry.min);
  return tier ? config.progressRoles[tier.roleKey] : null;
}

function hasProtectedRole(member) {
  if (config.protectedRoleIds.size === 0) {
    return false;
  }

  return member.roles.cache.some((role) => config.protectedRoleIds.has(role.id));
}

async function fetchGuildMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[Roles] No se pudo obtener el miembro ${userId}: ${error.message}`);
    return null;
  }
}

async function safeAddRoles(member, roleIds, reason, logContext) {
  if (roleIds.length === 0) {
    return;
  }

  try {
    await member.roles.add(roleIds, reason);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[Roles] ${logContext}: ${error.message}`);
  }
}

async function safeRemoveRoles(member, roleIds, reason, logContext) {
  if (roleIds.length === 0) {
    return;
  }

  try {
    await member.roles.remove(roleIds, reason);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[Roles] ${logContext}: ${error.message}`);
  }
}

async function syncProgressRoleForUser(guild, userId) {
  const row = getUserPoints(userId);
  if (!row) {
    return;
  }

  const member = await fetchGuildMember(guild, userId);
  if (!member) {
    return;
  }

  if (hasProtectedRole(member)) {
    return;
  }

  const targetRoleId = getProgressRoleId(row.total_points);
  const progressRoleIds = Object.values(config.progressRoles);

  const rolesToRemove = progressRoleIds.filter(
    (roleId) => roleId !== targetRoleId && member.roles.cache.has(roleId)
  );

  await safeRemoveRoles(
    member,
    rolesToRemove,
    'Ajuste automatico de rol por puntos historicos.',
    `No se pudieron quitar roles de progreso a ${member.user.tag}`
  );

  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    await safeAddRoles(
      member,
      [targetRoleId],
      'Ajuste automatico de rol por puntos historicos.',
      `No se pudo asignar rol de progreso a ${member.user.tag}`
    );
  }
}

async function syncProgressRolesAfterActivity(guild, payload) {
  const affectedUsers = new Set([payload.author.id]);

  if (payload.pointsPerMention > 0) {
    payload.mentions.forEach((mentionUser) => {
      affectedUsers.add(mentionUser.id);
    });
  }

  for (const userId of affectedUsers) {
    await syncProgressRoleForUser(guild, userId);
  }
}

async function applyMonthlyTopRoles(guild, topRows) {
  const previousHolders = store.monthly_role_holders || createInitialData().monthly_role_holders;
  const monthlyRoleIds = Object.values(config.monthlyRoles);

  const usersToCleanup = new Set([
    ...Object.keys(store.users),
    ...Object.values(previousHolders).filter(Boolean),
    ...topRows.map((row) => row.discord_user_id)
  ]);

  for (const userId of usersToCleanup) {
    const member = await fetchGuildMember(guild, userId);
    if (!member) {
      continue;
    }

    const rolesToRemove = monthlyRoleIds.filter((roleId) => member.roles.cache.has(roleId));
    await safeRemoveRoles(
      member,
      rolesToRemove,
      'Actualizacion de roles mensuales Top 3.',
      `No se pudieron limpiar roles mensuales de ${member.user.tag}`
    );
  }

  const newHolders = {
    paladin: null,
    heroe: null,
    guerrero: null
  };

  for (let index = 0; index < MONTHLY_ROLE_ORDER.length; index += 1) {
    const slot = MONTHLY_ROLE_ORDER[index];
    const row = topRows[index];

    if (!row) {
      continue;
    }

    const roleId = config.monthlyRoles[slot.key];
    const member = await fetchGuildMember(guild, row.discord_user_id);

    if (!member) {
      newHolders[slot.key] = row.discord_user_id;
      continue;
    }

    if (!member.roles.cache.has(roleId)) {
      await safeAddRoles(
        member,
        [roleId],
        'Asignacion de roles mensuales Top 3.',
        `No se pudo asignar ${slot.label} a ${member.user.tag}`
      );
    }

    newHolders[slot.key] = row.discord_user_id;
  }

  store.monthly_role_holders = newHolders;
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

function getTopMonthlyRows(limit = 3) {
  return getRankingRows(false).slice(0, limit);
}

async function resetMonthlyPoints(guild) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const resetKey = `${year}-${String(month).padStart(2, '0')}`;

  if (store.monthly_resets.includes(resetKey)) {
    return { ok: false, reason: 'already_reset', year, month };
  }

  const topRows = getTopMonthlyRows(3);
  await applyMonthlyTopRoles(guild, topRows);

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

  return { ok: true, year, month, snapshotCount, topRows };
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

function buildTopThreeSummary(topRows) {
  if (topRows.length === 0) {
    return 'Top 3 del mes: sin participantes con puntos.';
  }

  const lines = MONTHLY_ROLE_ORDER.map((slot, index) => {
    const row = topRows[index];
    if (!row) {
      return `${slot.label}: sin asignar`;
    }

    return `${slot.label}: <@${row.discord_user_id}> (${row.monthly_points} pts)`;
  });

  return `Top 3 del mes:\n${lines.join('\n')}`;
}

async function handleResetMensualCommand(message) {
  if (!isAdminById(message.author.id)) {
    await sendMessage(message, 'No tienes permiso para usar !reset-mensual.');
    return;
  }

  const result = await resetMonthlyPoints(message.guild);

  if (!result.ok && result.reason === 'already_reset') {
    await sendMessage(message, `El reset mensual de ${result.month}/${result.year} ya fue ejecutado.`);
    return;
  }

  const summary = buildTopThreeSummary(result.topRows);

  await sendMessage(
    message,
    `Reset mensual completado (${result.month}/${result.year}). Snapshots guardados: ${result.snapshotCount}.\n${summary}`
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
  const requiresMention = keywordInfo.detectedType === 'rookie' || keywordInfo.detectedType === 'sorteo';

  if (requiresMention && validMentions.length === 0) {
    await sendMessage(message, 'Registro invalido: #rookie y #sorteo requieren al menos una mencion valida.');
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

  await syncProgressRolesAfterActivity(message.guild, payload);
  await sendMessage(message, buildSuccessResponse(payload));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
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




