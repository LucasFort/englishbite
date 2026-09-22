(async function () {
  Api.requireAuth();
  const user = Api.getUser();
  if (user && user.name) {
    document.getElementById("avatarInitial").textContent = user.name.charAt(0).toUpperCase();
  }

  document.getElementById("logoutBtn").addEventListener("click", () => Api.logout());

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
    document.getElementById("path").innerHTML = `<p style="color:#c62828">${err.message}</p>`;
    return;
  }

  if (!progress.level) {
    window.location.href = "placement.html";
    return;
  }
  document.getElementById("retakeBtn").style.display = "inline-flex";

  document.getElementById("streakVal").textContent = progress.streak || 0;
  document.getElementById("xpVal").textContent = progress.xp || 0;

  const completed = new Set(progress.completedUnits || []);
  const pathEl = document.getElementById("path");
  pathEl.innerHTML = "";

  lessons.forEach((lesson, i) => {
    const isDone = completed.has(lesson.id);
    const isLocked = i > 0 && !completed.has(lessons[i - 1].id);

    const node = document.createElement(isLocked ? "div" : "a");
    if (!isLocked) node.href = `lesson.html?unit=${lesson.id}`;
    node.className = "node" + (isLocked ? " locked" : "") + (isDone ? " done" : "");

    node.innerHTML = `
      <div class="node-icon">${lesson.icon}</div>
      <div class="node-info">
        <h3>${lesson.title}</h3>
        <span>Nível ${lesson.level} · ${lesson.vocabulary.length} palavras · ${lesson.quiz.length} perguntas</span>
      </div>
      <div class="node-status">${isLocked ? "🔒" : isDone ? "✅" : "▶️"}</div>
    `;
    pathEl.appendChild(node);
  });
})();
