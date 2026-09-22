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
      /* Web Audio not available — sound is optional, never blocks the UI */
    }
  }

  // Pronúncia em inglês usando a voz do próprio navegador
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = speechSynthesis.getVoices();
    return (
      voices.find((v) => v.lang === "en-US" && /Google|Natural|Samantha|Aria|Jenny/i.test(v.name)) ||
      voices.find((v) => v.lang === "en-US") ||
      voices.find((v) => v.lang && v.lang.startsWith("en")) ||
      null
    );
  }
  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = () => (voice = pickVoice());
  }

  function say(text, slow) {
    safe(() => {
      if (!("speechSynthesis" in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      voice = voice || pickVoice();
      if (voice) u.voice = voice;
      u.lang = "en-US";
      u.rate = slow ? 0.55 : 0.95;
      speechSynthesis.speak(u);
    });
  }

  return {
    say,
    canSpeak: () => "speechSynthesis" in window,
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
  };
})();

document.addEventListener("click", (e) => {
  const el = e.target.closest(".btn, .lesson-node, .side-link");
  if (el) Sounds.click();
});
