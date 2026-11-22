/**
 * A figure whose digits roll to the new value when it changes, each column on its own strip, the rightmost first.
 * Columns are keyed from the right so a new thousand adds a column instead of re-rolling every digit.
 * The idea is from 21st.dev's Delta Number Ticker; this is a small version in the site's own style.
 */
export default function RollNumber({ text, className = "" }: { text: string; className?: string }) {
  const chars = [...text];
  let digitFromRight = 0;
  const keyed = chars
    .map((c, i) => ({ c, i }))
    .reverse()
    .map(({ c, i }) => ({ c, key: /\d/.test(c) ? `d${digitFromRight++}` : `g${chars.length - 1 - i}`, order: digitFromRight }))
    .reverse();
  return (
    <span className={`inline-flex items-baseline overflow-hidden tabular-nums ${className}`} aria-label={text} role="text">
      {keyed.map(({ c, key, order }) =>
        /\d/.test(c) ? (
          <span key={key} aria-hidden className="relative inline-block overflow-hidden" style={{ height: "1em", lineHeight: 1 }}>
            <span className="invisible">0</span>
            <span
              className="roll-strip absolute inset-x-0 top-0 flex flex-col"
              style={{ transform: `translateY(-${Number(c) * 10}%)`, transitionDelay: `${order * 25}ms` }}
            >
              {"0123456789".split("").map((d) => (
                <span key={d} className="block text-center" style={{ height: "1em", lineHeight: 1 }}>
                  {d}
                </span>
              ))}
            </span>
          </span>
        ) : (
          <span key={key} aria-hidden style={{ lineHeight: 1 }}>
            {c}
          </span>
        ),
      )}
    </span>
  );
}
