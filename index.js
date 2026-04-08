require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, Client, GatewayIntentBits } = require('discord.js');

const MAIN_KEYWORDS = Object.freeze({
  encargo: '#encargo',
  mazmorra: '#mazmorra',
  ayuda: '#ayuda',
  sorteo: '#sorteo'
});

const BONUS_KEYWORD = '#armada';

const POINT_RULES = Object.freeze({
  encargo: { author: 8, mention: 8, armadaBonus: 2 },
  mazmorra: { author: 5, mention: 5, armadaBonus: 2 },
  ayuda: { author: 4, mention: 4, armadaBonus: 2 },
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

const DATA_DIR = '/app/data';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DATA_FILE_PATH = path.resolve(DATA_DIR, 'data.json');
const BACKUP_FILE_PATH = path.resolve(DATA_DIR, 'data.backup.json');

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
    channelIdConteoEncargos: process.env.CHANNEL_ID_CONTEO_ENCARGOS?.trim() || null,
    reportTimezone: process.env.REPORT_TIMEZONE?.trim() || 'Europe/Berlin',
    maxHistoryMessages: Number.parseInt(process.env.MAX_HISTORY_MESSAGES || '1500', 10) || 1500,
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
  if (!fs.existsSync(DATA_FILE_PATH) && fs.existsSync(BACKUP_FILE_PATH)) {
    fs.copyFileSync(BACKUP_FILE_PATH, DATA_FILE_PATH);
  }

  if (!fs.existsSync(DATA_FILE_PATH)) {
    const initial = createInitialData();
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(initial, null, 2), 'utf8');
    fs.copyFileSync(DATA_FILE_PATH, BACKUP_FILE_PATH);
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
  fs.copyFileSync(DATA_FILE_PATH, BACKUP_FILE_PATH);
}

const config = loadConfig();
let store = readDataFile();
const data = store;

function saveData() {
  writeDataFile(data);
}

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

function normalizeText(value) {
  return (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextIntoChunks(text, maxLength = 1800) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let current = '';

  text.split('\n').forEach((line) => {
    const candidate = `${current}${line}\n`;
    if (candidate.length > maxLength) {
      if (current.trim()) {
        chunks.push(current.trimEnd());
      }
      current = `${line}\n`;
      return;
    }

    current = candidate;
  });

  if (current.trim()) {
    chunks.push(current.trimEnd());
  }

  return chunks;
}

function stripUserMentions(text) {
  return (text || '').replace(/<@!?\d+>/g, '');
}

function extractEncargoName(text) {
  if (!/^\s*#encargo\b/i.test(text || '')) {
    return null;
  }

  let cleaned = stripUserMentions(text).trim();
  cleaned = cleaned.replace(/^\s*#encargo\b/i, '').trim();
  cleaned = cleaned.replace(/^(?:#\S+\s+)+/, '').trim();
  cleaned = cleaned.replace(/^\[\d{1,2}:\d{2}\]\s*/, '').trim();

  const finishedMatch = cleaned.match(/has\s+terminado\s+el\s+encargo\s+(.+)$/i);
  if (finishedMatch) {
    cleaned = finishedMatch[1].trim();
  }

  cleaned = cleaned.replace(/^encargo\s+/i, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.includes('.')) {
    cleaned = cleaned.split('.', 1)[0].trim();
  }

  cleaned = cleaned.split(/[!?]/, 1)[0].trim();

  const originalTokens = cleaned.split(/\s+/).filter(Boolean);
  const startIndex = originalTokens.findIndex((token) => {
    const normalized = normalizeText(token);
    return normalized === 'expedicion' || normalized === 'regulacion';
  });

  if (startIndex >= 0) {
    cleaned = originalTokens.slice(startIndex).join(' ').trim();
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/^[\s\-:;,.]+|[\s\-:;,.]+$/g, '');
  return cleaned || null;
}

function cleanConteoQueryText(text) {
  let cleaned = stripUserMentions(text).trim();
  cleaned = cleaned.replace(/^\s*#conteo\b/i, '').trim();
  cleaned = cleaned.replace(/^\[\d{1,2}:\d{2}\]\s*/, '').trim();

  const finishedMatch = cleaned.match(/has\s+terminado\s+el\s+encargo\s+(.+)$/i);
  if (finishedMatch) {
    cleaned = finishedMatch[1].trim();
  }

  cleaned = cleaned.replace(/^encargo\s+/i, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ').trim().replace(/^[\s\-:;,.]+|[\s\-:;,.]+$/g, '');
  return cleaned || null;
}

function parseConteoMessage(content) {
  const match = (content || '').match(/^\s*#conteo\s+(.+?)\s*$/i);
  if (!match) {
    return null;
  }

  return cleanConteoQueryText(match[1]);
}

function isListaMessage(content) {
  return /^\s*#lista\s*$/i.test(content || '');
}

function createTimeZoneFormatter(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });
}

function getTimeZoneParts(date, timeZone) {
  const formatter = createTimeZoneFormatter(timeZone);
  const mapped = {};

  formatter.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      mapped[part.type] = part.value;
    }
  });

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return {
    year: Number.parseInt(mapped.year, 10),
    month: Number.parseInt(mapped.month, 10),
    day: Number.parseInt(mapped.day, 10),
    hour: Number.parseInt(mapped.hour, 10),
    minute: Number.parseInt(mapped.minute, 10),
    second: Number.parseInt(mapped.second, 10),
    weekday: weekdayMap[mapped.weekday]
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return zonedAsUtc - date.getTime();
}

function makeZonedDate(timeZone, year, month, day, hour = 0, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let result = new Date(utcGuess - getTimeZoneOffsetMs(new Date(utcGuess), timeZone));
  const correctedOffset = getTimeZoneOffsetMs(result, timeZone);
  result = new Date(utcGuess - correctedOffset);
  return result;
}

function addDaysUtc(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getReportingWindow(now = new Date()) {
  const timeZone = config.reportTimezone;
  const zonedNowParts = getTimeZoneParts(now, timeZone);
  const daysSinceTuesday = (zonedNowParts.weekday - 2 + 7) % 7;
  const currentDayStart = makeZonedDate(
    timeZone,
    zonedNowParts.year,
    zonedNowParts.month,
    zonedNowParts.day,
    0,
    0,
    0
  );

  const thisTuesdayStart = addDaysUtc(currentDayStart, -daysSinceTuesday);
  const tuesdayWindowStart = makeZonedDate(
    timeZone,
    getTimeZoneParts(thisTuesdayStart, timeZone).year,
    getTimeZoneParts(thisTuesdayStart, timeZone).month,
    getTimeZoneParts(thisTuesdayStart, timeZone).day,
    11,
    0,
    0
  );
  const tuesdayMorningEnd = makeZonedDate(
    timeZone,
    getTimeZoneParts(thisTuesdayStart, timeZone).year,
    getTimeZoneParts(thisTuesdayStart, timeZone).month,
    getTimeZoneParts(thisTuesdayStart, timeZone).day,
    8,
    0,
    0
  );

  if (zonedNowParts.weekday === 2 && now < tuesdayWindowStart) {
    return {
      start: addDaysUtc(tuesdayWindowStart, -7),
      end: tuesdayMorningEnd
    };
  }

  let start = tuesdayWindowStart;
  if (now < start) {
    start = addDaysUtc(start, -7);
  }

  const nextWeek = addDaysUtc(start, 7);
  const nextWeekParts = getTimeZoneParts(nextWeek, timeZone);
  const end = makeZonedDate(
    timeZone,
    nextWeekParts.year,
    nextWeekParts.month,
    nextWeekParts.day,
    8,
    0,
    0
  );

  return { start, end };
}

async function scanChannelHistoryForEncargos(channel, start, end) {
  const results = [];
  let scannedCount = 0;

  // eslint-disable-next-line no-console
  console.log(`[SCAN] Canal leido: ${channel.name}`);
  // eslint-disable-next-line no-console
  console.log(`[SCAN] Ventana: ${start.toISOString()} -> ${end.toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`[SCAN] Limite de mensajes: ${config.maxHistoryMessages}`);

  const collectedMessages = [];
  let beforeId = null;

  while (collectedMessages.length < config.maxHistoryMessages) {
    const remaining = config.maxHistoryMessages - collectedMessages.length;
    const batch = await channel.messages.fetch({
      limit: Math.min(100, remaining),
      ...(beforeId ? { before: beforeId } : {})
    });

    if (batch.size === 0) {
      break;
    }

    const batchMessages = [...batch.values()];
    collectedMessages.push(...batchMessages);
    beforeId = batchMessages[batchMessages.length - 1].id;

    if (batch.size < 100) {
      break;
    }
  }

  const orderedMessages = collectedMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  orderedMessages.forEach((message) => {
    scannedCount += 1;

    if (message.author.bot) {
      return;
    }

    if (message.createdAt <= start || message.createdAt >= end) {
      return;
    }

    const encargoName = extractEncargoName(message.content);
    if (!encargoName) {
      return;
    }

    const people = {};
    people[String(message.author.id)] = message.member?.displayName || getDisplayName(message.author);

    message.mentions.users.forEach((user) => {
      const member = message.guild.members.cache.get(user.id);
      people[String(user.id)] = member?.displayName || getDisplayName(user);
    });

    results.push({
      messageId: String(message.id),
      displayName: encargoName,
      normName: normalizeText(encargoName),
      people
    });
  });

  // eslint-disable-next-line no-console
  console.log(`[SCAN] Mensajes revisados: ${scannedCount}`);
  // eslint-disable-next-line no-console
  console.log(`[SCAN] Encargos detectados: ${results.length}`);

  return results;
}

function buildExactConteo(records, cleanedQuery) {
  const queryNorm = normalizeText(cleanedQuery);
  const matched = records.filter((record) => record.normName === queryNorm);

  if (matched.length === 0) {
    return { encargoName: null, names: [] };
  }

  const uniquePeople = new Map();
  matched.forEach((record) => {
    Object.entries(record.people).forEach(([userId, userName]) => {
      uniquePeople.set(userId, userName);
    });
  });

  const names = [...uniquePeople.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const encargoName = [...new Set(matched.map((record) => record.displayName))].sort((a, b) => {
    if (a.length !== b.length) {
      return a.length - b.length;
    }
    return a.localeCompare(b, 'es', { sensitivity: 'base' });
  })[0];

  return { encargoName, names };
}

function buildWeeklyList(records) {
  const grouped = new Map();

  records.forEach((record) => {
    if (!grouped.has(record.normName)) {
      grouped.set(record.normName, {
        displayNames: [],
        people: new Map()
      });
    }

    const entry = grouped.get(record.normName);
    entry.displayNames.push(record.displayName);

    Object.entries(record.people).forEach(([userId, userName]) => {
      entry.people.set(userId, userName);
    });
  });

  return [...grouped.values()]
    .map((entry) => ({
      encargoName: [...new Set(entry.displayNames)].sort((a, b) => {
        if (a.length !== b.length) {
          return a.length - b.length;
        }
        return a.localeCompare(b, 'es', { sensitivity: 'base' });
      })[0],
      totalPersonas: entry.people.size
    }))
    .sort((a, b) => a.encargoName.localeCompare(b.encargoName, 'es', { sensitivity: 'base' }));
}

function formatWindowDate(date) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: config.reportTimezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatConteoResponse(encargoName, names, start, end, sourceChannelName) {
  const lines = [
    '**Conteo**',
    `Canal leido: ${sourceChannelName}`,
    `Coincidencia exacta: ${encargoName}`,
    `Ventana: ${formatWindowDate(start)} -> ${formatWindowDate(end)} (${config.reportTimezone})`,
    `Personas distintas: ${names.length}`,
    ''
  ];

  if (names.length === 0) {
    lines.push('No la ha hecho nadie.');
  } else {
    lines.push('Personas:');
    names.forEach((name) => {
      lines.push(`- ${name}`);
    });
  }

  return lines.join('\n');
}

function formatWeeklyListResponse(rows, start, end, sourceChannelName) {
  const lines = [
    '**Lista semanal**',
    `Canal leido: ${sourceChannelName}`,
    `Ventana: ${formatWindowDate(start)} -> ${formatWindowDate(end)} (${config.reportTimezone})`,
    ''
  ];

  if (rows.length === 0) {
    lines.push('No encontre encargos en esa ventana.');
    return lines.join('\n');
  }

  rows.forEach((row, index) => {
    lines.push(`${index + 1}. ${row.encargoName} - ${row.totalPersonas} personas`);
  });

  return lines.join('\n');
}

async function sendChunkedReply(message, text) {
  const chunks = splitTextIntoChunks(text);

  for (const [index, chunk] of chunks.entries()) {
    if (index === 0) {
      await sendMessage(message, chunk);
      continue;
    }

    await message.channel.send(chunk);
  }
}

function isConteoCommandAllowedInChannel(channelId) {
  if (channelId === config.channelIdParticipacion) {
    return true;
  }

  return Boolean(config.channelIdConteoEncargos && channelId === config.channelIdConteoEncargos);
}

async function handleConteoCommands(message) {
  const content = (message.content || '').trim();

  if (!isListaMessage(content) && !parseConteoMessage(content)) {
    return false;
  }

  if (!isConteoCommandAllowedInChannel(message.channel.id)) {
    return false;
  }

  let participationChannel = message.guild.channels.cache.get(config.channelIdParticipacion);
  if (!participationChannel) {
    try {
      participationChannel = await message.guild.channels.fetch(config.channelIdParticipacion);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo obtener el canal de participacion para conteo:', error.message);
    }
  }

  if (!participationChannel || participationChannel.type !== ChannelType.GuildText) {
    await sendMessage(message, 'No encuentro el canal de participacion configurado para leer encargos.');
    return true;
  }

  const { start, end } = getReportingWindow(new Date());
  const records = await scanChannelHistoryForEncargos(participationChannel, start, end);

  if (isListaMessage(content)) {
    const rows = buildWeeklyList(records);
    await sendChunkedReply(
      message,
      formatWeeklyListResponse(rows, start, end, participationChannel.name)
    );
    return true;
  }

  const cleanedQuery = parseConteoMessage(content);
  if (!cleanedQuery) {
    return false;
  }

  const { encargoName, names } = buildExactConteo(records, cleanedQuery);
  if (!encargoName) {
    await sendMessage(message, 'No encontre coincidencia exacta para ese nombre.');
    return true;
  }

  await sendChunkedReply(
    message,
    formatConteoResponse(encargoName, names, start, end, participationChannel.name)
  );
  return true;
}

function getCurrentDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDayDifference(previousDay, currentDay) {
  const previousDate = new Date(`${previousDay}T00:00:00Z`);
  const currentDate = new Date(`${currentDay}T00:00:00Z`);

  if (Number.isNaN(previousDate.getTime()) || Number.isNaN(currentDate.getTime())) {
    return null;
  }

  return Math.floor((currentDate.getTime() - previousDate.getTime()) / (1000 * 60 * 60 * 24));
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
      streak: 0,
      best_streak: 0,
      last_active_day: null,
      last_streak_bonus_day: null,
      created_at: now,
      updated_at: now
    };
    return;
  }

  store.users[userId].username = username;
  ensureUserStreakFields(store.users[userId]);
  store.users[userId].updated_at = now;
}

function ensureUserStreakFields(userRow) {
  if (typeof userRow.streak !== 'number') {
    userRow.streak = 0;
  }

  if (typeof userRow.best_streak !== 'number') {
    userRow.best_streak = 0;
  }

  if (typeof userRow.last_active_day !== 'string' && userRow.last_active_day !== null) {
    userRow.last_active_day = null;
  }

  if (typeof userRow.last_streak_bonus_day !== 'string' && userRow.last_streak_bonus_day !== null) {
    userRow.last_streak_bonus_day = null;
  }
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

function processUserActivityStreak(data, userId) {
  const now = new Date().toISOString();
  const today = getCurrentDayKey();

  // Garantiza compatibilidad con usuarios nuevos o migrados de versiones anteriores.
  if (!data.users[userId]) {
    data.users[userId] = {
      discord_user_id: userId,
      username: userId,
      total_points: 0,
      monthly_points: 0,
      streak: 0,
      best_streak: 0,
      last_active_day: null,
      last_streak_bonus_day: null,
      created_at: now,
      updated_at: now
    };
  }

  const userRow = data.users[userId];
  ensureUserStreakFields(userRow);

  // Solo permite una actualización de racha por día.
  if (userRow.last_active_day === today) {
    return {
      streakUpdated: false,
      bonusGranted: 0,
      streak: userRow.streak
    };
  }

  const dayDifference = userRow.last_active_day
    ? getDayDifference(userRow.last_active_day, today)
    : null;

  if (dayDifference === 1) {
    userRow.streak += 1;
  } else {
    userRow.streak = 1;
  }

  if (userRow.streak > userRow.best_streak) {
    userRow.best_streak = userRow.streak;
  }

  userRow.last_active_day = today;

  let bonusGranted = 0;
  if (userRow.streak % 5 === 0 && userRow.last_streak_bonus_day !== today) {
    bonusGranted = 10;
    userRow.last_streak_bonus_day = today;
  }

  userRow.updated_at = now;

  return {
    streakUpdated: true,
    bonusGranted,
    streak: userRow.streak
  };
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

async function sendStreakBonusAnnouncement(guild, userId, streak, bonusGranted) {
  let streakChannel = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name.toLowerCase() === 'racha'
  );

  if (!streakChannel) {
    try {
      await guild.channels.fetch();
      streakChannel = guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildText && channel.name.toLowerCase() === 'racha'
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('No se pudo buscar el canal #racha:', error.message);
      return;
    }
  }

  if (!streakChannel) {
    return;
  }

  const announcement =
    `🔥 <@${userId}> alcanzó una racha de ${streak} días consecutivos ayudando al gremio!\n` +
    `Bonus obtenido: +${bonusGranted} puntos.`;

  try {
    await streakChannel.send(announcement);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('No se pudo enviar anuncio de racha:', error.message);
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

async function handleSetPointsCommand(message, parts) {
  if (!isAdminById(message.author.id)) {
    await sendMessage(message, 'No tienes permiso para usar !setpoints.');
    return;
  }

  const targetUser = message.mentions.users.first();
  const rawPoints = parts[2];

  if (!targetUser || typeof rawPoints === 'undefined') {
    await sendMessage(message, 'Uso correcto: !setpoints @user number');
    return;
  }

  const parsedPoints = Number.parseInt(rawPoints, 10);
  if (!Number.isInteger(parsedPoints) || parsedPoints < 0) {
    await sendMessage(message, 'Uso correcto: !setpoints @user number');
    return;
  }

  ensureUser(targetUser.id, getDisplayName(targetUser));

  if (!Object.prototype.hasOwnProperty.call(data.users[targetUser.id], 'points')) {
    Object.defineProperty(data.users[targetUser.id], 'points', {
      get() {
        return this.total_points;
      },
      set(value) {
        this.total_points = value;
        this.monthly_points = value;
        this.updated_at = new Date().toISOString();
      },
      enumerable: false,
      configurable: true
    });
  }

  data.users[targetUser.id].points = parsedPoints;
  saveData();

  await sendMessage(message, `${getDisplayName(targetUser)} now has ${parsedPoints} points.`);
}

async function handleAddPointsCommand(message, parts) {
  if (!isAdminById(message.author.id)) {
    await sendMessage(message, 'No tienes permiso para usar !sumarpuntos.');
    return;
  }

  const targetUser = message.mentions.users.first();
  const rawPoints = parts[2];

  if (!targetUser || typeof rawPoints === 'undefined') {
    await sendMessage(message, 'Uso correcto: !sumarpuntos @user cantidad');
    return;
  }

  const parsedPoints = Number.parseInt(rawPoints, 10);
  if (!Number.isInteger(parsedPoints) || parsedPoints <= 0) {
    await sendMessage(message, 'Uso correcto: !sumarpuntos @user cantidad');
    return;
  }

  ensureUser(targetUser.id, getDisplayName(targetUser));
  addPoints(targetUser.id, getDisplayName(targetUser), parsedPoints);
  saveData();
  await syncProgressRoleForUser(message.guild, targetUser.id);

  const row = getUserPoints(targetUser.id);
  await sendMessage(
    message,
    `Se agregaron ${parsedPoints} puntos a <@${targetUser.id}>.\nMensual: ${row ? row.monthly_points : 0} pts\nHistorico: ${row ? row.total_points : 0} pts`
  );
}

async function handleRemovePointsCommand(message, parts) {
  if (!isAdminById(message.author.id)) {
    await sendMessage(message, 'No tienes permiso para usar !restarpuntos.');
    return;
  }

  const targetUser = message.mentions.users.first();
  const rawPoints = parts[2];

  if (!targetUser || typeof rawPoints === 'undefined') {
    await sendMessage(message, 'Uso correcto: !restarpuntos @user cantidad');
    return;
  }

  const parsedPoints = Number.parseInt(rawPoints, 10);
  if (!Number.isInteger(parsedPoints) || parsedPoints <= 0) {
    await sendMessage(message, 'Uso correcto: !restarpuntos @user cantidad');
    return;
  }

  ensureUser(targetUser.id, getDisplayName(targetUser));
  const row = getUserPoints(targetUser.id);

  row.total_points = Math.max(0, row.total_points - parsedPoints);
  row.monthly_points = Math.max(0, row.monthly_points - parsedPoints);
  row.updated_at = new Date().toISOString();

  saveData();
  await syncProgressRoleForUser(message.guild, targetUser.id);

  await sendMessage(
    message,
    `Se restaron ${parsedPoints} puntos a <@${targetUser.id}>.\nMensual: ${row.monthly_points} pts\nHistorico: ${row.total_points} pts`
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

  if (command === 'setpoints') {
    await handleSetPointsCommand(message, parts);
    return true;
  }

  if (command === 'sumarpuntos' || command === 'agregarpuntos') {
    await handleAddPointsCommand(message, parts);
    return true;
  }

  if (command === 'restarpuntos') {
    await handleRemovePointsCommand(message, parts);
    return true;
  }

  if (command === 'reset-mensual') {
    await handleResetMensualCommand(message);
    return true;
  }

  await sendMessage(
    message,
    'Comando no reconocido. Usa !ranking, !ranking total, !puntos, !setpoints, !sumarpuntos, !restarpuntos o !reset-mensual.'
  );
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
  const requiresMention = keywordInfo.detectedType === 'sorteo';

  if (requiresMention && validMentions.length === 0) {
    await sendMessage(message, 'Registro invalido: #sorteo requiere al menos una mencion valida.');
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

  const streakResult = processUserActivityStreak(store, payload.author.id);

  if (streakResult.bonusGranted > 0) {
    addPoints(payload.author.id, payload.author.username, streakResult.bonusGranted);
  }

  if (streakResult.streakUpdated || streakResult.bonusGranted > 0) {
    saveData();
  }

  if (streakResult.bonusGranted > 0) {
    await sendStreakBonusAnnouncement(
      message.guild,
      payload.author.id,
      streakResult.streak,
      streakResult.bonusGranted
    );
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
  // eslint-disable-next-line no-console
  console.log(`Canal de participacion: ${config.channelIdParticipacion}`);
  // eslint-disable-next-line no-console
  console.log(
    `Canal de conteo de encargos: ${config.channelIdConteoEncargos || 'usa solo el canal de participacion'}`
  );
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

  const conteoHandled = await handleConteoCommands(message);
  if (conteoHandled) {
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






