/**
 * The agent's reply text: paragraphs, "- " bullet lists and **bold**, nothing
 * else. Built by hand rather than with a markdown library so model output can
 * never inject markup or links: everything is plain text nodes.
 */
import { Fragment } from "react";

const inline = (line: string) =>
  line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>);

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/).filter(Boolean);
  return (
    <div className={className ?? "space-y-2 text-sm leading-relaxed"}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const bullets = lines.every((l) => /^\s*[-•*]\s+/.test(l));
        if (bullets) {
          return (
            <ul key={bi} className="list-disc space-y-0.5 pl-5">
              {lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-•*]\s+/, ""))}</li>)}
            </ul>
          );
        }
        return (
          <p key={bi} className="break-words">
            {lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}
          </p>
        );
      })}
    </div>
  );
}
