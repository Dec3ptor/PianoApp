# Play Along Piano

Responsive play-along piano with sheet music, virtual keyboard, and a Synthesia-style falling-notes view. Uses the microphone for polyphonic pitch detection so you can practice along.

## Prerequisites

- Node.js (LTS)

## Install

```
npm install
```

## Run

Dev server (with HMR):

```
npm run dev
```

Production build + preview:

```
npm run start
```

Both servers bind to `0.0.0.0` over HTTPS (self-signed cert via `@vitejs/plugin-basic-ssl`):

- Dev:     `https://localhost:3000`  and  `https://<your-LAN-ip>:3000`
- Preview: `https://localhost:4173`  and  `https://<your-LAN-ip>:4173`

## Using on other devices on your LAN

1. Find your machine's LAN IP (e.g. `ipconfig` on Windows - look for IPv4 on your active adapter).
2. On the phone/laptop/tablet, open `https://<that-ip>:3000` (or `:4173` for preview).
3. The browser will warn about the self-signed certificate - accept it once per device. This is required: browsers only allow microphone access over HTTPS (or `localhost`), so plain HTTP over the LAN will not work.
4. Make sure Windows Firewall allows inbound connections on the chosen port for your Private network.

## Scripts

| Script           | What it does                                       |
| ---------------- | -------------------------------------------------- |
| `npm run dev`    | Vite dev server, HTTPS, LAN-accessible, port 3000  |
| `npm run build`  | Production build to `dist/`                        |
| `npm run preview`| Serve `dist/` over HTTPS, LAN-accessible, port 4173|
| `npm run start`  | `build` then `preview`                             |
| `npm run lint`   | TypeScript type-check (`tsc --noEmit`)             |
