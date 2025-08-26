# PWA ChatGPT (Vercel)

A minimal ChatGPT-style **Progressive Web App** with a Vercel serverless API.

## Quick deploy
1. Create a GitHub repo and upload this folder's **contents**.
2. On **vercel.com**: New → Project → import your repo (Framework: *Other*).
3. After first deploy, go to **Settings → Environment Variables** and add:
   - `OPENAI_API_KEY = sk-your-real-key`
4. Redeploy. Open the URL. In Safari: **Share → Add to Home Screen** to install as PWA.

## Files
- `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`
- `icons/` — PWA icons
- `api/chat.js` — serverless function that calls OpenAI Responses API
- `vercel.json` — basic config

## Change model
Edit `api/chat.js` → `model: 'gpt-4o-mini'`.

## Notes
- Do **not** expose your API key in the frontend.
- PWA caches the UI; replies still need network.
