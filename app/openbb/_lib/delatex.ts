/**
 * Convert the LaTeX the analyst LLM tends to emit into plain text/markdown —
 * OpenBB's chat panel does not render math, so `$$\text{Cost of Equity}$$`
 * and `$R_f$` reach users as raw markup.
 *
 * Deliberately conservative: inline `$...$` is only treated as math when the
 * inner text carries a LaTeX indicator (backslash, braces, sub/superscript),
 * so dollar amounts — including two in one sentence ("$5 … $6") — pass
 * through untouched.
 */

const COMMANDS: Array<[RegExp, string]> = [
  [/\\text\{([^}]*)\}/g, "$1"],
  [/\\mathrm\{([^}]*)\}/g, "$1"],
  [/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1 / $2)"],
  [/\\beta/g, "β"],
  [/\\alpha/g, "α"],
  [/\\sigma/g, "σ"],
  [/\\Delta/g, "Δ"],
  [/\\times/g, "×"],
  [/\\cdot/g, "·"],
  [/\\pm/g, "±"],
  [/\\approx/g, "≈"],
  [/\\leq/g, "≤"],
  [/\\geq/g, "≥"],
  [/\\%/g, "%"],
  [/[_^]\{([^}]*)\}/g, "_$1"],
  [/\\\\/g, " "],
];

function convertMath(inner: string): string {
  let s = inner;
  for (const [re, sub] of COMMANDS) s = s.replace(re, sub);
  // Any command we don't know: drop the backslash, keep the word.
  s = s.replace(/\\([A-Za-z]+)/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

/** Inline `$...$` is math only if it looks like LaTeX, not a price. */
function isMathy(inner: string): boolean {
  return /[\\{}_^]/.test(inner) && inner.length <= 120;
}

export function deLatex(text: string): string {
  return (
    text
      // Display blocks: $$...$$ (also the \[...\] variant) → inline code line.
      .replace(/\$\$([\s\S]{1,300}?)\$\$/g, (_, inner) => `\`${convertMath(inner)}\``)
      .replace(/\\\[([\s\S]{1,300}?)\\\]/g, (_, inner) => `\`${convertMath(inner)}\``)
      // Inline: $...$ / \(...\) only when the content is LaTeX-shaped.
      .replace(/\$([^$\n]{1,120})\$/g, (m, inner) =>
        isMathy(inner) ? convertMath(inner) : m,
      )
      .replace(/\\\(([^)\n]{1,120})\\\)/g, (_, inner) => convertMath(inner))
  );
}
