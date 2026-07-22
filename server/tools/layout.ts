/**
 * Shared HTML shell for the public, server-rendered free-tool / SEO pages.
 *
 * These pages live OUTSIDE the React SPA: Express returns a complete HTML
 * document (real content in the source) so Google can index them, and the
 * interactive bits run as inline vanilla JS. See server/tools/index.ts for the
 * route wiring (registered before the SPA catch-all).
 */

export interface ToolPageOptions {
  /** <title> text (also OG/Twitter title). */
  title: string;
  /** Meta description. */
  description: string;
  /** Canonical path, e.g. "/tools/gst-invoice-generator". */
  canonicalPath: string;
  /** Structured-data blocks (rendered as application/ld+json). */
  jsonLd?: object[];
  /** Main content HTML (between header and the signup CTA band). */
  bodyHtml: string;
  /** Extra tags injected into <head>. */
  headExtra?: string;
  /** Scripts injected right before </body>. */
  bodyEndScripts?: string;
  /** Hide the default signup CTA band (a page may render its own). */
  hideCtaBand?: boolean;
}

export const SITE_ORIGIN = "https://www.dealinsec.com";
const APP_LINK = "/?utm_source=tools&utm_medium=seo_page";
const APP_SIGNUP = "/?utm_source=tools&utm_medium=remove_brand";

