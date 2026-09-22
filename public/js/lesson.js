(async function () {
  Api.requireAuth();

  const params = new URLSearchParams(window.location.search);
  const unitId = params.get("unit");
  const lessonBody = document.getElementById("lessonBody");
  const progressFill = document.getElementById("progressFill");
  const heartsBox = document.getElementById("heartsBox");
  const feedbackBanner = document.getElementById("feedbackBanner");
  const feedbackText = document.getElementById("feedbackText");
  const feedbackExplanation = document.getElementById("feedbackExplanation");
  const continueBtn = document.getElementById("continueBtn");

  let lesson = null;
  let stage = "intro"; // intro -> quiz -> result
  let qIndex = 0;
  let hearts = 3;
  let correctCount = 0;
  let answered = false;

  try {
    const lessons = await fetch("data/lessons.json").then((r) => r.json());
    lesson = lessons.find((l) => l.id === unitId);
  } catch (err) {
    lessonBody.innerHTML = `<p style="color:#c62828">Não foi possível carregar a lição.</p>`;
    return;
  }

  if (!lesson) {
    lessonBody.innerHTML = `<p style="color:#c62828">Lição não encontrada.</p>`;
    return;
  }

  document.title = lesson.title + " — EnglishBite";
  renderIntro();

  function renderHearts() {
    heartsBox.textContent = "❤️".repeat(hearts) + "🖤".repeat(3 - hearts);
  }

  function renderIntro() {
    progressFill.style.width = "0%";
    lessonBody.innerHTML = `
      <div class="question-card">
        <span style="font-size:2.4rem;">${lesson.icon}</span>
        <h2>${lesson.title}</h2>
        <p style="color:#6b7a76; margin-bottom:20px;">${lesson.tip}</p>
        ${lesson.vocabulary
          .map(
            (v) => `
          <div class="vocab-card">
            <div class="word">${v.word}</div>
            <div class="meaning">${v.meaning}</div>
            <div class="example">"${v.example}"</div>
          </div>`
          )
          .join("")}
        <button class="btn btn-primary btn-block" id="startQuizBtn" style="margin-top:20px;">Começar quiz</button>
      </div>
    `;
    document.getElementById("startQuizBtn").addEventListener("click", () => {
      stage = "quiz";
      qIndex = 0;
      hearts = 3;
      correctCount = 0;
      renderHearts();
      renderQuestion();
    });
  }

  function renderQuestion() {
    answered = false;
    const q = lesson.quiz[qIndex];
    progressFill.style.width = Math.round((qIndex / lesson.quiz.length) * 100) + "%";
    lessonBody.innerHTML = `
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
      btn.addEventListener("click", () => selectOption(i, btn));
      optionsBox.appendChild(btn);
    });
  }

  function selectOption(i, btnEl) {
    if (answered) return;
    answered = true;
    const q = lesson.quiz[qIndex];
    const allOptions = document.querySelectorAll(".option");
    const isCorrect = i === q.answer;

    allOptions.forEach((el, idx) => {
      el.style.pointerEvents = "none";
      if (idx === q.answer) el.classList.add("correct");
      else if (idx === i) el.classList.add("wrong");
    });

    if (isCorrect) {
      correctCount++;
      Sounds.correct();
      feedbackBanner.className = "feedback-banner correct show";
      feedbackText.className = "feedback-text correct-text";
      feedbackText.textContent = "Certinho! 🎉";
    } else {
      hearts = Math.max(0, hearts - 1);
      Sounds.wrong();
      renderHearts();
      feedbackBanner.className = "feedback-banner wrong show";
      feedbackText.className = "feedback-text wrong-text";
      feedbackText.textContent = "Não foi dessa vez";
    }
    feedbackExplanation.textContent = q.explanation || "";
  }

  continueBtn.addEventListener("click", () => {
    feedbackBanner.classList.remove("show");
    if (hearts <= 0) {
      renderResult(false);
      return;
    }
    qIndex++;
    if (qIndex >= lesson.quiz.length) {
      renderResult(true);
    } else {
      renderQuestion();
    }
  });

  async function renderResult(passed) {
    stage = "result";
    progressFill.style.width = "100%";
    const xpEarned = passed ? correctCount * 10 : correctCount * 5;
    if (passed) Sounds.complete();
    else Sounds.tryAgain();

    lessonBody.innerHTML = `
      <div class="question-card result-card">
        <span class="big-emoji">${passed ? "🏆" : "💪"}</span>
        <h2>${passed ? "Lição concluída!" : "Quase lá!"}</h2>
        <p style="color:#6b7a76;">${passed ? "Você mandou bem nesta lição." : "Você ficou sem vidas, mas pode tentar de novo."}</p>
        <div class="result-stats">
          <div class="result-stat"><div class="value">${correctCount}/${lesson.quiz.length}</div><div class="label">Acertos</div></div>
          <div class="result-stat"><div class="value">+${xpEarned}</div><div class="label">XP ganho</div></div>
        </div>
        <div style="display:flex; gap:12px; justify-content:center; margin-top:12px;">
          ${!passed ? '<button class="btn btn-secondary" id="retryBtn">Tentar de novo</button>' : ""}
          <a href="home.html" class="btn btn-primary" id="homeBtn">Voltar à trilha</a>
        </div>
      </div>
    `;

    if (!passed) {
      document.getElementById("retryBtn").addEventListener("click", () => {
        stage = "intro";
        renderIntro();
      });
    }

    try {
      await Api.request("/api/progress", {
        method: "POST",
        auth: true,
        body: { unitId: lesson.id, xpEarned, passed },
      });
    } catch (err) {
      if (err.message === "UNAUTHORIZED") Api.logout();
    }
  }
})();
