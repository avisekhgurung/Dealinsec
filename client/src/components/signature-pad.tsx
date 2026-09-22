/**
 * A minimal, dependency-free signature pad. Mouse and touch, no library —
 * the product has none yet (the freelancer's own signature is an uploaded
 * image), and one small canvas is simpler than a new dependency for this.
 * Exposes the drawing as a PNG data URL via `onChange`, and nothing else.
 */
import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

export function SignaturePad({ onChange, height = 160 }: { onChange: (dataUrl: string | null) => void; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // Backing store at device pixel ratio so the stroke isn't blurry, while the
  // element itself stays at its CSS size — a signature pad is redrawn on
  // resize simply by clearing, which is acceptable here (nobody signs mid-resize).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111827";
    }
  }, [height]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const p = point(e);
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
    if (empty) setEmpty(false);
  };
  const end = () => {
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas && !empty) onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, touchAction: "none" }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={() => drawing.current && end()}
          data-testid="signature-canvas"
        />
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400 pointer-events-none">
            Sign here
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={empty}
        data-testid="button-clear-signature"
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-500 hover:text-neutral-700 disabled:opacity-40"
      >
        <RotateCcw className="w-3 h-3" /> Clear
      </button>
    </div>
  );
}
