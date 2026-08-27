import { expect, test } from 'bun:test'
import { capMessages, decodePayload, encodePayload, MAX_MESSAGES, MAX_TEXT_LEN, type ChatMessage } from './chat'

const msg = (i: number): ChatMessage => ({
  id: String(i),
  identity: 'a',
  name: 'A',
  isLocal: false,
  text: 'x',
  ts: i,
})

test('кодирование: кругосветка текст + время', () => {
  const data = encodePayload('привет, офис', 1234567890)
  expect(decodePayload(data)).toEqual({ text: 'привет, офис', ts: 1234567890 })
})

test('кодирование: длинный текст обрезается до лимита', () => {
  const data = encodePayload('x'.repeat(MAX_TEXT_LEN + 1000))
  expect(decodePayload(data)!.text.length).toBe(MAX_TEXT_LEN)
})

test('декодирование: мусор и неверная форма отклоняются', () => {
  expect(decodePayload(new TextEncoder().encode('это не json'))).toBeNull()
  expect(decodePayload(new TextEncoder().encode('{"text":1,"ts":1}'))).toBeNull()
  expect(decodePayload(new TextEncoder().encode('{"text":"x"}'))).toBeNull()
})

test('capMessages: держит последние MAX_MESSAGES', () => {
  const many = Array.from({ length: MAX_MESSAGES + 10 }, (_, i) => msg(i))
  const capped = capMessages(many)
  expect(capped.length).toBe(MAX_MESSAGES)
  expect(capped[0].id).toBe(String(10))
  expect(capped.at(-1)!.id).toBe(String(MAX_MESSAGES + 9))
})
