import type { Step } from "@/lib/agent";

const VERB: Record<string, string> = {
  get_issue: "Reads issue",
  find_similar: "Checks for duplicates",
  list_labels: "Reviews labels",
  read_repo_file: "Opens",
  submit_triage: "Files the ruling",
};

function detail(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>;
  if (name === "get_issue") return `#${String(o.number)}`;
  if (name === "read_repo_file") return String(o.path ?? "");
  return "";
}

/** The agent's working notes: one line per completed tool call, in order, so its reasoning can be audited. */
export default function Ledger({ steps, running }: { steps: Step[]; running: boolean }) {
  const rows = steps.filter((s) => s.kind === "thought" || s.output !== undefined);
  return (
    <ol className="font-mono text-[12.5px] leading-relaxed">
      {rows.map((r, i) => (
        <li key={i} className="typed grid grid-cols-[2.2rem_1fr] border-t border-dashed border-[var(--rule)] py-2">
          <span className="text-ink-soft/60">{String(i + 1).padStart(2, "0")}</span>
          {r.kind === "thought" ? (
            <span className="italic text-ink-soft">&ldquo;{r.text}&rdquo;</span>
          ) : (
            <span>
              <span className={r.isError ? "text-signal" : "text-ink"}>
                {VERB[r.name] ?? r.name} {detail(r.name, r.input)}
              </span>
              <span className="mt-0.5 block truncate text-ink-soft">
                {r.isError ? "! " : "-> "}
                {r.output?.replace(/\s+/g, " ").slice(0, 110)}
              </span>
            </span>
          )}
        </li>
      ))}
      {running && (
        <li className="grid grid-cols-[2.2rem_1fr] border-t border-dashed border-[var(--rule)] py-2 text-ink-soft">
          <span>..</span>
          <span className="animate-pulse">investigating</span>
        </li>
      )}
    </ol>
  );
}
