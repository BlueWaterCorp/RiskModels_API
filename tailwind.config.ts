import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';
import palette from 'tailwindcss/colors';

/**
 * Theme-aware palettes. The site was written against a dark zinc surface; rather
 * than restate every utility, the palettes below resolve through CSS variables.
 *   (no class)  literal Tailwind values — print/render routes rely on these
 *   html.light  Artifact Light: paper field, white plates, slate ink, navy chrome
 *   html.dark   navy field shared with the research site
 */
const ACCENTS = ['blue', 'emerald', 'red', 'amber', 'green', 'cyan', 'violet', 'orange', 'sky', 'rose', 'indigo'] as const;
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
type Shade = (typeof SHADES)[number];

function triple(hex: string): string {
  const h = hex.replace('#', '');
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

/** Text shades written for a dark field map to their dark counterparts on paper. */
const LIGHT_MIRROR: Record<Shade, Shade> = {
  '50': '950', '100': '900', '200': '800', '300': '700', '400': '700', '500': '600',
  '600': '700', '700': '800', '800': '200', '900': '100', '950': '50',
};

const ZINC_LIGHT: Record<Shade, string> = {
  '50': '#0b1220', '100': '#1a1a2e', '200': '#1e293b', '300': '#334155', '400': '#475569', '500': '#586579',
  '600': '#7c8aa0', '700': '#b8c2d0', '800': '#d5dce6', '900': '#ffffff', '950': '#f5f7fb',
};
const ZINC_DARK: Record<Shade, string> = {
  '50': '#f1f4f8', '100': '#e1e7ef', '200': '#d9e0ea', '300': '#c3ccd9', '400': '#9aa7bb', '500': '#7a889f',
  '600': '#46536b', '700': '#2e3a50', '800': '#1f2a3d', '900': '#121a2b', '950': '#0c1322',
};

const literalVars: Record<string, string> = { '--c-white': '255 255 255' };
const lightVars: Record<string, string> = { '--c-white': triple('#1a1a2e') };
const darkVars: Record<string, string> = { '--c-white': '255 255 255' };
const themed: Record<string, Record<string, string>> = {};

for (const shade of SHADES) {
  literalVars[`--c-zinc-${shade}`] = triple(palette.zinc[shade]);
  lightVars[`--c-zinc-${shade}`] = triple(ZINC_LIGHT[shade]);
  darkVars[`--c-zinc-${shade}`] = triple(ZINC_DARK[shade]);
}
themed.zinc = Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-zinc-${s}) / <alpha-value>)`]));
for (const name of ACCENTS) {
  const source = palette[name] as Record<Shade, string>;
  for (const shade of SHADES) {
    literalVars[`--c-${name}-${shade}`] = triple(source[shade]);
    lightVars[`--c-${name}-${shade}`] = triple(source[LIGHT_MIRROR[shade]]);
  }
  themed[name] = Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${name}-${s}) / <alpha-value>)`]));
}

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './content/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['var(--font-newsreader)', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: [
          'var(--font-mono)',
          'IBM Plex Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace',
        ],
      },
      colors: {
        white: 'rgb(var(--c-white) / <alpha-value>)',
        ...themed,
        navy: 'var(--rm-navy)',
        ink: 'var(--rm-ink)',
        'ink-muted': 'var(--rm-muted)',
        rule: 'var(--rm-rule)',
        plate: 'var(--rm-plate)',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      boxShadow: {
        md: '0 1px 2px rgb(15 23 42 / 0.06)',
        lg: '0 1px 3px rgb(15 23 42 / 0.08)',
        xl: '0 2px 6px rgb(15 23 42 / 0.10)',
        '2xl': '0 4px 12px rgb(15 23 42 / 0.12)',
      },
      borderRadius: {
        xl: '4px',
        '2xl': '4px',
        '3xl': '4px',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(20px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out',
        'fade-in-up': 'fade-in-up 0.5s ease-out',
        'slide-in': 'slide-in 0.3s ease-out',
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    typography,
    plugin(({ addBase }) => {
      addBase({ ':root': literalVars, 'html.light': lightVars, 'html.dark': darkVars });
    }),
  ],
};

export default config;
