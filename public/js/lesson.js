(async function () {
  Api.requireAuth();

  const params = new URLSearchParams(window.location.search);
  const unitId = params.get("unit");
  // Modos de prática fora da trilha: desafio do dia, revisão de erros e treino misturado
  const MODES = {
    daily: { icon: "🎲", title: "Desafio do dia", label: "Desafio do dia", xp: 20 },
    review: { icon: "🩹", title: "Revisão de erros", label: "Revisão", xp: 10 },
    mix: { icon: "🔀", title: "Treino relâmpago", label: "Treino", xp: 10 },
    smart: { icon: "🧠", title: "Memória de longo prazo", label: "Memória · Pro", xp: 15, pro: true },
    goal: { icon: "🎯", title: "Treino do objetivo", label: "Objetivo · Pro", xp: 15, pro: true },
  };
  // Trilha do objetivo (Pro): unidades que mais importam para cada meta
  const GOAL_UNITS = {
    travel: ["travel", "food", "shopping", "numbers-time", "greetings"],
    work: ["work", "future-plans", "opinions", "news", "phrasal-verbs"],
    talk: ["introductions", "feelings", "family", "daily-routine", "idioms"],
    grammar: ["past-tense", "future-plans", "phrasal-verbs", "daily-routine", "opinions"],
  };
  const mode = MODES[params.get("mode")] ? params.get("mode") : null;
  const node = mode ? mode : params.get("node") || "1";
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
  let userGems = 0;
  let isPro = false;
  try {
    const [units, progress] = await Promise.all([
      fetch("data/lessons.json").then((r) => r.json()),
      Api.request("/api/progress", { auth: true }).catch(() => null),
    ]);
    const done = (progress && progress.completedUnits) || [];
    userGems = (progress && progress.gems) || 0;
    isPro = !!(progress && progress.pro);
    if (mode && MODES[mode].pro && !isPro) {
      window.location.href = "home.html#pro";
      return;
    }
    if (mode) {
      unit = practiceUnit(units, progress || {});
      Object.assign(NODE_INFO, { [mode]: { label: MODES[mode].label, xp: MODES[mode].xp } });
    } else {
      unit = units.find((u) => u.id === unitId);
      isReview = done.includes(`${unitId}:${node}`) || done.includes(unitId);
    }
  } catch (err) {
    body.innerHTML = `<p style="color:var(--red-dark)">Não foi possível carregar a lição.</p>`;
    return;
  }
  if (!unit || !NODE_INFO[node]) {
    body.innerHTML = `<p style="color:var(--red-dark)">Lição não encontrada.</p>`;
    return;
  }

  // Monta uma "unidade" com palavras de várias unidades já liberadas pelo aluno
  function practiceUnit(units, progress) {
    const done = new Set(progress.completedUnits || []);
    const started = units.filter((u) => done.has(u.id) || [...done].some((d) => d.startsWith(u.id + ":")));
    const pool = started.length ? started : units.slice(0, 1);
    const all = pool.flatMap((u) => u.words.map((w) => Object.assign({ unitId: u.id }, w)));
    let words;
    const every = units.flatMap((u) => u.words);
    if (mode === "smart") {
      // primeiro as expressões "vencidas" (a ponto de serem esquecidas), das mais fracas para as mais fortes
      const srs = progress.srs || {};
      const today = progress.today || new Date().toISOString().slice(0, 10);
      const known = every.filter((w) => srs[w.en]);
      const due = known.filter((w) => srs[w.en].d <= today).sort((a, b) => srs[a.en].b - srs[b.en].b);
      const later = known.filter((w) => srs[w.en].d > today).sort((a, b) => srs[a.en].b - srs[b.en].b || (srs[a.en].d < srs[b.en].d ? -1 : 1));
      words = due.concat(later).slice(0, 10);
      if (words.length < 8) words = words.concat(sample(all.filter((w) => !words.some((x) => x.en === w.en)), 8 - words.length));
    } else if (mode === "goal") {
      const ids = GOAL_UNITS[progress.goalTheme] || GOAL_UNITS.talk;
      const goalUnits = units.filter((u) => ids.includes(u.id));
      words = sample(goalUnits.flatMap((u) => u.words), 12);
      pool.splice(0, pool.length, ...goalUnits); // os desafios de gramática também vêm do objetivo
    } else if (mode === "review") {
      const weak = new Set(progress.weak || []);
      const allUnits = units.flatMap((u) => u.words);
      words = allUnits.filter((w) => weak.has(w.en));
      // completa com palavras aleatórias para ter opções suficientes nos exercícios
      if (words.length < 8) words = words.concat(sample(all.filter((w) => !weak.has(w.en)), 8 - words.length));
    } else {
      words = sample(all, 12);
    }
    const quiz = sample(pool.flatMap((u) => u.quiz), mode === "daily" ? 3 : 2);
    return {
      id: mode,
      icon: MODES[mode].icon,
      title: MODES[mode].title,
      level: pool[pool.length - 1].level,
      tip:
        mode === "review"
          ? "Aqui estão as expressões que você errou. Acerte para tirá-las da lista!"
          : mode === "smart"
          ? "Revisão no momento certo: estas expressões estão prestes a sair da sua memória."
          : `Palavras misturadas de ${pool.length} unidade(s)${mode === "goal" ? " escolhidas para o seu objetivo" : " que você já estudou"}.`,
      words,
      quiz,
      weakTargets: mode === "review" ? new Set(progress.weak || []) : null,
    };
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
  let combo = 0;
  let bestCombo = 0;
  const weakWords = new Set(); // errou nesta fase → vai para a revisão
  const fixedWords = new Set(); // acertou de primeira na revisão → sai da lista
  const results = []; // primeira tentativa em cada expressão → memória de longo prazo
  const skillStats = {}; // acertos por habilidade → Raio-X do inglês
  const SKILL_OF = { listen: "listen", dictation: "listen", type: "write", translate: "write", speak: "speak", meaning: "vocab", reverse: "vocab", fill: "vocab", quiz: "grammar" };
  function track(ok) {
    if (!ex || ex.redo) return;
    if (ex.word && !results.some((r) => r.en === ex.word.en)) results.push({ en: ex.word.en, ok });
    const s = SKILL_OF[ex.type];
    if (!s) return;
    skillStats[s] = skillStats[s] || [0, 0];
    skillStats[s][0] += ok ? 1 : 0;
    skillStats[s][1] += 1;
  }
  const comboPill = document.createElement("div");
  comboPill.className = "combo-pill";
  document.body.appendChild(comboPill);
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

  function showCombo() {
    if (combo < 3) return comboPill.classList.remove("show");
    comboPill.textContent = `🔥 ${combo} seguidas!`;
    comboPill.classList.remove("show", "pulse");
    void comboPill.offsetWidth;
    comboPill.classList.add("show", "pulse");
    if (combo % 5 === 0) Sounds.levelUp && Sounds.levelUp();
  }

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
  // Cada fase é sorteada na hora: a ordem das palavras e o tipo de exercício mudam
  // a cada tentativa, então dois alunos (ou duas revisões) nunca veem a mesma sequência.
  function buildQueue() {
    const W = unit.words;
    const q = [];
    const add = (x) => x && q.push(x);
    // Exercícios que praticam uma palavra (w) já apresentada
    const DRILLS = {
      listen: (w) => ({ type: "listen", item: w, word: w }),
      listenEx: (w) => ({ type: "listen", item: w, example: true, word: w }),
      type: (w) => ({ type: "type", en: w.en, pt: w.pt, word: w }),
      reverse: (w) => ({ type: "reverse", item: w, word: w }),
      fill: (w) => canFill(w) && { type: "fill", item: w, word: w },
      translate: (w) => ({ type: "translate", en: w.ex, pt: w.exPt, word: w }),
      translateWord: (w) => tokens(w.en).length >= 2 && { type: "translate", en: w.en, pt: w.pt, word: w },
      dictation: (w) => ({ type: "dictation", en: pick([w.en, w.ex]), word: w }),
      speak: (w) => ({ type: "speak", en: w.en, pt: w.pt, word: w }),
      speakEx: (w) => ({ type: "speak", en: w.ex, pt: w.exPt, word: w }),
      meaning: (w) => ({ type: "meaning", item: w, word: w }),
    };
    // Sorteia o tipo, mas dá preferência aos menos usados na fase (para variar de verdade)
    const used = {};
    const drill = (w, kinds) => {
      const order = shuffle(kinds.slice()).sort((a, b) => (used[a] || 0) - (used[b] || 0));
      for (const k of order) {
        if ((k === "speak" || k === "speakEx") && !canSpeak) continue;
        const x = DRILLS[k](w);
        if (x) {
          used[k] = (used[k] || 0) + 1;
          return x;
        }
      }
      return DRILLS.meaning(w);
    };

    if (node === "1" || node === "2") {
      const ws = shuffle(node === "1" ? W.slice(0, 4) : W.slice(4, 8));
      const easy = ["listen", "reverse", "fill", "meaning"];
      const hard = ["type", "translateWord", "dictation", "speak", "fill", "reverse"];
      // apresenta 2 palavras, pratica, apresenta mais 2, pratica, depois mistura tudo
      ws.slice(0, 2).forEach((w) => add({ type: "meaning", item: w, isNew: true, word: w }));
      add(drill(ws[0], easy));
      ws.slice(2).forEach((w) => add({ type: "meaning", item: w, isNew: true, word: w }));
      add(drill(ws[1], easy));
      add({ type: "match", items: ws });
      shuffle(ws.slice()).forEach((w) => add(drill(w, hard)));
      add(drill(pick(ws), easy));
    } else if (node === "practice") {
      const ws = shuffle(W.slice());
      const kinds = ["translate", "dictation", "speakEx", "type", "listenEx", "fill", "reverse"];
      ws.slice(0, 5).forEach((w) => add(drill(w, kinds)));
      add({ type: "match", items: sample(W, 5) });
      ws.slice(5).forEach((w) => add(drill(w, kinds)));
      add(drill(ws[0], ["translate", "speakEx"]));
    } else if (node === "test") {
      const ws = shuffle(W.slice());
      unit.quiz.forEach((item) => add({ type: "quiz", item }));
      const kinds = ["type", "listenEx", "speakEx", "translate", "dictation", "fill", "reverse"];
      ws.slice(0, 6).forEach((w) => add(drill(w, kinds)));
      shuffle(q);
    } else {
      // modos de prática: daily (mais longo), review e mix
      const size = mode === "daily" ? 10 : 8;
      const targets = unit.weakTargets ? W.filter((w) => unit.weakTargets.has(w.en)) : W;
      let ws = shuffle((targets.length ? targets : W).slice()).slice(0, size);
      // poucos erros? completa com outras palavras para a revisão não ficar curta demais
      if (ws.length < 6) ws = ws.concat(sample(W.filter((w) => !ws.includes(w)), 6 - ws.length));
      const kinds = ["listen", "listenEx", "type", "reverse", "fill", "translate", "dictation", "speak", "meaning", "translateWord"];
      ws.forEach((w) => add(drill(w, kinds)));
      unit.quiz.forEach((item) => add({ type: "quiz", item }));
      shuffle(q);
      add({ type: "match", items: sample(W, 5) });
    }
    return q.filter((x) => !(x.type === "speak" && !canSpeak));
  }

  // A palavra aparece "inteira" no exemplo? Então dá para esconder e pedir para completar
  function canFill(w) {
    return fillParts(w) !== null;
  }
  function fillParts(w) {
    const target = w.en.replace(/[?!.,]+$/, "");
    const i = w.ex.toLowerCase().indexOf(target.toLowerCase());
    if (i < 0 || normalize(target) === normalize(w.ex)) return null;
    const before = w.ex.slice(0, i);
    const after = w.ex.slice(i + target.length);
    // só aceita quando é a palavra inteira (não um pedaço de outra palavra)
    if (/[a-z]$/i.test(before) || /^[a-z]/i.test(after)) return null;
    return { before, answer: w.ex.slice(i, i + target.length), after };
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
    } else if (mode === "daily") {
      content = `<p class="sub">Um desafio novo todo dia, sorteado só para você, com palavras de tudo o que você já estudou.<br><b>Vença para ganhar +5 🍯 de bônus!</b></p>`;
    } else if (mode === "review") {
      const n = unit.weakTargets.size;
      content = `<p class="sub">${n ? `Você tem <b>${n}</b> expressão(ões) para revisar. Cada acerto tira uma da lista!` : "Você não tem erros para revisar agora. Vamos treinar palavras aleatórias!"}</p>`;
    } else if (mode === "mix") {
      content = `<p class="sub">Um treino rápido e diferente a cada vez, misturando as unidades que você já estudou.</p>`;
    } else if (mode === "smart" || mode === "goal") {
      content = `<p class="sub">${esc(unit.tip)}<br><b>👑 Pro: vidas infinitas neste e em todos os treinos.</b></p>`;
    } else {
      content = `<p class="sub">Mostre o que você aprendeu na unidade. Cuidado com as vidas! ❤️</p>`;
    }
    body.innerHTML = `
      <div class="result-card">
        <img class="mascot" src="img/bee.svg" alt="" style="width:120px">
        <div class="ex-label" style="justify-content:center;display:flex">${mode ? `${unit.icon} ${info.label}` : `${unit.icon} ${esc(unit.title)} · ${info.label}`}</div>
        <h2 style="color:var(--title)">${mode ? `${unit.title} ${unit.icon}` : node === "test" ? "Desafio da unidade 🏆" : node === "practice" ? "Vamos praticar! 💪" : "Novas palavras ✨"}</h2>
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
      track(true);
      solved++;
      if (!ex.redo) firstTry++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      showCombo();
      if (!ex.redo && ex.word && unit.weakTargets && unit.weakTargets.has(ex.word.en) && !weakWords.has(ex.word.en)) fixedWords.add(ex.word.en);
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
      track(false);
      if (!isPro) hearts = Math.max(0, hearts - 1); // Pro: vidas infinitas
      mistakes++;
      combo = 0;
      showCombo();
      if (ex.word) {
        weakWords.add(ex.word.en);
        fixedWords.delete(ex.word.en);
      }
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
    heartsVal.textContent = isPro ? "∞" : hearts;
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

    // Português → escolha a expressão em inglês
    reverse(e) {
      const w = e.item;
      const opts = shuffle([w.en, ...sample(unit.words.filter((x) => x.en !== w.en).map((x) => x.en), 3)]);
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🔄 Ao contrário")}
          <h2>Como se diz em inglês?</h2>
          <div class="prompt">
            <img src="img/bee.svg" alt="">
            <div class="speech"><span>${esc(w.pt)}</span></div>
          </div>
          <div class="options">${opts.map(optionHtml).join("")}</div>
        </div>`;
      const choose = singleChoice(opts, true);
      e.check = () => ({ ok: opts[choose()] === w.en, answer: w.en, speak: w.en });
    },

    // Frase de exemplo com uma lacuna para completar
    fill(e) {
      const w = e.item;
      const parts = fillParts(w);
      const strip = (s) => s.replace(/[?!.,]+$/, "");
      const opts = shuffle([parts.answer, ...sample(unit.words.filter((x) => x.en !== w.en).map((x) => strip(x.en)), 3)]);
      body.innerHTML = `
        <div class="question-card">
          ${label(e, "🕳️ Complete")}
          <h2>Complete a frase</h2>
          <div class="fill-sentence">${esc(parts.before)}<span class="blank" id="blank">&nbsp;</span>${esc(parts.after)}</div>
          <div class="fill-pt">${esc(w.exPt)}</div>
          <div class="options">${opts.map(optionHtml).join("")}</div>
        </div>`;
      const blank = body.querySelector("#blank");
      const choose = singleChoice(opts);
      body.querySelectorAll(".options .option").forEach((b, i) =>
        b.addEventListener("click", () => {
          blank.textContent = opts[i];
          blank.classList.add("filled");
        })
      );
      e.check = () => ({ ok: normalize(opts[choose()]) === normalize(parts.answer), answer: w.ex, speak: w.ex });
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

    comboPill.classList.remove("show");
    if (!passed) {
      Sounds.tryAgain();
      const REFILL = 15;
      body.innerHTML = `
        <div class="result-card">
          <img class="mascot" src="img/bee.svg" alt="" style="filter:grayscale(.6)">
          <h2 class="fail">Você ficou sem vidas 💔</h2>
          <p class="sub">Tudo bem errar — é assim que se aprende. Que tal tentar de novo?</p>
          <div class="refill-box">
            <b>Continuar de onde parou?</b>
            <p>Recarregue as 5 vidas com mel e não perca o que já fez.</p>
            <button class="btn btn-blue" id="refillBtn" ${userGems < REFILL ? "disabled" : ""}>Recarregar por ${REFILL} 🍯</button>
            <div class="refill-have">Você tem ${userGems} 🍯</div>
          </div>
        </div>`;
      body.querySelector("#refillBtn").addEventListener("click", async (ev) => {
        ev.target.disabled = true;
        try {
          const p = await Api.request("/api/shop", { method: "POST", auth: true, body: { item: "hearts" } });
          userGems = p.gems;
          hearts = MAX_HEARTS;
          renderHearts(true);
          Sounds.levelUp();
          skipBtn.onclick = null;
          next();
        } catch (err) {
          ev.target.disabled = false;
          body.querySelector(".refill-have").textContent = err.message;
        }
      });
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
      perfect: mistakes === 0,
    });
  }

  function showDone({ title, sub, xpEarned, stat2, secs, perfect, kind }) {
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
        ${bestCombo >= 3 ? `<p class="sub" style="margin:18px 0 0">🔥 Melhor sequência: <b>${bestCombo} acertos seguidos</b></p>` : ""}
        <div class="rewards" id="rewards"></div>
      </div>`;
    if (perfect) confetti();
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
      body: {
        unitId: mode ? `mode:${mode}` : `${unit.id}:${node}`,
        xpEarned,
        passed: true,
        perfect: !!perfect,
        combo: bestCombo,
        kind: kind || mode || "lesson",
        weak: [...weakWords],
        fixed: [...fixedWords],
        results,
        skills: skillStats,
      },
    })
      .then((p) => showRewards(p.events || {}))
      .catch((err) => {
        if (err.message === "UNAUTHORIZED") Api.logout();
      })
      .finally(() => (mainBtn.disabled = false));
  }

  // Mostra o que a fase rendeu: meta diária, ofensiva, mel, conquistas e missões
  function showRewards(ev) {
    const box = document.getElementById("rewards");
    if (!box) return;
    // o servidor tem a palavra final sobre o XP (ex.: desafio do dia repetido vale menos)
    const xpBox = document.querySelector(".result-stat .value");
    if (xpBox && typeof ev.xpEarned === "number") xpBox.textContent = `⚡ ${ev.xpEarned}`;
    const items = [];
    if (ev.streakExtended) items.push(["🔥", "Ofensiva mantida!", "Volte amanhã para continuar a sequência."]);
    if (ev.goalReached) items.push(["🎯", "Meta diária batida!", "+5 🍯 de bônus"]);
    if (ev.challengeWon) items.push(["🎲", "Desafio do dia vencido!", "+5 🍯 de bônus. Amanhã tem outro!"]);
    if (ev.gemsEarned) items.push(["🍯", `+${ev.gemsEarned} de mel`, "Use na loja para proteger sua ofensiva."]);
    (ev.newAchievements || []).forEach((a) => items.push([a.icon, `Conquista: ${a.title}`, a.desc]));
    (ev.questsReady || []).forEach((q) => items.push(["📜", "Missão concluída!", `${q} — resgate na tela inicial.`]));
    if (weakWords.size && mode !== "review") items.push(["🩹", `${weakWords.size} expressão(ões) para revisar`, "Elas ficam na sua Revisão de erros."]);
    if (fixedWords.size) items.push(["✅", `${fixedWords.size} erro(s) corrigido(s)`, "Saíram da sua lista de revisão."]);
    box.innerHTML = items
      .map(([icon, title, desc], i) => `<div class="reward" style="animation-delay:${0.15 * i}s"><span class="ico">${icon}</span><div><b>${esc(title)}</b><small>${esc(desc)}</small></div></div>`)
      .join("");
    if ((ev.newAchievements || []).length || ev.goalReached || ev.challengeWon) {
      Sounds.levelUp();
      confetti();
    }
  }

  function confetti() {
    const colors = ["#58cc02", "#1cb0f6", "#ffc800", "#ff4b4b", "#ce82ff", "#ff9600"];
    const layer = document.createElement("div");
    layer.className = "confetti";
    for (let i = 0; i < 80; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.6 + "s";
      p.style.animationDuration = 1.6 + Math.random() * 1.4 + "s";
      p.style.setProperty("--drift", (Math.random() * 160 - 80).toFixed(0) + "px");
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 3600);
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
        perfect: firstTryOk === call.lines.length,
        kind: "call",
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
