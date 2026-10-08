import type { Issue } from "./github.ts";

const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "is", "it", "for", "with", "when", "this", "that", "i", "be", "not", "are", "as", "at", "by", "if", "can", "do", "does", "my"]);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_ ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface Similar {
  number: number;
  title: string;
  score: number;
}

/** Issues most similar to `target` by title-weighted token overlap. Used as a duplicate detection tool. */
export function findSimilar(target: Issue, pool: Issue[], limit = 5): Similar[] {
  const t = tokens(`${target.title} ${target.title} ${target.body.slice(0, 600)}`);
  return pool
    .filter((i) => i.number !== target.number)
    .map((i) => ({
      number: i.number,
      title: i.title,
      score: Math.round(jaccard(t, tokens(`${i.title} ${i.title} ${i.body.slice(0, 600)}`)) * 100) / 100,
    }))
    .filter((s) => s.score >= 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
