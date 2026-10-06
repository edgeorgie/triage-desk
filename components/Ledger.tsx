import type { Step } from "@/lib/agent";

const META: Record<string, { verb: string; icon: string }> = {
  get_issue: { verb: "Reads issue", icon: "#" },
  find_similar: { verb: "Looks for duplicates", icon: "=" },
  list_labels: { verb: "Reviews the labels", icon: "*" },
  read_repo_file: { verb: "Opens", icon: "/" },
  submit_triage: { verb: "Files the ruling", icon: "ok" },
};

function detail(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>;
  if (name === "get_issue") return `#${String(o.number)}`;
  if (name === "read_repo_file") return String(o.path ?? "");
  return "";
}

/** The agent's working notes as a timeline: each completed tool call pops in on a growing line. */
export default function Ledger({ steps, running }: { steps: Step[]; running: boolean }) {
  const rows = steps.filter((s) => s.kind === "thought" || s.output !== undefined);
  return (
    <ol className="relative ml-4 border-l-2 border-dashed border-ink/15 pl-8">
      {rows.map((r, i) => {
        const meta = r.kind === "tool" ? META[r.name] ?? { verb: r.name, icon: "•" } : { verb: "", icon: "…" };
        return (
          <li key={i} className="rise relative pb-5" style={{ animationDelay: "40ms" }}>
            <span
              className={`pop absolute -left-[2.9rem] top-0 grid h-8 w-8 place-items-center rounded-full border-2 border-ink text-sm font-bold ${
                r.kind === "tool" && r.isError ? "bg-rose-soft" : r.kind === "thought" ? "bg-card" : "bg-lemon"
              }`}
            >
              {meta.icon}
            </span>
            {r.kind === "thought" ? (
              <p className="rounded-2xl rounded-tl-sm bg-card px-4 py-2.5 text-[14px] italic text-ink-soft shadow-sm">{r.text}</p>
            ) : (
              <div>
                <p className="text-[15px] font-semibold">
                  {meta.verb} <span className="font-mono text-[13px] font-normal text-ink-soft">{detail(r.name, r.input)}</span>
                </p>
                <p className={`mt-0.5 truncate font-mono text-[12px] ${r.isError ? "text-rose" : "text-ink-soft"}`}>{r.output?.replace(/\s+/g, " ").slice(0, 120)}</p>
              </div>
            )}
          </li>
        );
      })}
      {running && (
        <li className="relative pb-2">
          <span className="pulse-ring absolute -left-[2.9rem] top-0 grid h-8 w-8 place-items-center rounded-full bg-tangerine text-sm font-bold text-white">
            <span className="h-2 w-2 animate-ping rounded-full bg-white" />
          </span>
          <p className="pt-1 text-[15px] font-semibold text-tangerine">Investigating...</p>
        </li>
      )}
    </ol>
  );
}
