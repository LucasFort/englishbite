require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const nodemailer = require("nodemailer");
const { Redis } = require("@upstash/redis");

const PORT = process.env.PORT || 8793;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutos

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Segurança ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

function verifyPassword(password, stored) {
  const [saltB64, hashB64] = String(stored).split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const testHash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
  return testHash.toString("base64") === hashB64;
}

function newToken() {
  return crypto.randomBytes(32).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
}

function newCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ---------- E-mail ----------
async function sendAppEmail(toEmail, subject, html, code) {
  const configured = process.env.SMTP_USER && process.env.SMTP_PASS;
  if (!configured) {
    console.log(`[MODO TESTE] E-mail para ${toEmail} — código: ${code}`);
    return { sent: false, devCode: code };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || "EnglishBite"}" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error("Falha ao enviar e-mail:", err.message);
    return { sent: false, devCode: code, error: err.message };
  }
}

function sendVerificationEmail(toEmail, code) {
  return sendAppEmail(
    toEmail,
    "Seu código de confirmação — EnglishBite",
    `<p>Olá!</p><p>Seu código de confirmação é:</p><h2>${code}</h2><p>Ele expira em 15 minutos.</p>`,
    code
  );
}

function sendResetEmail(toEmail, code) {
  return sendAppEmail(
    toEmail,
    "Redefinição de senha — EnglishBite",
    `<p>Olá!</p><p>Use o código abaixo para redefinir sua senha:</p><h2>${code}</h2><p>Se você não pediu isso, ignore este e-mail.</p>`,
    code
  );
}

// ---------- Dados ----------
function userKey(email) {
  return `user:${email}`;
}
function sessionKey(token) {
  return `session:${token}`;
}
function progressKey(email) {
  return `progress:${email}`;
}

async function getAuthedEmail(req) {
  const header = req.headers["authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const session = await redis.get(sessionKey(token));
  return session ? session.email : null;
}

// ---------- Rotas de autenticação ----------
app.post("/api/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!name || !email || password.length < 6) {
    return res.status(400).json({ error: "Preencha nome, e-mail e uma senha com pelo menos 6 caracteres." });
  }

  const existing = await redis.get(userKey(email));
  if (existing) {
    return res.status(409).json({ error: "Já existe uma conta com esse e-mail." });
  }

  const code = newCode();
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    emailVerified: false,
    pendingCode: code,
    pendingCodeExpiry: Date.now() + CODE_TTL_MS,
    createdAt: new Date().toISOString(),
  };
  await redis.set(userKey(email), user);

  const result = await sendVerificationEmail(email, code);
  res.json({ ok: true, devCode: result.devCode });
});

app.post("/api/resend-code", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = await redis.get(userKey(email));
  if (!user) return res.status(404).json({ error: "Conta não encontrada." });

  const code = newCode();
  user.pendingCode = code;
  user.pendingCodeExpiry = Date.now() + CODE_TTL_MS;
  await redis.set(userKey(email), user);

  const result = await sendVerificationEmail(email, code);
  res.json({ ok: true, devCode: result.devCode });
});

app.post("/api/verify-email", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();

  const user = await redis.get(userKey(email));
  if (!user) return res.status(404).json({ error: "Conta não encontrada." });
  if (user.emailVerified) return res.json({ ok: true });

  if (code !== String(user.pendingCode) || Date.now() > user.pendingCodeExpiry) {
    return res.status(400).json({ error: "Código inválido ou expirado." });
  }

  user.emailVerified = true;
  user.pendingCode = null;
  await redis.set(userKey(email), user);
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = await redis.get(userKey(email));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "E-mail ou senha incorretos." });
  }
  if (!user.emailVerified) {
    return res.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
  }

  const token = newToken();
  await redis.set(sessionKey(token), { email }, { ex: SESSION_TTL_SECONDS });

  res.json({ token, user: { name: user.name, email: user.email } });
});

app.post("/api/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = await redis.get(userKey(email));

  if (user) {
    const code = newCode();
    user.pendingCode = code;
    user.pendingCodeExpiry = Date.now() + CODE_TTL_MS;
    await redis.set(userKey(email), user);
    const result = await sendResetEmail(email, code);
    return res.json({ ok: true, devCode: result.devCode });
  }
  // Não revela se o e-mail existe ou não
  res.json({ ok: true });
});

app.post("/api/reset-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "");

  if (password.length < 6) {
    return res.status(400).json({ error: "A senha precisa ter pelo menos 6 caracteres." });
  }

  const user = await redis.get(userKey(email));
  if (!user || !user.pendingCode) {
    return res.status(400).json({ error: "Código inválido ou expirado." });
  }
  if (code !== String(user.pendingCode) || Date.now() > user.pendingCodeExpiry) {
    return res.status(400).json({ error: "Código inválido ou expirado." });
  }

  user.passwordHash = hashPassword(password);
  user.pendingCode = null;
  await redis.set(userKey(email), user);
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const user = await redis.get(userKey(email));
  res.json({ name: user.name, email: user.email });
});

