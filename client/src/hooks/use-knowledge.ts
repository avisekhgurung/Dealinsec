/** The workspace's knowledge: the list, what each addition does, and removal. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export const KNOWLEDGE_URL = "/api/knowledge";

export interface KnowledgeSource {
  id: string; kind: "note" | "url" | "pdf" | "image"; title: string; sourceUrl: string | null; fileName: string | null; description: string | null;
  chars: number; chunkCount: number; truncated: boolean; hasFile: boolean; createdAt: string;
}
export interface KnowledgeList {
  sources: KnowledgeSource[];
  usage: { sources: number; chunks: number };
  limits: { sources: number; chunks: number; pdfBytes: number; imageBytes: number };
}
export interface KnowledgeHit { n: number; sourceId: string; title: string; kind: string; sourceUrl: string | null; text: string }

export const useKnowledge = () => useQuery<KnowledgeList>({ queryKey: [KNOWLEDGE_URL], retry: false });

const refresh = () => queryClient.invalidateQueries({ queryKey: [KNOWLEDGE_URL] });
const json = async <T,>(res: Response): Promise<T> => res.json();

export const useAddNote = () => useMutation({ mutationFn: async (v: { title: string; text: string }) => json(await apiRequest("POST", `${KNOWLEDGE_URL}/note`, v)), onSuccess: refresh });
export const useAddUrl = () => useMutation({ mutationFn: async (v: { url: string; title?: string }) => json(await apiRequest("POST", `${KNOWLEDGE_URL}/url`, v)), onSuccess: refresh });
export const useAddPdf = () => useMutation({
  mutationFn: async (v: { file: File; title?: string }) => {
    const f = new FormData(); f.append("file", v.file); if (v.title) f.append("title", v.title);
    return json(await apiRequest("POST", `${KNOWLEDGE_URL}/pdf`, f));
  }, onSuccess: refresh,
});
export const useAddImage = () => useMutation({
  mutationFn: async (v: { file: File; title: string; description: string }) => {
    const f = new FormData(); f.append("title", v.title); f.append("description", v.description); f.append("file", v.file);
    return json(await apiRequest("POST", `${KNOWLEDGE_URL}/image`, f));
  }, onSuccess: refresh,
});
export const useRemoveSource = () => useMutation({ mutationFn: async (id: string) => json(await apiRequest("DELETE", `${KNOWLEDGE_URL}/${encodeURIComponent(id)}`)), onSuccess: refresh });
export const searchKnowledge = async (q: string) => json<{ hits: KnowledgeHit[]; empty: boolean; terms: string[] }>(await apiRequest("GET", `${KNOWLEDGE_URL}/search?q=${encodeURIComponent(q)}`));
