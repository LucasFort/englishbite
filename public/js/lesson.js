(async function () {
  Api.requireAuth();

  const unitId = new URLSearchParams(window.location.search).get("unit");
  const body = document.getElementById("lessonBody");
  const progressFill = document.getElementById("progressFill");
  const heartsBox = document.getElementById("heartsBox");
  const heartsVal = document.getElementById("heartsVal");
  const footer = document.getElementById("footer");
  const mainBtn = document.getElementById("mainBtn");
  const skipBtn = document.getElementById("skipBtn");
  const fbBadge = document.getElementById("fbBadge");
  const fbTitle = document.getElementById("fbTitle");
  const fbDetail = document.getElementById("fbDetail");
  const quitModal = document.getElementById("quitModal");

  const MAX_HEARTS = 5;
  const PRAISE = ["Excelente!", "Muito bem!", "Isso aí!", "Mandou bem!", "Perfeito!", "Incrível!"];

  let lesson = null;
  let isReview = false;
  try {
    const [lessons, progress] = await Promise.all([
      fetch("data/lessons.json").then((r) => r.json()),
      Api.request("/api/progress", { auth: true }).catch(() => null),
    ]);
    lesson = lessons.find((l) => l.id === unitId);
    isReview = !!(progress && (progress.completedUnits || []).includes(unitId));
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red-dark)">Não foi possível carregar a lição.</p>`;
    return;
  }
  if (!lesson) {
    body.innerHTML = `<p style="color:var(--red-dark)">Lição não encontrada.</p>`;
    return;
  }
  document.title = lesson.title + " — EnglishBite";

  const canSpeak = Sounds.canSpeak();
  let listeningOff = false;
  const queue = buildQueue(lesson);
  const total = queue.length;
  let solved = 0;
  let hearts = MAX_HEARTS;
  let mistakes = 0;
  let firstTry = 0;
  let ex = null; // exercício atual
  let state = "answering"; // answering | checked | done
  const startedAt = Date.now();

  document.getElementById("quitBtn").addEventListener("click", () => {
    if (state === "done") window.location.href = "home.html";
    else quitModal.classList.add("show");
  });
  document.getElementById("stayBtn").addEventListener("click", () => quitModal.classList.remove("show"));

  mainBtn.addEventListener("click", onMain);
  skipBtn.addEventListener("click", () => {
    if (state !== "answering" || !ex || ex.type !== "listen") return;
    listeningOff = true; // "Não posso ouvir agora": pula os exercícios de áudio, sem perder vida
    if (!ex.redo) solved++;
    next();
  });

  document.addEventListener("keydown", (e) => {
    if (quitModal.classList.contains("show")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (!mainBtn.disabled) mainBtn.click();
      return;
    }
    if (state !== "answering") return;
    if (/^[0-9]$/.test(e.key)) {
      const n = e.key === "0" ? 10 : Number(e.key);
      const opts = body.querySelectorAll(".option:not(:disabled), .word-bank .tile:not(.used)");
      if (opts[n - 1]) opts[n - 1].click();
    } else if (e.key === "Backspace") {
      const placed = body.querySelectorAll(".answer-line .tile");
      if (placed.length) placed[placed.length - 1].click();
    }
  });

  // ---------- Montagem da lição ----------
  function buildQueue(l) {
    const v = shuffle(l.vocabulary.slice());
    const buildable = shuffle(v.filter((w) => !/[\/()]/.test(w.word) && tokens(w.word).length >= 2));
    const q = [];
    const add = (x) => x && q.push(x);
    add({ type: "meaning", item: v[0], isNew: true });
    add({ type: "meaning", item: v[1], isNew: true });
    if (canSpeak) add({ type: "listen", item: v[2] });
    if (buildable[0]) add({ type: "translate", item: buildable[0] });
    add({ type: "match", items: v.slice(0, 5) });
    add({ type: "meaning", item: v[3], isNew: true });
    if (canSpeak && v[4]) add({ type: "listen", item: v[4] });
    if (buildable[1]) add({ type: "translate", item: buildable[1] });
    if (v[5]) add({ type: "meaning", item: v[5], isNew: true });
    l.quiz.forEach((item) => add({ type: "quiz", item }));
    return q.filter((x) => x.item || x.items);
  }

  // ---------- Fluxo ----------
  function next() {
    if (hearts <= 0) return finish(false);
    ex = queue.shift();
    while (ex && ex.type === "listen" && listeningOff) {
      if (!ex.redo) solved++;
      ex = queue.shift();
    }
    if (!ex) return finish(true);

    state = "answering";
    footer.className = "lesson-footer";
    mainBtn.textContent = "Verificar";
    mainBtn.disabled = true;
    skipBtn.style.visibility = ex.type === "listen" ? "visible" : "hidden";
    skipBtn.textContent = "Não posso ouvir agora";
    updateProgress();
    body.style.pointerEvents = "";
    RENDER[ex.type](ex);
    window.scrollTo(0, 0);
  }

  function onMain() {
    if (state === "answering") {
      const res = ex.check();
      showResult(res);
    } else if (state === "checked") {
      next();
    } else if (state === "done") {
      ex.onDone();
    }
  }

  function setReady(ready) {
    if (state === "answering") mainBtn.disabled = !ready;
  }

  function showResult({ ok, answer, speak }) {
    state = "checked";
    body.style.pointerEvents = "none";
    mainBtn.disabled = false;
    mainBtn.textContent = "Continuar";
    if (ok) {
      solved++;
      if (!ex.redo) firstTry++;
      Sounds.correct();
      footer.className = "lesson-footer correct";
      fbBadge.textContent = "✓";
      fbTitle.textContent = pick(PRAISE);
      fbDetail.textContent = ex.type === "quiz" && ex.item.explanation ? ex.item.explanation : "";
      if (speak) setTimeout(() => Sounds.say(speak), 250);
    } else {
      hearts = Math.max(0, hearts - 1);
      mistakes++;
      Sounds.wrong();
      renderHearts(true);
      footer.className = "lesson-footer wrong";
      fbBadge.textContent = "✕";
      fbTitle.textContent = "Resposta correta:";
      fbDetail.textContent = answer + (ex.type === "quiz" && ex.item.explanation ? " — " + ex.item.explanation : "");
      queue.push(Object.assign({}, ex, { redo: true })); // o erro volta no fim da lição
    }
    updateProgress();
  }

  function updateProgress() {
    progressFill.style.width = Math.min(100, Math.round((solved / total) * 100)) + "%";
  }

  function renderHearts(bump) {
    heartsVal.textContent = hearts;
    if (bump) {
      heartsBox.classList.remove("bump");
      void heartsBox.offsetWidth;
      heartsBox.classList.add("bump");
    }
  }

  // ---------- Tipos de exercício ----------
  const RENDER = {
    meaning(e) {
      const w = e.item;
      const opts = shuffle([w.meaning, ...sample(lesson.vocabulary.filter((x) => x !== w).map((x) => x.meaning), 3)]);
      body.innerHTML = `
        <div class="question-card">
          ${label(e, e.isNew ? "✨ Nova palavra" : "")}
          <h2>O que significa?</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech">
              <button class="speak-btn" data-say aria-label="Ouvir">🔊</button>
              <span>${esc(w.word)}</span>
            </div>
          </div>
          <div class="options">${opts.map(optionHtml).join("")}</div>
        </div>`;
      body.querySelector("[data-say]").addEventListener("click", () => Sounds.say(speakable(w.word)));
      Sounds.say(speakable(w.word));
      const choose = singleChoice(opts);
      e.check = () => ({ ok: opts[choose()] === w.meaning, answer: w.meaning });
    },

    listen(e) {
      const w = e.item;
      const opts = shuffle([w.word, ...sample(lesson.vocabulary.filter((x) => x !== w).map((x) => x.word), 3)]);
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🎧 Escuta")}
          <h2>Toque no que você ouvir</h2>
          <div class="speak-big">
            <button data-say aria-label="Ouvir">🔊</button>
            <button data-say-slow class="slow" aria-label="Ouvir devagar">🐢</button>
          </div>
          <div class="options">${opts.map(optionHtml).join("")}</div>
        </div>`;
      body.querySelector("[data-say]").addEventListener("click", () => Sounds.say(speakable(w.word)));
      body.querySelector("[data-say-slow]").addEventListener("click", () => Sounds.say(speakable(w.word), true));
      setTimeout(() => Sounds.say(speakable(w.word)), 300);
      const choose = singleChoice(opts);
      e.check = () => ({ ok: opts[choose()] === w.word, answer: w.word });
    },

    translate(e) {
      const w = e.item;
      const answerTokens = tokens(w.word);
      const lower = new Set(answerTokens.map((t) => t.toLowerCase()));
      const pool = [];
      lesson.vocabulary.forEach((x) => {
        if (x === w || /[\/()]/.test(x.word)) return;
        tokens(x.word).forEach((t) => {
          if (!lower.has(t.toLowerCase()) && !pool.some((p) => p.toLowerCase() === t.toLowerCase())) pool.push(t);
        });
      });
      const bank = shuffle([...answerTokens, ...sample(pool, Math.min(3, pool.length))]);

      body.innerHTML = `
        <div class="question-card">
          ${label(e, "✍️ Tradução")}
          <h2>Escreva isso em inglês</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech"><span>${esc(w.meaning)}</span></div>
          </div>
          <div class="answer-line" id="answerLine"></div>
          <div class="word-bank" id="wordBank">
            ${bank.map((t, i) => `<button class="tile" data-i="${i}">${esc(t)}</button>`).join("")}
          </div>
        </div>`;

      const line = body.querySelector("#answerLine");
      const placed = [];
      body.querySelectorAll("#wordBank .tile").forEach((src) => {
        src.addEventListener("click", () => {
          if (src.classList.contains("used")) return;
          Sounds.select();
          src.classList.add("used");
          const i = Number(src.dataset.i);
          placed.push(i);
          const chip = document.createElement("button");
          chip.className = "tile";
          chip.textContent = bank[i];
          chip.addEventListener("click", () => {
            placed.splice(placed.indexOf(i), 1);
            chip.remove();
            src.classList.remove("used");
            setReady(placed.length > 0);
          });
          line.appendChild(chip);
          setReady(true);
        });
      });
      e.check = () => ({
        ok: placed.map((i) => bank[i].toLowerCase()).join(" ") === answerTokens.map((t) => t.toLowerCase()).join(" "),
        answer: w.word,
        speak: w.word,
      });
    },

    match(e) {
      const pairs = e.items;
      const left = shuffle(pairs.map((p, i) => ({ text: p.word, i })));
      const right = shuffle(pairs.map((p, i) => ({ text: p.meaning, i })));
      let n = 0;
      const btn = (x, side) => {
        n++;
        return `<button class="option" data-side="${side}" data-i="${x.i}"><span class="key">${n % 10}</span><span>${esc(x.text)}</span></button>`;
      };
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🧩 Pares")}
          <h2>Toque nos pares correspondentes</h2>
          <div class="match-grid">
            <div class="match-col">${left.map((x) => btn(x, "L")).join("")}</div>
            <div class="match-col">${right.map((x) => btn(x, "R")).join("")}</div>
          </div>
        </div>`;

      let sel = { L: null, R: null };
      let matched = 0;
      body.querySelectorAll(".match-grid .option").forEach((b) => {
        b.addEventListener("click", () => {
          if (b.disabled) return;
          const side = b.dataset.side;
          if (sel[side]) sel[side].classList.remove("selected");
          sel[side] = b;
          b.classList.add("selected");
          if (side === "L") Sounds.say(speakable(pairs[b.dataset.i].word));
          if (!sel.L || !sel.R) return Sounds.select();

          const a = sel.L;
          const c = sel.R;
          sel = { L: null, R: null };
          if (a.dataset.i === c.dataset.i) {
            [a, c].forEach((x) => {
              x.classList.remove("selected");
              x.classList.add("correct");
              x.disabled = true;
              setTimeout(() => {
                x.classList.remove("correct");
                x.classList.add("matched");
              }, 350);
            });
            matched++;
            if (matched === pairs.length) {
              setTimeout(() => showResult({ ok: true }), 400);
            } else {
              Sounds.select();
            }
          } else {
            Sounds.wrong();
            [a, c].forEach((x) => {
              x.classList.remove("selected");
              x.classList.add("flash-wrong");
              setTimeout(() => x.classList.remove("flash-wrong"), 400);
            });
          }
        });
      });
      e.check = () => ({ ok: false, answer: "" }); // concluído automaticamente
    },

    quiz(e) {
      const q = e.item;
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "📝 Desafio")}
          <h2>${esc(q.question)}</h2>
          <div class="options">${q.options.map(optionHtml).join("")}</div>
        </div>`;
      const choose = singleChoice(q.options);
      e.check = () => ({ ok: choose() === q.answer, answer: q.options[q.answer] });
    },
  };

  function singleChoice(opts) {
    let chosen = -1;
    const buttons = body.querySelectorAll(".options .option");
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => {
        buttons.forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        chosen = i;
        Sounds.select();
        if (ex.type === "listen") Sounds.say(speakable(opts[i]));
        setReady(true);
      });
    });
    return () => chosen;
  }

  function optionHtml(text, i) {
    return `<button class="option"><span class="key">${i + 1}</span><span>${esc(text)}</span></button>`;
  }

  function label(e, text) {
    if (e.redo) return `<div class="ex-label redo">🔁 Erro anterior</div>`;
    return text ? `<div class="ex-label">${text}</div>` : "";
  }

  renderHearts();
  next();

  // ---------- Fim da lição ----------
  async function finish(passed) {
    state = "done";
    body.style.pointerEvents = "";
    skipBtn.style.visibility = "hidden";
    footer.className = "lesson-footer";
    mainBtn.disabled = false;
    ex = {};

    if (!passed) {
      Sounds.tryAgain();
      body.innerHTML = `
        <div class="result-card">
          <img class="mascot" src="img/bee.svg" alt="" style="filter:grayscale(.6)">
          <h2 class="fail">Você ficou sem vidas 💔</h2>
          <p class="sub">Tudo bem errar — é assim que se aprende. Que tal tentar de novo?</p>
        </div>`;
      mainBtn.textContent = "Tentar de novo";
      skipBtn.textContent = "Sair";
      skipBtn.style.visibility = "visible";
      skipBtn.onclick = () => (window.location.href = "home.html");
      ex.onDone = () => window.location.reload();
      return;
    }

    progressFill.style.width = "100%";
    Sounds.complete();
    const xpEarned = isReview ? 5 : 10 + (mistakes === 0 ? 5 : 0);
    const accuracy = Math.round((firstTry / total) * 100);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

    body.innerHTML = `
      <div class="result-card">
        <img class="mascot" src="img/bee.svg" alt="">
        <h2>${mistakes === 0 ? "Lição perfeita!" : "Lição concluída!"}</h2>
        <p class="sub">${mistakes === 0 ? "Nenhum erro — bônus de +5 XP! 🎉" : "Você mandou bem. Continue assim!"}</p>
        <div class="result-stats">
          <div class="result-stat" style="--tone:var(--gold)"><div class="label">Total de XP</div><div class="value">⚡ ${xpEarned}</div></div>
          <div class="result-stat" style="--tone:var(--green)"><div class="label">Precisão</div><div class="value">🎯 ${Math.min(100, accuracy)}%</div></div>
          <div class="result-stat" style="--tone:var(--blue)"><div class="label">Tempo</div><div class="value">⏱️ ${time}</div></div>
        </div>
      </div>`;
    mainBtn.textContent = "Continuar";
    mainBtn.disabled = true;
    ex.onDone = () => (window.location.href = "home.html");

    try {
      await Api.request("/api/progress", {
        method: "POST",
        auth: true,
        body: { unitId: lesson.id, xpEarned, passed: true },
      });
    } catch (err) {
      if (err.message === "UNAUTHORIZED") return Api.logout();
    }
    mainBtn.disabled = false;
  }

  // ---------- Utilidades ----------
  function tokens(s) {
    return s.replace(/[?!.,;:]/g, "").split(/\s+/).filter(Boolean);
  }
  function speakable(s) {
    return s.replace(/\s*\/\s*/g, ", ");
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sample(a, n) {
    return shuffle(Array.from(new Set(a))).slice(0, n);
  }
  function pick(a) {
    return a[Math.floor(Math.random() * a.length)];
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
