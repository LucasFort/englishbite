// Efeitos sonoros, voz da Bibi (áudios gravados) e reconhecimento de fala
const Sounds = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, startTime, duration, type, peakGain) {
    const c = getCtx();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq;
    const t0 = c.currentTime + startTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  function safe(fn) {
    try {
      fn();
    } catch (e) {
      /* som é opcional, nunca trava a tela */
    }
  }

  // ---------- Voz ----------
  // 1º: gravações com a voz do dono do app (audio/voice/index.json)
  // 2º: áudios gerados por unidade (audio/<unidade>.mp3 + audio/index.json)
  // 3º: voz do navegador (speechSynthesis), só como último recurso
  const VOICE_VOLUME = 0.6; // a voz estava alta demais em relação aos efeitos
  const norm = (t) => String(t).trim().toLowerCase().replace(/\s+/g, " ");
  let indexPromise = null;
  const buffers = {};
  let current = null;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = Promise.all([
        fetch("audio/index.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        fetch("audio/voice/index.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      ]).then(([units, voice]) => {
        const clips = {};
        Object.keys(units).forEach((unit) => {
          Object.keys(units[unit]).forEach((text) => {
            clips[norm(text)] = { src: `audio/${unit}.mp3`, start: units[unit][text][0], dur: units[unit][text][1] };
          });
        });
        const custom = {};
        Object.keys(voice).forEach((text) => (custom[norm(text)] = { src: "audio/voice/" + voice[text] }));
        return { clips, custom };
      });
    }
    return indexPromise;
  }

  function loadBuffer(src) {
    if (!buffers[src]) {
      const c = getCtx();
      buffers[src] = fetch(src)
        .then((r) => {
          if (!r.ok) throw new Error("audio " + r.status);
          return r.arrayBuffer();
        })
        .then((data) => new Promise((ok, fail) => c.decodeAudioData(data, ok, fail)));
      buffers[src].catch(() => delete buffers[src]);
    }
    return buffers[src];
  }

  function stop() {
    if (current) {
      try {
        current.stop();
      } catch (e) {}
      current = null;
    }
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  }

  // Toca a frase e resolve a promessa quando termina
  async function say(text, slow) {
    const c = getCtx();
    stop();
    try {
      const { clips, custom } = await loadIndex();
      const key = norm(text);
      const clip = custom[key] || clips[key];
      if (c && clip) {
        const buffer = await loadBuffer(clip.src);
        const src = c.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = slow ? 0.72 : 1;
        const vol = c.createGain();
        vol.gain.value = VOICE_VOLUME;
        src.connect(vol);
        vol.connect(c.destination);
        const start = clip.start != null ? Math.max(0, clip.start - 0.05) : 0;
        const dur = clip.dur != null ? clip.dur + 0.25 : undefined;
        current = src;
        return await new Promise((resolve) => {
          src.onended = () => {
            if (current === src) current = null;
            resolve(true);
          };
          if (dur != null) src.start(0, start, dur);
          else src.start(0);
        });
      }
    } catch (e) {
      /* cai para a voz do navegador */
    }
    return browserSay(text, slow);
  }

  let keepAlive = null;
  function browserSay(text, slow) {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      keepAlive = u; // evita o bug do Chrome que descarta a fala antes de tocar
      const voices = speechSynthesis.getVoices();
      const v =
        voices.find((x) => x.lang === "en-US" && x.localService) ||
        voices.find((x) => x.lang === "en-US") ||
        voices.find((x) => x.lang && x.lang.startsWith("en"));
      if (v) u.voice = v;
      u.lang = "en-US";
      u.rate = slow ? 0.6 : 0.95;
      u.volume = VOICE_VOLUME;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      setTimeout(() => speechSynthesis.speak(u), 60);
      setTimeout(() => resolve(false), 12000);
    });
  }

  // Baixa o áudio da unidade com antecedência
  function preload(texts) {
    loadIndex().then(({ clips, custom }) => {
      const srcs = new Set();
      texts.forEach((t) => {
        const clip = custom[norm(t)] || clips[norm(t)];
        if (clip) srcs.add(clip.src);
      });
      if (getCtx()) srcs.forEach((s) => loadBuffer(s).catch(() => {}));
    });
  }

  return {
    say,
    stop,
    preload,
    unlock: () => getCtx(),
    click: () => safe(() => tone(600, 0, 0.06, "sine", 0.07)),
    select: () => safe(() => tone(500, 0, 0.05, "sine", 0.06)),
    correct: () =>
      safe(() => {
        tone(660, 0, 0.12, "sine", 0.14);
        tone(880, 0.09, 0.18, "sine", 0.13);
      }),
    wrong: () =>
      safe(() => {
        tone(240, 0, 0.16, "sawtooth", 0.07);
        tone(180, 0.08, 0.18, "sawtooth", 0.06);
      }),
    tryAgain: () => safe(() => tone(330, 0, 0.22, "sine", 0.09)),
    complete: () =>
      safe(() => {
        tone(523.25, 0, 0.14, "sine", 0.13);
        tone(659.25, 0.12, 0.14, "sine", 0.13);
        tone(783.99, 0.24, 0.24, "sine", 0.14);
      }),
    levelUp: () =>
      safe(() => {
        tone(392, 0, 0.12, "triangle", 0.11);
        tone(523.25, 0.1, 0.12, "triangle", 0.11);
        tone(659.25, 0.2, 0.3, "triangle", 0.13);
      }),
    ring: () =>
      safe(() => {
        for (let i = 0; i < 2; i++) {
          tone(440, i * 1.2, 0.35, "sine", 0.08);
          tone(480, i * 1.2, 0.35, "sine", 0.08);
        }
      }),
  };
})();

