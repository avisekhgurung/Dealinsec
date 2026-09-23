/**
 * Draw or type a signature — either way, the output is the same PNG data
 * URL contract SignaturePad already used, so nothing downstream (the sign
 * endpoint, the document renderer) needs to know which mode was used.
 */
import { useEffect, useRef, useState } from "react";
import { PenLine, Type } from "lucide-react";
import { SignaturePad } from "@/components/signature-pad";

type Mode = "draw" | "type";

/** Cuts at a Unicode code point, never inside a UTF-16 surrogate pair or a
 *  combining sequence. A plain `.slice(0, n)` counts UTF-16 code UNITS, so it
 *  can split a character outside the Basic Multilingual Plane in half,
 *  corrupting the last glyph of a name that happens to land on the cut. */
function truncateGraphemes(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/** Cursive Latin scripts ("Brush Script MT" and its fallbacks) have no glyphs
 *  for CJK, Arabic, Hebrew, Devanagari, Greek or Cyrillic — the browser falls
 *  through to a plain system font for those ranges, which no longer looks
 *  like a signature and can misalign against the cursive baseline. Detected
 *  so the UI can steer toward Draw instead, not to block Type: the fallback
 *  font may still render the name legibly, just not as a flourish. */
function looksNonLatin(text: string): boolean {
  return /[Ͱ-ϿЀ-ӿ֐-ࣿऀ-෿฀-࿿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯豈-﫿]/.test(text)
    || /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text); // a surrogate pair — a supplementary-plane character (e.g. a rare CJK ideograph)
}

/** Renders a typed name in a signature-style script onto an offscreen
 *  canvas, so a typed signature is stored in the exact same format a drawn
 *  one is — the server and the document renderer never special-case it. */
function typedSignatureDataUrl(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  const width = 400;
  const height = 120;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "italic 42px 'Brush Script MT', 'Segoe Script', 'Apple Chancery', cursive";
  ctx.fillText(truncateGraphemes(trimmed, 60), width / 2, height / 2);
  return canvas.toDataURL("image/png");
}

export function SignatureInput({ signerName, onChange }: { signerName: string; onChange: (dataUrl: string | null) => void }) {
  const [mode, setMode] = useState<Mode>("draw");
  const [typedValue, setTypedValue] = useState(signerName);
  const lastDrawn = useRef<string | null>(null);

  // Typed mode defaults to whatever name is already entered above, so a
  // visitor who already typed their name doesn't have to type it twice.
  useEffect(() => {
    if (mode === "type" && !typedValue) setTypedValue(signerName);
  }, [mode]);

  useEffect(() => {
    if (mode !== "type") return;
    onChange(typedSignatureDataUrl(typedValue));
  }, [mode, typedValue]);

  const selectMode = (m: Mode) => {
    setMode(m);
    if (m === "draw") onChange(lastDrawn.current);
    else onChange(typedSignatureDataUrl(typedValue));
  };

  const nonLatinName = looksNonLatin(signerName) || looksNonLatin(typedValue);

  return (
    <div>
      <div className="flex items-center gap-1 mb-2" role="tablist" aria-label="Signature method">
        {(["draw", "type"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => selectMode(m)}
            data-testid={`signature-tab-${m}`}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mode === m
                ? "bg-emerald-600 text-white"
                : "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            }`}
          >
            {m === "draw" ? <PenLine className="w-3.5 h-3.5" /> : <Type className="w-3.5 h-3.5" />}
            {m === "draw" ? "Draw" : "Type"}
          </button>
        ))}
        {mode === "draw" && nonLatinName && (
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium ml-1">Recommended for this name</span>
        )}
      </div>

      {mode === "draw" ? (
        <SignaturePad
          onChange={(dataUrl) => {
            lastDrawn.current = dataUrl;
            onChange(dataUrl);
          }}
        />
      ) : (
        <div>
          <input
            value={typedValue}
            onChange={(e) => setTypedValue(truncateGraphemes(e.target.value, 60))}
            placeholder="Type your name"
            data-testid="input-typed-signature"
            className="w-full h-14 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white px-4 text-3xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            style={{ fontFamily: "'Brush Script MT', 'Segoe Script', 'Apple Chancery', cursive", fontStyle: "italic", color: "#111827" }}
          />
          <p className="text-[11px] text-neutral-500 mt-1.5">This will be recorded as your signature.</p>
          {nonLatinName && (
            <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
              This font may not display your name clearly. Draw is usually clearer for non-Latin names.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
