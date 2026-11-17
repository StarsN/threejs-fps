// The look plan, in one place. Dusk over a desert-industrial yard: sand,
// rust and slate, one warm accent, and one colour per team. The same names
// are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1b1712',
  surface: '#2a241c',
  hairline: '#4a3f30',
  ink: '#efe6d4',
  muted: '#9a8f7a',
  accent: '#e07840',
  sand: '#c8a06a',
  rust: '#b4552d',
  slate: '#3a4148',
  sable: '#58b7a0',
  ashen: '#c65b4a',
};

export function shade(name) {
  return PALETTE[name];
}
