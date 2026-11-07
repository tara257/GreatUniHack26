// Original, code-drawn icons. These are decoration; labels carry the live meaning.
export function PixelIcon({name='block',size=24,...props}) {
  const art={
    miner:<><path fill="#402e20" d="M3 12h2v-2h2V8h2V6h2v3H9v2H7v2H5v2H3z"/><path fill="#c18e50" d="M4 12h2v-2h2V8h2v1H9v2H7v2H5v1H4z"/><path fill="#35494a" d="M4 2h7v1h2v2h1v4h-2V6h-2V4H4z"/><path fill="#8ce1c5" d="M4 2h6v1h2v2h1v3h-1V6h-2V4H7V3H4z"/><path fill="#e4ffe5" d="M5 2h5v1H5z"/></>,
    lumberjack:<><path fill="#493623" d="M7 2h2v12H7z"/><path fill="#c79a58" d="M7 6h1v8H7z"/><path fill="#334640" d="M3 2h4v1h5v6H7V8H3z"/><path fill="#b3d5bb" d="M3 2h4v2h4v3H7V6H3z"/><path fill="#e5ecd3" d="M3 2h3v1H3z"/></>,
    builder:<><path fill="#422e23" d="M2 7h12v8H2zM1 5h2V3h2V1h6v2h2v2h2v2H1z"/><path fill="#e4b559" d="M3 7h10v7H3z"/><path fill="#d47442" d="M2 5h2V3h2V2h4v1h2v2h2v1H2z"/><path fill="#62442d" d="M7 9h3v5H7z"/><path fill="#9cdde0" d="M4 8h2v3H4zM11 8h1v3h-1z"/><path fill="#fff1bb" d="M8 3h2v1H8z"/></>,
    crafter:<><path fill="#392b24" d="M1 3h14v11H1z"/><path fill="#be8a55" d="M2 4h12v9H2z"/><path fill="#f2c77e" d="M2 3h12v3H2z"/><path fill="#715033" d="M5 3h1v3H5zM9 3h1v3H9zM2 4h12v1H2zM3 8h3v4H3zM10 8h3v4h-3z"/><path fill="#875b3b" d="M7 7h2v6H7z"/><path fill="#efd290" d="M2 13h2v1H2zM12 13h2v1h-2z"/></>,
    scout:<><path fill="#303942" d="M5 1h6v1h2v2h1v8h-1v2h-2v1H5v-1H3v-2H2V4h1V2h2z"/><path fill="#c5d6d8" d="M5 2h6v1h2v9h-2v2H5v-2H3V4h2z"/><path fill="#536777" d="M5 4h6v8H5zM4 5h8v6H4z"/><path fill="#ed8769" d="M8 4h2v3H8v2H6V7h2z"/><path fill="#fff0cf" d="M6 9h2v3H6z"/></>,
    log:<><path fill="#795234" d="M2 4h12v10H2z"/><path fill="#bf935b" d="M2 2h12v4H2z"/><path fill="#6b452f" d="M4 7h2v6H4zM10 6h2v8h-2z"/><path fill="#e2bd7f" d="M4 3h8v2H4z"/><path fill="#91623b" d="M6 3h4v1H6z"/></>,
    stone:<><path fill="#414b51" d="M1 3h14v11H1z"/><path fill="#a5b5b7" d="M2 2h12v4H2z"/><path fill="#788b8e" d="M2 6h12v7H2z"/><path fill="#52666b" d="M2 8h5v1H2zM7 6h1v4H7zM9 10h5v1H9zM4 11h1v2H4z"/><path fill="#c3ccbe" d="M3 3h4v1H3z"/></>,
    planks:<><path fill="#6a4a2a" d="M1 2h14v12H1z"/><path fill="#c59756" d="M2 3h12v10H2z"/><path fill="#e4b66f" d="M2 3h12v1H2zM2 7h12v1H2zM2 11h12v1H2z"/><path fill="#825e36" d="M2 6h12v1H2zM2 10h12v1H2zM6 3h1v3H6zM10 7h1v3h-1zM5 11h1v2H5z"/></>,
    sand:<><path fill="#ac925b" d="M2 3h12v11H2z"/><path fill="#e3cf8b" d="M2 2h12v11H2z"/><path fill="#f8e7ae" d="M3 3h4v2H3zM10 5h3v1h-3zM7 9h4v1H7z"/><path fill="#c6ad70" d="M4 7h2v1H4zM11 11h2v1h-2z"/></>,
    glass:<><path fill="#50858b" d="M2 2h12v12H2z"/><path fill="#86c6c6" d="M3 3h10v10H3z"/><path fill="#b7e2d9" d="M4 4h3v1H4zM5 6h2v1H5zM8 8h3v1H8zM10 10h2v1h-2z"/></>,
    food:<><path fill="#674d29" d="M8 1h2v3H8z"/><path fill="#80a14f" d="M10 1h3v2h-3z"/><path fill="#89382e" d="M3 4h9v1h2v7h-2v2H4v-2H2V6h1z"/><path fill="#dd6d4f" d="M4 4h3v1h4V4h1v2h1v5h-2v2H5v-2H3V6h1z"/><path fill="#ffa878" d="M4 6h2v3H4z"/></>,
    coal:<><path fill="#171d23" d="M5 2h6v2h2v2h1v5h-2v2H4v-2H2V6h1V4h2z"/><path fill="#56616b" d="M5 3h5v2h2v3H9v2H4V6h1z"/><path fill="#829198" d="M6 4h3v1H6z"/></>,
    stick:<><path fill="#674727" d="M11 1h3v3h-2v2h-2v2H8v2H6v2H4v3H1v-3h2v-2h2V8h2V6h2V4h2z"/><path fill="#c99e65" d="M12 2h1v1h-1v2h-2v2H8v2H6v2H4v2H2v-1h1v-2h2V8h2V6h2V4h2z"/></>,
    block:<><path fill="#755239" d="M1 4h14v10H1z"/><path fill="#98c95e" d="M1 2h14v4H1z"/><path fill="#5e9b45" d="M1 5h4v2h3V5h7v3h-2V7h-2V6H1z"/><path fill="#9d7950" d="M3 9h3v2H3zM9 11h3v1H9z"/><path fill="#c3e58a" d="M2 2h5v1H2zM10 3h3v1h-3z"/></>,
  };
  return <svg viewBox="0 0 16 16" width={size} height={size} className="pixel-icon" shapeRendering="crispEdges" aria-hidden="true" {...props}>{art[name] || art.block}</svg>;
}

export function resourceIcon(name) {
  if(/pickaxe/.test(name))return 'miner';
  if(/axe/.test(name))return 'lumberjack';
  if(/log|wood|stem/.test(name))return 'log';
  if(/planks|door|stairs/.test(name))return 'planks';
  if(/sand/.test(name))return 'sand';
  if(/glass/.test(name))return 'glass';
  if(/stone|ore|ingot/.test(name))return 'stone';
  if(/coal|charcoal/.test(name))return 'coal';
  if(/stick/.test(name))return 'stick';
  if(/apple|bread|beef|porkchop|mutton|carrot|potato|berries|chicken/.test(name))return 'food';
  if(/crafting|furnace|chest/.test(name))return 'crafter';
  return 'block';
}
