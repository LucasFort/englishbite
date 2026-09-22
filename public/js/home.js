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
  // Deslocamento horizontal dos nós, em zigue-zague
  const ZIGZAG = [0, 44, 70, 44, 0, -44, -70, -44];

  let lessons = [];
  let progress = { xp: 0, streak: 0, completedUnits: [] };

  try {
    const [lessonsRes, progressRes] = await Promise.all([
      fetch("data/lessons.json").then((r) => r.json()),
      Api.request("/api/progress", { auth: true }),
    ]);
    lessons = lessonsRes;
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

  const completed = new Set(progress.completedUnits || []);
  const currentIndex = lessons.findIndex((l) => !completed.has(l.id));

  renderStats();
  renderSide();
  renderPath();

  function streakValue() {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const active = progress.lastActiveDate === today || progress.lastActiveDate === yesterday;
    return { value: active ? Number(progress.streak) || 0 : 0, today: progress.lastActiveDate === today };
  }

  function renderStats() {
    const s = streakValue();
    const levelLabel = { iniciante: "A1", intermediario: "A2", avancado: "B1" }[progress.level] || "EN";
    const html = `
      <div class="stat level" title="Curso de inglês">🌎 ${levelLabel}</div>
      <div class="stat streak ${s.today ? "" : "off"}" title="Ofensiva: dias seguidos estudando"><span class="ico">🔥</span>${s.value}</div>
      <div class="stat xp" title="Pontos de experiência"><span class="ico">⚡</span>${Number(progress.xp) || 0}</div>
      <div class="stat hearts" title="Vidas por lição"><span class="ico">❤️</span>5</div>
    `;
    document.querySelectorAll("[data-stats]").forEach((el) => (el.innerHTML = html));
  }

  function renderSide() {
    const done = lessons.filter((l) => completed.has(l.id)).length;
    document.getElementById("progressText").textContent = `${done} de ${lessons.length} lições concluídas`;
    document.getElementById("progressFill").style.width = Math.round((done / lessons.length) * 100) + "%";
    const first = user && user.name ? user.name.split(" ")[0] : "";
    document.getElementById("helloName").textContent = first ? `Olá, ${first}!` : "Olá!";
    if (streakValue().today) {
      document.getElementById("helloText").textContent = "Você já estudou hoje. Continue assim! 🎉";
    }
  }

  function renderPath() {
    const pathEl = document.getElementById("path");
    pathEl.innerHTML = "";

    const groups = [];
    lessons.forEach((lesson, i) => {
      let g = groups[groups.length - 1];
      if (!g || g.level !== lesson.level) {
        g = { level: lesson.level, items: [] };
        groups.push(g);
      }
      g.items.push({ lesson, i });
    });

    groups.forEach((g, gi) => {
      const meta = SECTIONS[g.level] || { n: gi + 1, name: "Nível " + g.level, tone: "tone-green" };
      const section = document.createElement("section");
      section.className = "path-section " + meta.tone;
      section.innerHTML = `
        <div class="section-banner ${meta.tone}">
          <div>
            <div class="over">Seção ${meta.n} · Nível ${g.level}</div>
            <h2>${meta.name}</h2>
          </div>
          <button class="guide" data-guide="${g.level}">📖 Guia</button>
        </div>
        <div class="path-nodes"></div>
      `;
      pathEl.appendChild(section);

      const nodesEl = section.querySelector(".path-nodes");
      g.items.forEach(({ lesson, i }, k) => {
        const isDone = completed.has(lesson.id);
        const isCurrent = i === currentIndex;
        const isLocked = !isDone && !isCurrent;
        const offset = ZIGZAG[k % ZIGZAG.length];

        const wrap = document.createElement("div");
        wrap.className = "node-wrap";
        wrap.style.transform = `translateX(${offset}px)`;
        wrap.dataset.offset = offset;
        wrap.innerHTML = `
          ${isCurrent ? '<div class="node-bubble">Começar</div>' : ""}
          <button class="lesson-node ${isDone ? "done" : ""} ${isCurrent ? "current" : ""} ${isLocked ? "locked" : ""}"
                  aria-label="${escapeHtml(lesson.title)}">
            <span class="emoji">${isDone ? "⭐" : isLocked ? "🔒" : lesson.icon}</span>
          </button>
        `;
        wrap.querySelector(".lesson-node").addEventListener("click", (e) => {
          e.stopPropagation();
          togglePop(wrap, lesson, { isDone, isLocked, index: i });
        });
        nodesEl.appendChild(wrap);
      });

      // Mascote ao lado da trilha, do lado oposto à curva
      const mascot = document.createElement("img");
      mascot.src = "img/bee.svg";
      mascot.alt = "";
      const sectionLocked = currentIndex !== -1 && g.items.every(({ i }) => i > currentIndex);
      mascot.className = "path-mascot " + (gi % 2 === 0 ? "left" : "right") + (sectionLocked ? " sleepy" : "");
      nodesEl.appendChild(mascot);
    });

    if (currentIndex === -1) {
      const end = document.createElement("div");
      end.className = "card";
      end.style.textAlign = "center";
      end.innerHTML = `<h3>🏆 Você completou a trilha!</h3><p>Revise qualquer lição tocando nas estrelas.</p>`;
      pathEl.appendChild(end);
    }

    pathEl.querySelectorAll("[data-guide]").forEach((b) =>
      b.addEventListener("click", () => openGuide(b.dataset.guide))
    );

    const current = pathEl.querySelector(".lesson-node.current");
    if (current) current.scrollIntoView({ block: "center" });
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

  function togglePop(wrap, lesson, { isDone, isLocked, index }) {
    const already = openPop && openPop.parentElement === wrap;
    closePop();
    if (already) return;

    const pop = document.createElement("div");
    pop.className = "node-pop" + (isLocked ? " locked" : "");
    // Compensa o zigue-zague para o balão ficar centralizado na trilha
    pop.style.setProperty("--shift", wrap.dataset.offset + "px");
    pop.addEventListener("click", (e) => e.stopPropagation());
    if (isLocked) {
      pop.innerHTML = `
        <h3>${escapeHtml(lesson.title)}</h3>
        <p>Complete todas as lições anteriores para desbloquear esta!</p>
        <button class="btn" disabled>Bloqueada</button>`;
    } else {
      pop.innerHTML = `
        <h3>${escapeHtml(lesson.title)}</h3>
        <p>Lição ${index + 1} de ${lessons.length}</p>
        <a class="btn" href="lesson.html?unit=${encodeURIComponent(lesson.id)}">${isDone ? "Revisar +5 XP" : "Começar +10 XP"}</a>`;
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

  function openGuide(level) {
    const items = lessons.filter((l) => l.level === level);
    document.getElementById("guideBody").innerHTML = `
      <div class="ex-label">📖 Guia · Nível ${level}</div>
      ${items
        .map(
          (l) => `
        <h2>${l.icon} ${escapeHtml(l.title)}</h2>
        <div class="tip-box">💡 ${escapeHtml(l.tip)}</div>
        ${l.vocabulary
          .map(
            (v) => `
          <div class="vocab-row">
            <button class="speak-btn" data-say="${escapeHtml(v.word)}" aria-label="Ouvir">🔊</button>
            <div>
              <div class="word">${escapeHtml(v.word)}</div>
              <div class="meaning">${escapeHtml(v.meaning)}</div>
              <div class="example">"${escapeHtml(v.example)}"</div>
            </div>
          </div>`
          )
          .join("")}`
        )
        .join('<div style="height:24px"></div>')}
    `;
    document.querySelectorAll("#guideBody [data-say]").forEach((b) =>
      b.addEventListener("click", () => Sounds.say(b.dataset.say))
    );
    guideModal.classList.add("show");
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
