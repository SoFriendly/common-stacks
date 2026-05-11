interface Props {
  title: string;
  author?: string;
  className?: string;
}

// A small curated palette of literary cover colors. Picked deterministically
// from the title hash so the same book always gets the same cover.
const PALETTES: { bg: string; ink: string; accent: string }[] = [
  { bg: "#2b3a2f", ink: "#f1e7d0", accent: "#c9a86a" },
  { bg: "#5a3825", ink: "#f4e9d6", accent: "#d6a85a" },
  { bg: "#1e3a5f", ink: "#e8e4d5", accent: "#c7b07a" },
  { bg: "#7a2e2e", ink: "#f1e7d0", accent: "#d6a85a" },
  { bg: "#3d3a4f", ink: "#ece5d2", accent: "#bfa46a" },
  { bg: "#2e4a3f", ink: "#ece5d2", accent: "#cfa85a" },
  { bg: "#4a2e3f", ink: "#ece5d2", accent: "#c7a86a" },
  { bg: "#1f2a2e", ink: "#e6dfc8", accent: "#b89968" },
  { bg: "#5e4a2e", ink: "#f1e7d0", accent: "#e0c186" },
  { bg: "#264046", ink: "#ece5d2", accent: "#c0a165" },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fitLines(text: string, maxPerLine: number, maxLines: number): string[] {
  // Tokenize on whitespace, hyphens, underscores, and slashes so long
  // hyphenated names can break across lines.
  const tokens: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (buf) tokens.push(buf);
      buf = "";
    } else if (ch === "-" || ch === "_" || ch === "/" || ch === "·") {
      if (buf) tokens.push(buf + ch);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push(buf);

  const lines: string[] = [];
  let cur = "";
  for (const w of tokens) {
    // If a single token is longer than the line, hard-wrap it.
    if (w.length > maxPerLine) {
      if (cur) {
        lines.push(cur.trim());
        cur = "";
        if (lines.length >= maxLines) break;
      }
      let remaining = w;
      while (remaining.length > maxPerLine && lines.length < maxLines - 1) {
        lines.push(remaining.slice(0, maxPerLine));
        remaining = remaining.slice(maxPerLine);
      }
      cur = remaining;
      continue;
    }
    const candidate = cur ? `${cur}${cur.endsWith("-") || cur.endsWith("/") || cur.endsWith("_") ? "" : " "}${w}` : w;
    if (candidate.length <= maxPerLine) {
      cur = candidate;
    } else {
      lines.push(cur.trim());
      if (lines.length >= maxLines) {
        cur = "";
        break;
      }
      cur = w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur.trim());
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last.length > maxPerLine) lines[maxLines - 1] = last.slice(0, maxPerLine - 1) + "…";
  }
  return lines;
}

// Try progressively smaller font sizes until the whole title fits without
// truncation. Tuned for the 200x300 viewBox.
const TITLE_SIZE_TIERS: { fontSize: number; maxPerLine: number; maxLines: number }[] = [
  { fontSize: 19, maxPerLine: 13, maxLines: 3 },
  { fontSize: 17, maxPerLine: 14, maxLines: 4 },
  { fontSize: 15, maxPerLine: 16, maxLines: 5 },
  { fontSize: 13, maxPerLine: 19, maxLines: 6 },
  { fontSize: 11, maxPerLine: 22, maxLines: 8 },
  { fontSize: 9, maxPerLine: 26, maxLines: 10 },
];

function pickTitleSizing(title: string): {
  fontSize: number;
  lines: string[];
} {
  for (const tier of TITLE_SIZE_TIERS) {
    const lines = fitLines(title, tier.maxPerLine, tier.maxLines);
    const joined = lines.join(" ").replace(/\s+/g, " ").trim();
    const original = title.replace(/\s+/g, " ").trim();
    const lastTruncated = lines[lines.length - 1]?.endsWith("…") ?? false;
    if (!lastTruncated && joined.length >= original.length - 2) {
      return { fontSize: tier.fontSize, lines };
    }
  }
  const last = TITLE_SIZE_TIERS[TITLE_SIZE_TIERS.length - 1];
  return {
    fontSize: last.fontSize,
    lines: fitLines(title, last.maxPerLine, last.maxLines),
  };
}

export function DefaultCover({ title, author, className }: Props) {
  const palette = PALETTES[hash(title) % PALETTES.length];
  // Pick a font size that lets the entire title fit. Try larger sizes first
  // and shrink until everything fits without truncation.
  const sizing = pickTitleSizing(title);
  const lines = sizing.lines;
  const lineHeight = sizing.fontSize * 1.25;
  // Vertically center the title in the upper ~75% of the cover.
  const blockHeight = lines.length * lineHeight;
  const startY = 30 + (180 - blockHeight) / 2 + sizing.fontSize * 0.85;
  return (
    <svg
      viewBox="0 0 200 300"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={palette.bg} stopOpacity="1" />
          <stop offset="100%" stopColor={palette.bg} stopOpacity="0.85" />
        </linearGradient>
        <pattern id="grain" x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill={palette.bg} />
          <circle cx="1" cy="1" r="0.3" fill={palette.ink} fillOpacity="0.04" />
        </pattern>
      </defs>
      <rect width="200" height="300" fill="url(#paper)" />
      <rect width="200" height="300" fill="url(#grain)" />

      <g
        fontFamily='"Iowan Old Style","Palatino","Georgia",serif'
        fill={palette.ink}
        textAnchor="middle"
      >
        {lines.map((line, i) => (
          <text
            key={i}
            x="100"
            y={startY + i * lineHeight}
            fontSize={sizing.fontSize}
            fontWeight="600"
          >
            {line}
          </text>
        ))}
        {author &&
          (() => {
            const authorLines = fitLines(author.toUpperCase(), 22, 2);
            const baseY = 270 - (authorLines.length - 1) * 12;
            return authorLines.map((al, i) => (
              <text
                key={`a-${i}`}
                x="100"
                y={baseY + i * 12}
                fontSize="9"
                letterSpacing="2"
                fill={palette.accent}
              >
                {al}
              </text>
            ));
          })()}
      </g>
    </svg>
  );
}
