// Aplica o tema (claro/escuro) antes da página aparecer, para não piscar
(function () {
  let pref = "system";
  try {
    pref = localStorage.getItem("eb_theme") || "system";
  } catch (e) {}
  if (pref === "light" || pref === "dark") document.documentElement.dataset.theme = pref;
  window.Theme = {
    get: () => pref,
    set(value) {
      pref = value;
      try {
        localStorage.setItem("eb_theme", value);
      } catch (e) {}
      if (value === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = value;
    },
  };
})();
