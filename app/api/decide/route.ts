export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: 'Add OPENAI_API_KEY to the server environment to enable classification.' }, { status: 503 });
  if (Number(request.headers.get('content-length') || 0) > 8_000_000) return Response.json({ error: 'Image is too large.' }, { status: 413 });
  let body: { image?: unknown; instructions?: unknown };
  try { const parsed = await request.json(); if (!parsed || typeof parsed !== "object") throw new Error("Invalid request"); body = parsed as typeof body; } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (typeof body.image !== 'string' || body.image.length > 8_000_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) return Response.json({ error: 'Provide a JPEG, PNG, or WebP image.' }, { status: 400 });
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim().slice(0,3000) : '';
  if (!instructions) return Response.json({ error: 'Classification instructions are required.' }, { status: 400 });
  const started = Date.now();
  try {
    const response = await fetch('https://api.openai.com/v1/decisions', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model: 'gpt-6-luna', input: [{ role: 'user', content: [{ type: 'input_text', text: 'Inspect the fruit in this photograph.' }, { type: 'input_image', image_url: body.image }] }], questions: [{ type: 'choice', name: 'condition', instructions, choices: [
        { value: 'healthy', description: 'Fruit appears fresh and intact, without visible signs of rot. Minor natural marks are acceptable.' },
        { value: 'rotten', description: 'Visible decay, mold, substantial deterioration, or spoiled areas.' },
        { value: 'unclear', description: 'Image does not provide enough evidence, contains conflicting conditions, or does not show fruit.' }
      ] }] })
    });
    const result = await response.json() as { error?: { message?: string }; answers?: { type: string; choice?: string }[]; model?: string; usage?: unknown };
    if (!response.ok) return Response.json({ error: result.error?.message || `OpenAI returned HTTP ${response.status}.` }, { status: response.status === 429 ? 429 : 502 });
    const answer = result.answers?.[0];
    if (!answer || (answer.type !== 'refusal' && !['healthy','rotten','unclear'].includes(answer.choice || ''))) return Response.json({ error: 'Unexpected Decisions response. No result was saved.' }, { status: 502 });
    return Response.json({ ...result, elapsedMs: Date.now() - started, evaluatedAt: new Date().toISOString() });
  } catch { return Response.json({ error: 'Could not reach OpenAI or the request timed out. Try again.' }, { status: 502 }); }
}
