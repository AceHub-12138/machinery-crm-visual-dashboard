export function ContractTail({tail}:{tail:string|null}) {
  if(!tail)return null;
  return <span className="contract-tail num-unit" data-contract-tail title={`尾号 ${tail}`}>尾号 <span className="contract-tail-digits">{Array.from(tail).map((digit,index)=><span key={index}>{digit}</span>)}</span></span>;
}
