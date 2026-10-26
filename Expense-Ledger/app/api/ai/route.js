import { NextResponse } from "next/server";

const MODEL = "openai/gpt-oss-20b";

export async function POST(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "API Key missing" }, { status: 500 });

  try {
    const body = await request.json();
    const prompt = body.prompt || "Hello";
    const system =
      typeof body.system === "string" && body.system.trim()
        ? body.system.trim()
        : `Extract expense details. JSON only: {"action": "add", "category": "food|transport|shopping|bills|entertainment|health|other", "amount": number, "reason": "string"}`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: `${system}\nReturn ONLY raw JSON. No markdown fences, no single quotes, no explanation.` },
          { role: "user", content: prompt }
        ],
        temperature: 0,
        response_format: { type: "json_object" }
      })
    });

    if (!res.ok) {
      const errorBody = await res.text();
      return NextResponse.json({ error: `Groq says: ${errorBody}` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ text: data?.choices?.[0]?.message?.content || "" });
  } catch (e) {
    return NextResponse.json({ error: `System Error: ${e.message}` }, { status: 500 });
  }
}