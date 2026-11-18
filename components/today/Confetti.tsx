const COLORS = ["#22E5FF", "#8B5CFF", "#FF3DCB", "#34D399", "#FBBF24"];
const PIECES = 28;

/**
 * A one-shot CSS confetti burst for streak milestones. Purely decorative
 * (aria-hidden): the milestone is also announced in text. Under
 * prefers-reduced-motion the CSS hides it entirely (globals.css).
 */
export function Confetti() {
  return (
    <div
      aria-hidden="true"
      data-testid="confetti"
      className="qx-confetti pointer-events-none fixed inset-0 z-[80] overflow-hidden"
    >
      {Array.from({ length: PIECES }, (_, i) => {
        // Deterministic spread, so server and client renders agree.
        const x = (i * 37) % 100;
        const delay = (i % 7) * 60;
        const drift = ((i * 53) % 80) - 40;
        const spin = 360 + ((i * 97) % 540);
        return (
          <span
            key={i}
            className="qx-confetti__piece"
            style={
              {
                left: `${x}%`,
                background: COLORS[i % COLORS.length],
                animationDelay: `${delay}ms`,
                "--qx-drift": `${drift}vw`,
                "--qx-spin": `${spin}deg`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
