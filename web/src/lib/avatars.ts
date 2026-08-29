// Аватар синхронизирован между клиентами: seed приходит с бэкенда —
// из metadata участника (токен LiveKit) или из ответа /api/login —
// и все видят одного и того же зверя на входе.
export const avatarUrl = (identity: string, seed?: string) =>
  seed ? `/api/avatar/${identity}?v=${seed}` : `/api/avatar/${identity}`;

// Raw SVG с сервера (аватар из /api/rooms и /api/room) → URL для <img>.
// Кэш по содержимому: поллинг приносит тех же зверей, blob URL создаётся
// один раз. Не revoke'им — аватаров на странице десятки, не тысячи.
const svgUrlCache = new Map<string, string>();
export const avatarSvgUrl = (svg: string) => {
  let url = svgUrlCache.get(svg);
  if (!url) {
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    svgUrlCache.set(svg, url);
  }
  return url;
};
