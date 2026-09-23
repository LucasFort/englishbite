require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const nodemailer = require("nodemailer");
const { Redis } = require("@upstash/redis");

const PORT = process.env.PORT || 8793;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutos

// MEMORY_DB=1 roda com um banco em memória (para testar no computador sem mexer nos dados reais)
const redis = process.env.MEMORY_DB === "1" ? memoryRedis() : new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function memoryRedis() {
  const kv = new Map();
  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  console.log("[MEMORY_DB] Usando banco em memória — os dados somem ao reiniciar.");
  return {
    async get(k) { return clone(kv.get(k)); },
    async set(k, v) { kv.set(k, clone(v)); return "OK"; },
    async expire() { return 1; },
    async zincrby(k, inc, member) {
      const z = kv.get(k) || {};
      z[member] = (z[member] || 0) + Number(inc);
      kv.set(k, z);
      return z[member];
    },
    async zrange(k, start, stop) {
      const z = kv.get(k) || {};
      return Object.entries(z).sort((a, b) => b[1] - a[1]).slice(start, stop + 1).flat();
    },
    async hset(k, obj) { kv.set(k, Object.assign(kv.get(k) || {}, obj)); return 1; },
    async hgetall(k) { return clone(kv.get(k)); },
  };
}

const app = express();
app.set("trust proxy", 1); // o Render fica na frente do app (para saber que a URL é https)
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
  const expected = Buffer.from(hashB64, "base64");
  return expected.length === testHash.length && crypto.timingSafeEqual(testHash, expected);
}

function newToken() {
  return crypto.randomBytes(32).toString("base64").replace(/[^a-zA-Z0-9]/g, "");
}

function newCode() {
  return String(crypto.randomInt(100000, 1000000));
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
  { id: "challenge1", text: "Vença o desafio do dia", goal: 1, field: "challenge", reward: 15 },
  { id: "review1", text: "Faça 1 revisão de erros", goal: 1, field: "reviews", reward: 10 },
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
  { id: "challenge1", icon: "🎲", title: "Desafiante", desc: "Vença seu primeiro desafio do dia", test: (p) => p.totals.challenges >= 1 },
  { id: "challenge7", icon: "👑", title: "Rei dos desafios", desc: "Vença 7 desafios do dia", test: (p) => p.totals.challenges >= 7 },
  { id: "fixed20", icon: "🩹", title: "Aprendendo com os erros", desc: "Corrija 20 palavras na revisão", test: (p) => p.totals.fixed >= 20 },
  { id: "combo15", icon: "🎸", title: "Em chamas", desc: "Acerte 15 seguidas numa fase", test: (p) => p.bestCombo >= 15 },
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
    daily: { date: "", xp: 0, lessons: 0, perfect: 0, calls: 0, combo: 0, challenge: 0, reviews: 0, playGems: 0, claimed: [], goalHit: false },
    history: {},
    totals: { lessons: 0, perfect: 0, calls: 0, goals: 0, challenges: 0, fixed: 0 },
    achievements: [],
    bestCombo: 0,
    weak: [], // expressões que o aluno errou (em inglês), para a revisão
    srs: {}, // memória de cada expressão: { "Hello": { b: caixa 0-5, d: "2026-09-30" } }
    skills: {}, // acertos por habilidade: { listen: [acertos, total], ... }
    goalTheme: "",
    proUntil: 0,
    proFreezeMonth: "",
  };
}
// ---------- EnglishBite Pro ----------
const PRO_PLANS = {
  month: { days: 31, price: Number(process.env.PRO_PRICE_MONTH || 9.9), title: "EnglishBite Pro — 1 mês" },
  year: { days: 366, price: Number(process.env.PRO_PRICE_YEAR || 89.9), title: "EnglishBite Pro — 1 ano" },
};
function isPro(p) {
  return Number(p.proUntil || 0) > Date.now();
}
// Repetição espaçada: depois de quantos dias cada "caixa" de memória volta para revisão
const SRS_DAYS = [0, 1, 3, 7, 16, 35];
const SKILLS = ["listen", "write", "speak", "vocab", "grammar"];
const GOAL_THEMES = ["travel", "work", "talk", "grammar"];

