(async function () {
  Api.requireAuth();

  const params = new URLSearchParams(window.location.search);
  const unitId = params.get("unit");
  const node = params.get("node") || "1";
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
  const NODE_INFO = {
    1: { label: "Aprender · parte 1", xp: 10 },
    2: { label: "Aprender · parte 2", xp: 10 },
    practice: { label: "Prática", xp: 10 },
    call: { label: "Chamada com a Bibi", xp: 15 },
    test: { label: "Desafio da unidade", xp: 20 },
  };

  let unit = null;
  let isReview = false;
  try {
    const [units, progress] = await Promise.all([
      fetch("data/lessons.json").then((r) => r.json()),
      Api.request("/api/progress", { auth: true }).catch(() => null),
    ]);
    unit = units.find((u) => u.id === unitId);
    const done = (progress && progress.completedUnits) || [];
    isReview = done.includes(`${unitId}:${node}`) || done.includes(unitId);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red-dark)">Não foi possível carregar a lição.</p>`;
    return;
  }
  if (!unit || !NODE_INFO[node]) {
    body.innerHTML = `<p style="color:var(--red-dark)">Lição não encontrada.</p>`;
    return;
  }
  document.title = `${unit.title} — EnglishBite`;
  Sounds.preload(unit.words.map((w) => w.en));

  document.getElementById("quitBtn").addEventListener("click", () => {
    if (state === "done" || state === "intro") window.location.href = "home.html";
    else quitModal.classList.add("show");
  });
  document.getElementById("stayBtn").addEventListener("click", () => quitModal.classList.remove("show"));

  let state = "intro"; // intro | answering | checked | done
  let ex = null; // exercício atual
  if (node === "call") return runCall();

  // ======================================================================
  //  Lições com exercícios
  // ======================================================================
  const canSpeak = Mic.supported() || Mic.canRecord();
  let speakingOff = !canSpeak;
  const queue = buildQueue();
  const total = queue.length;
  let solved = 0;
  let hearts = MAX_HEARTS;
  let mistakes = 0;
  let firstTry = 0;
  let skipped = 0;
  let startedAt = Date.now();

  mainBtn.addEventListener("click", onMain);
  skipBtn.addEventListener("click", () => {
    if (state !== "answering" || !ex || ex.type !== "speak") return;
    Mic.stop();
    speakingOff = true; // "Não posso falar agora": pula os exercícios de fala, sem perder vida
    if (!ex.redo) {
      solved++;
      skipped++;
    }
    next();
  });

  document.addEventListener("keydown", (e) => {
    if (quitModal.classList.contains("show")) return;
    const typing = e.target.matches && e.target.matches("input, textarea");
    if (e.key === "Enter") {
      e.preventDefault();
      if (!mainBtn.disabled) mainBtn.click();
      return;
    }
    if (typing || state !== "answering") return;
    if (/^[0-9]$/.test(e.key)) {
      const n = e.key === "0" ? 10 : Number(e.key);
      const opts = body.querySelectorAll(".option:not(:disabled), .word-bank .tile:not(.used)");
      if (opts[n - 1]) opts[n - 1].click();
    } else if (e.key === "Backspace") {
      const placed = body.querySelectorAll(".answer-line .tile");
      if (placed.length) placed[placed.length - 1].click();
    }
  });

  renderIntro();

  // ---------- Montagem da fase ----------
  function buildQueue() {
    const W = unit.words;
    const q = [];
    const add = (x) => x && q.push(x);
    if (node === "1" || node === "2") {
      const ws = node === "1" ? W.slice(0, 4) : W.slice(4, 8);
      const multi = ws.find((w) => tokens(w.en).length >= 2) || ws[3];
      add({ type: "meaning", item: ws[0], isNew: true });
      add({ type: "meaning", item: ws[1], isNew: true });
      add({ type: "listen", item: ws[0] });
      add({ type: "meaning", item: ws[2], isNew: true });
      add({ type: "meaning", item: ws[3], isNew: true });
      add({ type: "match", items: ws });
      add({ type: "type", en: ws[1].en, pt: ws[1].pt });
      add({ type: "speak", en: ws[2].en, pt: ws[2].pt });
      add({ type: "listen", item: ws[3] });
      add({ type: "translate", en: multi.en, pt: multi.pt });
      add({ type: "dictation", en: ws[2].en });
      add({ type: "speak", en: ws[0].en, pt: ws[0].pt });
    } else if (node === "practice") {
      const ws = shuffle(W.slice());
      add({ type: "translate", en: ws[0].ex, pt: ws[0].exPt });
      add({ type: "dictation", en: ws[1].ex });
      add({ type: "speak", en: ws[2].ex, pt: ws[2].exPt });
      add({ type: "type", en: ws[3].en, pt: ws[3].pt });
      add({ type: "listen", item: ws[4], example: true });
      add({ type: "match", items: shuffle(W.slice()).slice(0, 5) });
      add({ type: "translate", en: ws[5].ex, pt: ws[5].exPt });
      add({ type: "speak", en: ws[6].ex, pt: ws[6].exPt });
      add({ type: "type", en: ws[7].en, pt: ws[7].pt });
      add({ type: "dictation", en: ws[3].ex });
      add({ type: "meaning", item: ws[4] });
    } else if (node === "test") {
      const ws = shuffle(W.slice());
      unit.quiz.forEach((item) => add({ type: "quiz", item }));
      add({ type: "type", en: ws[0].en, pt: ws[0].pt });
      add({ type: "listen", item: ws[1], example: true });
      add({ type: "speak", en: ws[2].ex, pt: ws[2].exPt });
      add({ type: "translate", en: ws[3].ex, pt: ws[3].exPt });
      add({ type: "dictation", en: ws[4].en });
      add({ type: "meaning", item: ws[5] });
      shuffle(q);
    }
    return q.filter((x) => !(x.type === "speak" && !canSpeak));
  }

  function renderIntro() {
    const info = NODE_INFO[node];
    let content = "";
    if (node === "1" || node === "2") {
      const ws = node === "1" ? unit.words.slice(0, 4) : unit.words.slice(4, 8);
      content = `
        <p class="sub">Você vai aprender estas expressões:</p>
        <div class="card" style="text-align:left">
          ${ws
            .map(
              (w) => `
            <div class="vocab-row" style="border-top:none;padding:8px 0">
              <button class="speak-btn" data-say="${esc(w.en)}" aria-label="Ouvir">🔊</button>
              <div><div class="word">${esc(w.en)}</div><div class="meaning">${esc(w.pt)}</div></div>
            </div>`
            )
            .join("")}
        </div>
        <div class="tip-box" style="text-align:left">💡 ${esc(unit.tip)}</div>`;
    } else if (node === "practice") {
      content = `<p class="sub">Hora de usar as expressões em frases completas: escutar, escrever e falar.</p>`;
    } else {
      content = `<p class="sub">Mostre o que você aprendeu na unidade. Cuidado com as vidas! ❤️</p>`;
    }
    body.innerHTML = `
      <div class="result-card">
        <img class="mascot" src="img/bee.svg" alt="" style="width:120px">
        <div class="ex-label" style="justify-content:center;display:flex">${unit.icon} ${esc(unit.title)} · ${info.label}</div>
        <h2 style="color:var(--title)">${node === "test" ? "Desafio da unidade 🏆" : node === "practice" ? "Vamos praticar! 💪" : "Novas palavras ✨"}</h2>
        ${content}
        ${Mic.supported() ? "" : `<p class="sub" style="font-size:.9rem">🎤 Seu navegador não reconhece fala. Nos exercícios de pronúncia você grava a sua voz e compara com a da Bibi. Para correção automática, use o Chrome ou o Edge.</p>`}
      </div>`;
    body.querySelectorAll("[data-say]").forEach((b) => b.addEventListener("click", () => Sounds.say(b.dataset.say)));
    footer.className = "lesson-footer";
    skipBtn.style.visibility = "hidden";
    mainBtn.textContent = "Começar";
    mainBtn.disabled = false;
    progressFill.style.width = "0%";
    renderHearts();
  }

  // ---------- Fluxo ----------
  function next() {
    if (hearts <= 0) return finish(false);
    ex = queue.shift();
    while (ex && ex.type === "speak" && speakingOff) {
      if (!ex.redo) {
        solved++;
        skipped++;
      }
      ex = queue.shift();
    }
    if (!ex) return finish(true);

    state = "answering";
    Sounds.stop();
    Mic.stop();
    footer.className = "lesson-footer";
    mainBtn.textContent = "Verificar";
    mainBtn.disabled = true;
    skipBtn.style.visibility = ex.type === "speak" ? "visible" : "hidden";
    skipBtn.textContent = "Não posso falar agora";
    updateProgress();
    body.style.pointerEvents = "";
    RENDER[ex.type](ex);
    window.scrollTo(0, 0);
    const input = body.querySelector("textarea");
    if (input) setTimeout(() => input.focus(), 50);
  }

  function onMain() {
    if (state === "intro") {
      Sounds.unlock();
      startedAt = Date.now();
      next();
    } else if (state === "answering") {
      showResult(ex.check());
    } else if (state === "checked") {
      next();
    } else if (state === "done") {
      ex.onDone();
    }
  }

  function setReady(ready) {
    if (state === "answering") mainBtn.disabled = !ready;
  }

  function showResult({ ok, answer, speak, note, soft }) {
    state = "checked";
    Mic.stop();
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
      fbDetail.textContent = note || (ex.type === "quiz" && ex.item.explanation ? ex.item.explanation : "");
      if (speak) setTimeout(() => Sounds.say(speak), 250);
    } else if (soft) {
      // fala não reconhecida: não tira vida
      solved++;
      Sounds.tryAgain();
      footer.className = "lesson-footer wrong";
      fbBadge.textContent = "🎤";
      fbTitle.textContent = "Vamos seguir!";
      fbDetail.textContent = note || "";
    } else {
      hearts = Math.max(0, hearts - 1);
      mistakes++;
      Sounds.wrong();
      renderHearts(true);
      footer.className = "lesson-footer wrong";
      fbBadge.textContent = "✕";
      fbTitle.textContent = "Resposta correta:";
      fbDetail.textContent = answer + (ex.type === "quiz" && ex.item.explanation ? " — " + ex.item.explanation : "");
      queue.push(Object.assign({}, ex, { redo: true })); // o erro volta no fim da fase
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
      const opts = shuffle([w.pt, ...sample(unit.words.filter((x) => x !== w).map((x) => x.pt), 3)]);
      body.innerHTML = `
        <div class="question-card">
          ${label(e, e.isNew ? "✨ Nova palavra" : "📖 Significado")}
          <h2>O que significa?</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech">
              <button class="speak-btn" data-say aria-label="Ouvir">🔊</button>
              <span>${esc(w.en)}</span>
            </div>
          </div>
          <div class="options">${opts.map(optionHtml).join("")}</div>
        </div>`;
      body.querySelector("[data-say]").addEventListener("click", () => Sounds.say(w.en));
      Sounds.say(w.en);
      const choose = singleChoice(opts);
      e.check = () => ({ ok: opts[choose()] === w.pt, answer: w.pt });
    },

    listen(e) {
      const w = e.item;
      const field = e.example ? "ex" : "en";
      const target = w[field];
      const opts = shuffle([target, ...sample(unit.words.filter((x) => x !== w).map((x) => x[field]), 3)]);
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🎧 Escuta")}
          <h2>Toque no que você ouvir</h2>
          ${speakBig()}
          <div class="options">${opts.map(optionHtml).join("")}</div>
        </div>`;
      bindSpeakBig(target);
      const choose = singleChoice(opts, true);
      e.check = () => ({ ok: opts[choose()] === target, answer: target });
    },

    translate(e) {
      const answerTokens = tokens(e.en);
      const lower = new Set(answerTokens.map((t) => t.toLowerCase()));
      const pool = [];
      unit.words.forEach((x) => {
        tokens(x.ex).concat(tokens(x.en)).forEach((t) => {
          const k = t.toLowerCase();
          if (!lower.has(k) && !pool.some((p) => p.toLowerCase() === k)) pool.push(t);
        });
      });
      const bank = shuffle([...answerTokens, ...sample(pool, Math.min(answerTokens.length > 5 ? 4 : 3, pool.length))]);

      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🧱 Monte a frase")}
          <h2>Escreva isso em inglês</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech"><span>${esc(e.pt)}</span></div>
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
        answer: e.en,
        speak: e.en,
      });
    },

    type(e) {
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "✍️ Escrita")}
          <h2>Escreva em inglês</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech"><span>${esc(e.pt)}</span></div>
          </div>
          <textarea class="type-box" id="typeBox" rows="3" placeholder="Digite em inglês" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        </div>`;
      const box = body.querySelector("#typeBox");
      box.addEventListener("input", () => setReady(box.value.trim().length > 0));
      e.check = () => Object.assign(compareTyped(box.value, e.en), { speak: e.en });
    },

    dictation(e) {
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🎧 Ditado")}
          <h2>Digite o que você ouvir</h2>
          ${speakBig()}
          <textarea class="type-box" id="typeBox" rows="3" placeholder="Digite em inglês" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        </div>`;
      bindSpeakBig(e.en);
      const box = body.querySelector("#typeBox");
      box.addEventListener("input", () => setReady(box.value.trim().length > 0));
      e.check = () => compareTyped(box.value, e.en);
    },

    speak(e) {
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🎤 Pronúncia")}
          <h2>Fale esta frase</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech">
              <button class="speak-btn" data-say aria-label="Ouvir">🔊</button>
              <div><div>${esc(e.en)}</div><div class="speech-pt">${esc(e.pt)}</div></div>
            </div>
          </div>
          <div class="mic-area" id="micArea"></div>
        </div>`;
      body.querySelector("[data-say]").addEventListener("click", () => Sounds.say(e.en));
      let tries = 0;
      micWidget(body.querySelector("#micArea"), {
        hint: "Toque no microfone e fale a frase em inglês",
        compareText: e.en,
        onCompareOk: () => showResult({ ok: true, note: "Muito bem! Continue treinando a pronúncia." }),
        onHeard(heard, status) {
          if (state !== "answering") return;
          const best = bestMatch(heard, e.en);
          if (best.score >= 0.7) return showResult({ ok: true, note: `Você disse: “${best.text}”` });
          tries++;
          if (tries >= 3) {
            return showResult({ soft: true, note: heard.length ? `Entendi: “${best.text}”. Ouça a Bibi e tente de novo depois!` : "Não consegui te ouvir. Verifique o microfone." });
          }
          status.innerHTML = heard.length
            ? `Entendi: “${esc(best.text)}”<br><b>Quase! Ouça a Bibi (🔊) e tente de novo.</b>`
            : "<b>Não ouvi nada.</b> Fale um pouco mais alto e mais perto do microfone.";
        },
      });
      e.check = () => ({ ok: false, answer: e.en });
    },

    match(e) {
      const pairs = e.items;
      const left = shuffle(pairs.map((p, i) => ({ text: p.en, i })));
      const right = shuffle(pairs.map((p, i) => ({ text: p.pt, i })));
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
          if (side === "L") Sounds.say(pairs[b.dataset.i].en);
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
            if (matched === pairs.length) setTimeout(() => showResult({ ok: true }), 400);
            else Sounds.select();
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
      e.check = () => ({ ok: false, answer: "" });
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

  function speakBig() {
    return `
      <div class="speak-big">
        <button data-say aria-label="Ouvir">🔊</button>
        <button data-say-slow class="slow" aria-label="Ouvir devagar">🐢</button>
      </div>`;
  }
  function bindSpeakBig(text) {
    body.querySelector("[data-say]").addEventListener("click", () => Sounds.say(text));
    body.querySelector("[data-say-slow]").addEventListener("click", () => Sounds.say(text, true));
    setTimeout(() => Sounds.say(text), 250);
  }

  function singleChoice(opts, sayOptions) {
    let chosen = -1;
    const buttons = body.querySelectorAll(".options .option");
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => {
        buttons.forEach((x) => x.classList.remove("selected"));
        b.classList.add("selected");
        chosen = i;
        Sounds.select();
        if (sayOptions) Sounds.say(opts[i]);
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

  // ---------- Fim da fase ----------
  async function finish(passed) {
    state = "done";
    Mic.stop();
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
    const xpEarned = isReview ? 5 : NODE_INFO[node].xp + (mistakes === 0 ? 5 : 0);
    const accuracy = Math.round((firstTry / Math.max(1, total - skipped)) * 100);
    const secs = Math.round((Date.now() - startedAt) / 1000);
    showDone({
      title: mistakes === 0 ? "Fase perfeita!" : "Fase concluída!",
      sub: mistakes === 0 && !isReview ? "Nenhum erro — bônus de +5 XP! 🎉" : "Você mandou bem. Continue assim!",
      xpEarned,
      stat2: { label: "Precisão", value: `🎯 ${Math.min(100, accuracy)}%` },
      secs,
    });
  }

  function showDone({ title, sub, xpEarned, stat2, secs }) {
    state = "done";
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    body.innerHTML = `
      <div class="result-card">
        <img class="mascot" src="img/bee.svg" alt="">
        <h2>${title}</h2>
        <p class="sub">${sub}</p>
        <div class="result-stats">
          <div class="result-stat" style="--tone:var(--gold)"><div class="label">Total de XP</div><div class="value">⚡ ${xpEarned}</div></div>
          <div class="result-stat" style="--tone:var(--green)"><div class="label">${stat2.label}</div><div class="value">${stat2.value}</div></div>
          <div class="result-stat" style="--tone:var(--blue)"><div class="label">Tempo</div><div class="value">⏱️ ${time}</div></div>
        </div>
      </div>`;
    footer.className = "lesson-footer";
    footer.style.display = "";
    skipBtn.style.visibility = "hidden";
    mainBtn.textContent = "Continuar";
    mainBtn.disabled = true;
    ex = { onDone: () => (window.location.href = "home.html") };
    if (!mainBtn.onclick && node === "call") mainBtn.onclick = () => ex.onDone();
    Api.request("/api/progress", {
      method: "POST",
      auth: true,
      body: { unitId: `${unit.id}:${node}`, xpEarned, passed: true },
    })
      .catch((err) => {
        if (err.message === "UNAUTHORIZED") Api.logout();
      })
      .finally(() => (mainBtn.disabled = false));
  }

  // ======================================================================
  //  Chamada com a Bibi
  // ======================================================================
  function runCall() {
    const call = unit.call;
    const canTalk = Mic.supported();
    let turn = 0;
    let startedCall = 0;
    let timer = null;
    let fails = 0;
    let firstTryOk = 0;

    heartsBox.style.visibility = "hidden";
    progressFill.style.width = "0%";
    footer.style.display = "none";
    body.innerHTML = `
      <div class="call-screen">
        <div class="call-card">
          <div class="call-avatar" id="avatar"><img src="img/bee.svg" alt="Bibi"></div>
          <div class="call-name">Bibi</div>
          <div class="call-sub" id="callSub">${esc(call.title)}</div>
          <button class="btn btn-block" id="dialBtn" style="max-width:300px;margin:24px auto 0">📞 Ligar para a Bibi</button>
          <p class="sub" style="margin-top:16px;font-size:.92rem">Converse com a Bibi em inglês. Ela fala, você responde${canTalk ? " falando no microfone" : " digitando"}. Use fone de ouvido se puder!</p>
        </div>
      </div>`;

    body.querySelector("#dialBtn").addEventListener("click", async () => {
      Sounds.unlock();
      state = "answering";
      Sounds.ring();
      body.querySelector("#callSub").textContent = "Chamando...";
      body.querySelector("#dialBtn").remove();
      body.querySelector(".call-card > .sub").remove();
      body.querySelector(".call-card").classList.add("in-call");
      await wait(2400);
      startedCall = Date.now();
      timer = setInterval(() => {
        const s = Math.round((Date.now() - startedCall) / 1000);
        const el = document.getElementById("callSub");
        if (el) el.textContent = `Em chamada · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }, 1000);
      buildCallUI();
      bibiTurn();
    });

    function buildCallUI() {
      const card = body.querySelector(".call-card");
      card.insertAdjacentHTML(
        "beforeend",
        `<div class="call-chat" id="chat"></div>
         <div class="call-controls" id="controls"></div>
         <button class="btn btn-red btn-sm" id="hangBtn" style="margin-top:18px">Desligar</button>`
      );
      body.querySelector("#hangBtn").addEventListener("click", () => quitModal.classList.add("show"));
    }

    function addMsg(who, en, pt) {
      const chat = document.getElementById("chat");
      const el = document.createElement("div");
      el.className = "msg " + who;
      el.innerHTML = `<div class="en">${esc(en)}</div>${pt ? `<button class="pt-toggle">Ver tradução</button><div class="pt" hidden>${esc(pt)}</div>` : ""}${who === "bibi" ? `<button class="speak-btn" aria-label="Ouvir de novo">🔊</button>` : ""}`;
      const tog = el.querySelector(".pt-toggle");
      if (tog)
        tog.addEventListener("click", () => {
          el.querySelector(".pt").hidden = false;
          tog.remove();
        });
      const rep = el.querySelector(".speak-btn");
      if (rep) rep.addEventListener("click", () => speakBibi(en));
      chat.appendChild(el);
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    async function speakBibi(text) {
      const avatar = document.getElementById("avatar");
      avatar.classList.add("talking");
      await Sounds.say(text);
      avatar.classList.remove("talking");
    }

    async function bibiTurn() {
      const line = call.lines[turn];
      fails = 0;
      progressFill.style.width = Math.round((turn / (call.lines.length + 1)) * 100) + "%";
      addMsg("bibi", line.bibi, line.bibiPt);
      renderControls(line, true);
      await speakBibi(line.bibi);
      renderControls(line, false);
    }

    function renderControls(line, waiting) {
      const controls = document.getElementById("controls");
      if (waiting) {
        controls.innerHTML = `<div class="mic-status">A Bibi está falando...</div>`;
        return;
      }
      controls.innerHTML = `
        <div class="call-hint">💡 ${esc(line.hintPt)} <button class="pt-toggle" id="showModel">Ver exemplo</button><span id="model" hidden> — <i>${esc(line.model)}</i></span></div>
        ${canTalk ? `<div class="mic-area" id="callMic"></div>` : ""}
        <div class="call-type">
          <input type="text" id="typeAnswer" placeholder="${canTalk ? "ou digite sua resposta..." : "Digite sua resposta em inglês..."}" autocomplete="off">
          <button class="btn btn-blue btn-sm" id="sendBtn">Enviar</button>
        </div>`;
      controls.querySelector("#showModel").addEventListener("click", (e) => {
        controls.querySelector("#model").hidden = false;
        e.target.remove();
        Sounds.say(line.model);
      });
      const input = controls.querySelector("#typeAnswer");
      const send = () => input.value.trim() && answer([input.value.trim()], true);
      controls.querySelector("#sendBtn").addEventListener("click", send);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          send();
        }
      });
      if (canTalk) {
        micWidget(controls.querySelector("#callMic"), {
          hint: "Toque no microfone e responda",
          dark: true,
          onHeard(heard, status) {
            if (!heard.length) {
              status.innerHTML = "<b>Não ouvi nada.</b> Fale mais alto — ou digite a resposta abaixo.";
              return;
            }
            answer(heard, false);
          },
        });
      }
    }

    async function answer(alternatives, typed) {
      const line = call.lines[turn];
      const text = alternatives[0];
      const ok = alternatives.some((a) => acceptsAnswer(a, line));
      addMsg("me", text);
      if (ok) {
        if (fails === 0) firstTryOk++;
        Sounds.correct();
        turn++;
        if (turn < call.lines.length) return bibiTurn();
        return endCall();
      }
      fails++;
      if (fails >= 2) {
        const controls = document.getElementById("controls");
        controls.innerHTML = `<div class="call-hint">Uma resposta possível: <b>${esc(line.model)}</b></div>
          <button class="btn btn-block" id="goOn" style="max-width:300px;margin:8px auto 0">Continuar a conversa</button>`;
        Sounds.say(line.model);
        controls.querySelector("#goOn").addEventListener("click", () => {
          turn++;
          if (turn < call.lines.length) bibiTurn();
          else endCall();
        });
        return;
      }
      addMsg("bibi", "Sorry, can you say that again?", "Desculpa, pode repetir?");
      Sounds.tryAgain();
      renderControls(line, false);
      const status = document.getElementById("micStatus");
      if (status) status.innerHTML = `<b>Dica:</b> ${esc(line.hintPt)}`;
    }

    async function endCall() {
      document.getElementById("controls").innerHTML = "";
      addMsg("bibi", call.end, call.endPt);
      await speakBibi(call.end);
      clearInterval(timer);
      Sounds.complete();
      progressFill.style.width = "100%";
      const secs = Math.round((Date.now() - startedCall) / 1000);
      const xpEarned = isReview ? 5 : NODE_INFO.call.xp;
      heartsBox.style.visibility = "";
      showDone({
        title: "Chamada concluída! 📞",
        sub: `Você conversou com a Bibi em inglês. ${firstTryOk === call.lines.length ? "Entendeu tudo de primeira! 🎉" : "Cada conversa deixa você mais fluente!"}`,
        xpEarned,
        stat2: { label: "Respostas", value: `💬 ${firstTryOk}/${call.lines.length}` },
        secs,
      });
    }
  }

  // ======================================================================
  //  Correção de respostas
  // ======================================================================
  // (funções, não constantes: a chamada retorna antes desta parte do código rodar)
  function contractions() {
    return {
      "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are", "he's": "he is", "she's": "she is",
      "it's": "it is", "that's": "that is", "what's": "what is", "where's": "where is", "there's": "there is",
      "don't": "do not", "doesn't": "does not", "didn't": "did not", "isn't": "is not", "aren't": "are not",
      "can't": "cannot", "won't": "will not", "haven't": "have not", "i'd": "i would", "i'll": "i will",
      "you'll": "you will", "we'll": "we will", "let's": "let us", "i've": "i have",
    };
  }
  function normalize(s) {
    const CONTRACTIONS = contractions();
    return String(s)
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[^a-z0-9' ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => CONTRACTIONS[w] || w)
      .join(" ")
      .replace(/'/g, "")
      .trim();
  }
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function compareTyped(given, target) {
    const g = normalize(given);
    const t = normalize(target);
    if (g === t) return { ok: true, answer: target };
    const dist = levenshtein(g, t);
    if (dist <= Math.max(1, Math.floor(t.length * 0.1))) {
      return { ok: true, answer: target, note: `Quase perfeito! O certo é: “${target}”` };
    }
    return { ok: false, answer: target };
  }
  // Quantas palavras da frase alvo aparecem, na ordem, no que foi dito (0 a 1)
  function speechScore(heard, target) {
    const h = normalize(heard).split(" ");
    const t = normalize(target).split(" ");
    const dp = Array.from({ length: t.length + 1 }, () => new Array(h.length + 1).fill(0));
    for (let i = 1; i <= t.length; i++)
      for (let j = 1; j <= h.length; j++)
        dp[i][j] = t[i - 1] === h[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    return dp[t.length][h.length] / t.length;
  }
  function bestMatch(alternatives, target) {
    let best = { text: alternatives[0] || "", score: 0 };
    alternatives.forEach((a) => {
      const score = speechScore(a, target);
      if (score > best.score) best = { text: a, score };
    });
    return best;
  }
  function acceptsAnswer(text, line) {
    const n = " " + normalize(text) + " ";
    if (speechScore(text, line.model) >= 0.6) return true;
    return line.accept.some((k) => n.includes(" " + normalize(k) + " ") || (normalize(k).includes(" ") && n.includes(normalize(k))));
  }

  // ======================================================================
  //  Microfone: permissão → ouvir (com barra de volume) → modo gravação se o reconhecimento falhar
  // ======================================================================
  async function micWidget(area, { hint, onHeard, compareText, onCompareOk, dark }) {
    if (!area) return;
    if (!Mic.supported()) return compareText && Mic.canRecord() ? compareMode(area, compareText, onCompareOk, Mic.explain("unsupported")) : (area.innerHTML = `<div class="mic-status">${Mic.explain("unsupported")}</div>`);
    const perm = await Mic.permission();
    if (perm === "granted") return listenMode();

    area.innerHTML = `
      <div class="mic-permission ${dark ? "dark" : ""}">
        <div class="big">🎤</div>
        <b>Ative o seu microfone</b>
        <p>Clique no botão e, quando o navegador perguntar, escolha <b>Permitir</b>.</p>
        <button class="btn btn-blue" data-allow>Ativar microfone</button>
        <div class="mic-status" data-status>${perm === "denied" ? Mic.explain("denied") : ""}</div>
      </div>`;
    area.querySelector("[data-allow]").addEventListener("click", async () => {
      const st = area.querySelector("[data-status]");
      st.textContent = "Aguardando a permissão...";
      // aproveita o clique para já preparar o reconhecimento offline do Chrome (quando existir)
      Mic.localStatus().then((s) => s === "downloadable" && Mic.installLocal());
      try {
        await Mic.ensurePermission();
        Sounds.correct();
        listenMode();
      } catch (err) {
        st.innerHTML = Mic.explain(err.message);
      }
    });

    function listenMode() {
      area.innerHTML = `
        <button class="mic-btn" data-mic aria-label="Falar">🎤</button>
        <div class="level-bar ${dark ? "dark" : ""}"><div data-level></div></div>
        <div class="mic-status" data-status>${hint}</div>`;
      const btn = area.querySelector("[data-mic]");
      const st = area.querySelector("[data-status]");
      const lvl = area.querySelector("[data-level]");
      let listening = false;
      btn.addEventListener("click", async () => {
        if (listening) return Mic.stop();
        Sounds.stop();
        listening = true;
        btn.classList.add("live");
        st.innerHTML = "<b>Ouvindo...</b> fale agora (toque de novo para parar)";
        try {
          const heard = await Mic.listen({
            onInterim: (t) => (st.textContent = "“" + t + "”"),
            onLevel: (v) => (lvl.style.width = Math.round(v * 100) + "%"),
          });
          onHeard(heard, st);
        } catch (err) {
          if (err.message === "network") {
            const local = await Mic.localStatus();
            if (local === "downloadable" || local === "downloading") return offerOffline();
          }
          if (err.message === "network" || err.message === "unsupported") {
            Mic.markBroken();
            if (compareText && Mic.canRecord()) return compareMode(area, compareText, onCompareOk, Mic.explain(err.message));
            st.innerHTML = Mic.explain(err.message) + " Digite a sua resposta abaixo.";
            return;
          }
          st.innerHTML = Mic.explain(err.message) + (compareText ? "" : " Você também pode digitar a resposta.");
        } finally {
          listening = false;
          btn.classList.remove("live");
          lvl.style.width = "0%";
        }
      });
    }

  // O reconhecimento online falhou: oferece o offline do Chrome (precisa de um clique para baixar)
  function offerOffline() {
    area.innerHTML = `
      <div class="mic-permission ${dark ? "dark" : ""}">
        <div class="big">📥</div>
        <b>Ative o reconhecimento de voz offline</b>
        <p>O reconhecimento online do navegador não respondeu. O Chrome pode baixar o de inglês para funcionar direto no seu computador (só na primeira vez).</p>
        <button class="btn btn-blue" data-offline>Ativar reconhecimento offline</button>
        <div class="mic-status" data-status></div>
      </div>`;
    area.querySelector("[data-offline]").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      const st = area.querySelector("[data-status]");
      st.textContent = "Baixando o reconhecimento de voz... pode levar até um minuto.";
      const ok = await Mic.installLocal((i) => (st.textContent = "Baixando o reconhecimento de voz" + ".".repeat((i % 3) + 1)));
      if (ok) {
        Sounds.correct();
        listenMode();
        area.querySelector("[data-status]").innerHTML = "<b>Pronto!</b> Toque no microfone e fale.";
      } else {
        Mic.markBroken();
        if (compareText && Mic.canRecord()) compareMode(area, compareText, onCompareOk, "Não foi possível ativar o reconhecimento offline.");
        else st.innerHTML = "Não foi possível ativar o reconhecimento de voz neste navegador. Digite a sua resposta abaixo.";
      }
    });
  }
  }

  // Plano B: o aluno grava a própria voz e compara com a da Bibi
  function compareMode(area, text, onOk, why) {
    area.innerHTML = `
      <div class="compare">
        <div class="mic-status">${why ? why + "<br>" : ""}<b>Grave sua voz e compare com a da Bibi.</b></div>
        <button class="mic-btn" data-rec aria-label="Gravar">⏺</button>
        <div class="level-bar"><div data-level></div></div>
        <div class="compare-actions" data-actions hidden>
          <button class="btn btn-white btn-sm" data-bibi>🔊 Bibi</button>
          <button class="btn btn-white btn-sm" data-me>▶ Você</button>
          <button class="btn btn-sm" data-ok>Ficou parecido ✓</button>
        </div>
      </div>`;
    const recBtn = area.querySelector("[data-rec]");
    const lvl = area.querySelector("[data-level]");
    let session = null;
    let url = null;
    recBtn.addEventListener("click", async () => {
      if (session) {
        url = await session.stop();
        session = null;
        recBtn.classList.remove("live");
        recBtn.textContent = "⏺";
        lvl.style.width = "0%";
        area.querySelector("[data-actions]").hidden = false;
        new Audio(url).play();
        return;
      }
      try {
        Sounds.stop();
        session = await Mic.record({ onLevel: (v) => (lvl.style.width = Math.round(v * 100) + "%") });
        recBtn.classList.add("live");
        recBtn.textContent = "⏹";
        session.done.then((u) => {
          if (session) {
            url = u;
            session = null;
            recBtn.classList.remove("live");
            recBtn.textContent = "⏺";
            area.querySelector("[data-actions]").hidden = false;
          }
        });
      } catch (err) {
        area.querySelector(".mic-status").innerHTML = Mic.explain(err.message);
      }
    });
    area.querySelector("[data-bibi]").addEventListener("click", () => Sounds.say(text));
    area.querySelector("[data-me]").addEventListener("click", () => url && new Audio(url).play());
    area.querySelector("[data-ok]").addEventListener("click", onOk);
  }

  // ---------- Utilidades ----------
  function tokens(s) {
    return s.replace(/[?!.,;:]/g, "").split(/\s+/).filter(Boolean);
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
  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
