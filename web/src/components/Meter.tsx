/* 8-bit status bar: ten chunky segments, value text beside it so color is never the only signal. */
export function Meter({ label, value, pct, tone = "mint", hint }: { label: string; value: string; pct: number; tone?: "mint" | "amber" | "magenta"; hint?: string }) {
  const filled = Math.max(0, Math.min(10, Math.round(pct * 10)));
  return (
    <div className="meter">
      <div className="meter-top">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{value}</span>
      </div>
      <div className={`bar bar-${tone}`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-valuetext={value}>
        {Array.from({ length: 10 }, (_, i) => <span key={i} className={i < filled ? "seg on" : "seg"} />)}
      </div>
      {hint && <p className="meter-hint">{hint}</p>}
    </div>
  );
}
