"use client";

import { useState } from "react";
import type { Issue } from "@/lib/github";
import type { TriageResult } from "@/lib/triage";
import { PRIORITIES } from "@/lib/triage";

const KIND: Record<string, { label: string; color: string }> = {
  bug: { label: "Bug", color: "bg-rose-soft text-rose" },
  feature: { label: "Feature", color: "bg-mint-soft text-mint" },
  question: { label: "Question", color: "bg-lemon/60 text-ink" },
  docs: { label: "Docs", color: "bg-tangerine-soft text-tangerine" },
  support: { label: "Support", color: "bg-lemon/60 text-ink" },
  other: { label: "Other", color: "bg-card text-ink-soft" },
};

const NOTE: Record<string, string> = { p0: "Drop everything", p1: "This sprint", p2: "In the queue", p3: "When time allows" };

export default function Ruling({ result, issue }: { result: TriageResult; issue: Issue }) {
  const [copied, setCopied] = useState(false);
  const kind = KIND[result.kind];
  const copy = () => {
    navigator.clipboard?.writeText(result.reply);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <section className="rise rounded-[2rem] bg-ink p-7 text-cream shadow-2xl shadow-ink/20">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`pop rounded-full px-4 py-1.5 text-sm font-bold ${kind.color}`}>{result.duplicateOf ? "Duplicate" : kind.label}</span>
        <div className="flex gap-1.5" aria-label={`Priority ${result.priority}`}>
          {PRIORITIES.map((p) => (
            <span
              key={p}
              className={`grid h-9 w-11 place-items-center rounded-xl font-mono text-sm font-bold transition ${
                p === result.priority ? "pop scale-110 bg-tangerine text-white shadow-lg shadow-tangerine/40" : "bg-cream/10 text-cream/40"
              }`}
            >
              {p.toUpperCase()}
            </span>
          ))}
        </div>
        <span className="text-sm text-cream/60">{NOTE[result.priority]}</span>
      </div>

      <p className="display mt-6 text-3xl font-bold leading-tight sm:text-4xl">{result.summary}</p>

      <div className="mt-6 flex items-center gap-3 text-sm text-cream/60">
        <span>Confidence</span>
        <span className="h-2 w-40 overflow-hidden rounded-full bg-cream/15">
          <span className="meter block h-full rounded-full bg-lemon" style={{ width: `${Math.round(result.confidence * 100)}%` }} />
        </span>
        <span className="font-mono">{Math.round(result.confidence * 100)}%</span>
      </div>

      <div className="mt-7 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50">Labels</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.labels.length === 0 && <span className="text-sm text-cream/50">none suggested</span>}
            {result.labels.map((l, i) => (
              <span key={l} className="pop rounded-full border border-cream/25 px-3 py-1 text-sm" style={{ animationDelay: `${i * 70}ms` }}>
                {l}
              </span>
            ))}
          </div>
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50">Duplicate of</p>
          <p className="mt-2 text-sm">
            {result.duplicateOf ? (
              <a className="rounded-full bg-lemon px-3 py-1 font-semibold text-ink hover:bg-white" href={issue.url.replace(/\/\d+$/, `/${result.duplicateOf}`)} target="_blank" rel="noreferrer">
                #{result.duplicateOf} &rarr;
              </a>
            ) : (
              <span className="text-cream/50">no clear match</span>
            )}
          </p>
        </div>
      </div>

      {result.needsInfo.length > 0 && (
        <div className="mt-7">
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50">Missing from the report</p>
          <ul className="mt-2 space-y-1.5">
            {result.needsInfo.map((n, i) => (
              <li key={i} className="flex gap-2 text-[15px]">
                <span className="text-tangerine">+</span>
                {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 rounded-3xl rounded-tl-md bg-cream p-5 text-ink">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-soft">Suggested first reply</p>
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{result.reply}</p>
        <button onClick={copy} className="mt-4 rounded-full bg-ink px-4 py-1.5 text-sm font-semibold text-cream transition hover:bg-tangerine active:scale-95">
          {copied ? "Copied!" : "Copy reply"}
        </button>
      </div>
    </section>
  );
}
