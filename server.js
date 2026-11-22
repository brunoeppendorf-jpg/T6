// Heftweise – Server fuer die Schulsachen-Boerse der Sportschule Halle
// Nutzer-Passwoerter werden ausschliesslich gehasht gespeichert (bcrypt).
// Passwort-Hashes verlassen den Server nie - der Client bekommt nur Name/Klasse/Nutzername.

const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PORT = process.env.PORT || 3000;
const SALT_ROUNDS = 12;
const SCHOOL_ID = 'sportschule-halle';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'bruno-eppendorf';
const schoolTicketKey = crypto.randomBytes(32);
const limitAccessAttempts = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  message: { error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' },
});

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Sessions (einfaches Token-System, nur im Arbeitsspeicher) ----------
// token -> username. Geht bei einem Server-Neustart verloren, dann muss man sich
// neu einloggen - fuer diese Groessenordnung bewusst so einfach gehalten.
const sessions = new Map();

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const username = token && sessions.get(token);
  if (!username) {
    return res.status(401).json({ error: 'Nicht eingeloggt.' });
  }
  req.username = username;
  next();
}

function readState() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { users: [], listings: [], messages: [] };
    }
    throw error;
  }

  const state = JSON.parse(raw);
  if (!Array.isArray(state?.users) || !Array.isArray(state.listings) ||
      (state.messages !== undefined && !Array.isArray(state.messages))) {
    throw new Error('Ungültige Datendatei: ' + DATA_FILE);
  }
  state.messages ??= [];
  return state;
}

function writeState(state) {
  const temporaryFile = DATA_FILE + '.tmp';
  const fd = fs.openSync(temporaryFile, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(state, null, 2), 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporaryFile, DATA_FILE);
}

function validNewPassword(password, minimum) {
  return typeof password === 'string' && password.trim().length >= minimum &&
    Buffer.byteLength(password, 'utf8') <= 72;
}

function schoolSignature(expires, passwordHash) {
  return crypto.createHmac('sha256', schoolTicketKey)
    .update(expires + '.' + passwordHash)
    .digest();
}

function validSchoolTicket(ticket, state) {
  if (!state.schoolPasswordHash || typeof ticket !== 'string' ||
      !/^\d{13}\.[0-9a-f]{64}$/.test(ticket)) return false;
  const [expires, signature] = ticket.split('.');
  return Number(expires) > Date.now() && crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'), schoolSignature(expires, state.schoolPasswordHash)
  );
}

function schoolAccessRequired(res) {
  return res.status(403).json({
    code: 'SCHOOL_ACCESS_REQUIRED',
    error: 'Bitte bestätige zuerst das aktuelle Schulpasswort.',
  });
}

function requireAdmin(req, res, next) {
  const admin = readState().users.some(u => u.username === req.username && u.admin === true);
  if (!admin) return res.status(403).json({ error: 'Admin-Zugang erforderlich.' });
  next();
}

function startSession(res, user) {
  const token = makeToken();
  sessions.set(token, user.username);
  const { username, name, klasse } = user;
  res.json({ user: { username, name, klasse, admin: user.admin === true }, token });
}

app.post('/api/school/access', limitAccessAttempts, async (req, res, next) => {
  const { school, password } = req.body || {};
  if (school !== SCHOOL_ID || !validNewPassword(password, 8)) {
    return res.status(400).json({ error: 'Bitte Schule und Schulpasswort angeben.' });
  }
  try {
    const { schoolPasswordHash } = readState();
    if (!schoolPasswordHash || !await bcrypt.compare(password, schoolPasswordHash) ||
        readState().schoolPasswordHash !== schoolPasswordHash) {
      return res.status(403).json({ error: 'Das Schulpasswort ist falsch oder wurde noch nicht eingerichtet.' });
    }
    const expires = Date.now() + 30 * 60 * 1000;
    res.json({ ticket: expires + '.' + schoolSignature(expires, schoolPasswordHash).toString('hex') });
  } catch (error) {
    next(error);
  }
});

