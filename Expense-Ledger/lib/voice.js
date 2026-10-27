/* Shared speech-recognition engine for the mic buttons in this app.
   Primary engine: MediaRecorder + server-side Whisper transcription
   (accuracy + domain vocabulary, works without Chrome's speech service).
   Fallback engine: the browser's Web Speech API. */

/* Probe microphone access up front: triggers the browser permission prompt
   and surfaces accurate failure reasons (blocked / missing / busy device). */
export async function ensureMicPermission() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { ok: false, name: "unsupported" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return { ok: true };
  } catch (error) {
    return { ok: false, name: error.name };
  }
}

export function micErrorMessage(name) {
  if (name === "cancelled") return null;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "🎙️ Mic is BLOCKED. Click the 🔒/① icon in the address bar → Site settings → Microphone → Allow, then reload the page.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "🎙️ No microphone found. Enable a mic (Windows Settings → Privacy & security → Microphone) and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "🎙️ Your mic seems busy — close other apps using it (Zoom/Teams/Discord) and try again.";
    case "network":
      return "🎙️ Speech recognition needs an internet connection right now.";
    case "no-speech":
      return "🎙️ I couldn't hear anything. Check your mic isn't muted and speak a bit louder.";
    case "audio-capture":
      return "🎙️ Couldn't start audio capture. Reconnect your microphone and try again.";
    case "transcribe":
      return "🎙️ Transcription failed on the server. Check the API key / connection and try again.";
    case "unsupported":
    case "browser":
      return "🎙️ Voice input isn't supported in this browser. Try Chrome or Edge.";
    default:
      return `🎙️ Mic error: ${name}`;
  }
}

/* ---------- Spoken-numbers normalisation ("two fifty" → 250) ---------- */

const ONES = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9
};
const TEENS_BASE = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, ten: 10 };
TEENS_BASE.forEach((word, idx) => { TENS[word] = 10 + idx; });

const NUMBER_WORDS = new Set([
  ...Object.keys(ONES),
  ...Object.keys(TENS),
  "hundred", "thousand", "lakh", "lac", "and", "point", "dot"
]);

/* Understand Indian-English number phrases:
   "two hundred fifty" → 250, "two fifty" → 250 (colloquial), "one lakh" → 100000,
   "two thousand five hundred" → 2500, "one point five" → 1.5 */
function parseNumberRun(tokens) {
  let total = 0;
  let current = 0;
  let decimalPart = "";
  let usedMultiplier = false;

  for (let k = 0; k < tokens.length; k += 1) {
    const word = tokens[k];
    if (word === "and") continue;

    if (word === "point" || word === "dot") {
      const digits = [];
      while (k + 1 < tokens.length && ONES[tokens[k + 1]] != null) {
        digits.push(String(ONES[tokens[k + 1]]));
        k += 1;
      }
      if (digits.length) decimalPart = `.${digits.join("")}`;
      continue;
    }

    if (word === "hundred") {
      current = (current || 1) * 100;
      usedMultiplier = true;
      continue;
    }
    if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      usedMultiplier = true;
      continue;
    }
    if (word === "lakh" || word === "lac") {
      total += (current || 1) * 100000;
      current = 0;
      usedMultiplier = true;
      continue;
    }

    if (TENS[word] != null) {
      if (current > 0 && current < 10 && !usedMultiplier) {
        current = current * 100 + TENS[word]; /* "two fifty" = 250 */
      } else {
        current += TENS[word];
      }
      continue;
    }
    if (ONES[word] != null) {
      current += ONES[word];
      continue;
    }
    break;
  }

  total += current;
  if (total === 0) return null;
  return `${total}${decimalPart}`;
}

