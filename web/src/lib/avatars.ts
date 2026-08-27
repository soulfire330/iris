// Случайный аватар на каждый вход: seed страницы подмешивается в URL —
// при перезагрузке сотрудник получает нового зверя, в рамках сессии
// (несколько плиток с одним логином) — один и тот же.
const seed = Math.random().toString(36).slice(2, 10)

export const avatarUrl = (identity: string) => `/api/avatar/${identity}?v=${seed}`
