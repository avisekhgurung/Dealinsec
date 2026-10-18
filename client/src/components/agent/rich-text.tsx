/**
 * The agent's reply text, from Markdown parsed into plain data (lib/chat/markdown.ts) and rendered as React elements.
 * No HTML from the model ever reaches the page: there is no dangerouslySetInnerHTML here, text is text nodes, and a
 * link exists only for a URL that passed `safeHref` (http(s) out of the app, or a path inside it).
 *
 * Long content stays readable: code blocks and tables scroll sideways inside their own box (keyboard-focusable), never
 * the whole conversation. Parsing is memoized per message, so a reply isn't re-parsed when something else changes.
 */
import { Fragment, memo, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/chat/clipboard";
import { parseMarkdown, type Block, type Inline } from "@/lib/chat/markdown";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text": return <Fragment key={i}>{n.v}</Fragment>;
          case "br": return <br key={i} />;
          case "strong": return <strong key={i} className="font-semibold"><Inlines nodes={n.c} /></strong>;
          case "em": return <em key={i}><Inlines nodes={n.c} /></em>;
          case "code": return <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [overflow-wrap:anywhere]">{n.v}</code>;
          case "link":
            return n.external ? (
              <a key={i} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-emerald-700 underline decoration-emerald-700/30 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-current dark:text-emerald-400">
                <Inlines nodes={n.c} /><ExternalLink className="ml-0.5 inline h-3 w-3 align-[-1px]" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link key={i} href={n.href} className="font-medium text-emerald-700 underline decoration-emerald-700/30 underline-offset-2 hover:decoration-current dark:text-emerald-400"><Inlines nodes={n.c} /></Link>
            );
        }
      })}
    </>
  );
}

/** Copy with honest feedback: "Copied" only when the clipboard took it. */
export function CopyButton({ text, label = "Copy", className, testId }: { text: string; label?: string; className?: string; testId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button type="button" data-testid={testId}
      onClick={async () => { const ok = await copyText(text); setState(ok ? "copied" : "failed"); setTimeout(() => setState("idle"), 1600); }}
      className={cn("inline-flex h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted sm:h-7 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60", className)}
      aria-label={state === "copied" ? "Copied" : label}>
      {state === "copied" ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}</span>
      <span className="sr-only" role="status">{state === "copied" ? "Copied to clipboard" : state === "failed" ? "Couldn't copy" : ""}</span>
    </button>
  );
}

function CodeBlock({ lang, code, open }: { lang: string | null; code: string; open: boolean }) {
  return (
    <figure className="overflow-hidden rounded-xl border bg-neutral-50 dark:bg-neutral-900/60" data-testid="md-code">
      <figcaption className="flex items-center justify-between gap-2 border-b px-3 py-1">
        <span className="font-mono text-[11px] text-muted-foreground">{lang || "text"}{open ? " · still writing" : ""}</span>
        <CopyButton text={code} label="Copy code" testId="md-code-copy" />
      </figcaption>
      <pre tabIndex={0} className="max-h-[32rem] overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/50"><code>{code}</code></pre>
    </figure>
  );
}

const HEADING_TAG = { 1: "h3", 2: "h4", 3: "h5", 4: "h6" } as const;
const HEADING_CLASS = { 1: "text-base font-semibold", 2: "text-[15px] font-semibold", 3: "text-sm font-semibold", 4: "text-sm font-medium text-foreground/80" } as const;

function Blocks({ blocks, nested = false }: { blocks: Block[]; nested?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "heading": {
            const Tag = HEADING_TAG[b.level];
            return <Tag key={i} className={cn(HEADING_CLASS[b.level], "leading-snug", i > 0 && "pt-1.5")}><Inlines nodes={b.c} /></Tag>;
          }
          case "p": return <p key={i} className="break-words"><Inlines nodes={b.c} /></p>;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} start={b.ordered && b.start !== 1 ? b.start : undefined} className={cn(b.ordered ? "list-decimal" : nested ? "list-[circle]" : "list-disc", "space-y-1 pl-5 marker:text-muted-foreground")}>
                {b.items.map((it, k) => (
                  <li key={k} className="break-words pl-0.5">
                    <Inlines nodes={it.c} />
                    {it.children.length > 0 && <div className="mt-1 space-y-1.5"><Blocks blocks={it.children} nested /></div>}
                  </li>
                ))}
              </Tag>
            );
          }
          case "code": return <CodeBlock key={i} lang={b.lang} code={b.v} open={b.open} />;
          case "table":
            return (
              <div key={i} role="region" aria-label="Table" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50" data-testid="md-table">
                <table className="w-max min-w-full border-collapse text-xs">
                  <thead className="bg-muted/60">
                    <tr>{b.head.map((h, k) => <th key={k} scope="col" style={{ textAlign: b.align[k] ?? "left" }} className="whitespace-nowrap border-b px-3 py-2 font-semibold"><Inlines nodes={h} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri} className="border-b last:border-0 even:bg-muted/20">
                        {r.map((c, k) => <td key={k} style={{ textAlign: b.align[k] ?? "left" }} className="max-w-[22rem] px-3 py-2 align-top"><Inlines nodes={c} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote": return <blockquote key={i} className="space-y-2 border-l-2 border-emerald-500/40 pl-3 text-foreground/80"><Blocks blocks={b.c} /></blockquote>;
          case "hr": return <hr key={i} className="border-border" />;
        }
      })}
    </>
  );
}

export const RichText = memo(function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={className ?? "min-w-0 space-y-2.5 text-sm leading-relaxed"} data-testid="rich-text">
      <Blocks blocks={blocks} />
    </div>
  );
});