export function normalizeVoiceText(text) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return "";
  /* Common mis-hearings of "rupees". */
  const cleaned = lower.replace(/\brupees?\b|\brupies?\b|\brupes?\b/g, "rupees");

  const words = cleaned.split(/[^a-z0-9]+/).filter(Boolean);
  const output = [];
  let i = 0;

  while (i < words.length) {
    const run = [];
    let j = i;
    while (j < words.length) {
      const word = words[j];
      if (NUMBER_WORDS.has(word)) {
        /* "and"/"point" only make sense inside a run. */
        if ((word === "and" || word === "point" || word === "dot") && run.length === 0) break;
        run.push(word);
        j += 1;
      } else break;
    }

    if (run.length && run.some(word => /[a-z]/.test(word))) {
      const value = parseNumberRun(run);
      if (value != null) {
        output.push(value);
        i = j;
        continue;
      }
    }
    while (i < j) {
      output.push(words[i]);
      i += 1;
    }
    if (i === j) {
      output.push(words[i]);
      i += 1;
    }
  }
  return output.join(" ");
}

/* ---------- Primary engine: record → Whisper via /api/speech ---------- */

export function createMediaRecorderRecognizer({ lang, onResult, onDone, onError, onFallback, onLevel, onAutoStop }) {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof window === "undefined" || !window.MediaRecorder) {
    return null;
  }

  let recorder = null;
  let stream = null;
  let audioCtx = null;
  let rafTimer = null;
  let durationTimer = null;
  let finished = false;
  let hadSpeech = false;
  let silenceStart = null;
  let stopping = false;

  const cleanup = () => {
    if (rafTimer) { clearTimeout(rafTimer); rafTimer = null; }
    if (durationTimer) { clearTimeout(durationTimer); durationTimer = null; }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (error) {}
      audioCtx = null;
    }
  };

  const controller = {
    stop() {
      stopping = true;
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch (error) { cleanup(); }
      } else {
        cleanup();
      }
    },
    async start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (error) {
        cleanup();
        if (onError) onError(error.name || "audio-capture");
        if (onDone) onDone("");
        return;
      }

      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => {
        try { return window.MediaRecorder.isTypeSupported(type); } catch (err) { return false; }
      });

      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 128000
      });
      const chunks = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        cleanup();
        if (finished) return;
        finished = true;

        if (!blob || blob.size === 0) {
          if (onError) onError("no-speech");
          if (onDone) onDone("");
          return;
        }

        try {
          const form = new FormData();
          form.append("audio", blob, "speech.webm");
          if (lang) form.append("language", String(lang).split("-")[0]);
          form.append("refine", "1");
          /* Domain prompt biases Whisper toward ledger vocabulary: amounts,
             categories and command words transcribe far more reliably. */
          form.append(
            "prompt",
            "PocketWise expense ledger voice commands. Amounts in Indian rupees. Categories: food, transport, shopping, bills, entertainment, health, other. Words like: add, spent, paid, bought, remove, delete, cancel, set, change, monthly savings goal, limit."
          );

          const res = await fetch("/api/speech", { method: "POST", body: form });
          const data = await res.json().catch(() => ({}));
          const text = String(data?.text || "").trim();

          if (!res.ok) {
            if (onError) onError("transcribe");
            if (onDone) onDone("");
            return;
          }
          if (!text) {
            if (onError) onError("no-speech");
            if (onDone) onDone("");
            return;
          }

          if (onResult) onResult(text, "");
          if (onDone) onDone(text);
        } catch (error) {
          if (onError) onError("transcribe");
          if (onDone) onDone("");
        }
      };

      recorder.start(250);
      if (onFallback) onFallback();

      /* Live RMS monitoring with ADAPTIVE calibration: the first second
         measures the room's noise floor, then the speech threshold is set
         relative to it (max(0.032, floor×3)) — works in loud rooms and
         quiet ones. Auto-stop after 2s of silence once you spoke; 20s cap. */
      try {
        const startedAt = Date.now();
        let noiseFloor = 0.008;
        const floorSamples = [];
        audioCtx = new AudioContext();
        /* Android may spawn the context suspended — resume inside the
           user's tap or the mic glow and silence detection never tick. */
        if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.fftSize);
        let speechThreshold = 0.045;
        let lastEmit = 0;

        const tick = () => {
          if (!audioCtx || finished) return;
          analyser.getByteTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const value = (buffer[i] - 128) / 128;
            sum += value * value;
          }
          const level = Math.sqrt(sum / buffer.length);

          if (Date.now() - startedAt < 1000) {
            /* warm-up: sample the room's noise floor */
            if (Date.now() - startedAt > 120) floorSamples.push(level);
          } else if (Date.now() - startedAt < 1400) {
            /* finalize threshold from the floor right after warm-up */
            if (floorSamples.length) {
              noiseFloor = Math.max(0.004, Math.min(...floorSamples));
              speechThreshold = Math.max(0.032, noiseFloor * 3);
            }
          } else if (level > speechThreshold) {
            hadSpeech = true;
            silenceStart = null;
          } else if (hadSpeech) {
            if (!silenceStart) silenceStart = Date.now();
            else if (Date.now() - silenceStart > 2000) {
              if (onAutoStop) {
                try { onAutoStop(); } catch (err) {}
              }
              controller.stop();
              return;
            }
          }

          /* Live level feedback for the UI (10fps) */
          if (onLevel && Date.now() - lastEmit > 100) {
            lastEmit = Date.now();
            try { onLevel(Math.min(1, level * 4)); } catch (err) {}
          }

          rafTimer = setTimeout(tick, 60);
        };
        tick();
      } catch (error) {
        /* Silence detection is optional. */
      }

      durationTimer = setTimeout(() => {
        if (onAutoStop) {
          try { onAutoStop(); } catch (err) {}
        }
        controller.stop();
      }, 20000);
    }
  };

  return controller;
}