// Microfone: permissão, medidor de volume, reconhecimento de fala e gravação
const Mic = (() => {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let meter = null;
  let recognitionBroken = false; // vira true se não houver nenhum jeito de reconhecer fala
  let useLocal = false; // reconhecimento no próprio computador (Chrome novo), sem depender da internet

  // Estado do reconhecimento offline: available | downloadable | downloading | unavailable
  async function localStatus() {
    try {
      if (!Rec || !Rec.available) return "unavailable";
      return await Rec.available({ langs: ["en-US"], processLocally: true });
    } catch (e) {
      return "unavailable";
    }
  }
  // Precisa ser chamado dentro de um clique (o Chrome exige). Resolve true quando estiver pronto.
  async function installLocal(onWait) {
    if (!Rec || !Rec.install) return false;
    const ok = await Rec.install({ langs: ["en-US"], processLocally: true }).catch(() => false);
    for (let i = 0; i < 60; i++) {
      const s = await localStatus();
      if (s === "available") {
        useLocal = true;
        return true;
      }
      if (s === "unavailable") return false;
      if (onWait) onWait(i);
      await new Promise((r) => setTimeout(r, 2000));
    }
    return ok && (await localStatus()) === "available";
  }

  const canCapture = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  // Reconhece a fala de verdade (Chrome/Edge/Safari)
  const supported = () => !!Rec && !recognitionBroken;
  // Pelo menos consegue gravar (usado no modo "compare com a Bibi")
  const canRecord = () => canCapture() && !!window.MediaRecorder;

  async function permission() {
    try {
      return (await navigator.permissions.query({ name: "microphone" })).state; // granted | prompt | denied
    } catch (e) {
      return "prompt";
    }
  }

  // Abre o microfone de verdade: é isso que faz o Chrome mostrar o aviso "Permitir microfone"
  async function openStream() {
    if (!canCapture()) throw new Error("no-mic");
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (e.name === "NotAllowedError" || e.name === "SecurityError") throw new Error("denied");
      if (e.name === "NotFoundError" || e.name === "OverconstrainedError") throw new Error("no-mic");
      if (e.name === "NotReadableError") throw new Error("busy");
      throw new Error("no-mic");
    }
  }

  async function ensurePermission() {
    const s = await openStream();
    s.getTracks().forEach((t) => t.stop());
    return true;
  }

  function startMeter(stream, onLevel) {
    stopMeter();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const data = new Uint8Array(an.fftSize);
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
        if (onLevel) onLevel(Math.min(1, peak / 70));
        raf = requestAnimationFrame(tick);
      };
      tick();
      meter = { ctx, stream, stop: () => cancelAnimationFrame(raf) };
    } catch (e) {
      meter = { stream, stop() {} };
    }
  }
  function stopMeter() {
    if (!meter) return;
    meter.stop();
    meter.stream.getTracks().forEach((t) => t.stop());
    if (meter.ctx) meter.ctx.close().catch(() => {});
    meter = null;
  }

  // Resolve com as frases entendidas (melhores primeiro). Erros: denied, no-mic, busy, network, unsupported
  async function listen({ onInterim, onLevel } = {}) {
    if (!Rec) throw new Error("unsupported");
    stop();
    const stream = await openStream(); // garante a permissão antes de começar
    if (!useLocal && (await localStatus()) === "available") useLocal = true;
    startMeter(stream, onLevel);
    return new Promise((resolve, reject) => {
      rec = new Rec();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.continuous = false;
      if (useLocal) rec.processLocally = true;
      let finals = [];
      let lastInterim = "";
      let failed = null;
      const guard = setTimeout(() => stop(), 9000); // não fica ouvindo para sempre
      rec.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        if (res.isFinal) finals = Array.from(res).map((a) => a.transcript);
        else {
          lastInterim = res[0].transcript;
          if (onInterim) onInterim(lastInterim);
        }
      };
      rec.onerror = (e) => {
        if (e.error === "no-speech" || e.error === "aborted") return;
        const serviceDown = ["network", "service-not-allowed", "language-not-supported"].includes(e.error);
        if (serviceDown && useLocal) useLocal = false; // o offline falhou: volta a tentar o online
        failed = e.error === "not-allowed" ? "denied" : e.error === "audio-capture" ? "no-mic" : serviceDown ? "network" : e.error;
      };
      rec.onend = () => {
        clearTimeout(guard);
        rec = null;
        stopMeter();
        if (failed) reject(new Error(failed));
        else resolve(finals.length ? finals : lastInterim ? [lastInterim] : []);
      };
      try {
        rec.start();
      } catch (err) {
        clearTimeout(guard);
        stopMeter();
        rec = null;
        reject(new Error("unsupported"));
      }
    });
  }

  function stop() {
    if (rec) {
      try {
        rec.stop();
      } catch (e) {}
    }
  }

  // Gravação simples (sem reconhecimento): devolve { stop(): Promise<url> }
  async function record({ onLevel } = {}) {
    const stream = await openStream();
    startMeter(stream, onLevel);
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.start();
    const auto = setTimeout(() => mr.state === "recording" && mr.stop(), 8000);
    const done = new Promise((resolve) => {
      mr.onstop = () => {
        clearTimeout(auto);
        stopMeter();
        resolve(URL.createObjectURL(new Blob(chunks, { type: mr.mimeType || "audio/webm" })));
      };
    });
    return { stop: () => (mr.state === "recording" && mr.stop(), done), done };
  }

  // Texto amigável para cada erro
  function explain(code) {
    return (
      {
        denied:
          "O microfone está bloqueado. Clique no ícone 🔒 (ou 🎤) ao lado do endereço do site, escolha <b>Microfone → Permitir</b> e recarregue a página.",
        "no-mic": "Não encontrei nenhum microfone. Conecte um fone com microfone e tente de novo.",
        busy: "Outro programa está usando o microfone. Feche-o e tente de novo.",
        network: "O reconhecimento de voz online do navegador não respondeu.",
        unsupported: "Este navegador não reconhece fala. Use o Chrome ou o Edge — ou o modo de gravação.",
      }[code] || "Não foi possível usar o microfone agora."
    );
  }

  return { supported, canRecord, permission, ensurePermission, listen, stop, record, explain, localStatus, installLocal, markBroken: () => (recognitionBroken = true) };
})();

document.addEventListener("click", (e) => {
  Sounds.unlock();
  const el = e.target.closest(".btn, .lesson-node, .side-link");
  if (el) Sounds.click();
});
