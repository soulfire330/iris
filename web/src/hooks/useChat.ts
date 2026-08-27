import { useCallback, useEffect, useState } from 'react'
import { RoomEvent, type Participant, type Room } from 'livekit-client'
import { CHAT_TOPIC, capMessages, decodePayload, encodePayload, type ChatMessage } from '@/lib/chat'
import { parseMeta } from '@/lib/names'

// Чат комнаты поверх data channel LiveKit. active — открыт ли таб чата:
// обработчик переподписывается при его смене, поэтому открытый чат не копит
// непрочитанное, а markRead гасит счётчик при переключении на таб.
export function useChat(
  room: Room,
  me: { identity: string; name: string; seed: string },
  active: boolean,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    const onData = (
      payload: Uint8Array,
      participant?: Participant,
      _kind?: number,
      topic?: string,
    ) => {
      if (topic !== CHAT_TOPIC) return
      const msg = decodePayload(payload)
      if (!msg) return
      const meta = parseMeta(participant?.metadata)
      const m: ChatMessage = {
        id: crypto.randomUUID(),
        identity: participant?.identity ?? '?',
        name: participant?.name || participant?.identity || 'неизвестно',
        seed: meta.seed,
        isLocal: false,
        text: msg.text,
        ts: msg.ts,
      }
      setMessages((prev) => capMessages([...prev, m]))
      if (!active) setUnread((u) => u + 1)
    }
    room.on(RoomEvent.DataReceived, onData)
    return () => {
      room.off(RoomEvent.DataReceived, onData)
    }
  }, [room, active])

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || !room.localParticipant) return
      const ts = Date.now()
      // LiveKit не возвращает автору его же данные — локальный эхо сразу.
      setMessages((prev) =>
        capMessages([
          ...prev,
          {
            id: crypto.randomUUID(),
            identity: me.identity,
            name: me.name,
            seed: me.seed,
            isLocal: true,
            text,
            ts,
          },
        ]),
      )
      room.localParticipant
        .publishData(encodePayload(text, ts), { reliable: true, topic: CHAT_TOPIC })
        .catch((e) => console.warn('chat: не удалось отправить', e))
    },
    [room, me.identity, me.name, me.seed],
  )

  const markRead = useCallback(() => setUnread(0), [])

  return { messages, unread, send, markRead }
}
