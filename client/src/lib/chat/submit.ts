/**
 * Sending from the message box, safely:
 *   - one submission at a time: a second Enter or click while one is on its way does nothing;
 *   - the box is cleared only when the conversation has ACCEPTED the message (it is in the thread), never before;
 *   - if it is refused or fails before that, the text stays in the box, untouched, ready to send again.
 *
 * `send(text, accepted)` calls `accepted()` once the message is in; its promise settling without that means it wasn't.
 */
export type SendFn = (text: string, accepted: () => void) => unknown;

export function createSubmitter(send: SendFn, on: { accepted: (text: string) => void; pending: (p: boolean) => void }) {
  let inFlight = false;
  return {
    get pending() { return inFlight; },
    submit(raw: string): boolean {
      const text = raw.trim();
      if (!text || inFlight) return false;
      inFlight = true;
      on.pending(true);
      let accepted = false;
      const accept = () => {
        if (accepted) return;
        accepted = true;
        on.accepted(text);
      };
      const settle = () => { inFlight = false; on.pending(false); };
      let result: unknown;
      try { result = send(text, () => { accept(); settle(); }); }
      catch { settle(); return false; }
      Promise.resolve(result).then(() => { if (!accepted) settle(); }, () => { if (!accepted) settle(); });
      return true;
    },
  };
}
