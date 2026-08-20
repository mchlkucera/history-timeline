import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, IBM_Plex_Mono, Instrument_Serif } from 'next/font/google';

// Import order matters and is exactly this:
import '../styles/tokens.css';   // Survey tokens — must be first
import '../styles/shell.css';    // Survey chrome
import '../styles/app.css';      // the app's own classes (.tl-view, .tl-canvasbox, rail stops, palette)
import './globals.css';          // the compat layer for the renderers — must be last

const sans = Instrument_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-tl-sans' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-tl-mono' });
const mark = Instrument_Serif({ subsets: ['latin'], weight: '400', display: 'swap', variable: '--font-tl-mark' });

export const metadata: Metadata = {
  title: 'Timeline — a visual atlas of history',
  description: 'Eleven working ways to see history — real borders, real lineages, one space-time block.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The shell is viewport-sized and paints its own ground; tell the browser
  // chrome which ground, per theme, so the notch area does not flash white.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E3E8E6' },
    { media: '(prefers-color-scheme: dark)', color: '#080C0D' },
  ],
};

/* THEME. tokens.css implements the requirement exactly: bare :root is the
   complete LIGHT palette, and dark is an override-only set under BOTH
   @media (prefers-color-scheme: dark) :root:not([data-theme="light"]) AND
   :root[data-theme="dark"].

   So DO NOT STAMP data-theme ON FIRST LOAD. This script stamps the attribute
   only when the stored value is exactly "dark" or "light"; anything else —
   including absent — stamps nothing, the device preference decides, and the
   unstamped light-OS state falls back to the bare :root light palette. */
const THEME_BOOT = `try{var t=localStorage.getItem('tl-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${mark.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="tl-body">{children}</body>
    </html>
  );
}
