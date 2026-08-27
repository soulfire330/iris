import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Participant,
  RemoteAudioTrack,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client'

export interface DSP {
  echoCancellation: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export const DEFAULT_DSP: DSP = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

// В dev — ws://<vite-host>:5173 (vite проксирует /rtc на LiveKit),
// в проде — wss://<домен> (Caddy проксирует /rtc на LiveKit).
const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`

export function useRoom(token: string, dsp: DSP) {
  // Настройки DSP задаются при создании Room; смена настроек — новая комната и переподключение.
  const room = useMemo(
    () =>
      new Room({
        adaptiveStream: true,
        audioCaptureDefaults: dsp,
      }),
    [dsp],
  )
  const [remote, setRemote] = useState<Participant[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [startedAt, setStartedAt] = useState<Date | null>(null)

  // Говорящий с порогом: показать через 200мс речи, снять через 500мс тишины.
  const shown = useRef<Map<string, boolean>>(new Map()) // identity -> виден ли сейчас
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [speakers, setSpeakers] = useState<Set<string>>(new Set())

  const setShowing = useCallback((id: string, show: boolean) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(
      id,
      setTimeout(() => {
        shown.current.set(id, show)
        setSpeakers(new Set([...shown.current].filter(([, v]) => v).map(([k]) => k)))
      }, show ? 200 : 500),
    )
  }, [])

  useEffect(() => {
    setError('')
    setConnected(false)
    setStartedAt(null)
    shown.current.clear()

    const update = () => setRemote([...room.remoteParticipants.values()])
    const onSpeakers = (list: Participant[]) => {
      const active = new Set(list.map((p) => p.identity))
      for (const id of active) setShowing(id, true)
      for (const [id, visible] of shown.current) {
        if (visible && !active.has(id)) setShowing(id, false)
      }
    }

    // Неподписанный аудио-трек без attach() не звучит (видео крепят сами плитки).
    const onSubscribed = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach()
        el.hidden = true
        document.body.appendChild(el)
      }
      update()
    }
    const onUnsubscribed = (track: RemoteTrack) => {
      track.detach().forEach((el) => el.remove())
      update()
    }

    // Состояние подключения — из событий комнаты, а не из промиса connect():
    // LiveKit сам ретраит обрыв первого коннекта, и UI должен это увидеть.
    const onConnected = () => {
      setError('')
      setConnected(true)
    }
    const onJoined = () => {
      setError('')
      setConnected(true)
      setStartedAt(new Date())
    }
    const onReconnecting = () => {
      setConnected(false)
    }

    room
      .on(RoomEvent.ParticipantConnected, update)
      .on(RoomEvent.ParticipantDisconnected, update)
      .on(RoomEvent.ParticipantMetadataChanged, update)
      .on(RoomEvent.TrackPublished, update)
      .on(RoomEvent.TrackUnpublished, update)
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onUnsubscribed)
      .on(RoomEvent.ConnectionQualityChanged, update)
      .on(RoomEvent.TrackMuted, update)
      .on(RoomEvent.TrackUnmuted, update)
      .on(RoomEvent.ActiveSpeakersChanged, onSpeakers)
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, onConnected)
      .on(RoomEvent.Disconnected, onReconnecting)

    // Стартовое подключение. Промис может упасть (таймаут/обрыв), но комната
    // может восстановиться сама — тогда Connected снова переключит состояние
    // и сотрёт ошибку.
    room.connect(wsUrl(), token).then(onJoined).catch((e) => {
      setError(typeof e?.message === 'string' ? e.message : String(e))
    })

    return () => {
      room.removeAllListeners()
      timers.current.forEach((t) => clearTimeout(t))
      room.disconnect()
    }
  }, [room, token, setShowing])

  return { room, remote, speakers, connected, error, startedAt }
}

/** Глушит/включает все удалённые аудио-треки (deafen). */
export function applyDeafen(room: Room, deafened: boolean) {
  for (const p of room.remoteParticipants.values()) {
    for (const pub of p.audioTrackPublications.values()) {
      const t = pub.track
      if (t && t.kind === Track.Kind.Audio) {
        ;(t as RemoteAudioTrack).setVolume(deafened ? 0 : 1)
      }
    }
  }
}
