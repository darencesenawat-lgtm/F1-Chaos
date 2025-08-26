export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing on Vercel' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return res.status(400).json({ error: 'messages is required' });

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', input: messages })
    });

    const data = await r.json();

    // If OpenAI returned an error, bubble it up
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || `OpenAI error (${r.status})` });
    }

    // Robust text extraction
    let text = data?.output_text;
    if (!text && Array.isArray(data?.output)) {
      text = data.output
        .flatMap(o => o?.content || [])
        .map(c => (c?.text?.value ?? c?.text ?? ''))
        .join('')
        .trim();
    }

    if (!text) return res.status(200).json({ error: 'No text in OpenAI response', raw: data, reply: '' });

    return res.status(200).json({ reply: text });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Server error' });
  }
}
