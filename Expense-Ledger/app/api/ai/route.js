import { NextResponse } from "next/server";

const MODEL = "gpt-4o-mini";

export async function POST(request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI unavailable" }, { status: 503 });

  let body;
  try { body = await request.json(); } catch (e) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt || prompt.length > 8000) {
    return NextResponse.json({ error: "Invalid input size" }, { status: 400 });
  }
  const system = typeof body?.system === "string" ? body.system.slice(0, 2000) : "";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
        temperature: 0.2
      })
    });
    if (!res.ok) return NextResponse.json({ error: "AI request failed" }, { status: 502 });
    const data = await res.json();
    return NextResponse.json({ text: data?.choices?.[0]?.message?.content || "" });
  } catch (e) {
    return NextResponse.json({ error: "AI unavailable" }, { status: 502 });
  }
}