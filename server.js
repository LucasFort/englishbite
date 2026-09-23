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

function emptyProgress() {
  return { xp: 0, streak: 0, lastActiveDate: "", completedUnits: [], level: null };
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

// ---------- Progresso ----------
app.get("/api/progress", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });
  const progress = await redis.get(progressKey(email));
  res.json(progress || emptyProgress());
});

function applyStreak(progress) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (progress.lastActiveDate === today) {
    // já contabilizado hoje
  } else if (progress.lastActiveDate === yesterday) {
    progress.streak = Number(progress.streak) + 1;
  } else {
    progress.streak = 1;
  }
  progress.lastActiveDate = today;
}

app.post("/api/progress", async (req, res) => {
  const email = await getAuthedEmail(req);
  if (!email) return res.status(401).json({ error: "UNAUTHORIZED" });

  const { unitId, xpEarned, passed } = req.body;
  const progress = (await redis.get(progressKey(email))) || emptyProgress();

  applyStreak(progress);
  progress.xp = Number(progress.xp) + Number(xpEarned || 0);

  const completed = new Set(progress.completedUnits || []);
  if (passed) completed.add(unitId);
  progress.completedUnits = Array.from(completed);

  await redis.set(progressKey(email), progress);
  res.json(progress);
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

  const progress = (await redis.get(progressKey(email))) || emptyProgress();
  applyStreak(progress);
  progress.xp = Number(progress.xp) + 20;

  const completed = new Set(progress.completedUnits || []);
  skipIds.forEach((id) => completed.add(id));
  progress.completedUnits = Array.from(completed);
  progress.level = level;

  await redis.set(progressKey(email), progress);
  res.json(progress);
});

app.listen(PORT, () => {
  console.log(`EnglishBite rodando na porta ${PORT}`);
});
