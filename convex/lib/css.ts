import type { DesignProfile } from "./types";

const FONT_MAP: Record<string, string> = {
  "serif-formal": 'Georgia, "Iowan Old Style", serif',
  "serif-casual": '"Palatino Linotype", "Book Antiqua", serif',
  "sans-formal": '"Helvetica Neue", Helvetica, Arial, sans-serif',
  "sans-casual": 'Verdana, "Trebuchet MS", sans-serif',
  "mono-technical": '"Courier New", Courier, monospace',
  "mixed-editorial": "Georgia, serif",
};

const HEADING_FONT_MAP: Record<string, string | null> = {
  "mixed-editorial": "Helvetica, sans-serif",
};

export function generateSeriesCSS(profile: DesignProfile): string {
  const bodyFont = FONT_MAP[profile.font_mood] ?? FONT_MAP["serif-formal"];
  const headingFont = HEADING_FONT_MAP[profile.font_mood] ?? null;
  const primary = profile.color_primary || "#2c3e50";
  const secondary = profile.color_secondary || "#f4f6f7";
  const accent = profile.color_accent || "#e74c3c";

  let css = `/* Shelf — Design Echo Stylesheet */

body {
  font-family: ${bodyFont};
  line-height: 1.7;
  margin: 1em;
  color: #1a1a1a;
}

.series-header {
  border-top: 4px solid ${primary};
  padding-top: 0.5em;
  margin-bottom: 2em;
}

.series-name {
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${primary};
}

.issue-date {
  font-size: 0.75em;
  color: #888;
  margin-top: 0.2em;
}

h1 {
  font-size: 1.8em;
  line-height: 1.2;
  margin-bottom: 0.3em;
}

h2, h3 {
  color: ${primary};
}

h2 { font-size: 1.4em; margin-top: 1.5em; }
h3 { font-size: 1.15em; margin-top: 1.2em; }
`;

  if (headingFont) {
    css += `
h1, h2, h3 {
  font-family: ${headingFont};
}
`;
  }

  css += `
.first-paragraph::first-letter {
  float: left;
  font-size: 3.2em;
  line-height: 0.8;
  padding-right: 0.08em;
  color: ${primary};
}

blockquote {
  border-left: 3px solid ${accent};
  margin-left: 0;
  padding-left: 1em;
  font-style: italic;
  color: #555;
}
`;

  if (profile.has_callout_boxes) {
    css += `
.callout {
  background: ${secondary};
  padding: 1em;
  border-radius: 4px;
  margin: 1.5em 0;
}
`;
  }

  if (profile.has_dividers) {
    css += `
hr {
  border: none;
  border-top: 1px solid ${secondary};
  margin: 2em 0;
}
`;
  }

  css += `
img {
  max-width: 100%;
  height: auto;
}

figcaption {
  font-size: 0.85em;
  color: #888;
  text-align: center;
  margin-top: 0.3em;
}

a {
  color: ${accent};
  text-decoration: underline;
}

p { margin: 0.8em 0; }

ul, ol {
  margin: 0.8em 0;
  padding-left: 1.5em;
}

code {
  font-family: "Courier New", Courier, monospace;
  font-size: 0.9em;
  background: ${secondary};
  padding: 0.1em 0.3em;
  border-radius: 2px;
}

pre {
  background: ${secondary};
  padding: 1em;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.85em;
}
`;

  return css;
}