// ---------- Datas (horário de Brasília) ----------
function dayStr(offsetDays = 0) {
  return new Date(Date.now() - 3 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function weekInfo() {
  // semana de segunda a domingo, no horário de Brasília
  const now = new Date(Date.now() - 3 * 3600 * 1000);
  const day = (now.getUTCDay() + 6) % 7; // 0 = segunda
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const endsAt = monday.getTime() + 7 * 86400000 + 3 * 3600 * 1000; // domingo 23:59 BRT
  return { id: monday.toISOString().slice(0, 10), endsAt, elapsed: (day * 86400000 + (now - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))) / (7 * 86400000) };
}

// ---------- Gamificação ----------
const QUESTS = [
  { id: "xp30", text: "Ganhe 30 XP", goal: 30, field: "xp", reward: 10 },
  { id: "xp60", text: "Ganhe 60 XP", goal: 60, field: "xp", reward: 20 },
  { id: "lessons2", text: "Complete 2 fases", goal: 2, field: "lessons", reward: 10 },
  { id: "lessons4", text: "Complete 4 fases", goal: 4, field: "lessons", reward: 20 },
  { id: "perfect1", text: "Faça 1 fase sem errar", goal: 1, field: "perfect", reward: 15 },
  { id: "call1", text: "Faça 1 chamada com a Bibi", goal: 1, field: "calls", reward: 15 },
  { id: "combo8", text: "Acerte 8 seguidas numa fase", goal: 8, field: "combo", reward: 15 },
];
// 3 missões por dia, sempre as mesmas para todo mundo naquele dia
function questsFor(date) {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const easy = QUESTS.filter((q) => ["xp30", "lessons2"].includes(q.id));
  const rest = QUESTS.filter((q) => !easy.includes(q));
  const first = easy[h % easy.length];
  const pool = rest.filter((q) => q.field !== first.field);
  const second = pool[(h >>> 3) % pool.length];
  const pool2 = pool.filter((q) => q.field !== second.field);
  const third = pool2[(h >>> 7) % pool2.length];
  return [first, second, third];
}

const ACHIEVEMENTS = [
  { id: "first", icon: "🐣", title: "Primeiro passo", desc: "Complete sua primeira fase", test: (p) => p.totals.lessons >= 1 },
  { id: "streak3", icon: "🔥", title: "Esquentando", desc: "Ofensiva de 3 dias", test: (p) => p.bestStreak >= 3 },
  { id: "streak7", icon: "🌋", title: "Imparável", desc: "Ofensiva de 7 dias", test: (p) => p.bestStreak >= 7 },
  { id: "streak30", icon: "☄️", title: "Lenda", desc: "Ofensiva de 30 dias", test: (p) => p.bestStreak >= 30 },
  { id: "xp100", icon: "⚡", title: "Energizado", desc: "Junte 100 XP", test: (p) => p.xp >= 100 },
  { id: "xp500", icon: "💥", title: "Turbinado", desc: "Junte 500 XP", test: (p) => p.xp >= 500 },
  { id: "xp1500", icon: "🚀", title: "Foguete", desc: "Junte 1.500 XP", test: (p) => p.xp >= 1500 },
  { id: "call", icon: "📞", title: "Alô, Bibi!", desc: "Faça sua primeira chamada", test: (p) => p.totals.calls >= 1 },
  { id: "calls10", icon: "🎙️", title: "Tagarela", desc: "Faça 10 chamadas", test: (p) => p.totals.calls >= 10 },
  { id: "perfect5", icon: "💎", title: "Perfeccionista", desc: "5 fases sem nenhum erro", test: (p) => p.totals.perfect >= 5 },
  { id: "unit", icon: "🏆", title: "Unidade vencida", desc: "Passe no desafio de uma unidade", test: (p) => p.completedUnits.some((id) => id.endsWith(":test")) },
  { id: "goal7", icon: "🎯", title: "Focado", desc: "Bata a meta diária 7 vezes", test: (p) => p.totals.goals >= 7 },
];

const BOTS = [
  { name: "🤖 Robô Rex", pace: 260 },
  { name: "🤖 Robô Lola", pace: 190 },
  { name: "🤖 Robô Zeca", pace: 120 },
  { name: "🤖 Robô Nina", pace: 70 },
];

function emptyProgress() {
  return {
    xp: 0,
    streak: 0,
    bestStreak: 0,
    lastActiveDate: "",
    completedUnits: [],
    level: null,
    gems: 0,
    freezes: 0,
    dailyGoal: 20,
    daily: { date: "", xp: 0, lessons: 0, perfect: 0, calls: 0, combo: 0, claimed: [], goalHit: false },
    history: {},
    totals: { lessons: 0, perfect: 0, calls: 0, goals: 0 },
    achievements: [],
  };
}
function normalize(p) {
  const base = emptyProgress();
  const out = Object.assign(base, p || {});
  out.daily = Object.assign(emptyProgress().daily, (p || {}).daily);
  out.totals = Object.assign(emptyProgress().totals, (p || {}).totals);
  out.history = out.history || {};
  out.bestStreak = Math.max(Number(out.bestStreak) || 0, Number(out.streak) || 0);
  const today = dayStr();
  if (out.daily.date !== today) out.daily = Object.assign(emptyProgress().daily, { date: today });
  return out;
}
// Ofensiva que "já caducou" aparece como 0 (sem mudar o que está salvo)
function visibleStreak(p) {
  if (!p.lastActiveDate) return 0;
  const gap = daysBetween(p.lastActiveDate, dayStr());
  return gap <= 1 || gap - 1 <= p.freezes ? Number(p.streak) || 0 : 0;
}
function applyStreak(p) {
  const today = dayStr();
  if (p.lastActiveDate === today) return false;
  const gap = p.lastActiveDate ? daysBetween(p.lastActiveDate, today) : 99;
  if (gap === 1) {
    p.streak = Number(p.streak) + 1;
  } else if (gap > 1 && gap - 1 <= p.freezes) {
    p.freezes -= gap - 1; // o protetor de ofensiva salvou os dias perdidos
    p.streak = Number(p.streak) + 1;
  } else {
    p.streak = 1;
  }
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  p.lastActiveDate = today;
  return true;
}
function checkAchievements(p) {
  const fresh = ACHIEVEMENTS.filter((a) => !p.achievements.includes(a.id) && a.test(p));
  fresh.forEach((a) => p.achievements.push(a.id));
  return fresh.map(({ id, icon, title, desc }) => ({ id, icon, title, desc }));
}
function publicView(p) {
  const quests = questsFor(p.daily.date).map((q) => ({
    id: q.id,
    text: q.text,
    goal: q.goal,
    reward: q.reward,
    value: Math.min(q.goal, Number(p.daily[q.field]) || 0),
    claimed: p.daily.claimed.includes(q.id),
  }));
  return Object.assign({}, p, {
    streak: visibleStreak(p),
    today: dayStr(),
    quests,
    achievementList: ACHIEVEMENTS.map(({ id, icon, title, desc }) => ({ id, icon, title, desc, unlocked: p.achievements.includes(id) })),
  });
}
async function loadProgress(email) {
  return normalize(await redis.get(progressKey(email)));
}
async function addLeagueXp(email, xp) {
  if (!xp) return;
  const week = weekInfo().id;
  const user = await redis.get(userKey(email));
  const parts = String((user && user.name) || "Aluno").trim().split(/\s+/);
  const display = parts[0] + (parts[1] ? " " + parts[1][0].toUpperCase() + "." : "");
  await redis.zincrby(`league:${week}`, xp, email);
  await redis.hset("league:names", { [email]: display });
  await redis.expire(`league:${week}`, 60 * 60 * 24 * 21);
}

// ---------- Progresso ----------
app.get("/api/progress", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  res.json(publicView(await loadProgress(email)));
});

