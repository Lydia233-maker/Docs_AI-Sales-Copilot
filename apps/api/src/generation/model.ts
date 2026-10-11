export type ModelAsker = (system: string, user: string) => Promise<string>;

let testAsker: ModelAsker | null = null;

export function setModelClientForTests(asker: ModelAsker | null) {
  testAsker = asker;
}

export function hasModelClient() {
  return Boolean(testAsker || process.env.DEEPSEEK_API_KEY);
}

export async function askModel(system: string, user: string) {
  if (testAsker) return testAsker(system, user);
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('model status');
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('empty model response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export function parseModelJson(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('model json');
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

export async function classifyQuote(quote: string): Promise<'preference' | 'caution' | 'unclassified'> {
  if (!hasModelClient()) return 'unclassified';
  try {
    const raw = await askModel(
      'Classify the shopper message. Reply with JSON only: {"kind":"preference"} or {"kind":"caution"}. Do not invent a kind when the text is unclear.',
      quote,
    );
    if (!raw) return 'unclassified';
    const data = parseModelJson(raw);
    if (data.kind === 'preference' || data.kind === 'caution') return data.kind;
  } catch {
    return 'unclassified';
  }
  return 'unclassified';
}
