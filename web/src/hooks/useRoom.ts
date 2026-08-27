import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createAudioAnalyser,
  LocalAudioTrack,
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

  // Говорящий: показать через 50мс речи, снять через 50мс тишины на локальном
  // пути (тик освежает каждые 100мс); для серверного списка снятие 500мс —
  // сервер шлёт его только при изменении состава, иначе чужие плитки мигают.
  // Отстрелявший таймер удаляется из карты — иначе следующий «true» упирается
  // в мёртвый таймер и показ больше никогда не планируется.
  const shown = useRef<Map<string, boolean>>(new Map()) // identity -> виден ли сейчас
  const timers = useRef<Map<string, { t: ReturnType<typeof setTimeout>; show: boolean }>>(new Map())
  const [speakers, setSpeakers] = useState<Set<string>>(new Set())

  const setShowing = useCallback((id: string, show: boolean, showMs = 50, hideMs = 500) => {
    const current = shown.current.get(id)
    const pending = timers.current.get(id)
    if (show === current) {
      // Состояние не меняется: показан и говорит дальше — гасим запланированное
      // снятие (это была короткая пауза); скрыт и молчит — ничего не делаем.
      if (show && pending) clearTimeout(pending.t)
      return
    }
    if (show && pending?.show) return // показ уже запланирован — не перезапускать
    if (pending) clearTimeout(pending.t)
    timers.current.set(id, {
      t: setTimeout(() => {
        timers.current.delete(id)
        shown.current.set(id, show)
        setSpeakers(new Set([...shown.current].filter(([, v]) => v).map(([k]) => k)))
      }, show ? showMs : hideMs),
      show,
    })
  }, [])

  // Локальный индикатор речи: серверный ActiveSpeakersChanged ходит по кругу
  // аудио → сервер → обратно и запаздывает; свою плитку считаем по уровню звука
  // прямо из микрофонного трека. Тик сам подхватывает трек, когда он появится
  // (публикация регистрируется раньше, чем к ней привяжется track).
  const localAnalyser = useRef<ReturnType<typeof createAudioAnalyser> | null>(null)
  const localTrack = useRef<LocalAudioTrack | null>(null)

  useEffect(() => {
    setError('')
    setConnected(false)
    setStartedAt(null)
    shown.current.clear()

    const update = () => setRemote([...room.remoteParticipants.values()])
    // Говорящий список приходит от сервера; локальный монитор показывает
    // свою плитку быстрее, серверный — запасной путь и для неё.
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

    // Локальные публикации (микрофон включили/выключили) — включают монитор речи.
    const local = room.localParticipant
    const localTick = setInterval(() => {
      const pub = local.audioTrackPublications.get(Track.Source.Microphone)
      const track = pub?.track
      if (!track) {
        if (localAnalyser.current) {
          void localAnalyser.current.cleanup()
          localAnalyser.current = null
          localTrack.current = null
        }
        return
      }
      if (track.kind !== Track.Kind.Audio || !(track instanceof LocalAudioTrack)) return
      // Микрофон перепубликовали (выкл/вкл) — analyser висит на старом потоке.
      if (localTrack.current !== track) {
        if (localAnalyser.current) void localAnalyser.current.cleanup()
        try {
          // smoothingTimeConstant 0.8 (по умолчанию) сглаживает спектр почти за
          // секунду — индикатор «разгоняется» медленно даже без дебаунса.
          localAnalyser.current = createAudioAnalyser(track, { smoothingTimeConstant: 0.1 })
          localTrack.current = track
        } catch {
          return // браузер без WebAudio — остаёмся на серверном определении
        }
      }
      if (localAnalyser.current) {
        setShowing(local.identity, localAnalyser.current.calculateVolume() > 0.01, 0, 50)
      }
    }, 100)

    // Стартовое подключение. Промис может упасть (таймаут/обрыв), но комната
    // может восстановиться сама — тогда Connected снова переключит состояние
    // и сотрёт ошибку.
    room.connect(wsUrl(), token).then(onJoined).catch((e) => {
      setError(typeof e?.message === 'string' ? e.message : String(e))
    })

    return () => {
      room.removeAllListeners()
      clearInterval(localTick)
      if (localAnalyser.current) void localAnalyser.current.cleanup()
      localAnalyser.current = null
      localTrack.current = null
      timers.current.forEach((t) => clearTimeout(t.t))
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