app.post("/api/progress", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });

  const { unitId, passed, perfect, kind } = req.body;
  const xpEarned = Math.max(0, Math.min(40, Number(req.body.xpEarned) || 0));
  const combo = Math.max(0, Math.min(50, Number(req.body.combo) || 0));
  const p = await loadProgress(email);
  const today = dayStr();

  const streakExtended = applyStreak(p);
  p.xp = Number(p.xp) + xpEarned;
  p.daily.xp += xpEarned;
  p.daily.combo = Math.max(p.daily.combo, combo);
  p.history[today] = (Number(p.history[today]) || 0) + xpEarned;
  Object.keys(p.history)
    .filter((d) => daysBetween(d, today) > 60)
    .forEach((d) => delete p.history[d]);

  let gemsEarned = 0;
  if (passed) {
    p.daily.lessons++;
    p.totals.lessons++;
    if (perfect) {
      p.daily.perfect++;
      p.totals.perfect++;
    }
    if (kind === "call") {
      p.daily.calls++;
      p.totals.calls++;
    }
    gemsEarned = 2 + (perfect ? 3 : 0);
    const completed = new Set(p.completedUnits || []);
    completed.add(String(unitId));
    p.completedUnits = Array.from(completed);
  }
  let goalReached = false;
  if (!p.daily.goalHit && p.daily.xp >= p.dailyGoal) {
    p.daily.goalHit = true;
    p.totals.goals++;
    goalReached = true;
    gemsEarned += 5;
  }
  p.gems += gemsEarned;
  const newAchievements = checkAchievements(p);

  await redis.set(progressKey(email), p);
  await addLeagueXp(email, xpEarned);

  const view = publicView(p);
  view.events = {
    streakExtended,
    goalReached,
    gemsEarned,
    newAchievements,
    questsReady: view.quests.filter((q) => q.value >= q.goal && !q.claimed).map((q) => q.text),
  };
  res.json(view);
});

