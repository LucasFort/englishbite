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
    const cur = steps[currentIndex === -1 ? steps.length - 1 : currentIndex];
    const html = `
      <div class="stat level" title="Seu nível atual">🌎 ${cur.unit.level}</div>
      <div class="stat streak ${s.today ? "" : "off"}" title="Ofensiva: dias seguidos estudando"><span class="ico">🔥</span>${s.value}</div>
      <div class="stat xp" title="Pontos de experiência"><span class="ico">⚡</span>${Number(progress.xp) || 0}</div>
      <div class="stat hearts" title="Vidas por lição"><span class="ico">❤️</span>5</div>
    `;
    document.querySelectorAll("[data-stats]").forEach((el) => (el.innerHTML = html));
  }

  function renderSide() {
    const count = steps.filter((s) => s.done).length;
    document.getElementById("progressText").textContent = `${count} de ${steps.length} fases concluídas`;
    document.getElementById("progressFill").style.width = Math.round((count / steps.length) * 100) + "%";
    const first = user && user.name ? user.name.split(" ")[0] : "";
    document.getElementById("helloName").textContent = first ? `Olá, ${first}!` : "Olá!";
    if (streakValue().today) {
      document.getElementById("helloText").textContent = "Você já estudou hoje. Continue assim! 🎉";
    }
  }

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
      end.innerHTML = `<h3>🏆 Você completou a trilha!</h3><p>Revise qualquer fase tocando nas estrelas.</p>`;
      pathEl.appendChild(end);
    }

    pathEl.querySelectorAll("[data-guide]").forEach((b) => b.addEventListener("click", () => openGuide(b.dataset.guide)));

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
