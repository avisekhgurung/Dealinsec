/**
 * PagedDocument — the pagination engine behind every DealInSec business PDF.
 *
 * The browser's native print flow breaks content wherever the page happens to
 * end: orphaned headings, signature blocks split across sheets, a lone footer
 * on its own page. This component removes that class of bug by composing
 * explicit A4 sheets BEFORE printing:
 *
 *   1. Every piece of the document is a DocBlock — an atomic unit that is
 *      never split across pages. Long content (tables, term lists) is chunked
 *      into multiple blocks by the caller so it can flow.
 *   2. Blocks render once into an offscreen measurer at the exact printable
 *      width (178mm), heights are read after fonts settle, and blocks are
 *      packed into pages greedily.
 *   3. `keepWithNext` chains a block to its successor — a section heading can
 *      therefore never be the last thing on a page.
 *   4. Each page renders as a real 210×297mm sheet with its own footer, so
 *      "Page X of Y" is exact and the invoice that fits one page IS one page.
 *
 * Screen shows the sheets as scaled cards (a true print preview); print emits
 * them 1:1 via doc.css (@page margin 0, break-after per sheet).
 */
import {
  useLayoutEffect, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import "./doc.css";

export interface DocBlock {
  key: string;
  node: ReactNode;
  /** Never let this block be the last on a page — glue it to the next one. */
  keepWithNext?: boolean;
  /** Extra classes on the block wrapper (table-continuation styling). */
  className?: string;
}

const PAGE_MM = { h: 297, padTop: 14, padBottom: 10 };
const BLOCK_GAP_MM = 3.2;

export function PagedDocument({
  blocks,
  footer,
  className = "",
}: {
  blocks: DocBlock[];
  /** Rendered at the bottom of every sheet. Page numbers are exact. */
  footer: (page: number, total: number) => ReactNode;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[][] | null>(null);
  const [scale, setScale] = useState(1);
  const [pxPerMm, setPxPerMm] = useState(0);
  const [fontTick, setFontTick] = useState(0);

  // Re-measure once webfonts land — Inter's metrics differ from the fallback.
  useEffect(() => {
    let alive = true;
    (document as any).fonts?.ready?.then(() => { if (alive) setFontTick((t) => t + 1); });
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const meas = measRef.current, probe = probeRef.current;
    if (!meas || !probe) return;
    const pxPerMm = probe.offsetHeight / 100;
    if (!pxPerMm) return;
    setPxPerMm(pxPerMm);

    const gap = BLOCK_GAP_MM * pxPerMm;
    const footH = (footRef.current?.offsetHeight ?? 0) + 3 * pxPerMm; /* .doc-foot margin */
    const budget =
      (PAGE_MM.h - PAGE_MM.padTop - PAGE_MM.padBottom) * pxPerMm - footH;

    const heights = new Map<string, number>();
    meas.querySelectorAll<HTMLElement>("[data-block]").forEach((el) => {
      heights.set(el.dataset.block!, el.offsetHeight + gap);
    });
    const h = (k: string) => heights.get(k) ?? gap;

    // Group keepWithNext chains into indivisible units where they fit.
    const units: string[][] = [];
    let chain: string[] = [];
    blocks.forEach((b, i) => {
      chain.push(b.key);
      if (!b.keepWithNext || i === blocks.length - 1) {
        units.push(chain);
        chain = [];
      }
    });

    const out: string[][] = [[]];
    let used = 0;
    const push = (k: string) => { out[out.length - 1].push(k); used += h(k); };
    const breakPage = () => { out.push([]); used = 0; };

    for (const unit of units) {
      const unitH = unit.reduce((s, k) => s + h(k), 0);
      if (unitH <= budget) {
        if (used > 0 && used + unitH > budget) breakPage();
        unit.forEach(push);
      } else {
        // Chain taller than a page: flow its blocks, but never leave the
        // chain's heading (any block except the unit's last) alone at a page
        // bottom — if the NEXT block won't also fit, break first.
        for (let j = 0; j < unit.length; j++) {
          const k = unit[j];
          const isGlue = j < unit.length - 1;
          const nextH = isGlue ? h(unit[j + 1]) : 0;
          if (used > 0 && used + h(k) + (isGlue ? Math.min(nextH, budget / 3) : 0) > budget) breakPage();
          push(k);
        }
      }
    }
    if (out.length > 1 && out[out.length - 1].length === 0) out.pop();
    setPages(out);
  }, [blocks, fontTick]);

  // Screen: scale the 210mm sheet down to the container (print resets this).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const probe = probeRef.current;
    const update = () => {
      const pageW = probe ? (probe.offsetHeight / 100) * 210 : 794;
      // A hidden container measures 0 — never scale the document away; it
      // recovers to the right scale the moment the pane becomes visible.
      if (el.clientWidth > 0) setScale(Math.min(1, el.clientWidth / pageW));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byKey = useMemo(() => new Map(blocks.map((b) => [b.key, b.node])), [blocks]);
  const byKey2 = useMemo(() => new Map(blocks.map((b) => [b.key, b.className ?? ""])), [blocks]);
  const laidOut = pages ?? [blocks.map((b) => b.key)];
  const pageWmm = 210;

  return (
    <div ref={wrapRef} className={`doc-pages doc-print-root ${className}`}>
      {/* Offscreen measurer at exact printable width */}
      <div className="doc-measurer" aria-hidden="true">
        <div ref={probeRef} style={{ height: "100mm" }} />
        <div ref={measRef} className="doc-meas-col doc-pages">
          {blocks.map((b) => (
            <div key={b.key} data-block={b.key} className={`doc-block ${b.className ?? ""}`}>{b.node}</div>
          ))}
          <div ref={footRef} className="doc-foot">{footer(1, 1)}</div>
        </div>
      </div>

      <div
        className="doc-scale-outer"
        style={
          scale < 1 && pxPerMm
            ? { height: laidOut.length * (297 * pxPerMm + 16) * scale, overflow: "hidden" }
            : undefined
        }
      >
      <div
        className="doc-scale"
        style={{ ["--doc-scale" as any]: scale, width: `${pageWmm}mm` }}
      >
        {laidOut.map((keys, pi) => (
          <div key={pi} className="doc-page">
            <div className="doc-page-body">
              {keys.map((k) => (
                <div key={k} className={`doc-block ${byKey2.get(k) ?? ""}`}>{byKey.get(k)}</div>
              ))}
            </div>
            <div className="doc-foot">{footer(pi + 1, laidOut.length)}</div>
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
