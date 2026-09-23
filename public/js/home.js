(async function () {
  Api.requireAuth();
  const user = Api.getUser();

  document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", () => Api.logout()));

  const SECTIONS = {
    A1: { n: 1, name: "Primeiros passos", tone: "tone-green" },
    A2: { n: 2, name: "Conversas do dia a dia", tone: "tone-purple" },
    B1: { n: 3, name: "Inglês de verdade", tone: "tone-blue" },
    B2: { n: 4, name: "Rumo à fluência", tone: "tone-orange" },
  };
  // As fases de cada unidade, na ordem do aprendizado
  const NODES = [
    { key: "1", icon: null, name: "Aprender · parte 1", desc: "4 expressões novas", cta: "Começar", xp: 10 },
    { key: "2", icon: "📖", name: "Aprender · parte 2", desc: "Mais 4 expressões novas", cta: "Começar", xp: 10 },
    { key: "practice", icon: "💪", name: "Prática", desc: "Escute, escreva e fale frases completas", cta: "Praticar", xp: 10 },
    { key: "call", icon: "📞", name: "Chamada com a Bibi", desc: "Converse em inglês falando no microfone", cta: "Ligar", xp: 15 },
    { key: "test", icon: "🏆", name: "Desafio da unidade", desc: "Mostre tudo o que aprendeu", cta: "Começar", xp: 20 },
  ];
  // Deslocamento horizontal dos nós, em zigue-zague
  const ZIGZAG = [0, 50, 76, 50, 0, -50, -76, -50];
  // Objetivos da trilha personalizada (Pro)
  const GOALS = {
    travel: { icon: "✈️", name: "Viagem", desc: "Aeroporto, hotel, restaurante e compras" },
    work: { icon: "💼", name: "Trabalho", desc: "Reuniões, planos e opiniões" },
    talk: { icon: "💬", name: "Conversação", desc: "Falar de você, sentimentos e expressões" },
    grammar: { icon: "📝", name: "Gramática", desc: "Passado, futuro e phrasal verbs" },
  };
  const SKILL_NAMES = {
    listen: ["🎧", "Escuta"],
    write: ["✍️", "Escrita"],
    speak: ["🎤", "Fala"],
    vocab: ["📖", "Vocabulário"],
    grammar: ["📝", "Gramática"],
  };

  let units = [];
  let progress = { xp: 0, streak: 0, completedUnits: [] };

  try {
    const [unitsRes, progressRes] = await Promise.all([
      fetch("data/lessons.json").then((r) => r.json()),
      Api.request("/api/progress", { auth: true }),
    ]);
    units = unitsRes;
    progress = progressRes;
  } catch (err) {
    if (err.message === "UNAUTHORIZED") {
      Api.logout();
      return;
    }
    document.getElementById("path").innerHTML = `<p style="color:var(--red-dark);text-align:center">${escapeHtml(err.message)}</p>`;
    return;
  }

  if (!progress.level) {
    window.location.href = "placement.html";
    return;
  }

  const done = new Set(progress.completedUnits || []);
  // Lista plana de todas as fases, na ordem da trilha
  const steps = [];
  units.forEach((u, ui) =>
    NODES.forEach((n) => steps.push({ unit: u, ui, node: n, done: done.has(`${u.id}:${n.key}`) || done.has(u.id) }))
  );
  const currentIndex = steps.findIndex((s) => !s.done);

  renderAll();
  renderPath();
  setupTabs();
  confirmPayment();

  function renderAll() {
    renderStats();
    renderSide();
    renderStreakAlert();
    renderPractice();
    renderQuests();
    renderShop();
    renderProfile();
    renderPro();
    renderDots();
  }

  function studiedToday() {
    return progress.lastActiveDate === progress.today;
  }

  // ---------- Abas (Aprender, Praticar, Liga...) ----------
  function setupTabs() {
    const show = () => {
      const tab = (location.hash || "#learn").slice(1);
      const valid = document.querySelector(`[data-view="${tab}"]`) ? tab : "learn";
      document.querySelectorAll("[data-view]").forEach((v) => (v.hidden = v.dataset.view !== valid));
      document.querySelectorAll("[data-tab]").forEach((a) => a.classList.toggle("active", a.dataset.tab === valid));
      if (valid === "league") loadLeague();
      if (valid !== "learn") window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", show);
    show();
  }

  function renderDots() {
    const questReady = progress.quests.some((q) => q.value >= q.goal && !q.claimed);
    const practiceNew = !progress.daily.challenge;
    document.querySelectorAll('[data-dot="quests"]').forEach((d) => (d.hidden = !questReady));
    document.querySelectorAll('[data-dot="practice"]').forEach((d) => (d.hidden = !practiceNew));
  }

  // ---------- Barra de status ----------
  function renderStats() {
    const cur = steps[currentIndex === -1 ? steps.length - 1 : currentIndex];
    const freezes = progress.freezes ? ` · ${progress.freezes} protetor(es) ❄️` : "";
    const html = `
      <div class="stat level" title="Seu nível atual">🌎 ${cur.unit.level}</div>
      <div class="stat streak ${studiedToday() ? "" : "off"}" title="Ofensiva: dias seguidos estudando${freezes}"><span class="ico">🔥</span>${Number(progress.streak) || 0}${progress.freezes ? '<span class="freeze-badge">❄️</span>' : ""}</div>
      <div class="stat xp" title="Pontos de experiência"><span class="ico">⚡</span>${Number(progress.xp) || 0}</div>
      <a class="stat gems" href="#shop" title="Mel: use na loja"><span class="ico">🍯</span>${Number(progress.gems) || 0}</a>
    `;
    document.querySelectorAll("[data-stats]").forEach((el) => (el.innerHTML = html));
  }

  function renderSide() {
    const count = steps.filter((s) => s.done).length;
    document.getElementById("progressText").textContent = `${count} de ${steps.length} fases concluídas`;
    document.getElementById("progressFill").style.width = Math.round((count / steps.length) * 100) + "%";
    const first = user && user.name ? user.name.split(" ")[0] : "";
    document.getElementById("helloName").textContent = first ? `Olá, ${first}!` : "Olá!";
    if (studiedToday()) {
      document.getElementById("helloText").textContent = "Você já estudou hoje. Continue assim! 🎉";
    }
    document.getElementById("sideGoal").innerHTML = goalCard();
    document.getElementById("sideQuests").innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Missões do dia</h3><a href="#quests">Ver todas</a></div>
        ${progress.quests.map(questRow).join("")}
      </div>`;
    bindClaims(document.getElementById("sideQuests"));
  }

  function goalCard() {
    const goal = progress.dailyGoal || 20;
    const xp = Math.min(goal, progress.daily.xp || 0);
    const pct = Math.round((xp / goal) * 100);
    return `
      <div class="card goal-card">
        <div class="ring" style="--p:${pct}"><span>${progress.daily.goalHit ? "✓" : pct + "%"}</span></div>
        <div style="flex:1">
          <h3 style="margin:0 0 4px">Meta diária</h3>
          <p>${progress.daily.goalHit ? "Meta batida! 🎉 Volte amanhã." : `${xp} de ${goal} XP hoje`}</p>
        </div>
      </div>`;
  }

  // Aviso quando a ofensiva está em risco
  function renderStreakAlert() {
    const el = document.getElementById("streakAlert");
    const hour = new Date().getHours();
    if (progress.streak > 0 && !studiedToday()) {
      el.innerHTML = `
        <div class="alert-card ${hour >= 18 ? "urgent" : ""}">
          <span class="big">🔥</span>
          <div>
            <b>Sua ofensiva de ${progress.streak} dia(s) está em risco!</b>
            <p>Faça qualquer fase ou treino hoje para não perder a sequência.${progress.freezes ? ` Você tem ${progress.freezes} protetor(es) ❄️.` : ""}</p>
          </div>
        </div>`;
    } else if (!progress.daily.challenge) {
      el.innerHTML = `
        <a class="alert-card daily" href="lesson.html?mode=daily">
          <span class="big">🎲</span>
          <div><b>Desafio do dia disponível!</b><p>Um desafio novo, sorteado só para você. Vença e ganhe +5 🍯.</p></div>
          <span class="go">›</span>
        </a>`;
    } else {
      el.innerHTML = "";
    }
  }

  // ---------- Praticar ----------
  function unlockedUnits() {
    const list = units.filter((u) => done.has(u.id) || [...done].some((d) => d.startsWith(u.id + ":")));
    return list.length ? list : units.slice(0, 1);
  }

  // Palavra do dia: diferente para cada aluno e para cada dia
  function wordOfDay() {
    const pool = unlockedUnits().concat(units[Math.min(units.length - 1, unlockedUnits().length)]);
    const words = pool.flatMap((u) => u.words.map((w) => Object.assign({ unit: u }, w)));
    let h = 2166136261;
    for (const c of ((user && user.email) || "") + progress.today) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return words[h % words.length];
  }

  function renderPractice() {
    const w = wordOfDay();
    const weak = (progress.weak || []).length;
    const unitsCount = unlockedUnits().length;
    document.getElementById("practiceBody").innerHTML = `
      <div class="word-day">
        <div class="over">✨ Palavra do dia</div>
        <div class="row">
          <button class="speak-btn big" data-say="${escapeHtml(w.en)}" aria-label="Ouvir">🔊</button>
          <div>
            <div class="wd-en">${escapeHtml(w.en)}</div>
            <div class="wd-pt">${escapeHtml(w.pt)}</div>
          </div>
        </div>
        <div class="wd-ex"><button class="speak-btn" data-say="${escapeHtml(w.ex)}" aria-label="Ouvir exemplo">🔊</button> “${escapeHtml(w.ex)}” <span>— ${escapeHtml(w.exPt)}</span></div>
        <div class="wd-unit">${w.unit.icon} ${escapeHtml(w.unit.title)}</div>
      </div>

      <div class="practice-grid">
        <a class="practice-card tone-orange ${progress.daily.challenge ? "is-done" : ""}" href="lesson.html?mode=daily">
          <span class="pc-ico">🎲</span>
          <b>Desafio do dia</b>
          <small>${progress.daily.challenge ? "Vencido hoje ✓ — jogue de novo por +5 XP" : "10 exercícios sorteados · +20 XP e +5 🍯"}</small>
        </a>
        <a class="practice-card tone-red" href="lesson.html?mode=review">
          <span class="pc-ico">🩹</span>
          <b>Revisar erros ${weak ? `<span class="count">${weak}</span>` : ""}</b>
          <small>${weak ? "Pratique as expressões que você errou" : "Nenhum erro pendente — bom trabalho!"}</small>
        </a>
        <a class="practice-card tone-blue" href="lesson.html?mode=mix">
          <span class="pc-ico">🔀</span>
          <b>Treino relâmpago</b>
          <small>Mistura de ${unitsCount} unidade(s) · diferente a cada vez</small>
        </a>
        <a class="practice-card tone-purple ${progress.pro ? "" : "locked-pro"}" href="${progress.pro ? "lesson.html?mode=smart" : "#pro"}">
          <span class="pc-ico">🧠</span>
          <b>Memória de longo prazo <span class="pro-tag">PRO</span></b>
          <small>${memoryStats().due ? `${memoryStats().due} expressão(ões) prestes a ser esquecida(s)` : "Revisão no momento certo, antes de esquecer"}</small>
        </a>
        <a class="practice-card tone-green ${progress.pro ? "" : "locked-pro"}" href="${progress.pro ? "lesson.html?mode=goal" : "#pro"}">
          <span class="pc-ico">🎯</span>
          <b>Treino do objetivo <span class="pro-tag">PRO</span></b>
          <small>${progress.pro && progress.goalTheme ? GOALS[progress.goalTheme].name : "Viagem, trabalho, conversação ou gramática"}</small>
        </a>
      </div>`;
    document.querySelectorAll("#practiceBody [data-say]").forEach((b) => b.addEventListener("click", () => Sounds.say(b.dataset.say)));
  }

  // ---------- Missões ----------
  function questRow(q) {
    const pct = Math.round((q.value / q.goal) * 100);
    const ready = q.value >= q.goal && !q.claimed;
    return `
      <div class="quest ${q.claimed ? "claimed" : ""}">
        <span class="q-ico">${q.claimed ? "✅" : ready ? "🎁" : "📜"}</span>
        <div class="q-main">
          <div class="q-text">${escapeHtml(q.text)}</div>
          <div class="mini-track"><div class="mini-fill" style="width:${pct}%"></div><span class="q-num">${q.value}/${q.goal}</span></div>
        </div>
        ${ready ? `<button class="btn btn-sm" data-claim="${q.id}">+${q.reward} 🍯</button>` : `<span class="q-reward">${q.claimed ? "" : `${q.reward} 🍯`}</span>`}
      </div>`;
  }

  function bindClaims(root) {
    root.querySelectorAll("[data-claim]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const p = await Api.request("/api/quests/claim", { method: "POST", auth: true, body: { id: b.dataset.claim } });
          progress = p;
          Sounds.levelUp();
          toast(`+${p.reward} 🍯 resgatado!`);
          renderAll();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      })
    );
  }

  function msUntilMidnight() {
    const now = new Date(Date.now() - 3 * 3600 * 1000); // horário de Brasília
    return 86400000 - ((now.getUTCHours() * 60 + now.getUTCMinutes()) * 60000 + now.getUTCSeconds() * 1000);
  }
  function fmtDuration(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h ? `${h}h ${m}min` : `${m}min`;
  }

  function renderQuests() {
    document.getElementById("questsSub").textContent = `Novas missões em ${fmtDuration(msUntilMidnight())}.`;
    const goal = progress.dailyGoal || 20;
    document.getElementById("questsBody").innerHTML = `
      ${goalCard()}
      <div class="card">${progress.quests.map(questRow).join("")}</div>
      <div class="card">
        <h3>Sua meta diária</h3>
        <p style="margin-bottom:14px">Quanto XP você quer ganhar por dia? Bater a meta dá +5 🍯.</p>
        <div class="goal-options">
          ${[
            [10, "Leve", "~5 min"],
            [20, "Normal", "~10 min"],
            [30, "Sério", "~15 min"],
            [50, "Intenso", "~25 min"],
          ]
            .map(([v, name, time]) => `<button class="goal-opt ${v === goal ? "active" : ""}" data-goal="${v}"><b>${name}</b><span>${v} XP · ${time}</span></button>`)
            .join("")}
        </div>
      </div>`;
    bindClaims(document.getElementById("questsBody"));
    document.querySelectorAll("[data-goal]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          progress = await Api.request("/api/goal", { method: "POST", auth: true, body: { goal: Number(b.dataset.goal) } });
          toast("Meta atualizada!");
          renderAll();
        } catch (err) {
          toast(err.message);
        }
      })
    );
  }

  // ---------- Loja ----------
  function renderShop() {
    const gems = progress.gems || 0;
    const freezes = progress.freezes || 0;
    document.getElementById("shopBody").innerHTML = `
      <div class="shop-balance"><span>🍯</span><b>${gems}</b> de mel</div>
      <div class="shop-item">
        <span class="si-ico">❄️</span>
        <div class="si-main">
          <b>Protetor de ofensiva</b>
          <p>Se você esquecer de estudar um dia, ele salva a sua ofensiva automaticamente. Você tem ${freezes}/2.</p>
        </div>
        <button class="btn btn-blue btn-sm" data-buy="freeze" ${gems < 40 || freezes >= 2 ? "disabled" : ""}>${freezes >= 2 ? "Máximo" : "40 🍯"}</button>
      </div>
      <div class="shop-item">
        <span class="si-ico">❤️</span>
        <div class="si-main">
          <b>Recarga de vidas</b>
          <p>Ficou sem vidas no meio de uma fase? Recarregue na hora, sem perder o que já fez. Disponível dentro da lição.</p>
        </div>
        <span class="si-price">15 🍯</span>
      </div>
      <div class="card" style="margin-top:20px">
        <h3>Como ganhar mel</h3>
        <p>🍯 +2 por fase concluída, +3 se for perfeita<br>🎯 +5 ao bater a meta diária<br>🎲 +5 ao vencer o desafio do dia<br>📜 +10 a +20 por missão resgatada</p>
      </div>`;
    document.querySelectorAll("[data-buy]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          progress = await Api.request("/api/shop", { method: "POST", auth: true, body: { item: b.dataset.buy } });
          Sounds.levelUp();
          toast("Protetor de ofensiva equipado! ❄️");
          renderAll();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      })
    );
  }

  // ---------- Liga ----------
  let leagueTimer = null;
  async function loadLeague() {
    const box = document.getElementById("leagueBody");
    try {
      const data = await Api.request("/api/league", { auth: true });
      const medals = ["🥇", "🥈", "🥉"];
      box.innerHTML = `
        <div class="league-list">
          ${data.rows
            .map(
              (r, i) => `
            <div class="league-row ${r.me ? "me" : ""} ${r.bot ? "bot" : ""} ${i < 3 ? "top" : ""}">
              <span class="rank">${medals[i] || i + 1}</span>
              <span class="avatar-sm">${r.bot ? "🤖" : escapeHtml(r.name.charAt(0).toUpperCase())}</span>
              <span class="lname">${escapeHtml(r.name.replace(/^🤖\s*/, ""))}${r.pro ? ' <span class="pro-tag">👑 PRO</span>' : ""}${r.me ? " (você)" : ""}</span>
              <span class="lxp">${r.xp} XP</span>
            </div>`
            )
            .join("")}
        </div>
        <p class="view-sub" style="margin-top:16px">🤖 Os robôs estão aqui para você ter com quem competir. Chame seus amigos para a liga!</p>`;
      const tick = () => (document.getElementById("leagueSub").textContent = `A liga termina em ${fmtDuration(data.endsAt - Date.now())}. Ganhe XP para subir!`);
      tick();
      clearInterval(leagueTimer);
      leagueTimer = setInterval(tick, 60000);
    } catch (err) {
      box.innerHTML = `<p class="view-sub">${escapeHtml(err.message)}</p>`;
    }
  }

  // ---------- EnglishBite Pro ----------
  function memoryStats() {
    const vals = Object.values(progress.srs || {});
    return {
      total: vals.length,
      fresh: vals.filter((v) => v.b <= 1).length,
      learning: vals.filter((v) => v.b >= 2 && v.b <= 3).length,
      solid: vals.filter((v) => v.b >= 4).length,
      due: vals.filter((v) => v.d <= progress.today).length,
    };
  }

  function skillRows() {
    const s = progress.skills || {};
    return Object.keys(SKILL_NAMES).map((k) => {
      const [ok, total] = Array.isArray(s[k]) ? s[k] : [0, 0];
      return { k, icon: SKILL_NAMES[k][0], name: SKILL_NAMES[k][1], total, pct: total ? Math.round((ok / total) * 100) : null };
    });
  }

  function money(v) {
    return "R$ " + Number(v).toFixed(2).replace(".", ",");
  }

  function renderPro() {
    const box = document.getElementById("proBody");
    const m = memoryStats();
    const skills = skillRows();
    const measured = skills.filter((x) => x.total >= 3);
    const weakest = measured.slice().sort((a, b) => a.pct - b.pct)[0];
    const plans = progress.proPlans || { month: 9.9, year: 89.9 };
    const yearSave = Math.round((1 - plans.year / (plans.month * 12)) * 100);

    const memoryPanel = `
      <div class="card">
        <div class="card-head"><h3>🧠 Memória de longo prazo</h3></div>
        <p style="margin-bottom:14px">O app lembra de cada expressão que você estudou e traz de volta no momento certo, logo antes de você esquecer.</p>
        <div class="memory-bars">
          <div><b>${m.fresh}</b><span>🌱 Recém-aprendidas</span></div>
          <div><b>${m.learning}</b><span>🌿 Fixando</span></div>
          <div><b>${m.solid}</b><span>🌳 Na memória</span></div>
        </div>
        <p class="due-line">${m.due ? `⏰ <b>${m.due}</b> expressão(ões) para revisar hoje` : m.total ? "✅ Nada vencido hoje — sua memória está em dia!" : "Faça algumas fases para a sua memória começar a ser acompanhada."}</p>
        ${progress.pro ? `<a class="btn btn-block" href="lesson.html?mode=smart">Revisar agora</a>` : ""}
      </div>`;

    const skillsPanel = `
      <div class="card">
        <h3>📊 Raio-X do seu inglês</h3>
        ${skills
          .map(
            (x) => `
          <div class="skill-row">
            <span class="sk-name">${x.icon} ${x.name}</span>
            <div class="mini-track"><div class="mini-fill" style="width:${x.pct || 0}%;background:${x.pct === null ? "var(--border)" : x.pct >= 80 ? "var(--green)" : x.pct >= 60 ? "var(--gold)" : "var(--red)"}"></div></div>
            <span class="sk-pct">${x.total >= 3 ? x.pct + "%" : "—"}</span>
          </div>`
          )
          .join("")}
        <p class="due-line">${weakest ? `💡 Seu ponto a melhorar é <b>${weakest.name.toLowerCase()}</b> (${weakest.pct}% de acertos). ${
              {
                speak: "Faça as chamadas com a Bibi e os exercícios de pronúncia.",
                listen: "Capriche nos exercícios de escuta e ditado (use o 🐢 para ouvir devagar).",
                write: "Treine as fases de Prática, que têm mais escrita e montagem de frases.",
                vocab: "Use a Memória de longo prazo todos os dias.",
                grammar: "Refaça os desafios das unidades e leia o 📖 Guia de cada uma.",
              }[weakest.k]
            }` : "Continue estudando: o Raio-X aparece depois de alguns exercícios de cada tipo."}</p>
      </div>`;

    if (!progress.pro) {
      box.innerHTML = `
        <div class="pro-hero">
          <div class="crown">👑</div>
          <h1>EnglishBite Pro</h1>
          <p>O app que aprende com você. Revisões no momento certo, treinos do seu objetivo e um raio-x do seu inglês.</p>
          ${m.total ? `<div class="pro-hook">Você já estudou <b>${m.total}</b> expressões.${m.due ? ` <b>${m.due}</b> ${m.due === 1 ? "está prestes a ser esquecida" : "estão prestes a ser esquecidas"}.` : ""} O Pro não deixa isso acontecer.</div>` : ""}
        </div>

        <div class="pro-features">
          <div class="pf"><span>🧠</span><b>Memória de longo prazo</b><small>Repetição espaçada: cada expressão volta depois de 1, 3, 7, 16 e 35 dias, no momento exato de fixar para sempre.</small></div>
          <div class="pf"><span>📊</span><b>Raio-X do seu inglês</b><small>Veja quanto você acerta em escuta, escrita, fala, vocabulário e gramática, e o que treinar.</small></div>
          <div class="pf"><span>🎯</span><b>Trilha do objetivo</b><small>Treinos de viagem, trabalho, conversação ou gramática com conteúdo de toda a trilha, até das unidades bloqueadas.</small></div>
          <div class="pf"><span>❤️</span><b>Vidas infinitas</b><small>Erre à vontade e aprenda sem medo de perder a fase.</small></div>
          <div class="pf"><span>🍯</span><b>Mel em dobro</b><small>Ganhe o dobro de mel em cada fase.</small></div>
          <div class="pf"><span>❄️</span><b>2 protetores por mês</b><small>Sua ofensiva protegida todo mês, de graça.</small></div>
          <div class="pf"><span>👑</span><b>Selo Pro na liga</b><small>Mostre para todo mundo que você leva o inglês a sério.</small></div>
        </div>

        <div class="plans">
          <button class="plan" data-plan="year">
            <span class="plan-flag">Economize ${yearSave}%</span>
            <b>Anual</b>
            <span class="price">${money(plans.year)}</span>
            <small>${money(plans.year / 12)} por mês</small>
          </button>
          <button class="plan" data-plan="month">
            <b>Mensal</b>
            <span class="price">${money(plans.month)}</span>
            <small>por mês</small>
          </button>
        </div>
        <p class="view-sub" style="text-align:center">Pagamento seguro pelo Mercado Pago: Pix, cartão ou boleto. Sem renovação automática, então você só paga de novo se quiser.</p>

        <h3 class="block-title">Uma prévia do seu Pro</h3>
        <div class="pro-preview">${memoryPanel}${skillsPanel}</div>`;
      box.querySelectorAll("[data-plan]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            const r = await Api.request("/api/pro/checkout", { method: "POST", auth: true, body: { plan: b.dataset.plan } });
            window.location.href = r.url;
          } catch (err) {
            toast(err.message);
            b.disabled = false;
          }
        })
      );
      return;
    }

    const until = new Date(progress.proUntil).toLocaleDateString("pt-BR");
    const daysLeft = Math.ceil((progress.proUntil - Date.now()) / 86400000);
    box.innerHTML = `
      <div class="pro-hero on">
        <div class="crown">👑</div>
        <h1>Você é Pro!</h1>
        <p>Ativo até <b>${until}</b>${daysLeft <= 7 ? ` · faltam ${daysLeft} dia(s)` : ""}.</p>
        ${daysLeft <= 7 ? `<div class="plans small"><button class="plan" data-plan="month"><b>Renovar 1 mês</b><span class="price">${money(plans.month)}</span></button><button class="plan" data-plan="year"><b>Renovar 1 ano</b><span class="price">${money(plans.year)}</span></button></div>` : ""}
      </div>
      ${memoryPanel}
      ${skillsPanel}
      <div class="card">
        <h3>🎯 Trilha do objetivo</h3>
        <p style="margin-bottom:14px">Escolha o que você quer alcançar. O treino puxa conteúdo de toda a trilha para esse objetivo.</p>
        <div class="goal-options">
          ${Object.entries(GOALS)
            .map(([k, g]) => `<button class="goal-opt ${progress.goalTheme === k ? "active" : ""}" data-theme-goal="${k}"><b>${g.icon} ${g.name}</b><span>${g.desc}</span></button>`)
            .join("")}
        </div>
        ${progress.goalTheme ? `<a class="btn btn-block" style="margin-top:14px" href="lesson.html?mode=goal">Treinar ${GOALS[progress.goalTheme].name.toLowerCase()}</a>` : ""}
      </div>`;
    box.querySelectorAll("[data-theme-goal]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          progress = await Api.request("/api/pro/goal", { method: "POST", auth: true, body: { theme: b.dataset.themeGoal } });
          toast(`Objetivo: ${GOALS[b.dataset.themeGoal].name}`);
          renderAll();
        } catch (err) {
          toast(err.message);
        }
      })
    );
    box.querySelectorAll("[data-plan]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const r = await Api.request("/api/pro/checkout", { method: "POST", auth: true, body: { plan: b.dataset.plan } });
          window.location.href = r.url;
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      })
    );
  }

  // Volta do Mercado Pago: confirma o pagamento e libera o Pro na hora
  async function confirmPayment() {
    const raw = location.search + "&" + (location.hash.split("?")[1] || "");
    const q = new URLSearchParams(raw.replace(/^\?/, ""));
    const paymentId = q.get("payment_id") || q.get("collection_id");
    if (!paymentId) return;
    history.replaceState(null, "", "home.html#pro");
    const status = q.get("status") || q.get("collection_status");
    if (status && status !== "approved") {
      toast(status === "pending" || status === "in_process" ? "Pagamento em análise. O Pro será liberado assim que for aprovado." : "O pagamento não foi concluído.");
      return;
    }
    try {
      progress = await Api.request("/api/pro/confirm", { method: "POST", auth: true, body: { paymentId } });
      renderAll();
      location.hash = "#pro";
      Sounds.levelUp();
      toast("Bem-vindo ao EnglishBite Pro! 👑");
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Perfil ----------
  function renderProfile() {
    const name = (user && user.name) || "Aluno";
    const t = progress.totals || {};
    const list = progress.achievementList || [];
    const unlocked = list.filter((a) => a.unlocked).length;
    const theme = window.Theme ? Theme.get() : "system";
    document.getElementById("profileBody").innerHTML = `
      <div class="profile-head">
        <div class="avatar-lg">${escapeHtml(name.charAt(0).toUpperCase())}</div>
        <div>
          <h1 class="view-title" style="margin:0">${escapeHtml(name)} ${progress.pro ? '<span class="pro-tag big">👑 PRO</span>' : ""}</h1>
          <p class="view-sub" style="margin:4px 0 0">${escapeHtml((user && user.email) || "")}</p>
        </div>
      </div>

      <h3 class="block-title">Estatísticas</h3>
      <div class="stat-grid">
        ${[
          ["🔥", progress.streak || 0, "Ofensiva atual"],
          ["🌋", progress.bestStreak || 0, "Maior ofensiva"],
          ["⚡", progress.xp || 0, "XP total"],
          ["📚", t.lessons || 0, "Fases concluídas"],
          ["💎", t.perfect || 0, "Fases perfeitas"],
          ["📞", t.calls || 0, "Chamadas"],
          ["🎲", t.challenges || 0, "Desafios vencidos"],
          ["🎸", progress.bestCombo || 0, "Maior combo"],
        ]
          .map(([ico, v, l]) => `<div class="stat-box"><span>${ico}</span><b>${v}</b><small>${l}</small></div>`)
          .join("")}
      </div>

      <h3 class="block-title">Últimas 5 semanas</h3>
      ${heatmap()}

      <h3 class="block-title">Conquistas <span class="muted">${unlocked}/${list.length}</span></h3>
      <div class="badge-grid">
        ${list
          .map(
            (a) => `
          <div class="badge ${a.unlocked ? "on" : ""}" title="${escapeHtml(a.desc)}">
            <span class="b-ico">${a.unlocked ? a.icon : "🔒"}</span>
            <b>${escapeHtml(a.title)}</b>
            <small>${escapeHtml(a.desc)}</small>
          </div>`
          )
          .join("")}
      </div>

      <h3 class="block-title">Aparência</h3>
      <div class="segmented" id="themePick">
        ${[
          ["light", "☀️ Claro"],
          ["dark", "🌙 Escuro"],
          ["system", "💻 Automático"],
        ]
          .map(([v, l]) => `<button data-theme-opt="${v}" class="${v === theme ? "active" : ""}">${l}</button>`)
          .join("")}
      </div>

      <div class="profile-actions">
        <a class="btn btn-gold" href="#pro">${progress.pro ? "👑 Meu painel Pro" : "👑 Conhecer o Pro"}</a>
        <button class="btn" data-install>📲 Baixar o app</button>
        <a class="btn btn-white" href="placement.html">🎯 Refazer teste de nível</a>
        <a class="btn btn-white" href="#shop">🛍️ Loja</a>
        <button class="btn btn-white" data-logout>🚪 Sair</button>
      </div>`;
    const root = document.getElementById("profileBody");
    root.querySelectorAll("[data-theme-opt]").forEach((b) =>
      b.addEventListener("click", () => {
        Theme.set(b.dataset.themeOpt);
        root.querySelectorAll("[data-theme-opt]").forEach((x) => x.classList.toggle("active", x === b));
      })
    );
    root.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", () => Api.logout()));
  }

  // Calendário de atividade (XP por dia, últimos 35 dias)
  function heatmap() {
    const hist = progress.history || {};
    const today = Date.parse(progress.today);
    const days = [];
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today - i * 86400000).toISOString().slice(0, 10);
      days.push({ d, xp: Number(hist[d]) || 0 });
    }
    const lvl = (xp) => (xp === 0 ? 0 : xp < 15 ? 1 : xp < 30 ? 2 : xp < 60 ? 3 : 4);
    const active = days.filter((x) => x.xp > 0).length;
    return `
      <div class="heatmap">
        ${days.map((x) => `<i class="h${lvl(x.xp)}" title="${x.d.split("-").reverse().join("/")}: ${x.xp} XP"></i>`).join("")}
      </div>
      <p class="view-sub" style="margin-top:8px">Você estudou em ${active} dos últimos 35 dias.</p>`;
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- Trilha ----------
  function renderPath() {
    const pathEl = document.getElementById("path");
    pathEl.innerHTML = "";
    let lastLevel = null;
    let unitNumberInSection = 0;

    units.forEach((u, ui) => {
      const meta = SECTIONS[u.level] || { n: 1, name: "Nível " + u.level, tone: "tone-green" };
      if (u.level !== lastLevel) {
        lastLevel = u.level;
        unitNumberInSection = 0;
        const header = document.createElement("div");
        header.className = "path-divider";
        header.textContent = `Seção ${meta.n} · ${u.level} · ${meta.name}`;
        pathEl.appendChild(header);
      }
      unitNumberInSection++;

      const section = document.createElement("section");
      section.className = "path-section " + meta.tone;
      section.innerHTML = `
        <div class="section-banner ${meta.tone}">
          <div>
            <div class="over">Seção ${meta.n}, unidade ${unitNumberInSection}</div>
            <h2>${u.icon} ${escapeHtml(u.title)}</h2>
          </div>
          <button class="guide" data-guide="${u.id}">📖 Guia</button>
        </div>
        <div class="path-nodes"></div>
      `;
      pathEl.appendChild(section);

      const nodesEl = section.querySelector(".path-nodes");
      const offsetBase = ui % 2 === 0 ? 0 : 4; // alterna o lado da curva a cada unidade
      NODES.forEach((n, k) => {
        const index = ui * NODES.length + k;
        const step = steps[index];
        const isCurrent = index === currentIndex;
        const isLocked = !step.done && !isCurrent;
        const offset = ZIGZAG[(k + offsetBase) % ZIGZAG.length];
        const icon = step.done ? (n.key === "test" ? "🏆" : "⭐") : isLocked ? "🔒" : n.icon || u.icon;

        const wrap = document.createElement("div");
        wrap.className = "node-wrap";
        wrap.style.transform = `translateX(${offset}px)`;
        wrap.dataset.offset = offset;
        wrap.innerHTML = `
          ${isCurrent ? `<div class="node-bubble">${n.key === "call" ? "Ligar" : "Começar"}</div>` : ""}
          <button class="lesson-node ${step.done ? "done" : ""} ${isCurrent ? "current" : ""} ${isLocked ? "locked" : ""} ${n.key === "test" ? "trophy" : ""}"
                  aria-label="${escapeHtml(u.title + " — " + n.name)}">
            <span class="emoji">${icon}</span>
          </button>
        `;
        wrap.querySelector(".lesson-node").addEventListener("click", (e) => {
          e.stopPropagation();
          togglePop(wrap, u, n, { isDone: step.done, isLocked });
        });
        nodesEl.appendChild(wrap);
      });

      const mascot = document.createElement("img");
      mascot.src = "img/bee.svg";
      mascot.alt = "";
      const unitLocked = currentIndex !== -1 && ui * NODES.length > currentIndex;
      mascot.className = "path-mascot " + (ui % 2 === 0 ? "left" : "right") + (unitLocked ? " sleepy" : "");
      nodesEl.appendChild(mascot);
    });

    if (currentIndex === -1) {
      const end = document.createElement("div");
      end.className = "card";
      end.style.textAlign = "center";
      end.innerHTML = `<h3>🏆 Você completou a trilha!</h3><p>Revise qualquer fase tocando nas estrelas, ou continue treinando na aba Praticar.</p>`;
      pathEl.appendChild(end);
    }

    pathEl.querySelectorAll("[data-guide]").forEach((b) => b.addEventListener("click", () => openGuide(b.dataset.guide)));

    const current = pathEl.querySelector(".lesson-node.current");
    if (current && (location.hash || "#learn") === "#learn") current.scrollIntoView({ block: "center" });
  }

  let openPop = null;
  function closePop() {
    if (openPop) {
      openPop.parentElement.classList.remove("open");
      openPop.remove();
    }
    openPop = null;
  }
  document.addEventListener("click", closePop);

  function togglePop(wrap, unit, n, { isDone, isLocked }) {
    const already = openPop && openPop.parentElement === wrap;
    closePop();
    if (already) return;

    const pop = document.createElement("div");
    pop.className = "node-pop" + (isLocked ? " locked" : "");
    pop.style.setProperty("--shift", wrap.dataset.offset + "px");
    pop.addEventListener("click", (e) => e.stopPropagation());
    const title = `${escapeHtml(unit.title)} · ${n.name}`;
    if (isLocked) {
      pop.innerHTML = `
        <h3>${title}</h3>
        <p>Complete as fases anteriores para desbloquear esta!</p>
        <button class="btn" disabled>Bloqueada</button>`;
    } else {
      pop.innerHTML = `
        <h3>${title}</h3>
        <p>${n.desc}</p>
        <a class="btn" href="lesson.html?unit=${encodeURIComponent(unit.id)}&node=${n.key}">${isDone ? "Revisar +5 XP" : `${n.cta} +${n.xp} XP`}</a>`;
    }
    wrap.appendChild(pop);
    wrap.classList.add("open");
    openPop = pop;
  }

  const guideModal = document.getElementById("guideModal");
  document.getElementById("guideClose").addEventListener("click", () => guideModal.classList.remove("show"));
  guideModal.addEventListener("click", (e) => {
    if (e.target === guideModal) guideModal.classList.remove("show");
  });

  function openGuide(unitId) {
    const u = units.find((x) => x.id === unitId);
    document.getElementById("guideBody").innerHTML = `
      <div class="ex-label">📖 Guia · Nível ${u.level}</div>
      <h2>${u.icon} ${escapeHtml(u.title)}</h2>
      <div class="tip-box">💡 ${escapeHtml(u.tip)}</div>
      ${u.words
        .map(
          (w) => `
        <div class="vocab-row">
          <button class="speak-btn" data-say="${escapeHtml(w.en)}" aria-label="Ouvir">🔊</button>
          <div>
            <div class="word">${escapeHtml(w.en)}</div>
            <div class="meaning">${escapeHtml(w.pt)}</div>
            <div class="example">
              <button class="speak-btn" data-say="${escapeHtml(w.ex)}" aria-label="Ouvir exemplo" style="width:28px;height:28px;font-size:1rem">🔊</button>
              "${escapeHtml(w.ex)}" — ${escapeHtml(w.exPt)}
            </div>
          </div>
        </div>`
        )
        .join("")}
    `;
    document.querySelectorAll("#guideBody [data-say]").forEach((b) => b.addEventListener("click", () => Sounds.say(b.dataset.say)));
    guideModal.classList.add("show");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