const MAX_WEAK = 40;
const MAX_PLAY_GEMS = 30; // mel por dia vindo de fases (missões, meta e desafio ficam fora do teto)
function cleanWords(list) {
  return (Array.isArray(list) ? list : []).map((w) => String(w).slice(0, 120)).filter(Boolean).slice(0, 30);
}
function normalize(p) {
  const base = emptyProgress();
  const out = Object.assign(base, p || {});
  out.daily = Object.assign(emptyProgress().daily, (p || {}).daily);
  out.totals = Object.assign(emptyProgress().totals, (p || {}).totals);
  out.history = out.history || {};
  out.weak = Array.isArray(out.weak) ? out.weak : [];
  out.srs = out.srs && typeof out.srs === "object" ? out.srs : {};
  out.skills = out.skills && typeof out.skills === "object" ? out.skills : {};
  // Pro: 2 protetores de ofensiva todo mês
  const month = dayStr().slice(0, 7);
  if (isPro(out) && out.proFreezeMonth !== month) {
    out.freezes = Math.max(Number(out.freezes) || 0, 2);
    out.proFreezeMonth = month;
  }
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
    pro: isPro(p),
    proPlans: { month: PRO_PLANS.month.price, year: PRO_PLANS.year.price },
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
  const p = await redis.get(progressKey(email));
  await redis.hset("league:pro", { [email]: p && isPro(p) ? 1 : 0 });
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

  const { unitId, passed, perfect } = req.body;
  // lesson/call: fases da trilha · daily/review/mix: modos de prática (não marcam fases)
  // smart/goal: treinos do Pro (memória de longo prazo e trilha do objetivo)
  const kind = ["lesson", "call", "daily", "review", "mix", "smart", "goal"].includes(req.body.kind) ? req.body.kind : "lesson";
  let xpEarned = Math.max(0, Math.min(40, Number(req.body.xpEarned) || 0));
  const combo = Math.max(0, Math.min(50, Number(req.body.combo) || 0));
  const p = await loadProgress(email);
  const today = dayStr();

  let challengeWon = false;
  if (kind === "daily" && passed) {
    if (p.daily.challenge) xpEarned = Math.min(xpEarned, 5); // o bônus do desafio vale uma vez por dia
    else {
      p.daily.challenge = 1;
      p.totals.challenges++;
      challengeWon = true;
    }
  }
  if (kind === "review" && passed) p.daily.reviews++;

  // Palavras erradas entram na lista de revisão; as acertadas na revisão saem dela
  const fixed = new Set(cleanWords(req.body.fixed));
  const before = p.weak.length;
  p.weak = p.weak.filter((w) => !fixed.has(w));
  p.totals.fixed += before - p.weak.length;
  cleanWords(req.body.weak).forEach((w) => {
    p.weak = p.weak.filter((x) => x !== w);
    p.weak.unshift(w);
  });
  p.weak = p.weak.slice(0, MAX_WEAK);

  // Memória de longo prazo: acertou de primeira → a expressão sobe de caixa e volta mais tarde
  (Array.isArray(req.body.results) ? req.body.results : []).slice(0, 40).forEach((r) => {
    const en = String((r && r.en) || "").slice(0, 120);
    if (!en || (!p.srs[en] && Object.keys(p.srs).length >= 400)) return;
    const cur = p.srs[en] || { b: 0, d: today };
    const b = r.ok ? Math.min(SRS_DAYS.length - 1, cur.b + 1) : 0;
    p.srs[en] = { b, d: dayStr(SRS_DAYS[b]) };
  });
  // Raio-X: acertos por habilidade
  const skills = req.body.skills && typeof req.body.skills === "object" ? req.body.skills : {};
  SKILLS.forEach((s) => {
    const v = Array.isArray(skills[s]) ? skills[s] : null;
    if (!v) return;
    const total = Math.max(0, Math.min(40, Number(v[1]) || 0));
    const ok = Math.max(0, Math.min(total, Number(v[0]) || 0));
    const cur = Array.isArray(p.skills[s]) ? p.skills[s] : [0, 0];
    p.skills[s] = [cur[0] + ok, cur[1] + total];
  });

  const streakExtended = applyStreak(p);
  p.xp = Number(p.xp) + xpEarned;
  p.daily.xp += xpEarned;
  p.daily.combo = Math.max(p.daily.combo, combo);
  p.bestCombo = Math.max(Number(p.bestCombo) || 0, combo);
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
    // Mel por jogar tem teto diário, para ninguém "farmar" repetindo a mesma fase
    // (Pro: mel em dobro, com teto também em dobro)
    const mult = isPro(p) ? 2 : 1;
    const playGems = Math.max(0, Math.min((2 + (perfect ? 3 : 0)) * mult, MAX_PLAY_GEMS * mult - p.daily.playGems));
    p.daily.playGems += playGems;
    gemsEarned = playGems + (challengeWon ? 5 : 0);
    if (kind === "lesson" || kind === "call") {
      const completed = new Set(p.completedUnits || []);
      completed.add(String(unitId));
      p.completedUnits = Array.from(completed);
    }
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
    challengeWon,
    xpEarned,
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
  const pros = (await redis.hgetall("league:pro")) || {};
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) {
    rows.push({ name: names[flat[i]] || "Aluno", xp: Number(flat[i + 1]), me: flat[i] === email, pro: Number(pros[flat[i]]) === 1 });
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

// ---------- EnglishBite Pro: pagamento com Mercado Pago ----------
// Variáveis no Render: MP_ACCESS_TOKEN (obrigatória para vender) e PUBLIC_URL (ex.: https://englishbite.onrender.com)
const MP_API = "https://api.mercadopago.com";

function publicUrl(req) {
  return (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}
async function mp(pathname, options = {}) {
  const res = await fetch(MP_API + pathname, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${data.message || "erro"}`);
  return data;
}

async function extendPro(email, days) {
  const p = await loadProgress(email);
  p.proUntil = Math.max(Date.now(), Number(p.proUntil) || 0) + days * 86400000;
  p.proFreezeMonth = ""; // libera os protetores do mês na hora
  const fresh = normalize(p);
  await redis.set(progressKey(email), fresh);
  return fresh;
}

// Confere o pagamento direto na API do Mercado Pago (não confia no que o navegador manda)
async function grantFromPayment(paymentId) {
  const id = String(paymentId || "").replace(/\D/g, "");
  if (!id) return { ok: false, reason: "Pagamento inválido." };
  const pay = await mp(`/v1/payments/${id}`);
  if (pay.status !== "approved") return { ok: false, reason: "Pagamento ainda não aprovado.", status: pay.status };
  const [email, planId] = String(pay.external_reference || "").split("|");
  const plan = PRO_PLANS[planId];
  if (!email || !plan) return { ok: false, reason: "Pagamento sem referência do EnglishBite." };
  if (pay.currency_id !== "BRL" || Number(pay.transaction_amount) + 0.01 < plan.price) return { ok: false, reason: "Valor do pagamento não confere." };
  const doneKey = `mp:paid:${id}`;
  if (await redis.get(doneKey)) return { ok: true, email, already: true };
  await redis.set(doneKey, { email, plan: planId, at: new Date().toISOString() });
  await extendPro(email, plan.days);
  return { ok: true, email };
}

app.post("/api/pro/checkout", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const planId = PRO_PLANS[req.body.plan] ? req.body.plan : "month";
  const plan = PRO_PLANS[planId];
  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(503).json({ error: "As assinaturas abrem em breve! O pagamento ainda está sendo configurado." });
  }
  const base = publicUrl(req);
  try {
    const pref = await mp("/checkout/preferences", {
      method: "POST",
      body: JSON.stringify({
        items: [{ id: `pro-${planId}`, title: plan.title, quantity: 1, unit_price: plan.price, currency_id: "BRL" }],
        payer: { email },
        external_reference: `${email}|${planId}|${crypto.randomBytes(4).toString("hex")}`,
        back_urls: { success: `${base}/home.html#pro`, pending: `${base}/home.html#pro`, failure: `${base}/home.html#pro` },
        auto_return: "approved",
        statement_descriptor: "ENGLISHBITE",
        ...(base.startsWith("https://") ? { notification_url: `${base}/api/pro/webhook` } : {}),
      }),
    });
    res.json({ url: pref.init_point });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "Não foi possível abrir o pagamento agora. Tente de novo em instantes." });
  }
});

