/**
 * セッションタグから決定的に HSL カラーを生成する。
 * 同じ tag は常に同じ色になる。
 */
export function tagHue(tag: string | null | undefined): number {
  if (!tag) return 0;
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

/** カードの dot / chip 用の色 (中程度の彩度・明度)。 */
export function tagColor(tag: string | null | undefined, s = 70, l = 60): string {
  if (!tag) return "hsl(0 0% 55%)";
  return `hsl(${tagHue(tag)} ${s}% ${l}%)`;
}

/** Aurora のエージェントアバター用 (任意 s/l)。 */
export function agentColor(hue: number, s = 70, l = 60): string {
  return `hsl(${hue} ${s}% ${l}%)`;
}
