(async function () {
  Api.requireAuth();

  const quizBody = document.getElementById("quizBody");
  const progressFill = document.getElementById("progressFill");
  const skipBtn = document.getElementById("skipBtn");

  let questions = [];
  let qIndex = 0;
  let correctCount = 0;
  let answered = false;

  try {
    questions = await fetch("data/placement.json").then((r) => r.json());
  } catch (err) {
    quizBody.innerHTML = `<p style="color:#c62828">Não foi possível carregar o teste.</p>`;
    return;
  }

  document.getElementById("startBtn").addEventListener("click", () => {
    qIndex = 0;
    correctCount = 0;
    renderQuestion();
  });

  skipBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await finish("iniciante");
  });

  function renderQuestion() {
    answered = false;
    const q = questions[qIndex];
    progressFill.style.width = Math.round((qIndex / questions.length) * 100) + "%";
    quizBody.innerHTML = `
      <div class="question-card">
        <h2>${q.question}</h2>
        <div id="optionsBox"></div>
      </div>
    `;
    const optionsBox = document.getElementById("optionsBox");
    q.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.textContent = opt;
      btn.addEventListener("click", () => selectOption(i, q));
      optionsBox.appendChild(btn);
    });
  }

  function selectOption(i, q) {
    if (answered) return;
    answered = true;
    if (i === q.answer) {
      correctCount++;
      Sounds.correct();
    } else {
      Sounds.wrong();
    }

    const allOptions = document.querySelectorAll(".option");
    allOptions.forEach((el, idx) => {
      el.style.pointerEvents = "none";
      if (idx === q.answer) el.classList.add("correct");
      else if (idx === i) el.classList.add("wrong");
    });

    setTimeout(() => {
      qIndex++;
      if (qIndex >= questions.length) {
        const level = correctCount >= 7 ? "avancado" : correctCount >= 4 ? "intermediario" : "iniciante";
        finish(level);
      } else {
        renderQuestion();
      }
    }, 700);
  }

  const levelInfo = {
    iniciante: { emoji: "🌱", title: "Iniciante", desc: "Você vai começar do começo, com saudações e frases do dia a dia." },
    intermediario: { emoji: "🌿", title: "Intermediário", desc: "Você já sabe o básico! Vamos direto para phrasal verbs e frases mais elaboradas." },
    avancado: { emoji: "🌳", title: "Avançado", desc: "Muito bom! Vamos direto para expressões idiomáticas e inglês mais avançado." },
  };

  async function finish(level) {
    progressFill.style.width = "100%";
    Sounds.levelUp();
    const info = levelInfo[level];
    quizBody.innerHTML = `
      <div class="question-card result-card">
        <span class="big-emoji">${info.emoji}</span>
        <h2>Nível: ${info.title}</h2>
        <p style="color:#6b7a76;">${info.desc}</p>
        <a href="home.html" class="btn btn-primary" id="continueBtn" style="margin-top:12px;">Começar minha trilha</a>
      </div>
    `;

    try {
      await Api.request("/api/placement", { method: "POST", auth: true, body: { level } });
    } catch (err) {
      if (err.message === "UNAUTHORIZED") Api.logout();
    }
  }
})();
