// Instalar o app ("Baixar o EnglishBite") no celular ou no computador
(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferred = null;

  // Os botões [data-install] só aparecem com a classe "can-install" no <html> (ver style.css)
  function show(visible) {
    document.documentElement.classList.toggle("can-install", visible);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // guarda o convite para mostrar no nosso botão
    deferred = e;
    show(true);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    show(false);
  });

  if (!standalone && isIOS) show(true); // no iPhone não existe o convite automático: mostramos o passo a passo
  document.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("[data-install]");
    if (!b) return;
    e.preventDefault();
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      show(false);
    } else {
      iosHelp();
    }
  });

  function iosHelp() {
    let m = document.getElementById("installHelp");
    if (!m) {
      m = document.createElement("div");
      m.id = "installHelp";
      m.className = "modal-backdrop";
      m.innerHTML = `
        <div class="modal" style="text-align:center">
          <button class="icon-btn close" aria-label="Fechar">✕</button>
          <img src="img/icons/icon-192.png" alt="" style="width:72px;border-radius:18px">
          <h2>Instale o EnglishBite</h2>
          ${
            isIOS
              ? `<p class="view-sub">No Safari, toque em <b>Compartilhar</b> <span style="font-size:1.3rem">⎋</span> e depois em <b>Adicionar à Tela de Início</b> ➕.</p>`
              : `<p class="view-sub">Abra o menu do navegador (<b>⋮</b>) e escolha <b>Instalar aplicativo</b> ou <b>Adicionar à tela inicial</b>.</p>`
          }
          <button class="btn btn-block" data-ok>Entendi</button>
        </div>`;
      document.body.appendChild(m);
      m.addEventListener("click", (e) => {
        if (e.target === m || e.target.closest(".close, [data-ok]")) m.classList.remove("show");
      });
    }
    m.classList.add("show");
  }
})();
