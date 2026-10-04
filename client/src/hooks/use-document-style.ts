/**
 * The organization's document style, as CSS variables for the printable pages.
 * Any failure (not set up, offline, signed out) means the default look: a
 * document must always be able to print.
 */
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_DOCUMENT_STYLE, normalizeStyle, styleVars, type DocumentStyle } from "@shared/document-style";

export const DOCUMENT_STYLE_URL = "/api/document-style";

export function useDocumentStyle(): { style: DocumentStyle; vars: Record<string, string> } {
  const { data } = useQuery<{ style: DocumentStyle }>({ queryKey: [DOCUMENT_STYLE_URL], staleTime: 5 * 60_000, retry: false });
  const style = data?.style ? normalizeStyle(data.style) : DEFAULT_DOCUMENT_STYLE;
  return { style, vars: styleVars(style) };
}