/** HTML-escape untrusted/dynamic text before it goes into markup. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STYLES = `<style>
  *,*::before,*::after{box-sizing:border-box}
  /* Tokens mirror the landing page's light theme (client/src/index.css). */
  :root{--green:hsl(160 84% 30%);--green-d:hsl(160 84% 23%);--ink:hsl(222 47% 11%);--muted:hsl(215 16% 47%);--line:hsl(215 20% 88%);--card-line:hsl(215 20% 92%);--bg:hsl(210 20% 98%);--card:hsl(0 0% 100%);--accent-bg:hsl(160 60% 95%);--accent-fg:hsl(160 55% 22%);--accent-line:hsl(160 40% 85%)}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  a{color:var(--green);text-decoration:none}
  a:hover{text-decoration:underline}
  h1,h2,h3{line-height:1.2;margin:0 0 .5em}
  .wrap{max-width:1080px;margin:0 auto;padding:0 20px}
  .btn{display:inline-flex;align-items:center;gap:8px;background:var(--green);color:#fff;font-weight:700;padding:12px 22px;border-radius:12px;border:0;cursor:pointer;font-size:15px}
  .btn:hover{background:var(--green-d);text-decoration:none;color:#fff}
  .btn.ghost{background:transparent;color:var(--green);border:1.5px solid var(--line)}
  .btn.ghost:hover{background:#fff;border-color:var(--green)}
  header.site{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
  /* Matches <DealinsecLogo size="md"> in the app header exactly. */
  .brand{display:inline-flex;align-items:center;gap:10px;font-size:18px;font-weight:700;line-height:1;letter-spacing:-.025em;color:#171717}
  .brand:hover{text-decoration:none}
  .logo{flex-shrink:0;filter:drop-shadow(0 1px 1px rgba(0,0,0,.05))}
  .brand-text{line-height:1;font-weight:700}
  .brand-accent{background:linear-gradient(135deg,#059669 0%,#0D9488 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:#0D9488}
  .hero{padding:56px 0 20px;text-align:center}
  .hero h1{font-size:clamp(28px,5vw,44px);font-weight:800;letter-spacing:-.02em}
  .hero p.sub{font-size:clamp(16px,2.2vw,20px);color:var(--muted);max-width:660px;margin:0 auto}
  .chips{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:20px 0 0}
  .chip{font-size:13px;font-weight:600;color:var(--accent-fg);background:var(--accent-bg);border:1px solid var(--accent-line);border-radius:999px;padding:6px 12px}
  section{padding:28px 0}
  .card{background:var(--card);border:1px solid var(--card-line);border-radius:16px;padding:22px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
  @media(max-width:860px){.grid2{grid-template-columns:1fr}}
  label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin:12px 0 5px}
  input.f,textarea.f,select.f{width:100%;font:inherit;font-size:15px;color:var(--ink);background:#fff;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px}
  input.f:focus,textarea.f:focus,select.f:focus{outline:none;border-color:var(--green)}
  .row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  @media(max-width:760px){.steps{grid-template-columns:1fr}}
  .step .n{width:34px;height:34px;border-radius:50%;background:var(--accent-bg);color:var(--accent-fg);font-weight:800;display:grid;place-items:center;margin-bottom:8px}
  .faq h3{font-size:17px;margin-top:18px}
  .faq p{color:var(--muted);margin:.3em 0 0}
  .cta-band{background:linear-gradient(135deg,var(--green),#0a6e46);color:#fff;margin-top:24px}
  .cta-band .wrap{padding:44px 20px;text-align:center}
  .cta-band h2{color:#fff;font-size:clamp(22px,3.5vw,32px);font-weight:800}
  .cta-band p{color:#DCFCE7;max-width:620px;margin:0 auto 22px}
  .cta-band .btn{background:#fff;color:var(--green-d)}
  .cta-band .btn:hover{background:#F0FDF4}
  footer.site{background:#fff;border-top:1px solid var(--line);padding:34px 0;color:var(--muted);font-size:14px}
  footer.site .links{display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px}
  .muted{color:var(--muted)}

  /* ── Ambient decorative backdrop (subtle, behind everything) ── */
  body{position:relative;overflow-x:hidden}
  /* Lightweight: soft radial-gradients (no blur filter) + corner dot patches. */
  .ambient{position:absolute;top:0;left:0;right:0;height:760px;overflow:hidden;pointer-events:none;z-index:0}
  .ambient .blob{position:absolute;border-radius:50%;opacity:.6}
  .ambient .b1{width:440px;height:440px;background:radial-gradient(circle,hsl(160 65% 84%),transparent 68%);top:-160px;left:-140px}
  .ambient .b2{width:480px;height:480px;background:radial-gradient(circle,hsl(174 55% 88%),transparent 68%);top:-80px;right:-180px}
  .ambient .ring{position:absolute;border:2px solid hsl(160 40% 82% / .5);border-radius:50%}
  .ambient .r1{width:120px;height:120px;top:240px;left:70px}
  .ambient .r2{width:70px;height:70px;top:120px;right:120px}
  .ambient .dotpad{position:absolute;width:170px;height:150px;background-image:radial-gradient(hsl(160 22% 68% / .55) 1.4px,transparent 1.4px);background-size:22px 22px;opacity:.45}
  .ambient .d1{top:110px;left:24px}
  .ambient .d2{top:360px;right:40px}
  header.site,main,.cta-band,footer.site{position:relative;z-index:1}

  /* ── Header nav ── */
  .nav{display:none;align-items:center;gap:2px}
  @media(min-width:920px){.nav{display:flex}}
  .nav a{padding:8px 14px;border-radius:10px;font-size:14px;font-weight:600;color:var(--muted);transition:background .15s,color .15s}
  .nav a:hover{color:var(--ink);background:hsl(210 20% 93%);text-decoration:none}
  .nav a.active{color:var(--accent-fg);background:var(--accent-bg)}
  .btn .ext{width:14px;height:14px;opacity:.85}

  /* ── Hero badge + two-tone headline ── */
  .badge{display:inline-flex;align-items:center;gap:9px;padding:8px 16px;border-radius:999px;background:var(--card);border:1px solid var(--accent-line);color:var(--accent-fg);font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;box-shadow:0 1px 2px rgba(16,24,40,.05);margin-bottom:20px}
  .hero .accent{color:var(--green)}

  /* ── Icon tool cards ── */
  .tool-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
  @media(max-width:860px){.tool-grid{grid-template-columns:1fr}}
  .tool-card{display:flex;flex-direction:column;background:var(--card);border:1px solid var(--card-line);border-radius:18px;padding:24px;box-shadow:0 1px 3px rgba(16,24,40,.05);transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}
  .tool-card:hover{transform:translateY(-3px);box-shadow:0 12px 26px rgba(16,24,40,.09);border-color:var(--accent-line);text-decoration:none}
  .tool-ico{width:54px;height:54px;border-radius:15px;background:var(--accent-bg);color:var(--green-d);display:grid;place-items:center;margin-bottom:16px}
  .tool-card h2{font-size:18px;margin:0 0 7px;color:var(--ink);letter-spacing:-.01em}
  .tool-card p{margin:0;color:var(--muted);font-size:14px;line-height:1.55;flex:1}
  .tool-card .go{margin-top:18px;color:var(--green-d);font-weight:700;font-size:14px;display:inline-flex;align-items:center;gap:6px}
  .tool-card:hover .go{gap:9px}

  /* ── Enhanced CTA band ── */
  .cta-band .wrap{display:flex;align-items:center;gap:24px;text-align:left;padding:40px 24px}
  .cta-ico{width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;flex-shrink:0}
  .cta-copy{flex:1;min-width:260px}
  .cta-band .btn{background:#fff;color:var(--green-d);white-space:nowrap}
  .cta-band .btn:hover{background:#F0FDF4}
  @media(max-width:720px){.cta-band .wrap{flex-direction:column;text-align:center}.cta-copy{min-width:0}}

  /* ── Footer socials ── */
  .footer-top{display:flex;justify-content:space-between;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:14px}
  .socials{display:flex;gap:10px}
  .socials a{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);display:grid;place-items:center;color:var(--muted);transition:color .15s,border-color .15s}
  .socials a:hover{color:var(--green);border-color:var(--accent-line)}

  /* ── Logo + signature controls ── */
  .file-btn{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--green-d);cursor:pointer;padding:9px 13px;border:1.5px solid var(--line);border-radius:10px;background:#fff}
  .file-btn:hover{border-color:var(--green)}
  .file-btn input[type=file]{display:none}
  .logo-preview{margin:6px 0}
  .sig-pad{width:100%;height:100px;border:1.5px dashed var(--line);border-radius:12px;background:#fff;touch-action:none;cursor:crosshair;display:block}
  .sig-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}

  /* ── Export panel (download / share) ── */
  .export-overlay{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);opacity:0;visibility:hidden;transition:opacity .2s ease,visibility .2s ease}
  .export-overlay.open{opacity:1;visibility:visible}
  .export-sheet{width:100%;max-width:440px;background:var(--card);border-radius:22px;box-shadow:0 24px 60px rgba(0,0,0,.28);transform:translateY(18px) scale(.97);opacity:0;transition:transform .3s cubic-bezier(.34,1.4,.5,1),opacity .3s ease;overflow:hidden}
  .export-overlay.open .export-sheet{transform:translateY(0) scale(1);opacity:1}
  .export-hero{background:linear-gradient(135deg,var(--green),var(--green-d));color:#fff;padding:26px 24px 22px;text-align:center;position:relative}
  .export-check{width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;margin:0 auto 12px;animation:eo-pop .45s cubic-bezier(.34,1.56,.64,1) both}
  .export-hero h3{color:#fff;font-size:19px;margin:0 0 3px;font-weight:800}
  .export-hero p{color:#DCFCE7;font-size:13px;margin:0}
  .export-close{position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:50%;border:0;background:rgba(255,255,255,.18);color:#fff;font-size:20px;cursor:pointer;line-height:1;display:grid;place-items:center}
  .export-close:hover{background:rgba(255,255,255,.3)}
  .export-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px}
  .export-opt{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:15px;border:1.5px solid var(--line);border-radius:16px;background:var(--card);cursor:pointer;text-align:left;transition:transform .15s,border-color .15s,box-shadow .15s;font-family:inherit}
  .export-opt:hover{transform:translateY(-2px);border-color:var(--green);box-shadow:0 8px 20px rgba(16,24,40,.09)}
  .export-opt .eo-ico{width:38px;height:38px;border-radius:11px;background:var(--accent-bg);color:var(--green-d);display:grid;place-items:center;margin-bottom:5px}
  .export-opt .eo-spin{display:none;color:var(--green-d)}
  .export-opt.busy{opacity:.7;pointer-events:none}
  .export-opt.busy .eo-glyph{display:none}
  .export-opt.busy .eo-spin{display:block;animation:eo-spin .8s linear infinite}
  .export-opt b{font-size:14px;color:var(--ink)}
  .export-opt small{font-size:11px;color:var(--muted);line-height:1.3}
  @keyframes eo-pop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.14);opacity:1}100%{transform:scale(1)}}
  @keyframes eo-spin{to{transform:rotate(360deg)}}
  @media(max-width:480px){.export-overlay{align-items:flex-end;padding:0}.export-sheet{max-width:100%;border-radius:22px 22px 0 0}}

  /* Documents use a system font stack so PNG/print export renders reliably
     (no external web-font embedding needed). */
  .print-doc, .print-doc *{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}

  /* ── Print / PDF: show ONLY the document (.print-doc), in normal flow, so it
     paginates correctly with NO blank trailing pages. The blank pages came from
     visibility:hidden, which hides content but STILL reserves its full height
     (the tall form + marketing sections spilled onto page after page). Using
     display:none instead means the hidden content takes no space at all. ── */
  @media print{
    @page{size:A4;margin:14mm}
    html,body{background:#fff!important;margin:0!important;padding:0!important}
    /* Chrome, hero, the form column and every non-document section take no space. */
    .ambient,header.site,footer.site,.cta-band,.tool-switch,.related,.hero,#form-card,.no-print{display:none!important}
    main>section:not(:has(.print-doc)),
    .wrap>*:not(:has(.print-doc)),
    .grid2>*:not(:has(.print-doc)){display:none!important}
    /* Flatten the wrappers so the document starts at the top edge. */
    main,main>section,main>section>.wrap,.grid2{display:block!important;margin:0!important;padding:0!important;max-width:none!important}
    /* The document itself: normal flow, full width, clean (no glass sheen). */
    .print-doc{position:static!important;width:100%!important;max-width:100%!important;margin:0!important;border:none!important;box-shadow:none!important}
    .print-doc,.print-doc *{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
    .print-doc::before{content:none!important}
  }

  /* ============================================================================
     DEALINSEC · LIQUID-GLASS REFRESH (iOS-26 material). Appended last so these
     rules win on source order and the .print-doc paper-guard lands after .card.
     ============================================================================ */
  :root{
    --hdr-h:64px;                                 /* single source of truth for both sticky bars */
    --glass:rgba(255,255,255,.66);
    --glass-strong:rgba(255,255,255,.78);
    --glass-line:hsl(215 25% 88% / .7);
    --glass-hair:rgba(255,255,255,.85);
    --glass-edge-lo:hsl(160 30% 60% / .30);
    --glass-inset:inset 0 1px 0 rgba(255,255,255,.72), inset 0 0 0 1px rgba(255,255,255,.14);
    --glass-shadow:0 12px 34px -14px hsl(160 45% 16% / .30);
    --shadow-green:0 10px 30px -8px hsl(160 60% 30% / .26), 0 2px 8px hsl(160 40% 20% / .08);
    --shadow-green-lg:0 22px 50px -14px hsl(160 60% 28% / .34);
    --blur:saturate(180%) blur(20px);
    --blur-lite:saturate(160%) blur(12px);
  }
  /* Soft green mesh so the frosted surfaces have real light to refract.
     background-attachment:scroll — fixed is janky/repaint-heavy on iOS. */
  body{
    background:
      radial-gradient(1100px 620px at 12% -8%, hsl(160 70% 90% / .55), transparent 60%),
      radial-gradient(900px 560px at 108% 4%,  hsl(174 62% 90% / .50), transparent 58%),
      radial-gradient(760px 720px at 50% 118%, hsl(160 55% 92% / .45), transparent 62%),
      var(--bg);
    background-attachment:scroll;
    background-repeat:no-repeat;
  }
  header.site{
    background:var(--glass-strong);
    -webkit-backdrop-filter:var(--blur); backdrop-filter:var(--blur);
    border-bottom:1px solid hsl(160 25% 80% / .5);
    box-shadow:0 1px 0 rgba(255,255,255,.6), 0 10px 26px -20px hsl(160 45% 16% / .6);
  }
  header.site .wrap{height:var(--hdr-h)}

  /* Cross-tool switcher: frosted sticky sub-bar under the header, horizontal scroll. */
  .tool-switch{
    position:sticky; top:var(--hdr-h); z-index:19;
    background:var(--glass-strong);
    -webkit-backdrop-filter:var(--blur); backdrop-filter:var(--blur);
    border-bottom:1px solid hsl(160 25% 80% / .45);
    box-shadow:0 1px 0 rgba(255,255,255,.5);
  }
  .tool-switch .wrap{position:relative;padding-top:0;padding-bottom:0}
  .ts-track{
    display:flex; gap:6px; align-items:center;
    overflow-x:auto; overflow-y:hidden;
    padding:9px 0; margin:0 -2px;
    scroll-snap-type:x proximity; scroll-behavior:smooth;
    -webkit-overflow-scrolling:touch; scrollbar-width:none;
  }
  .ts-track::-webkit-scrollbar{display:none}
  .ts-pill{
    flex:0 0 auto; scroll-snap-align:start;
    display:inline-flex; align-items:center;
    min-height:38px; padding:8px 15px; border-radius:12px;
    font-size:14px; font-weight:650; letter-spacing:-.01em; white-space:nowrap;
    color:var(--muted); border:1px solid transparent;
    transition:color .18s ease, background .18s ease, box-shadow .18s ease, transform .12s ease;
  }
  .ts-pill:hover{color:var(--ink); background:rgba(255,255,255,.55); text-decoration:none}
  .ts-pill:active{transform:scale(.96)}
  .ts-pill.active{                                /* raised white "selected segment" */
    color:var(--green-d); font-weight:700;
    background:#fff; border-color:var(--glass-line);
    box-shadow:0 2px 8px -2px rgba(16,24,40,.18), 0 0 0 1px hsl(160 40% 85% / .6);
  }
  .ts-pill:focus-visible{outline:2px solid var(--green); outline-offset:2px}
  .tool-switch .wrap::after{                      /* fade hint that more tools scroll off-screen */
    content:""; position:absolute; top:0; right:0; bottom:0; width:34px;
    pointer-events:none; background:linear-gradient(90deg, transparent, var(--glass-strong));
  }
  @media(min-width:980px){                         /* full set fits on desktop → no fade, wrap-pack */
    .tool-switch .wrap::after{display:none}
    .ts-track{overflow-x:visible; flex-wrap:wrap; row-gap:6px}
  }

  /* Frosted form/info surfaces with a masked specular top hairline. */
  .card{
    position:relative;
    background:var(--glass);
    -webkit-backdrop-filter:var(--blur-lite); backdrop-filter:var(--blur-lite);
    border:1px solid var(--glass-edge-lo);
    border-radius:20px;
    box-shadow:var(--glass-shadow), var(--glass-inset);
  }
  .card::before{
    content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
    border-top:1px solid var(--glass-hair);
    -webkit-mask:linear-gradient(180deg,#000, transparent 42%);
            mask:linear-gradient(180deg,#000, transparent 42%);
  }
  .chip{
    background:rgba(255,255,255,.55);
    -webkit-backdrop-filter:saturate(160%) blur(10px); backdrop-filter:saturate(160%) blur(10px);
    border:1px solid rgba(255,255,255,.6); color:var(--accent-fg);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.7), 0 2px 8px -4px hsl(160 40% 20% / .26);
  }
  .badge{
    background:var(--glass-strong);
    -webkit-backdrop-filter:saturate(160%) blur(10px); backdrop-filter:saturate(160%) blur(10px);
    border:1px solid rgba(255,255,255,.6);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.7), 0 6px 16px -8px hsl(160 50% 30% / .3);
  }
  .tool-card{
    background:var(--glass);
    -webkit-backdrop-filter:var(--blur-lite); backdrop-filter:var(--blur-lite);
    border:1px solid var(--glass-edge-lo);
    box-shadow:var(--glass-shadow), var(--glass-inset);
  }
  .tool-card:hover{
    box-shadow:var(--shadow-green-lg), var(--glass-inset);
    border-color:rgba(255,255,255,.6);
  }
  .tool-ico{
    background:linear-gradient(135deg, hsl(160 60% 92%), hsl(174 55% 90%));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.85);
  }

  /* "More free tools" related section (per-tool footer nav). */
  .related{padding:28px 0}
  .rt-title{font-size:18px;font-weight:800;letter-spacing:-.01em;margin:0 0 14px}
  .rt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:860px){.rt-grid{grid-template-columns:1fr 1fr}}
  .rt-card{
    display:flex;align-items:center;justify-content:space-between;gap:10px;
    min-height:52px;padding:12px 16px;border-radius:14px;
    background:var(--glass);
    -webkit-backdrop-filter:var(--blur-lite); backdrop-filter:var(--blur-lite);
    border:1px solid var(--glass-edge-lo);
    box-shadow:var(--glass-inset);
    color:var(--ink);font-weight:650;font-size:14px;
    transition:transform .14s ease, box-shadow .16s ease, border-color .16s ease;
  }
  .rt-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-green),var(--glass-inset);border-color:rgba(255,255,255,.6);text-decoration:none}
  .rt-card .rt-go{color:var(--green-d);font-weight:800;transition:transform .16s ease}
  .rt-card:hover .rt-go{transform:translateX(3px)}

  /* Export panel → frosted scrim + floating sheet. */
  .export-overlay{
    background:hsl(222 32% 12% / .42);
    -webkit-backdrop-filter:blur(7px); backdrop-filter:blur(7px);
  }
  .export-sheet{
    background:var(--glass-strong);
    -webkit-backdrop-filter:var(--blur); backdrop-filter:var(--blur);
    border:1px solid rgba(255,255,255,.5);
    box-shadow:0 30px 72px -20px hsl(222 45% 8% / .6), var(--glass-inset);
  }
  .export-opt{
    background:rgba(255,255,255,.55);
    -webkit-backdrop-filter:var(--blur-lite); backdrop-filter:var(--blur-lite);
    border:1px solid rgba(255,255,255,.55);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.6);
  }
  .export-opt:hover{border-color:var(--green);box-shadow:var(--shadow-green)}

  /* Fields: iOS rounded, inset well, soft green focus ring. */
  label{font-weight:600;letter-spacing:.01em}
  input.f,textarea.f,select.f{
    min-height:46px;
    background:rgba(255,255,255,.72);
    -webkit-backdrop-filter:saturate(140%) blur(6px); backdrop-filter:saturate(140%) blur(6px);
    border:1.5px solid var(--glass-line);
    border-radius:13px;
    padding:12px 14px;
    box-shadow:inset 0 1px 2px hsl(215 25% 40% / .06);
    transition:border-color .18s ease, box-shadow .18s ease, background .18s ease;
  }
  input.f::placeholder,textarea.f::placeholder{color:hsl(215 16% 42%)}
  input.f:hover,textarea.f:hover,select.f:hover{border-color:hsl(160 30% 78%)}
  input.f:focus,textarea.f:focus,select.f:focus{
    outline:none; border-color:var(--green); background:#fff;
    box-shadow:0 0 0 4px hsl(160 84% 30% / .16);
  }
  select.f{cursor:pointer}

  /* Primary button: dimensional green capsule. */
  .btn{
    min-height:46px; border-radius:14px;
    background:linear-gradient(180deg, hsl(160 84% 34%), var(--green-d));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.28), 0 8px 20px -8px hsl(160 84% 20% / .6);
    transition:transform .12s ease, box-shadow .12s ease, filter .12s ease;
  }
  /* No color here — base .btn:hover already whitens primary buttons, and
     re-declaring color:#fff would override .cta-band .btn's green-d label. */
  .btn:hover{filter:brightness(1.05); background:linear-gradient(180deg, hsl(160 84% 34%), var(--green-d))}
  .btn:active{transform:scale(.97); box-shadow:inset 0 1px 3px hsl(160 84% 16% / .5)}
  .btn:focus-visible{outline:2px solid var(--green-d); outline-offset:2px}
  .btn.ghost{
    color:var(--green-d);
    background:rgba(255,255,255,.55);
    -webkit-backdrop-filter:blur(10px); backdrop-filter:blur(10px);
    border:1.5px solid rgba(255,255,255,.6);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.7), 0 4px 12px -6px hsl(160 40% 20% / .3);
  }
  .btn.ghost:hover{background:rgba(255,255,255,.72); border-color:var(--accent-line); color:var(--green-d)}
  .btn.ghost:active{transform:scale(.97)}
  .file-btn{
    min-height:42px; border-radius:12px;
    background:rgba(255,255,255,.65);
    -webkit-backdrop-filter:var(--blur-lite); backdrop-filter:var(--blur-lite);
    border:1.5px solid var(--glass-line);
    transition:border-color .16s ease, background .16s ease;
  }
  .file-btn:hover{border-color:var(--green); background:#fff}
  /* "Remove branding" toggle (injected next to the download button). */
  .nobrand-row{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;color:var(--muted);margin-top:14px;cursor:pointer;user-select:none}
  .nobrand-row input{width:18px;height:18px;accent-color:var(--green);cursor:pointer;flex-shrink:0}
  .nobrand-row:hover{color:var(--ink)}
  /* Benefit checklist in the sign-up-to-remove-branding modal. */
  .bm-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px}
  .bm-list li{position:relative;padding-left:29px;font-size:13.5px;color:var(--ink);line-height:1.45}
  .bm-list li b{font-weight:700}
  .bm-list li::before{content:"✓";position:absolute;left:0;top:0;width:20px;height:20px;border-radius:50%;background:var(--accent-bg);color:var(--green-d);font-size:12px;font-weight:800;display:grid;place-items:center}
  /* "Save to account" — the primary (highlighted) export option. */
  .export-opt.eo-primary{background:linear-gradient(180deg,hsl(160 60% 96%),hsl(160 55% 93%));border-color:var(--accent-line)}
  .export-opt.eo-primary .eo-ico{background:var(--green);color:#fff}
  .export-opt.eo-primary:hover{border-color:var(--green);box-shadow:var(--shadow-green)}
  /* Save confirmation toast. */
  .save-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%) translateY(20px);z-index:140;background:var(--ink);color:#fff;font-size:13.5px;font-weight:600;padding:12px 18px;border-radius:12px;box-shadow:0 12px 30px rgba(16,24,40,.35);opacity:0;visibility:hidden;transition:opacity .25s ease,transform .25s ease,visibility .25s ease;max-width:90vw}
  .save-toast.show{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}
  .save-toast a{color:#7CE0B8;font-weight:700;margin-left:6px}

  /* HARD GUARD: the export node is <div class="card print-doc"> — it carries BOTH
     classes, so force it back to opaque white paper and strip the sheen. After .card. */
  .print-doc, .print-doc *{
    -webkit-backdrop-filter:none!important; backdrop-filter:none!important;
  }
  .print-doc{
    background:#fff!important;
    border:1px solid var(--card-line)!important;
    box-shadow:0 1px 2px rgba(16,24,40,.06)!important;
  }
  .print-doc::before{content:none!important}

  /* Mobile "app feel": >=44px targets, 16px inputs (no iOS zoom), shorter bars.
     Full-width buttons scoped to main so the header "Open App" button is untouched. */
  @media(max-width:760px){
    :root{--hdr-h:56px}
    input.f,textarea.f,select.f{min-height:48px; font-size:16px}
    main .btn{width:100%; justify-content:center}
    .btn{min-height:48px}
    .ts-pill{min-height:44px; padding:10px 16px}
    .card{border-radius:18px; padding:18px}
    .hero{padding:34px 0 12px}
  }
  html{max-width:100%; overflow-x:hidden}

  /* Inputs must be able to shrink inside grid/flex cells (grid items default to
     min-width:auto, which lets a date input's intrinsic width overflow its cell). */
  input.f,textarea.f,select.f{min-width:0; max-width:100%}
  .row2>*{min-width:0}
  /* Phones: one field per row so date pickers and text inputs get full width and
     never overflow / squish. Two-up returns on larger phones & tablets where it fits. */
  @media(max-width:600px){ .row2{grid-template-columns:1fr} }

  /* Fallback: no backdrop-filter (older Firefox/Android) → solid-ish surfaces. */
  @supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){
    header.site,.tool-switch,.export-sheet{background:rgba(255,255,255,.96)}
    .card,.tool-card,.rt-card,.export-opt{background:#fff}
    .chip,.badge{background:#fff}
    .btn.ghost,.file-btn{background:#fff}
  }
  /* Reduced-transparency (OS accessibility) → near-opaque, no blur. */
  @media (prefers-reduced-transparency:reduce){
    header.site,.tool-switch,.card,.tool-card,.rt-card,.export-sheet,.export-opt,.chip,.badge{
      background:rgba(255,255,255,.97)!important;
      -webkit-backdrop-filter:none!important; backdrop-filter:none!important;
    }
  }
  /* Reduced-motion → kill transforms/animation (incl. export keyframes). */
  @media (prefers-reduced-motion:reduce){
    *,*::before,*::after{
      animation-duration:.001ms!important; animation-iteration-count:1!important;
      transition-duration:.001ms!important; scroll-behavior:auto!important;
    }
    .btn:active,.btn.ghost:active,.ts-pill:active,.tool-card:hover,.rt-card:hover{transform:none!important}
  }
  /* Re-assert the clean-A4 reset AFTER the .print-doc glass guard so the PDF
     (window.print) stays borderless — the guard's border/box-shadow are for screen only. */
</style>`;

// Same mark as the React app's <DealinsecLogo> (client/src/components/
// dealinsec-logo.tsx) — inlined as SVG so the server-rendered pages match the
// landing page exactly: emerald gradient tile, geometric "D", gold accent seal.
const LOGO_SVG = `<svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="logo" aria-hidden="true">
  <defs>
    <linearGradient id="dls-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#10B981"/><stop offset="0.55" stop-color="#059669"/><stop offset="1" stop-color="#0D9488"/></linearGradient>
    <linearGradient id="dls-sheen" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="white" stop-opacity="0.28"/><stop offset="0.5" stop-color="white" stop-opacity="0"/></linearGradient>
    <linearGradient id="dls-accent" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FBBF24"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>
  </defs>
  <rect width="48" height="48" rx="13" fill="url(#dls-bg)"/>
  <rect width="48" height="48" rx="13" fill="url(#dls-sheen)"/>
  <path d="M13.5 12 H22.5 C29.9558 12 34 16.9249 34 24 C34 31.0751 29.9558 36 22.5 36 H13.5 V12 Z M18.5 17 V31 H22.3 C26.6 31 29 28.4 29 24 C29 19.6 26.6 17 22.3 17 H18.5 Z" fill="white" fill-rule="evenodd"/>
  <circle cx="35.5" cy="33.5" r="3.2" fill="url(#dls-accent)" stroke="url(#dls-bg)" stroke-width="1.8"/>
</svg>`;

const EXT_ICON = `<svg class="ext" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`;

// Subtle decorative backdrop echoing the landing page's ambient style.
const AMBIENT = `<div class="ambient" aria-hidden="true"><span class="blob b1"></span><span class="blob b2"></span><span class="ring r1"></span><span class="ring r2"></span><span class="dotpad d1"></span><span class="dotpad d2"></span></div>`;

// Cross-tool navigation source of truth (label order = display order).
const TOOL_LINKS: [string, string][] = [
  ["/tools", "All tools"],
  ["/tools/gst-invoice-generator", "GST Invoice"],
  ["/tools/quotation-maker", "Quotation"],
  ["/tools/service-agreement-template", "Agreement"],
  ["/tools/gst-calculator", "GST Calculator"],
  ["/tools/proforma-invoice-generator", "Proforma"],
  ["/tools/purchase-order-generator", "Purchase Order"],
];

/** Sticky frosted sub-bar so users can hop between tools; marks the active one. */
function toolSwitch(active = ""): string {
  const pills = TOOL_LINKS.map(([href, label]) => {
    const on = href === active;
    return `<a class="ts-pill${on ? " active" : ""}" href="${esc(href)}"${on ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  }).join("");
  return `<nav class="tool-switch" aria-label="Free tools"><div class="wrap"><div class="ts-track" role="list">${pills}</div></div></nav>`;
}

/** "More free tools" cards for the bottom of each tool page (hides the current tool + the hub). */
function relatedTools(current = ""): string {
  const cards = TOOL_LINKS
    .filter(([href]) => href !== "/tools" && href !== current)
    .map(([href, label]) =>
      `<a class="rt-card" href="${esc(href)}"><span class="rt-label">${esc(label)}</span><span class="rt-go" aria-hidden="true">→</span></a>`,
    )
    .join("");
  return `<section class="related no-print" aria-label="More free tools"><div class="wrap">
    <h2 class="rt-title">More free tools</h2>
    <div class="rt-grid">${cards}</div>
  </div></section>`;
}

function header(): string {
  return `<header class="site"><div class="wrap">
    <a class="brand" href="/" aria-label="DealInSec home">${LOGO_SVG}<span class="brand-text">Deal<span class="brand-accent">insec</span></span></a>
    <nav class="nav">
      <a href="/tools" class="active">Free Tools</a>
      <a href="/tools#how">How it works</a>
      <a href="/tools#faq">FAQs</a>
      <a href="mailto:support@dealinsec.com">Contact</a>
    </nav>
    <a class="btn" href="${APP_LINK}">Open App ${EXT_ICON}</a>
  </div></header>`;
}

function ctaBand(): string {
  const clock = `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
  return `<div class="cta-band"><div class="wrap">
    <div class="cta-ico">${clock}</div>
    <div class="cta-copy">
      <h2>Get every deal in writing — and get paid on time</h2>
      <p>DealInSec takes you from quotation to signed agreement to GST invoice in one place. Save your clients, send invoices, track payments, and e-sign contracts. Free to start.</p>
    </div>
    <a class="btn" href="${APP_LINK}">Start free →</a>
  </div></div>`;
}

const SOCIALS = `<div class="socials">
  <a href="https://twitter.com/" aria-label="Twitter"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.2 8.2L23 22h-6.6l-5.2-6.8L5.3 22H2l7.7-8.8L1.5 2h6.8l4.7 6.2L18.9 2Zm-2.3 18h1.8L7.2 3.9H5.3L16.6 20Z"/></svg></a>
  <a href="https://www.linkedin.com/" aria-label="LinkedIn"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.94 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM3.2 8.5h3.5V21H3.2V8.5Zm5.6 0h3.35v1.7h.05c.47-.85 1.6-1.75 3.3-1.75 3.53 0 4.18 2.2 4.18 5.05V21h-3.5v-5.6c0-1.33-.02-3.05-1.86-3.05-1.86 0-2.15 1.45-2.15 2.95V21H8.8V8.5Z"/></svg></a>
  <a href="mailto:support@dealinsec.com" aria-label="Email"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3 6 9 6.5L21 6"/></svg></a>
</div>`;

const EO = {
  spin: `<svg class="eo-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>`,
  pdf: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>`,
  png: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>`,
  share: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>`,
  print: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>`,
  check: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  save: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>`,
};
const EXPORT_PANEL = `<div id="export-panel" class="export-overlay" aria-hidden="true" role="dialog" aria-modal="true" aria-label="Download or share">
  <div class="export-sheet">
    <div class="export-hero">
      <button class="export-close" id="export-close" aria-label="Close">&times;</button>
      <div class="export-check">${EO.check}</div>
      <h3>Your document is ready</h3>
      <p>Download it, or share it straight to your client</p>
    </div>
    <div class="export-grid">
      <button type="button" class="export-opt eo-primary" id="exp-save"><span class="eo-ico"><span class="eo-glyph">${EO.save}</span>${EO.spin}</span><b>Save to account</b><small>Keep &amp; open it anytime</small></button>
      <button type="button" class="export-opt" id="exp-pdf"><span class="eo-ico"><span class="eo-glyph">${EO.pdf}</span>${EO.spin}</span><b>Download PDF</b><small>Print or save as PDF</small></button>
      <button type="button" class="export-opt" id="exp-png"><span class="eo-ico"><span class="eo-glyph">${EO.png}</span>${EO.spin}</span><b>Download PNG</b><small>Image for chat &amp; social</small></button>
      <button type="button" class="export-opt" id="exp-share"><span class="eo-ico"><span class="eo-glyph">${EO.share}</span>${EO.spin}</span><b>Share</b><small>WhatsApp, email &amp; more</small></button>
    </div>
  </div>
</div>`;

function footer(): string {
  const y = 2026;
  return `<footer class="site"><div class="wrap">
    <div class="footer-top">
      <div class="links" style="margin-bottom:0">
        <a href="/tools">Free Tools</a>
        <a href="/tools/gst-invoice-generator">GST Invoice Generator</a>
        <a href="/">Product</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/refund">Refund</a>
      </div>
      ${SOCIALS}
    </div>
    <div class="muted">© ${y} DealInSec — the deal-management OS for India's service businesses. These free tools run in your browser; nothing you enter is stored on our servers.</div>
  </div></footer>`;
}

// Sign-up prompt shown when an anonymous user tries to remove the branding.
// Reuses the export panel's frosted-sheet styling for a consistent feel.
function brandModal(): string {
  const shield = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>`;
  return `<div id="brand-modal" class="export-overlay no-print" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Remove DealInSec branding">
    <div class="export-sheet">
      <div class="export-hero">
        <button class="export-close" data-close aria-label="Close">&times;</button>
        <div class="export-check">${shield}</div>
        <h3>Sign up free &amp; keep this document</h3>
        <p>Remove the footer — and save it to your account for later</p>
      </div>
      <div style="padding:20px">
        <ul class="bm-list">
          <li>Remove the &ldquo;Made with DealInSec&rdquo; footer</li>
          <li><b>This document is saved to your account</b> — open it anytime for later reference</li>
          <li>Reuse &amp; edit it, send to clients, track payments and e-sign</li>
        </ul>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
          <a class="btn" href="${APP_SIGNUP}" data-stash-save style="flex:1;min-width:150px;justify-content:center">Sign up free →</a>
          <button type="button" class="btn ghost" data-close>Maybe later</button>
        </div>
      </div>
    </div>
  </div>`;
}

export function renderToolPage(o: ToolPageOptions): string {
  const canonical = SITE_ORIGIN + o.canonicalPath;
  const ld = (o.jsonLd || [])
    // Escape "<" so a "</script>" inside any string value can't break out of
    // the JSON-LD script block (defense in depth; content is currently static).
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b).replace(/</g, "\\u003c")}</script>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}" />
<link rel="canonical" href="${canonical}" />
<meta name="robots" content="index,follow" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(o.title)}" />
<meta property="og:description" content="${esc(o.description)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:site_name" content="DealInSec" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(o.title)}" />
<meta name="twitter:description" content="${esc(o.description)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<script defer src="/tools/lib/html-to-image.js"></script>
${STYLES}
${o.headExtra || ""}
${ld}
</head>
<body>
${AMBIENT}
${header()}
${toolSwitch(o.canonicalPath)}
<main>${o.bodyHtml}</main>
${o.canonicalPath === "/tools" ? "" : relatedTools(o.canonicalPath)}
${EXPORT_PANEL}
${brandModal()}
<div id="save-toast" class="save-toast no-print" role="status" aria-live="polite"></div>
${o.hideCtaBand ? "" : ctaBand()}
${footer()}
${o.bodyEndScripts || ""}
</body>
</html>`;
}
