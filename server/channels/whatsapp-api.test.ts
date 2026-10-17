/** The WhatsApp Cloud API client with fetch mocked: what it sends, what it keeps, and how failures read. */
import { describe, expect, it } from "vitest";
import { WhatsappError, fillTemplate, mapGraphError, whatsappClient } from "./whatsapp-api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function client(answers: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); const a = answers.shift()!; if (a instanceof Error) throw a; return a; }) as unknown as typeof fetch;
  return { c: whatsappClient(f, 1000), calls };
}

describe("WhatsApp Cloud API client", () => {
  it("sends a text with the token only in the Authorization header, to the number without '+', no link preview", async () => {
    const { c, calls } = client([json({ messaging_product: "whatsapp", contacts: [{ input: "919876543210", wa_id: "919876543210" }], messages: [{ id: "wamid.ABC" }] })]);
    expect(await c.sendText("TOKEN-1", "123456", "+919876543210", "Hello")).toEqual({ id: "wamid.ABC" });
    expect(calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d\/123456\/messages$/);
    expect(calls[0].url).not.toContain("TOKEN-1");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-1");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "text", text: { body: "Hello", preview_url: false } });
  });

  it("sends a template with its body parameters", async () => {
    const { c, calls } = client([json({ messages: [{ id: "wamid.T" }] })]);
    await c.sendTemplate("t", "1", "+15550001111", { name: "intro_v1", language: "en", params: ["Dr. Rao", "websites"] });
    expect(JSON.parse(String(calls[0].init.body)).template).toEqual({ name: "intro_v1", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Dr. Rao" }, { type: "text", text: "websites" }] }] });
  });

  it("no answer, a 5xx, or an answer without an id on a send is uncertain (never failed, so never resent)", async () => {
    for (const a of [new TypeError("fetch failed"), json({ error: { code: 1, message: "x" } }, 503), json({ messages: [] })]) {
      const { c } = client([a]);
      await expect(c.sendText("t", "1", "+15550001111", "x")).rejects.toMatchObject({ code: "uncertain" });
    }
  });

  it("maps Graph's errors to what the person should do", async () => {
    expect(mapGraphError(401, { code: 190 })).toBe("auth");
    expect(mapGraphError(400, { code: 131047 })).toBe("window_closed");
    expect(mapGraphError(400, { code: 132001 })).toBe("template");
    expect(mapGraphError(400, { code: 131026 })).toBe("recipient");
    expect(mapGraphError(400, { code: 131056 })).toBe("rate_limited");
    expect(mapGraphError(403, { code: 10 })).toBe("permission");
    expect(mapGraphError(400, { code: 999 })).toBe("rejected");
    const { c } = client([json({ error: { code: 131047, message: "Re-engagement message" } }, 400)]);
    await expect(c.sendText("t", "1", "+15550001111", "x")).rejects.toBeInstanceOf(WhatsappError);
  });

  it("offers only APPROVED templates whose values are all plain text in the body, with their parameter count", async () => {
    const { c } = client([json({ data: [
      { name: "intro_v1", language: "en", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{1}}, about {{2}}. Again {{1}}." }, { type: "FOOTER", text: "Reply STOP to opt out" }] },
      { name: "pending", language: "en", status: "PENDING", components: [{ type: "BODY", text: "x" }] },
      { name: "with_image", language: "en", status: "APPROVED", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hi" }] },
      { name: "button_var", language: "en", status: "APPROVED", components: [{ type: "BODY", text: "Hi" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://a.com/{{1}}" }] }] },
      { name: "plain_buttons", language: "hi", status: "APPROVED", components: [{ type: "BODY", text: "नमस्ते {{1}}" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Stop promotions" }] }] },
    ] })]);
    expect(await c.templates("t", "waba")).toEqual([
      { name: "intro_v1", language: "en", category: "marketing", body: "Hi {{1}}, about {{2}}. Again {{1}}.", params: 2 },
      { name: "plain_buttons", language: "hi", category: "", body: "नमस्ते {{1}}", params: 1 },
    ]);
    expect(fillTemplate("Hi {{1}}, about {{2}}. Again {{1}}.", ["Asha", "sites"])).toBe("Hi Asha, about sites. Again Asha.");
  });
});
