const COLORS = [
  '#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
  '#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf',
];

export function avatarDataUri(name: string | null | undefined): string {
  try {
    const safeName = (name || '').trim() || '?';

    const rawInitials = safeName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => ([...w][0] ?? '').toUpperCase())
      .join('') || '?';

    // Only keep ASCII letters/digits to guarantee safe SVG + btoa encoding.
    const initials = rawInitials.replace(/[^\x20-\x7E]/g, '') || '?';

    const hash = [...safeName].reduce((a, c) => (a + c.charCodeAt(0)) | 0, 0);
    const color = COLORS[Math.abs(hash) % COLORS.length];

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="${color}"/><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="white">${initials}</text></svg>`;

    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="20" fill="#7f7f7f"/></svg>')}`;
  }
}
