// The display fonts (Kremlin, Propaganda, Mockery) have no Polish
// diacritics, so text set in them is written the way arcade machines of
// the era did it: plain letters, upper case. Kremlin also draws nothing
// for "/ · — ( ) % + #", so separators become hyphens.
export function deaccent(s) {
  return String(s)
    .replace(/[·—]/g, '-')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}
