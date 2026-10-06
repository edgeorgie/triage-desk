interface Props {
  host: string;
  remember: boolean;
  hasKey: boolean;
  onRemember: (value: boolean) => void;
  onClear: () => void;
}

export default function KeyNotes({ host, remember, hasKey, onRemember, onClear }: Props) {
  return (
    <div className="flex flex-col gap-1.5 text-xs text-ink-soft">
      <p>
        Sent only to {host}. Kept for this tab only. Use a key with a spending limit.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} />
          Remember on this device (stored unencrypted in this browser)
        </label>
        {hasKey && (
          <button type="button" onClick={onClear} className="font-semibold underline-offset-4 hover:text-tangerine hover:underline">
            Clear key
          </button>
        )}
      </div>
    </div>
  );
}
