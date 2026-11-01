# Bot on your phone: research (2026-11-01)

Goal: Bot as an app on your phone, with (a) push notifications, (b) "Hey Bot" voice, (c) reminders, (d) Gemini for the voice part.

How to read the labels: **[sourced]** = I found it in a source, linked in the list at the end. **[mine]** = my own background knowledge, not checked against a page today. **[unverified]** = I could not confirm it, or sources disagree. Many sources below are blogs, not official docs, so prices and version numbers need a re-check on the official page before you spend money or build on them.

## The short version

1. **Reminders work today, without any phone.** Bot now saves reminders and the page shows them (banner + browser notification) while it is open. Nothing here needs an account or a package.
2. **Push to the phone is possible**, and Bot only needs *outgoing* connections to do it. It needs HTTPS on the phone side, which means Tailscale, and a login before the phone may talk to Bot.
3. **A real "Hey Bot" in the background is not possible from a web page.** A PWA cannot listen with the screen off. The honest first step is a mic button (built). Real wake word needs either a small native Android wrapper, or using the phone's own assistant ("Hey Google, open Bot").
4. **Gemini for voice is possible but needs a separate Google AI Studio API key.** Your Google AI Pro plan very probably does not include API use. The free tier exists but is limited. The cheap and good first version is: phone's built-in speech-to-text, Bot as it is now, phone's built-in text-to-speech. Gemini voice (Live API) is a later upgrade.

---

## 1. Web Push for a PWA

