# Play Along Piano

Responsive play-along piano with sheet music, virtual keyboard, and a Synthesia-style falling-notes view. Uses the microphone for polyphonic pitch detection (or a MIDI keyboard via Web MIDI) so you can practice along.

## GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the app and publishes it to GitHub Pages on every push to `main` (pull requests are type-checked and built, not deployed).

One-time setup:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or run the workflow manually from the Actions tab).
3. The site is served at `https://<user>.github.io/<repo>/`, e.g. `https://dec3ptor.github.io/PianoApp/`.

GitHub Pages on a **private** repository needs a paid plan (GitHub Pro/Team/Enterprise); on the free plan the repository has to be public. The published site itself is public either way.

The build reads the site's sub-path from `BASE_PATH` (the workflow sets it from the Pages configuration), so it also works with a custom domain.

GitHub Pages is served over HTTPS, which the browser requires for microphone access, so the mic works there without any certificate setup. On an iPad/iPhone, *Share → Add to Home Screen* runs it full-screen.

## Local development

Prerequisite: Node.js 20 or newer.

```
npm install
npm run dev        # http://localhost:3000, also reachable on your LAN
```

Production build + preview:

```
npm run start      # build, then serve dist/ on port 3005
```

Browsers only allow the microphone on HTTPS or `localhost`. To test the mic on another device on your LAN, use the deployed GitHub Pages site or `npm run tunnel` (Cloudflare tunnel, needs `cloudflared.exe`).

| Script            | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Vite dev server, LAN-accessible, port 3000          |
| `npm run build`   | Production build to `dist/` (`BASE_PATH` sets the sub-path) |
| `npm run preview` | Serve `dist/`, LAN-accessible, port 3005            |
| `npm run start`   | `build` then `preview`                              |
| `npm run lint`    | TypeScript type-check (`tsc --noEmit`)              |
| `npm run tunnel`  | Expose the dev server over HTTPS with cloudflared   |

## Flow view

The app opens in the Flow view (the header buttons switch to the sheet music or keyboard). Mint notes fall onto the keyboard and flare where they land, with sparks rising from each key: white when you play the right note, rose for a wrong one. *Settings → Particle effects* turns the sparks off; *Stage lighting* dims the keyboard so the keys you need stand out. On slower devices the sparks thin out automatically if the frame rate drops, and they're off when the system asks for reduced motion.

## MIDI keyboards

Click **MIDI: Connect** in the header the first time; after that the app reconnects on its own.

- **Chrome / Edge / Opera:** allow the MIDI prompt.
- **Firefox:** Web MIDI is enabled per site through a one-time *site permission add-on*. With the keyboard plugged in, click **MIDI: Connect**, then **Continue to Installation** and **Add**. Firefox refuses MIDI access while no MIDI device is connected (restart Firefox if you plugged the keyboard in after starting it), and reports every refusal as "WebMIDI requires a site permission add-on to activate". The add-on can be removed again under *Add-ons and themes → Site permissions*.
- **Safari (macOS / iOS):** no Web MIDI. Use the microphone, or a Web MIDI–enabled iOS browser app.

## How playback works

Playback is built to stay smooth on phones and tablets:

- **Audio is scheduled on the audio clock.** `src/lib/transport.ts` hands notes to Web Audio a little ahead of time (150 ms on desktop, 300 ms on mobile) with exact start times, so note timing doesn't depend on how busy the page is. The playhead follows the audio clock too, compensated for output latency.
- **One lightweight sampler.** `src/lib/piano.ts` plays the Salamander Grand Piano samples directly with Web Audio (one buffer source and gain per note, one shared `AudioContext`). Only the velocity layer the app uses is loaded, the samples this piece needs are fetched and decoded in the background when the page opens, and they're kept in Cache Storage for the next visit.
- **No React render per frame.** Components subscribe to the transport and only re-render when something they show changes (a note starts or ends, a new measure). The falling notes move with a single CSS transform per frame; the sheet music re-renders once per measure and highlights notes by toggling CSS classes. VexFlow is only downloaded when a sheet view is opened.
- Playback pauses when the page is hidden or when iOS takes the audio away (phone call, Siri).

## Browser support

Modern Chrome, Edge, Firefox and Safari. `@vitejs/plugin-legacy` also emits an ES5 bundle with polyfills for older browsers (e.g. old iPads running the "Web MIDI Browser" app), but the Tailwind CSS v4 styles need Safari/iOS 15.4 or newer to render correctly.

Web MIDI input works in Chrome/Edge, Firefox (with its site permission add-on, see above) and Web MIDI-enabled iOS browsers. The microphone needs HTTPS.

## Credits

Piano sound: Salamander Grand Piano by Alexander Holm (CC-BY 3.0), loaded from the [tambien/Piano](https://github.com/tambien/Piano) sample set.