// Quando o aluno volta do Mercado Pago, o app confirma o pagamento na hora
app.post("/api/pro/confirm", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: "Pagamento não configurado." });
  try {
    const r = await grantFromPayment(req.body.paymentId);
    if (!r.ok) return res.status(400).json({ error: r.reason, status: r.status });
    if (r.email !== email) return res.status(403).json({ error: "Este pagamento é de outra conta." });
    res.json(publicView(await loadProgress(email)));
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: "Não foi possível confirmar o pagamento agora." });
  }
});

// Aviso automático do Mercado Pago (funciona mesmo se o aluno fechar a página)
app.post("/api/pro/webhook", async (req, res) => {
  res.sendStatus(200);
  const type = req.query.type || req.query.topic || req.body.type || req.body.topic;
  const id = req.query["data.id"] || req.query.id || (req.body.data && req.body.data.id);
  if (type !== "payment" || !id || !process.env.MP_ACCESS_TOKEN) return;
  try {
    const r = await grantFromPayment(id);
    console.log(`[Pro] pagamento ${id}:`, r.ok ? `liberado para ${r.email}` : r.reason);
  } catch (err) {
    console.error("[Pro] webhook:", err.message);
  }
});

// Liberar Pro manualmente (ex.: pagamento por Pix direto). Exige ADMIN_KEY com 16+ caracteres no Render.
app.post("/api/admin/pro", async (req, res) => {
  const key = String(process.env.ADMIN_KEY || "");
  const given = Buffer.from(String(req.headers["x-admin-key"] || ""));
  if (key.length < 16 || given.length !== key.length || !crypto.timingSafeEqual(given, Buffer.from(key))) {
    return res.status(403).json({ error: "Proibido." });
  }
  const email = String(req.body.email || "").trim().toLowerCase();
  const days = Math.max(1, Math.min(400, Number(req.body.days) || 31));
  if (!(await redis.get(userKey(email)))) return res.status(404).json({ error: "Conta não encontrada." });
  const p = await extendPro(email, days);
  res.json({ ok: true, email, proUntil: new Date(p.proUntil).toISOString() });
});

app.post("/api/pro/goal", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const theme = String(req.body.theme || "");
  if (!GOAL_THEMES.includes(theme)) return res.status(400).json({ error: "Objetivo inválido." });
  const p = await loadProgress(email);
  if (!isPro(p)) return res.status(403).json({ error: "Recurso do EnglishBite Pro." });
  p.goalTheme = theme;
  await redis.set(progressKey(email), p);
  res.json(publicView(p));
});

app.listen(PORT, () => {
  console.log(`EnglishBite rodando na porta ${PORT}`);
});
