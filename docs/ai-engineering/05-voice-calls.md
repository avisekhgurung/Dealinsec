# 05. A voice call with DealInSec

## What we built
A hands-free call, like a modern voice mode: tap **Call** (or "Talk to DealInSec" on the welcome), the assistant greets you, and then you simply talk. It listens, notices when you have finished a sentence, thinks, answers aloud, and listens again. You can interrupt with a tap. Cards that need a tap (approvals, search results) appear on the call screen. Everything said is saved in the conversation, so it is all there when the call ends.

**The character:** a refined English gentleman: calm, courteous, composed, quietly witty, never flustered or theatrical, one to three short plain sentences, the person's first name now and then. It is DealInSec and says so if asked; it is not any film character. The persona is a *register*: the prompt says every rule about never inventing, asking before changing, and treating web and message text as data applies in full (tested). The voice is chosen to match: male, British where the language is English, the most natural one the device has (`pickGentlemanVoice`), spoken a little unhurried and low.

## Design
- **A pure state machine for turn-taking** (`shared/voice-call.ts`, 19 tests). The microphone and speech APIs are noisy and asynchronous; the part that must never get stuck is plain `reduce(state, event) -> {state, effects}`. Phases: connecting, listening, thinking, speaking, ended. It handles: opening greeting, interim captions, a finished utterance, a reply, an empty reply, interruption (while speaking and while thinking), mute and unmute, "are you still there?" then goodbye on silence, a blocked microphone, an unsupported browser, an agent failure that is apologised for aloud, and ending from any phase. A reply that arrives after an interruption is ignored.
- **A thin hook carries out the effects** (`hooks/use-voice-call.ts`): speech recognition with endpointing (a 1.2 s pause ends a turn), sentence-by-sentence speech (browsers cut a long utterance off after ~15 s; the first sentence also starts at once), a microphone level meter for the orb, a screen wake lock, and release of everything on hang-up.
- **Half-duplex on purpose.** The recogniser is off while the assistant speaks, so it never hears itself; a tap interrupts. **Interrupting by voice is opt-in ("beta")**: it listens to the assistant's own voice for 450 ms to learn how loud the echo is, then only fires on something clearly louder that lasts 260 ms (`createBargeInDetector`, tested with synthetic levels). Whether a device cancels its own speaker's echo can't be known in advance, so it defaults off and says it works best with headphones.
- **Approvals are never given by voice.** The assistant says the card is waiting and to tap it; it never asks for a spoken "yes". A misheard word or a television in the room must not be able to approve a payment or a deal.
- **The voice channel** (`channel: "voice"`) is an existing, tested part of the conversation layer; the route now accepts it from the web app. Same session, same tools, same policy; only the prompt's style changes.
- **Privacy.** The browser's recogniser (Chrome) may send audio to its speech service; the mic tooltip says so. Nothing is recorded or stored by us; only the transcript becomes ordinary messages. Hang-up stops the microphone.

## Verified, and not
Verified in the real app (the speech services replaced by a stand-in that records what is spoken and lets me "speak"; everything else real, including the agent): opening greeting and the chosen voice; a full turn (about 1.2 s endpointing, about 4 s thinking, two sentences spoken in turn, back to listening); the reply in the gentleman register with the first name and no markdown; an approval-needing request, spoken as "tap the card", and tapping it inside the call; real search results inside the call; interrupt; mute and unmute; ending the call; a blocked microphone; the phone layout.

**Not verified: real audio.** Whether the recogniser hears your voice well, how the chosen voice sounds on your device, and whether interrupting by voice avoids hearing its own speaker. Please try it and say what you hear.

## Honest limits versus a cloud voice product
This is as good as the browser's speech services allow, which is free but uneven. What "like ChatGPT's voice mode" additionally needs, and we do not have yet:
- **A neural voice.** Browser voices vary by device (good on iPhone and recent Chrome, flat elsewhere). A natural, consistent butler-like voice needs a text-to-speech provider (a key, and usually a card or a small monthly cost). The speaking code is isolated so one can be dropped in, and we would **not** clone any real actor's voice.
- **Streaming replies.** The model's answer arrives whole, so the first word is spoken after the whole answer is ready (about 4 s with a tool call). Streaming tokens and speaking sentence by sentence would roughly halve the wait.
- **Better listening.** Server-side speech-to-text (Whisper-class) handles accents and noise better than the browser's.
- **Real barge-in and "always on".** Reliable talking-over needs echo cancellation we only get from a call-style audio pipeline.
