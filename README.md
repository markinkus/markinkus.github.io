# Markino Frame App

GitHub Pages app built with Vite + React for Brilliant Labs Frame.

It can connect to Frame over Web Bluetooth, upload the Lua app, show text/dashboard content, capture photos, generate sprites, send a Leaflet map snapshot, and send Gemini prompts with an optional captured image.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

You can also paste the Gemini API key directly in the app UI. On GitHub Pages everything runs in the browser, so any `VITE_GEMINI_API_KEY` value is public in the built JavaScript. Use a backend/proxy if the key must remain secret.

The old hardcoded Gemini key was removed from source. Rotate it before using the project again.

## Scripts

```bash
npm run check
npm run build
npm run preview
```

`npm run build` writes the static site to `docs/`, which is the folder GitHub Pages should serve.

## Frame Notes

The browser uploads the standard Lua libraries needed by `lua/markino_frame_app.lua`:

- `data.min`
- `plain_text.min`
- `camera.min`
- `sprite.min`
- `image_sprite_block.min`
- `text_sprite_block.min`

The app then sends structured `frame-msg` payloads for text, camera capture, single sprites, image blocks, and text sprite blocks.

Web Bluetooth requires a compatible Chromium browser on HTTPS or `localhost`.
