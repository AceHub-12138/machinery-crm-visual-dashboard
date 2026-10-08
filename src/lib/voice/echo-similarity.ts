/** Unicode character edit similarity, normalized by the longer input. */
export function echoSimilarity(text: string, reference: string): number {
  const normalize = (value: string) => Array.from(value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const a = normalize(text), b = normalize(reference);
  if (!a.length || !b.length) return 0;
  let row = b.map((_, i) => i + 1); row.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}