app.post("/api/quests/claim", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const p = await loadProgress(email);
  const q = questsFor(p.daily.date).find((x) => x.id === req.body.id);
  if (!q) return res.status(400).json({ error: "Missão não encontrada." });
  if (p.daily.claimed.includes(q.id)) return res.status(400).json({ error: "Recompensa já resgatada." });
  if ((Number(p.daily[q.field]) || 0) < q.goal) return res.status(400).json({ error: "Missão ainda não concluída." });
  p.daily.claimed.push(q.id);
  p.gems += q.reward;
  await redis.set(progressKey(email), p);
  res.json(Object.assign(publicView(p), { reward: q.reward }));
});

const SHOP = {
  freeze: { cost: 40, apply: (p) => (p.freezes >= 2 ? "Você já tem o máximo de 2 protetores." : ((p.freezes += 1), null)) },
  hearts: { cost: 15, apply: () => null },
};
app.post("/api/shop", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const item = SHOP[req.body.item];
  if (!item) return res.status(400).json({ error: "Item inválido." });
  const p = await loadProgress(email);
  if (p.gems < item.cost) return res.status(400).json({ error: "Mel insuficiente." });
  const err = item.apply(p);
  if (err) return res.status(400).json({ error: err });
  p.gems -= item.cost;
  await redis.set(progressKey(email), p);
  res.json(publicView(p));
});

app.post("/api/goal", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const goal = Number(req.body.goal);
  if (![10, 20, 30, 50].includes(goal)) return res.status(400).json({ error: "Meta inválida." });
  const p = await loadProgress(email);
  p.dailyGoal = goal;
  await redis.set(progressKey(email), p);
  res.json(publicView(p));
});

app.get("/api/league", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const week = weekInfo();
  const flat = (await redis.zrange(`league:${week.id}`, 0, 29, { rev: true, withScores: true })) || [];
  const names = (await redis.hgetall("league:names")) || {};
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    rows.push({ name: names[flat[i]] || "Aluno", xp: Number(flat[i + 1]), me: flat[i] === email });
  }
  if (!rows.some((r) => r.me)) {
    const user = await redis.get(userKey(email));
    rows.push({ name: ((user && user.name) || "Você").split(" ")[0], xp: 0, me: true });
  }
  // Robôs (identificados como robôs) para a liga nunca ficar vazia
  BOTS.forEach((b) => rows.push({ name: b.name, xp: Math.round(b.pace * week.elapsed), bot: true }));
  rows.sort((a, b) => b.xp - a.xp);
  res.json({ week: week.id, endsAt: week.endsAt, rows: rows.slice(0, 30) });
});

app.post("/api/placement", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });

  const level = String(req.body.level || "");
  const skipLevelsByTier = {
    iniciante: [],
    intermediario: ["A1"],
    avancado: ["A1", "A2"],
  };
  if (!(level in skipLevelsByTier)) {
    return res.status(400).json({ error: "Nível inválido." });
  }

  // Cada unidade tem 5 fases; o teste de nível marca todas as fases das unidades puladas
  const lessons = require("./public/data/lessons.json");
  const NODE_KEYS = ["1", "2", "practice", "call", "test"];
  const skipLevels = skipLevelsByTier[level];
  const skipIds = lessons
    .filter((l) => skipLevels.includes(l.level))
    .flatMap((l) => NODE_KEYS.map((k) => `${l.id}:${k}`));

  const progress = await loadProgress(email);
  applyStreak(progress);
  progress.xp = Number(progress.xp) + 20;
  progress.daily.xp += 20;

  const completed = new Set(progress.completedUnits || []);
  skipIds.forEach((id) => completed.add(id));
  progress.completedUnits = Array.from(completed);
  progress.level = level;

  await redis.set(progressKey(email), progress);
  await addLeagueXp(email, 20);
  res.json(publicView(progress));
});

app.listen(PORT, () => {
  console.log(`EnglishBite rodando na porta ${PORT}`);
});
