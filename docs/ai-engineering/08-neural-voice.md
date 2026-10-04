# 08. A neural voice for the call

The call used the browser's built-in speech, which is free but uneven (good on iPhone and recent Chrome, flat elsewhere). Now, when the server has a key, each sentence is spoken by OpenAI's speech model in a calm English-gentleman register. Without a key nothing changes.

## How it works
```
reply text -> split into sentences -> POST /api/voice/speak (one sentence) -> MP3 -> played in order
              while sentence 1 plays, sentence 2 is already being fetched (one ahead)
a sentence that cannot be fetched or played -> spoken by the browser's voice instead
```
- **The key never reaches the browser.** The page calls our own route; the server calls OpenAI (`server/voice/tts.ts`).
- **Never silent.** A failure of any one sentence (provider down, busy, bad audio, autoplay refused) is spoken by the browser's voice, so a call cannot go quiet halfway. Two failures switch the neural voice off for the rest of that call so it stops asking: "not set up" and "today's allowance is used".
- **The person still comes first.** Interrupting calls the same cancel as before; it aborts the requests in flight, stops the audio and releases the files. Nothing started before the interruption speaks after it (11 tests, 3 mutants killed).
- **The text is not logged**, nor the key; errors say what happened in plain words with no provider detail.

## Setup (on Render)
| Variable | Default | |
|---|---|---|
| `OPENAI_API_KEY` | none | **required**; without it the call keeps the browser voice |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | the model that takes spoken-style instructions |
| `OPENAI_TTS_VOICE` | `onyx` | try `ash`, `echo`, `sage`, `verse` if you prefer another |
| `VOICE_DAILY_CHARS` | `50000` | per workspace per UTC day (about 55 minutes of speech) |
| `VOICE_PER_MINUTE` | `40` | per person |
| `OPENAI_TTS_BASE_URL` | OpenAI | for tests only |

No migration. Redeploy after setting the key.

## Cost and limits
At OpenAI's list price a typical spoken reply (a few hundred characters) costs a fraction of a US cent; the default daily cap of 50,000 characters per workspace bounds a workspace to well under a dollar a day. The caps and the per-minute rate are **in memory, per server process**: they reset on a restart and are not shared across instances (fine for one instance; a shared store is needed if the app ever runs on several). A request is also capped at 600 characters and the route refuses anything that is not speakable text. A failed attempt gives its characters back.

## Verified, and not
Verified: 11 provider/budget tests with 10 mutants killed; 11 speaker-logic tests (order, prefetch bound, fallback, switch-off, cancel, replace) with the cancel/stale-answer mutants killed; `script/e2e-voice.mts` **22 checks** over HTTP against a fake OpenAI server (auth, audio bytes and headers, markdown stripped before sending, 600-character cut, empty input never reaches the provider, 502/429 mapping, key never in a response, refund on failure, per-workspace cap, per-minute rate); and in a real browser, a real call: the greeting and a four-sentence reply fetched, prefetched and **played through the real audio element** (the fake provider returns about a second of genuinely decodable silent MP3), an interruption that stopped further sound at once, and the browser-voice fallback when the provider was down.

**Not verified, and I cannot verify here: how it sounds.** I have no OpenAI key and cannot hear. I do not know whether `onyx` with the English-gentleman instructions sounds like what you want, how fast the first word arrives over a real connection (the first sentence has to be fetched before it can start, roughly half a second to a second), or how Safari on an iPhone treats the audio unlock (the code plays a silent sound at the tap that starts the call so later sounds are allowed; this is the standard method, untested on a real device). Please try a call and tell me what you hear; changing the voice is one variable.

## Not built
- **Streaming the model's reply** into sentences as it is written (the first word still waits for the whole answer, about 4 s with a tool call). The speaker already takes a list of sentences, so this is a change to the call hook and the agent stream, and it would roughly halve the wait.
- **Server speech-to-text** (listening is still the browser's recogniser).
- A voice picker in the app. We would not imitate any real actor's voice.

## Lessons
- **My first instrumentation was wrong, not the code.** The page showed no `play` calls and I nearly went hunting; the real trace (unlock sound, fetch, play, ended) showed the pipeline was fine. Trace the actual events before theorising.
- **A fake that cannot be decoded tests less than one that can.** The first fake returned MP3-shaped bytes the browser cannot play, which would only ever have exercised the fallback. Silent MPEG frames (417 bytes each) exercise the real playback.
- Sign-up throttling (5 per IP per 15 minutes) bit repeated e2e runs: restart the dev server to clear it.
