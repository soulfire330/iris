// Чат комнаты. Транспорт — data channel LiveKit: ноль серверного кода,
// сообщения живут, пока живёт комната (auto-dispose). Истории для опоздавших
// нет — сознательное следствие, см. решение в разговоре о дизайне чата.

export const CHAT_TOPIC = "chat";
export const MAX_TEXT_LEN = 2000;
export const MAX_MESSAGES = 500;

export interface ChatMessage {
  id: string;
  identity: string;
  name: string;
  seed?: string;
  isLocal: boolean;
  text: string;
  ts: number;
}

// В data channel — только текст и время. Автор не доверяется отправителю:
// identity и имя берутся из участника LiveKit, а не из payload.
interface ChatPayload {
  text: string;
  ts: number;
}

// encode() в текущем TS возвращает Uint8Array<ArrayBufferLike>, а publishData
// LiveKit требует Uint8Array<ArrayBuffer> (NonSharedUint8Array). Кодировщик
// всегда выделяет свежий ArrayBuffer — каст честный.
export function encodePayload(text: string, ts = Date.now()): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ text: text.slice(0, MAX_TEXT_LEN), ts })) as Uint8Array<ArrayBuffer>;
}

export function decodePayload(data: Uint8Array): ChatPayload | null {
  try {
    const j = JSON.parse(new TextDecoder().decode(data));
    if (typeof j?.text !== "string" || typeof j?.ts !== "number") return null;
    return { text: j.text.slice(0, MAX_TEXT_LEN), ts: j.ts };
  } catch {
    return null;
  }
}

// Долгая встреча не должна копить сообщения безгранично.
export function capMessages(list: ChatMessage[]): ChatMessage[] {
  return list.length > MAX_MESSAGES ? list.slice(-MAX_MESSAGES) : list;
}
