/** Contour lines for the map's background. Purely decorative. */

function contour(
  centerX: number,
  centerY: number,
  radius: number,
  phase: number,
): string {
  const points: string[] = [];
  const steps = 72;
  for (let step = 0; step < steps; step += 1) {
    const angle = (step / steps) * Math.PI * 2;
    const wobble =
      1 + 0.14 * Math.sin(3 * angle + phase) + 0.07 * Math.sin(5 * angle - phase);
    const x = centerX + Math.cos(angle) * radius * wobble * 1.25;
    const y = centerY + Math.sin(angle) * radius * wobble;
    points.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return `M ${points.join(" L ")} Z`;
}

const PATHS = [
  ...[70, 130, 190, 250, 310].map((radius, index) =>
    contour(800, 250, radius, 0.6 + index * 0.18),
  ),
  ...[60, 120, 180, 240, 300, 360].map((radius, index) =>
    contour(180, 780, radius, 2.1 + index * 0.14),
  ),
];

export function Contours() {
  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 size-full text-map-line"
      aria-hidden
    >
      <g fill="none" stroke="currentColor" strokeWidth={1.2}>
        {PATHS.map((path, index) => (
          // Math.sin can differ in its last digit between the server and a browser.
          <path key={index} d={path} suppressHydrationWarning />
        ))}
      </g>
    </svg>
  );
}