app.post('/api/register', limitAccessAttempts, async (req, res, next) => {
  const { username, password, name, klasse, schoolTicket } = req.body || {};
  if (![username, name, klasse].every(value => typeof value === 'string' && value === value.trim() && value.length)) {
    return res.status(400).json({ error: 'Bitte alle Felder ausfüllen.' });
  }
  if (!validNewPassword(password, 6)) {
    return res.status(400).json({ error: 'Das Passwort braucht mindestens 6 Zeichen und darf höchstens 72 UTF-8-Bytes lang sein.' });
  }
  try {
    let state = readState();
    if (!validSchoolTicket(schoolTicket, state)) return schoolAccessRequired(res);
    if (username.toLowerCase() === ADMIN_USERNAME.toLowerCase() || state.users.some(u => u.username === username)) {
      return res.status(409).json({ error: 'Dieser Nutzername ist schon vergeben.' });
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    state = readState();
    if (!validSchoolTicket(schoolTicket, state)) return schoolAccessRequired(res);
    if (state.users.some(u => u.username === username)) {
      return res.status(409).json({ error: 'Dieser Nutzername ist schon vergeben.' });
    }
    const user = { username, passwordHash, name, klasse };
    state.users.push(user);
    writeState(state);
    startSession(res, user);
  } catch (error) {
    next(error);
  }
});

app.post('/api/login', limitAccessAttempts, async (req, res, next) => {
  const { username, password, schoolTicket, admin } = req.body || {};
  const adminLogin = admin === true;
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Bitte Nutzername und Passwort angeben.' });
  }
  try {
    const state = readState();
    if (!adminLogin && !validSchoolTicket(schoolTicket, state)) return schoolAccessRequired(res);
    const user = state.users.find(u => u.username === username && (u.admin === true) === adminLogin);
    if (!user || !await bcrypt.compare(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Nutzername oder Passwort ist falsch.' });
    }
    const latest = readState();
    if (!adminLogin && !validSchoolTicket(schoolTicket, latest)) return schoolAccessRequired(res);
    if (!latest.users.some(u => u.username === username && u.passwordHash === user.passwordHash)) {
      return res.status(401).json({ error: 'Bitte melde dich mit dem aktuellen Passwort an.' });
    }
    startSession(res, user);
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/school-password', requireAuth, requireAdmin, async (req, res, next) => {
  const { password } = req.body || {};
  if (!validNewPassword(password, 8)) {
    return res.status(400).json({ error: 'Das Schulpasswort braucht mindestens 8 Zeichen und darf höchstens 72 UTF-8-Bytes lang sein.' });
  }
  try {
    const schoolPasswordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const state = readState();
    state.schoolPasswordHash = schoolPasswordHash;
    writeState(state);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.put('/api/admin/user-password', requireAuth, requireAdmin, async (req, res, next) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || !username || !validNewPassword(password, 8)) {
    return res.status(400).json({ error: 'Bitte Nutzername und ein neues Passwort mit mindestens 8 Zeichen und höchstens 72 UTF-8-Bytes angeben.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const state = readState();
    const user = state.users.find(u => u.username === username && u.admin !== true);
    if (!user) return res.status(404).json({ error: 'Nutzerkonto nicht gefunden.' });
    user.passwordHash = passwordHash;
    writeState(state);
    for (const [token, signedInUsername] of sessions) {
      if (signedInUsername === username) sessions.delete(token);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// ---------- Logout ----------
app.post('/api/logout', requireAuth, (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.slice(7);
  sessions.delete(token);
  res.json({ ok: true });
});

// ---------- Inserate ----------
app.get('/api/listings', requireAuth, (req, res) => {
  res.json({ listings: readState().listings });
});

app.post('/api/listings', requireAuth, (req, res) => {
  const { title, category, price, condition, grade, emoji, desc } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Titel fehlt.' });
  }
  const state = readState();
  const owner = state.users.find(u => u.username === req.username);
  if (!owner) {
    return res.status(401).json({ error: 'Nicht eingeloggt.' });
  }
  const listing = {
    id: 'l' + crypto.randomBytes(8).toString('hex'),
    title: String(title).trim().slice(0, 200),
    category: String(category || 'sonstiges').slice(0, 40),
    price: Number.isFinite(Number(price)) ? Math.max(0, Number(price)) : 0,
    condition: String(condition || '').slice(0, 60),
    grade: String(grade || '').slice(0, 60),
    emoji: String(emoji || '📦').slice(0, 8),
    desc: String(desc || '').slice(0, 2000),
    ownerUsername: owner.username,
    contact: `${owner.name}, ${owner.klasse}`,
    createdAt: Date.now(),
  };
  state.listings.push(listing);
  writeState(state);
  res.json({ listing });
});

app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const state = readState();
  const listing = state.listings.find(l => l.id === req.params.id);
  if (!listing) {
    return res.status(404).json({ error: 'Inserat nicht gefunden.' });
  }
  if (listing.ownerUsername !== req.username) {
    return res.status(403).json({ error: 'Das ist nicht dein Inserat.' });
  }
  state.listings = state.listings.filter(l => l.id !== req.params.id);
  writeState(state);
  res.json({ ok: true });
});

// ---------- Nachrichten ----------
// Jede Nachricht haengt an einem Inserat. "to" wird beim ersten Kontakt aus dem
// Inserat-Besitzer abgeleitet, bei Antworten explizit mitgeschickt (der jeweils
// andere Gespraechspartner in dem Thread).
app.get('/api/messages', requireAuth, (req, res) => {
  const state = readState();
  const mine = state.messages.filter(m => m.from === req.username || m.to === req.username);
  res.json({ messages: mine });
});

app.post('/api/messages', requireAuth, (req, res) => {
  const { listingId, to, text } = req.body || {};
  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: 'Nachricht ist leer.' });
  }
  const state = readState();
  const listing = state.listings.find(l => l.id === listingId);
  if (!listing) {
    return res.status(404).json({ error: 'Inserat nicht gefunden.' });
  }
  const recipientUsername = to || listing.ownerUsername;
  if (recipientUsername === req.username) {
    return res.status(400).json({ error: 'Du kannst dir nicht selbst schreiben.' });
  }
  const fromUser = state.users.find(u => u.username === req.username);
  const toUser = state.users.find(u => u.username === recipientUsername);
  if (!toUser) {
    return res.status(404).json({ error: 'Empfänger nicht gefunden.' });
  }
  const message = {
    id: 'm' + crypto.randomBytes(8).toString('hex'),
    listingId: listing.id,
    listingTitle: listing.title,
    from: fromUser.username,
    fromName: `${fromUser.name}, ${fromUser.klasse}`,
    to: toUser.username,
    toName: `${toUser.name}, ${toUser.klasse}`,
    text: String(text).trim().slice(0, 2000),
    createdAt: Date.now(),
  };
  state.messages.push(message);
  writeState(state);
  res.json({ message });
});

app.use('/api', (error, req, res, next) => {
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status || 500).json({ error: 'Die Anfrage konnte nicht verarbeitet werden.' });
});

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const initialState = readState();
if (process.env.ADMIN_PASSWORD && !initialState.users.some(u => u.admin === true)) {
  if (!validNewPassword(process.env.ADMIN_PASSWORD, 11)) {
    throw new Error('ADMIN_PASSWORD braucht mindestens 11 Zeichen und darf höchstens 72 UTF-8-Bytes lang sein.');
  }
  if (initialState.users.some(u => u.username === ADMIN_USERNAME)) {
    throw new Error('Der Admin-Nutzername ist bereits vergeben. Bitte einen freien ADMIN_USERNAME verwenden.');
  }
  initialState.users.push({
    username: ADMIN_USERNAME,
    name: 'Bruno Eppendorf',
    klasse: 'Administration',
    admin: true,
    passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD, SALT_ROUNDS),
  });
  writeState(initialState);
}

app.listen(PORT, () => {
  console.log(`Heftweise läuft auf http://localhost:${PORT}`);
});
