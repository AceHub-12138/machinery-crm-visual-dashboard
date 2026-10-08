/** Align ASR to any spoken substring; extra interrogatives always mean a question. */
export function echoSimilarity(text: string, reference: string): number {
  const normalize = (value: string) => Array.from(value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}?]/gu, ""));
  const a = normalize(text), b = normalize(reference);
  if (!a.length || !b.length) return 0;
  // Free reference prefix/suffix, but every ASR character contributes to cost.
  let row = b.map(() => 0); row.unshift(0);
  let starts = b.map((_, i) => i + 1); starts.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const next = [i], nextStarts = [0];
    for (let j = 1; j <= b.length; j++) {
      const choices = [
        { cost: row[j - 1] + Number(a[i - 1] !== b[j - 1]), start: starts[j - 1] },
        { cost: row[j] + 1, start: starts[j] },
        { cost: next[j - 1] + 1, start: nextStarts[j - 1] },
      ];
      choices.sort((x, y) => x.cost - y.cost || Math.abs(j - x.start - i) - Math.abs(j - y.start - i));
      next[j] = choices[0].cost; nextStarts[j] = choices[0].start;
    }
    row = next; starts = nextStarts;
  }
  let end = 0;
  for (let j = 1; j <= b.length; j++) {
    if (row[j] < row[end] || (row[j] === row[end] && Math.abs(j - starts[j] - a.length) < Math.abs(end - starts[end] - a.length))) end = j;
  }
  const aligned = b.slice(starts[end], end).join("");
  const questions = a.join("").match(/是不是|多少|怎么|什么|吗|呢|几|哪|\?/g) ?? [];
  if (questions.some(word => !aligned.includes(word))) return 0;
  return Math.max(0, 1 - row[end] / a.length);
}