/* ---------- Fallback engine: Web Speech API (continuous, live interim text) ---------- */

export function createSpeechRecognizer({ lang, onResult, onDone, onError }) {
  const SpeechRecognizer = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (!SpeechRecognizer) return null;

  const recognition = new SpeechRecognizer();
  recognition.lang = lang || "en-IN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let interimText = "";
  let silenceTimer = null;
  let restarts = 0;
  let stopped = false;
  let lastErrorName = "";

  const scheduleSilenceSubmit = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (!finalText.trim()) return;
    silenceTimer = setTimeout(() => {
      stopped = true;
      try { recognition.stop(); } catch (error) {}
    }, 2000);
  };

  recognition.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    interimText = interim;
    if (onResult) onResult(finalText, interim);
    scheduleSilenceSubmit();
  };

  recognition.onerror = event => {
    lastErrorName = event.error || "";
  };

  recognition.onend = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    const text = `${finalText} ${interimText}`.trim();

    if (text) {
      if (onResult) onResult(finalText || interimText, "");
      if (onDone) onDone(text);
      return;
    }

    const FATAL = ["not-allowed", "service-not-allowed", "permission-denied", "audio-capture"];
    const isFatal = FATAL.includes(lastErrorName);

    if (!stopped && !isFatal && restarts < 3) {
      restarts += 1;
      try {
        recognition.start();
        return;
      } catch (error) {}
    }

    if (onError) onError(stopped && !lastErrorName ? "cancelled" : lastErrorName || "no-speech");
    if (onDone) onDone(text);
  };

  return {
    recognition,
    stop() {
      stopped = true;
      if (silenceTimer) clearTimeout(silenceTimer);
      try { recognition.stop(); } catch (error) {}
    }
  };
}

/* ---------- Unified session: recorder+Whisper first, browser speech as fallback ---------- */

export function createVoiceSession({ lang, onResult, onDone, onError, onFallback, onLevel, onAutoStop }) {
  const startFallback = () => {
    const speech = createSpeechRecognizer({ lang, onResult, onDone, onError });
    if (!speech) {
      if (onError) onError("browser");
      if (onDone) onDone("");
      return;
    }
    try {
      speech.recognition.start();
    } catch (error) {
      if (onError) onError("browser");
      if (onDone) onDone("");
    }
  };

  const primary = createMediaRecorderRecognizer({ lang, onResult, onDone, onError, onFallback, onLevel, onAutoStop });
  if (!primary) {
    /* Recorder API unavailable — fall back to browser speech as primary. */
    const speech = createSpeechRecognizer({ lang, onResult, onDone, onError });
    if (!speech) return null;
    return {
      start() {
        try { speech.recognition.start(); } catch (error) {}
      },
      stop() { speech.stop(); }
    };
  }

  return {
    start() {
      Promise.resolve(primary.start()).catch(() => {
        if (onError) onError("audio-capture");
        if (onDone) onDone("");
      });
    },
    stop() {
      primary.stop();
    }
  };
}
