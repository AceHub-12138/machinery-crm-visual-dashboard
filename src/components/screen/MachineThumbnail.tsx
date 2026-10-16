/** Local equipment silhouettes, illustrative rather than model product photos.
 * Model text only selects the visual family; no payload fields are added. */
export function MachineThumbnail({ model }: { model: string | null }) {
  const family = /^(BC|B6)|刨床/i.test(model ?? '') ? 'planer'
    : /^Y|插齿/i.test(model ?? '') ? 'gear'
    : /^(BK|B5)|插床/i.test(model ?? '') ? 'slotter' : 'generic';
  return <svg className="nexus-machine-thumb" data-machine-family={family} viewBox="0 0 120 76" role="img" aria-label={`${model || '设备'}轮廓示意图`}>
    <ellipse className="nexus-machine-halo" cx="60" cy="67" rx="53" ry="6"/>
    <g strokeLinejoin="round" strokeWidth="1.3">
      <path className="nexus-machine-side" d="M14 62l14-6h75l8 6-13 8H24z"/>
      <path className="nexus-machine-front" d="M14 62h84v8H24z"/>
      {family === 'planer' ? <>
        <path className="nexus-machine-side" d="M27 55V30l12-6 31 3v28zM60 29V16l39-2 9 6v11z"/>
        <path className="nexus-machine-front" d="M23 33h38v28H23zM55 20h43v12H55zM61 42h36v8H61z"/>
        <path className="nexus-machine-detail" d="M29 38h25M31 55h18M94 32v10M69 50v11M88 50v11"/>
        <circle className="nexus-machine-detail" cx="44" cy="46" r="5"/>
      </> : family === 'gear' ? <>
        <path className="nexus-machine-side" d="M26 59V13l13-6h40l8 7v45z"/>
        <path className="nexus-machine-front" d="M23 15h51v47H23zM69 49h31v13H69z"/>
        <path className="nexus-machine-window" d="M31 23h34v24H31z"/>
        <path className="nexus-machine-detail" d="M49 24v10M36 41h24M80 21h7M80 27h7M80 33h7"/>
        <circle className="nexus-machine-detail" cx="49" cy="39" r="7"/>
      </> : family === 'slotter' ? <>
        <path className="nexus-machine-side" d="M32 60V13l13-6 25 5v48zM68 43l18-5 20 5v9L86 60 68 54z"/>
        <path className="nexus-machine-front" d="M27 15h33v47H27zM61 45h25v11H61z"/>
        <path className="nexus-machine-window" d="M33 21h20v14H33z"/>
        <path className="nexus-machine-detail" d="M44 35v13M34 53h16M86 46v15M65 15h8v19"/>
        <circle className="nexus-machine-detail" cx="43" cy="43" r="4"/>
      </> : <>
        <path className="nexus-machine-side" d="M26 56V21l13-8h53l10 8v36z"/>
        <path className="nexus-machine-front" d="M23 23h65v39H23z"/>
        <path className="nexus-machine-window" d="M31 30h33v23H31z"/>
        <path className="nexus-machine-detail" d="M72 32h8M72 39h8M72 46h8M40 54v7"/>
      </>}
    </g>
  </svg>;
}
