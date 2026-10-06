import type { Issue } from "@/lib/github";
import type { TriageResult } from "@/lib/triage";

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  feature: "Feature",
  question: "Question",
  docs: "Docs",
  support: "Support",
  other: "Other",
};

const PRIORITY_NOTE: Record<string, string> = {
  p0: "Drop everything",
  p1: "This sprint",
  p2: "In the queue",
  p3: "When time allows",
};

const eyebrow = "font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft";

export default function Ruling({ result, issue }: { result: TriageResult; issue: Issue }) {
  const hot = result.priority === "p0" || result.priority === "p1";
  return (
    <section className="border-2 border-ink p-6">
      <div className="flex items-start justify-between gap-4">
        <p className={eyebrow}>
          Ruling on #{issue.number} &middot; {PRIORITY_NOTE[result.priority]} &middot; {Math.round(result.confidence * 100)}% sure
        </p>
        <span
          className={`stamp shrink-0 border-[3px] px-3 py-1 font-mono text-sm font-bold uppercase tracking-[0.2em] ${
            hot ? "border-signal text-signal" : "border-moss text-moss"
          }`}
        >
          {result.duplicateOf ? "Duplicate" : KIND_LABEL[result.kind]} {result.priority}
        </span>
      </div>
      <p className="mt-4 font-serif text-3xl leading-tight">{result.summary}</p>

      <dl className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <dt className={eyebrow}>Labels</dt>
          <dd className="mt-2 flex flex-wrap gap-1.5">
            {result.labels.length === 0 && <span className="text-sm text-ink-soft">none suggested</span>}
            {result.labels.map((l) => (
              <span key={l} className="border border-ink px-2 py-0.5 font-mono text-xs">{l}</span>
            ))}
          </dd>
        </div>
        <div>
          <dt className={eyebrow}>Duplicate of</dt>
          <dd className="mt-2 font-mono text-sm">
            {result.duplicateOf ? (
              <a
                className="underline decoration-signal decoration-2 underline-offset-4"
                href={issue.url.replace(/\/\d+$/, `/${result.duplicateOf}`)}
                target="_blank"
                rel="noreferrer"
              >
                #{result.duplicateOf}
              </a>
            ) : (
              <span className="text-ink-soft">no clear match</span>
            )}
          </dd>
        </div>
      </dl>

      {result.needsInfo.length > 0 && (
        <div className="mt-6">
          <p className={eyebrow}>Missing from the report</p>
          <ul className="mt-2 space-y-1 text-sm">
            {result.needsInfo.map((n, i) => (
              <li key={i} className="flex gap-2"><span className="text-signal">&times;</span>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 border-l-4 border-signal pl-4">
        <p className={eyebrow}>Suggested first reply</p>
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed">{result.reply}</p>
        <button
          onClick={() => navigator.clipboard?.writeText(result.reply)}
          className="mt-3 font-mono text-xs uppercase tracking-widest underline underline-offset-4 hover:text-signal"
        >
          Copy reply
        </button>
      </div>
    </section>
  );
}