**New terms.**
- **PWA (Progressive Web App):** a normal web page that the phone can install like an app (own icon, no browser bar). It needs a *manifest* (a small JSON file with name, icons, colors) and works best with a service worker. Built in this branch.
- **Service worker:** a small script the browser keeps alive next to your page, even when the page is closed. It is what wakes up when a push arrives. Built in this branch (`public/sw.js`), but deliberately it caches nothing.
- **Push API / push service:** the browser gets a unique *subscription* (an address) from a push service run by the browser vendor (Google's for Chrome, Apple's for Safari, Mozilla's for Firefox). Your server sends a message to that address; the push service holds it and delivers it to the phone when the phone is online. The phone keeps ONE connection open to its vendor, so Bot never needs to reach the phone directly. [mine]
- **VAPID keys:** a key pair (ES256, on the P-256 curve) that identifies *your* server to the push service. The public half goes to the browser when it subscribes; every push you send carries a short signed token (a JWT) proving it comes from you. Generated once, the private half is a secret and goes in `.env`. [mine, standard: RFC 8292]
- **Payload encryption:** the push service is a stranger, so the message text is encrypted for the phone with a key the phone created (ECDH key agreement + HKDF + AES-128-GCM, "aes128gcm", RFC 8291/8188). [mine]

**Flow.** Page asks permission (must follow a tap) → browser creates a subscription via the push service → page sends the subscription to Bot → Bot stores it (`data/`, private) → when a reminder is due, Bot encrypts a small message, signs a VAPID token, and does an HTTPS POST to the subscription address → the phone's service worker gets a `push` event and calls `showNotification`. [mine]

**Can your Windows PC do this with outgoing connections only?** Yes. Bot only makes an outgoing HTTPS POST to the push service (for example Google's `fcm.googleapis.com` for Chrome on Android, Apple's `web.push.apple.com` for iOS). No port needs to be opened on your router. [mine; the general design is the standard Web Push model]
Two catches: (1) the PC has to be on and Bot running at the due time (catch-up covers a reminder that was missed, but late); (2) the *phone* needs Bot's page over HTTPS to subscribe and to install, see part 4.

**Android Chrome vs iPhone.**
- **Android + Chrome:** works in a normal tab or an installed PWA, once you tap "allow". [mine]
- **iPhone/iPad:** web push works since iOS/iPadOS 16.4, **but only for a site added to the Home Screen**, and the permission request must follow a user tap. A site in a normal Safari tab cannot get push. [sourced: Pushpad, MagicBell, Webscraft] The manifest must declare it as a web app, otherwise `registration.pushManager` is undefined. [sourced: Pushpad] One source says push does not work for PWAs in the EU since iOS 17.4 [sourced: Webscraft, one blog, **unverified** by Apple's own docs]. Israel is not in the EU, so this should not matter for you. [mine]
- A German edition of one blog claims all iOS browsers have push by default since iOS 17; the other sources contradict it. Treat as wrong. [unverified]
- Newer WebKit work ("Declarative Web Push", Safari 18.4) lets push show a notification without a service worker running JavaScript. [sourced: Webscraft summary] We do not need it.

**HTTPS requirement.** Service workers, push and the install prompt need a "secure context": `https://`, or `localhost` for development. [mine, standard] So `http://192.168.x.x:3000` from your phone would **not** work. This is why Tailscale's HTTPS name is part of the plan.

**Node built-ins only, or the `web-push` package?**
- *Built-ins:* Node's `crypto` has everything: `createECDH('prime256v1')`, `hkdfSync`, `createCipheriv('aes-128-gcm')`, and `crypto.sign` with `dsaEncoding: 'ieee-p1363'` for the VAPID signature. `fetch` does the POST. I estimate 100 to 150 lines. RFC 8291 has a test vector (Appendix A) that a unit test can check, so the encryption can be verified without any phone. [mine]
- *`web-push` package:* the well-known library; fewer lines for us but it brings its own dependencies, and Bot has stayed dependency-free. [mine]
- **Recommendation: built-ins, with the RFC test vector.** It keeps Bot dependency-free and it is a good learning exercise. If it fights us, switch to `web-push`. **I will not install anything without your OK.**

---

## 2. "Hey Bot" wake word: the honest limits

**Can a PWA / web page listen in the background or with the screen off? No.** [mine, confirmed by indirect evidence]
- Microphone capture (`getUserMedia`) is tied to the page being visible. On iOS, WebKit bug reports describe a Home Screen web app's microphone being muted when the app is minimized. [sourced: WebKit bugs 236509, 252465, Apple forum]
- On Android a hidden or screen-off tab may be backgrounded and the mic muted or audio paused, depending on OS and browser. [sourced: Hackernoon web-calls guide, general; I found no Android-specific source, so the exact Chrome behavior is **unverified**]
- The Web Speech API (see part 3) also only runs while the page is open. [mine]

So a page can do wake word only **while it is open and on screen** (for example a phone left on a desk with the screen kept awake). That is a cost: screen on, battery drain, and the mic open. Not what you want in your pocket.

**Options, from simplest to hardest:**

| Option | Works with screen off? | Effort | Notes |
|---|---|---|---|
| **A. Push-to-talk button in the PWA** | No (you open the app and tap) | Built in this branch | Realistic first step. |
| **B. Phone's own assistant opens Bot** ("Hey Google, open Bot" on Android once Bot is installed as an app; Siri: "Hey Siri, Bot" via a Shortcut) | Yes, the assistant does the listening | Small | Opens the page; you then tap the mic or type. [mine, **unverified** for this exact PWA case] |
| **C. Assistant sends text straight to Bot** (Siri Shortcut or an Android shortcut app doing an HTTPS POST with your login token) | Yes | Medium; needs a token-based route in Bot | "Hey Siri, ask Bot" then dictate, Bot answers by notification. Needs the auth work in part 4. [mine, **unverified**] |
| **D. On-page wake word engine (WASM)** | No, only while the page is open | Medium | See below. |
| **E. Small native Android wrapper with a foreground service** | Yes | High (Android Studio, Kotlin, build and sign an APK) | A Trusted Web Activity alone cannot listen; you would need a real Android service with a persistent notification and the microphone permission. Capacitor can host a plugin for this. This is what "always listening" apps do. [mine] |

**On-device engines.**
- **Picovoice Porcupine:** the usual choice for custom words like "Hey Bot", and it has a WebAssembly build. **But** a community post says Picovoice confirmed its free tier AccessKeys stop working after **June 30, 2026**, and that there is no non-commercial tier planned. [sourced: Home Assistant forum, community post; I could not open Picovoice's own pricing page, so **unverified** whether it is still free for personal use today] Assume it is **not** free. One review site lists $899/month; **unverified** and probably an enterprise tier.
- **openWakeWord:** free and open source (Python). A third-party project runs its models in the browser with `onnxruntime-web`, using a mel-spectrogram model, an embedding model and a per-word detector model. [sourced: JonesHong/web-asr-core README] It is not an official browser build, and a custom "Hey Bot" model would have to be trained (the project has a training recipe, [mine]) and the preprocessing glued together in JavaScript. Doable, but it is a project of its own, and it only helps while the page is open and visible, so it does not fix the main limit.

**Battery and privacy.** An always-on wake word keeps the microphone and some CPU busy all day; a native foreground service also forces a permanent notification. On-device engines do not send audio anywhere until the word fires. The Web Speech API, once triggered, sends the audio to Google (part 3). [mine / sourced]

**Recommendation:** build A now (done), add B/C once Tailscale and login exist (cheap and works with the screen off), and only consider E if B/C turn out to be not good enough.

---

## 3. Gemini for voice

**Cheapest good design (needs no Gemini API key):**
1. **Speech to text:** the browser's Web Speech API. On Chrome the audio goes to a server for recognition, so it needs internet; Android Chrome supports it. [sourced: MDN data via mirror, version numbers unreadable there]. It supports Hebrew (`he-IL`) in practice, as far as I know. [mine]
2. Bot handles the text as it does today (front desk, models).
3. **Text to speech:** the browser's `speechSynthesis` reads the answer aloud (free, on the device). [mine]

**Gemini options (all need an API key from Google AI Studio):**
- **Audio understanding (speech-to-text):** send an audio file to a Gemini model and get a transcript. Billed per audio token; one source says about 25 tokens per second of audio. [sourced: third-party blog, **unverified** exact price]
- **Gemini API text-to-speech:** reads text with natural voices. Sources disagree on prices, and one lists the 3.1 Flash and 2.5 TTS preview models as **retiring on 2026-11-17** with 3.8 Flash TTS as the replacement. [sourced: developersdigest.tech, nemovideo, usagepricing; **unverified**, check the model deprecation page]
- **Live API (real-time audio in and out, like a phone call):** the official pricing page lists it as free of charge with rate limits, and paid audio at about $3.00 per million input tokens and $12.00 per million output tokens for the newest Live model. [sourced: ai.google.dev pricing page and MakerStack review; model names in third-party pages are inconsistent, **unverified** details] Needs a WebSocket connection; the key must never reach the phone. Safer design: the PC's Bot holds the key and relays audio, or Bot hands the phone a short-lived token. [mine] It is the "feels like talking" option, but it is a different architecture from the chat Bot has today (a Live API model has its own personality and cannot easily use Bot's router), so I would leave it for last.

**Does your Google AI Pro subscription cover the API?** Very probably **no**. Consumer subscriptions and the Gemini API are billed separately. [mine; search results said the same but did not confirm, so **unverified**]. The API has its own free tier, with limits that Google now shows only inside the AI Studio console per project; some models are not available free, and free-tier requests may be used to improve Google products. [sourced: Google rate-limits page via aggregators, Sept/Oct 2026] Paid use needs billing set up with a prepaid minimum of $5. [sourced: same] **You decide** whether you want that. Note the privacy line: on the free tier, what you say may be used by Google.

**Does the `agy` CLI take audio?** I found nothing saying so. The documented print mode takes text (`-p`), JSON schema and stream-json input; one SDK wrapper lists image input as unsupported, and audio is not mentioned. [sourced: cheat sheets and an SDK README; **unverified** for your installed version: check `agy --help` yourself]. Plan on audio **not** going through `agy`. Also known: `agy -p` can hang when started without a terminal on Windows in some versions (a GitHub issue for 1.0.6). Bot already runs it successfully, so just be aware. [sourced]

**Recommendation for (d):** Step 1: Web Speech + speechSynthesis (no key). Step 2, only if you find the voice quality poor: Gemini TTS for Bot's spoken answers, using a free AI Studio key kept in `.env`. Step 3, maybe: Live API. Any key goes in `.env` only, which is gitignored.

---

## 4. Reaching the PC from the phone

Bot listens on `127.0.0.1`, which means "only this computer". That is a good default and it should stay.

**Safe path: Tailscale.** [sourced: Tailscale docs; Open WebUI docs]
- **Tailscale** makes a private network ("tailnet") between your own devices (PC and phone), with encrypted links, without opening any router port.
- **`tailscale serve`** publishes a local port to your tailnet only, with a real HTTPS certificate under a name like `https://my-pc.tailXXXX.ts.net`. You must enable HTTPS certificates in the Tailscale admin page once; the CLI walks you through it. Example from the official page: `tailscale serve 3000`. The CLI syntax changed in version 1.52, so old tutorials may be wrong; follow the current official page. [sourced]
- **Never use `tailscale funnel`:** that one puts the service on the open internet. [sourced: Open WebUI docs]
- Your phone needs the Tailscale app, signed in to the same account, **and connected** whenever you open Bot. Push notifications themselves do not need that, since they come through Google's/Apple's push service. [mine]

**Important: why Bot needs a login before this.** `tailscale serve` forwards to `127.0.0.1:3000`, so every request looks local to Bot. Today Bot trusts "it comes from localhost". Once the tailnet can reach it, anything on your tailnet (a shared device, a phone someone else holds) would be fully trusted, and Bot can start models, edit its own code (with approval) and push to GitHub. So before enabling `tailscale serve`:
1. **Login token in an HttpOnly cookie.** A long random token (kept in `.env` or `data/`, never in git) that you type once on the phone. The server answers with a cookie flagged `HttpOnly` (JavaScript on the page cannot read it), `Secure` (only over HTTPS) and `SameSite=Strict`. Every `/api` route checks it. Compare it with `crypto.timingSafeEqual`. [mine]
2. **Rate limiting.** Count failed logins per minute and lock out after a few, so the token cannot be guessed. [mine]
3. **Host/Origin allowlist.** Today `server.js` accepts only `localhost:PORT` and `127.0.0.1:PORT`. It needs the new `*.ts.net` name too, but only the exact name you configure (from `.env`), not any `.ts.net`. The Origin check must allow `https://<that name>`. [mine]
4. **Keep sensitive routes local-only.** Improve Bot, Restart and Push to GitHub should probably stay available only from the PC itself (check the Host header), not from the phone. This is a decision for you. [mine]
5. Optionally check the identity headers `tailscale serve` adds (the logged-in Tailscale user), as a second lock. [mine, **unverified**]

These are changes to `server.js`, which is protected from Bot's own editor, so they need Claude Code.

---

## What I built in this branch (low-risk groundwork)

- `reminders.js` + tests: create, list, cancel; saved in `data/reminders.json` (gitignored) with atomic writes; scheduler every 30 s with catch-up after downtime (late ones are marked); times checked as real future moments (no Feb 30, no past, max 5 years, valid time zone required); a notify function you can swap.
- Front desk action `remind`: the model only extracts *text + local time + time zone*; code validates; the chat shows "Reminder set for Mon, 2 Nov, 09:00 (Asia/Jerusalem): call the bank". If the time is unusable the front desk result is rejected and Claude Sonnet answers normally (so it will not say "set").
- Page: reminders list with cancel buttons, in-page banner plus browser Notification when due, "Turn on notifications" button (browsers require a tap), mic button using the Web Speech API (English/Hebrew), manifest, icons, service worker that caches nothing.
- `server.js` (protected file) got small additions: the 4 phone-app files from a fixed table, and 3 reminder routes. Bindings and the Host/Origin/body checks were not touched.

**Limits right now:** the notification only appears while the page is open somewhere (PC browser; on the phone only after the Tailscale + login work). The PC must be on. Reminders have no repeat ("every Monday") yet. Edit/snooze is not built.

---

## Recommended build order

1. **(done)** Reminders on the PC page, PWA basics, mic button.
2. **Try it for a few days on the PC.** See whether the front desk understands your reminder phrasing in English and Hebrew; tune `router-brief.md`.
3. **Login + rate limit + Host allowlist** in `server.js` (Claude Code session). Do this *before* any phone access.
4. **Install Tailscale on PC and phone; `tailscale serve`** (you do the installs, one session helps with the commands). Open Bot on the phone, add it to the Home Screen.
5. **Web Push** with Node built-ins: VAPID keys in `.env`, subscription store, encryption tested with the RFC 8291 vector, `push` handler in `sw.js`, reminder scheduler sends pushes. Test Android first (simplest).
6. **Spoken replies** with `speechSynthesis` (tiny change) and a "read answers aloud" toggle.
7. **Hands-free via the phone's assistant** (options B/C) with a token-based route.
8. **Later, only if wanted:** Gemini TTS or Live API with an AI Studio key; native Android wrapper for true "Hey Bot".

## What you must do or decide

1. **Which phone?** Android (Chrome) or iPhone? Android is easier for push and for any later native wrapper. On iPhone everything works only from the Home Screen app, iOS 16.4 or newer.
2. **Tailscale:** create an account (free personal plan, I believe, [mine]), install it on the PC and phone, and enable HTTPS certificates in the admin page. I will not do this for you.
3. **Login token:** you choose and store it (password manager); it goes in `.env`.
4. **Which Bot features may be used from the phone?** Chat only, or also Improve/Restart/Push? My advice: chat and reminders only.
5. **Packages:** do you accept built-ins only for Web Push (my recommendation), or allow the `web-push` package?
6. **Gemini API key:** only if you want Gemini voice. Create it in Google AI Studio yourself, paste it into `.env`, never into chat or code. Decide if you accept free-tier privacy terms or want billing (prepay $5 minimum).
7. **Wake word:** are you happy with the mic button plus "Hey Google / Hey Siri, open Bot" for now, or do you want a real native Android app later?
8. **PC availability:** reminders and pushes only fire while the PC is on and Bot runs. If you need them at night, the PC must stay awake, or Bot would need to move to an always-on machine.

## Sources

- iOS push: [Pushpad: iOS special requirements](https://pushpad.xyz/blog/ios-special-requirements-for-web-push-notifications), [MagicBell: PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [Webscraft: PWA push on iOS in 2026](https://webscraft.org/blog/pwa-pushspovischennya-na-ios-u-2026-scho-realno-pratsyuye?lang=en)
- Picovoice free tier ending: [Home Assistant community post](https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744), [Picovoice pricing](https://picovoice.ai/pricing)
- openWakeWord in the browser: [web-asr-core](https://github.com/JonesHong/web-asr-core), [ONNX Runtime Web](https://opensource.microsoft.com/blog/2021/09/02/onnx-runtime-web-running-your-machine-learning-model-in-browser/)
- Mic in background: [WebKit bug 236509](https://bugs.webkit.org/show_bug.cgi?id=236509), [WebKit bug 252465](https://bugs.webkit.org/show_bug.cgi?id=252465), [Apple forum thread](https://developer.apple.com/forums/thread/689182), [Hackernoon](https://hackernoon.com/how-to-make-web-calls-feel-native-on-mobile)
- Gemini pricing and Live API: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [MakerStack review](https://makerstack.co/reviews/gemini-flash-live-review/), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini TTS pricing (nemovideo)](https://www.nemovideo.com/blog/gemini-3-1-flash-tts-pricing), [developersdigest speech](https://www.developersdigest.tech/models/speech/google)
- Web Speech API: [MDN SpeechRecognition (mirror found by search)](https://reference.codeproject.com/dom/Web_Speech_API); check [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) for exact versions
- `agy`: [Antigravity CLI cheat sheet](https://computingforgeeks.com/antigravity-cli-cheat-sheet/), [GitHub issue 318](https://github.com/google-antigravity/antigravity-cli/issues/318), [PHP SDK README](https://packagist.org/packages/develate/antigravity-cli-php)
- Tailscale: [Tailscale Serve docs](https://tailscale.com/docs/features/tailscale-serve), [Open WebUI HTTPS with Tailscale](https://docs.openwebui.com/reference/https/tailscale)
