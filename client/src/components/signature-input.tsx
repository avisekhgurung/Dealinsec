/**
 * Draw or type a signature — either way, the output is the same PNG data
 * URL contract SignaturePad already used, so nothing downstream (the sign
 * endpoint, the document renderer) needs to know which mode was used.
 */
import { useEffect, useRef, useState } from "react";
import { PenLine, Type } from "lucide-react";
import { SignaturePad } from "@/components/signature-pad";

type Mode = "draw" | "type";

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
  ctx.fillText(trimmed.slice(0, 60), width / 2, height / 2);
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
            onChange={(e) => setTypedValue(e.target.value.slice(0, 60))}
            placeholder="Type your name"
            data-testid="input-typed-signature"
            className="w-full h-14 rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white px-4 text-3xl outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            style={{ fontFamily: "'Brush Script MT', 'Segoe Script', 'Apple Chancery', cursive", fontStyle: "italic", color: "#111827" }}
          />
          <p className="text-[11px] text-neutral-500 mt-1.5">This will be recorded as your signature.</p>
        </div>
      )}
    </div>
  );
}
