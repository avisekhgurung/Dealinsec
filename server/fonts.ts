/**
 * Self-hosted fonts for the server-rendered marketing pages (blog, category pages, tools).
 * One head snippet replaces the old Google Fonts links: the same woff2 files the app uses,
 * served from client/public/fonts. Latin subsets, SIL Open Font License.
 *
 * Inter 800 exists only for the brand wordmark (.brand), which the public/brand renders
 * match; everything else is Source Sans 3, with Source Serif 4 for the blog's article body.
 */
export const FONT_STACK_SANS = `"Source Sans 3","Aptos","Segoe UI Variable","Trebuchet MS",sans-serif`;

export const FONT_HEAD = `<link rel="preload" href="/fonts/source-sans-3-400.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/source-sans-3-600.woff2" as="font" type="font/woff2" crossorigin />
<style>
@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/source-sans-3-400.woff2") format("woff2")}
@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:500;font-display:swap;src:url("/fonts/source-sans-3-500.woff2") format("woff2")}
@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/source-sans-3-600.woff2") format("woff2")}
@font-face{font-family:"Source Sans 3";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/source-sans-3-700.woff2") format("woff2")}
@font-face{font-family:"Source Serif 4";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/source-serif-4-400.woff2") format("woff2")}
@font-face{font-family:"Source Serif 4";font-style:italic;font-weight:400;font-display:swap;src:url("/fonts/source-serif-4-400-italic.woff2") format("woff2")}
@font-face{font-family:"Source Serif 4";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/source-serif-4-600.woff2") format("woff2")}
@font-face{font-family:"Inter";font-style:normal;font-weight:800;font-display:swap;src:url("/fonts/inter-800.woff2") format("woff2")}
</style>`;
