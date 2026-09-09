const EMBED_DIM = 768;
const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

function fallbackEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
    vec[i % EMBED_DIM] += ((h >>> 0) % 1000) / 1000 - 0.5;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

async function embedWithGemini(texts: string[]): Promise<number[][] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const out: number[][] = [];
  for (const text of texts) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIM,
        }),
      },
    );
    if (!res.ok) {
      console.warn('Gemini embedding failed', res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as {
      embedding?: { values?: number[] };
    };
    const values = json.embedding?.values;
    if (!values?.length) return null;
    out.push(values);
  }
  return out;
}

async function embedWithOpenRouter(texts: string[]): Promise<number[][] | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: texts,
    }),
  });
  if (!res.ok) {
    console.warn('OpenRouter embedding failed', res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const data = json.data;
  if (!data?.length) return null;
  return data.map((d) => {
    const e = d.embedding;
    if (e.length === EMBED_DIM) return e;
    if (e.length > EMBED_DIM) return e.slice(0, EMBED_DIM);
    return [...e, ...new Array(EMBED_DIM - e.length).fill(0)];
  });
}

export async function embedTexts(texts: string[]): Promise<{
  vectors: number[][];
  provider: 'gemini' | 'openrouter' | 'fallback';
}> {
  const gemini = await embedWithGemini(texts);
  if (gemini) return { vectors: gemini, provider: 'gemini' };
  const or = await embedWithOpenRouter(texts);
  if (or) return { vectors: or, provider: 'openrouter' };
  return {
    vectors: texts.map((t) => fallbackEmbedding(t)),
    provider: 'fallback',
  };
}

export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
