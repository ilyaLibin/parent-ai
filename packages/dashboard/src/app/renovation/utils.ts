const DEFAULT_COLOR = '#4f46e5';

export function nameToColor(name: string): string {
  if (!name.trim()) return DEFAULT_COLOR;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const h = ((hash % 360) + 360) % 360;
  return `hsl(${h}, 65%, 50%)`;
}
