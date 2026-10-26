import { NextResponse } from "next/server";

/* Transcribes uploaded audio with Groq's Whisper model. Used as a fallback
   speech engine when the browser's built-in SpeechRecognition web service
   is unreachable (VPN/proxy/firewall or Chromium forks without the service). */
export async function POST(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "API Key missing" }, { status: 500 });

  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No audio file" }, { status: 400 });
    }

    const language = form.get("language");
    /* Domain prompt biases transcription toward ledger vocabulary so
       categories, commands and rupee amounts come out exactly. */
    const prompt = form.get("prompt")
      ? String(form.get("prompt"))
      : "PocketWise expense ledger voice commands. Amounts in Indian rupees. Categories: food, transport, shopping, bills, entertainment, health, other. Words like: add, spent, paid, bought, remove, delete, cancel, set, change, monthly savings goal, limit.";

    const attempt = async model => {
      const upstream = new FormData();
      upstream.append("file", file, file.name || "speech.webm");
      upstream.append("model", model);
      upstream.append("response_format", "json");
      upstream.append("temperature", "0");
      if (language) upstream.append("language", String(language));
      upstream.append("prompt", prompt);

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream
      });

      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return String(data?.text || "").trim() || null;
    };

    /* Ensemble: both Whisper variants in parallel; whichever produces a
       transcript wins — protects against a single model mishearing. */
    const [primary, turbo] = await Promise.allSettled([
      attempt("whisper-large-v3"),
      attempt("whisper-large-v3-turbo")
    ]);
    let text =
      [primary, turbo]
        .map(result => (result.status === "fulfilled" ? result.value : null))
        .find(Boolean) || "";

    /* Second pass: an LLM cleans up transcription errors using the ledger
       vocabulary (fixes "spend to hundreds on pizza" → "spent 200 on pizza"). */
    if (text && form.get("refine") === "1") {
      try {
        const chatRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            temperature: 0,
            messages: [
              {
                role: "system",
                content:
                  "You clean up speech-to-text transcripts for an expense ledger app. Fix misrecognised words, numbers and currency terms while preserving the meaning exactly. Vocabulary context: categories food/transport/shopping/bills/entertainment/health/other; commands add/spent/paid/bought/remove/delete/cancel/set/change; monthly savings goal; category limit; rupees. Keep amounts as digits. Return ONLY the corrected command text with no explanation."
              },
              { role: "user", content: text }
            ]
          })
        });
        if (chatRes.ok) {
          const chatData = await chatRes.json();
          const refined = String(chatData?.choices?.[0]?.message?.content || "").trim();
          if (refined) text = refined;
        }
      } catch (error) {
        /* Refinement failed — the raw transcript is still usable. */
      }
    }

    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json({ error: `System Error: ${error.message}` }, { status: 500 });
  }
}
