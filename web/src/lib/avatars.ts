// Аватар синхронизирован между клиентами: seed приходит с бэкенда —
// из metadata участника (токен LiveKit) или из ответа /api/login —
// и все видят одного и того же зверя на входе.
export const avatarUrl = (identity: string, seed?: string) =>
  seed ? `/api/avatar/${identity}?v=${seed}` : `/api/avatar/${identity}`
