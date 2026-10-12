import { formatMoneyParts } from "@/lib/format";

export function Money({ value }: { value: number | string }) {
  const parts = formatMoneyParts(value);
  return <span className="num-unit" title={`${parts.currency}${parts.number}${parts.unit}`}>{parts.currency}{parts.number}{parts.unit ? <span className="u">{parts.unit}</span> : null}</span>;
}
