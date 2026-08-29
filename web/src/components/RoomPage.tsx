import { CornersOut } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { RoomEvent, Track, type LocalTrackPublication } from 'livekit-client'
import { Button } from '@/components/ui/button'
import { CallBar } from '@/components/CallBar'
import { ParticipantTile } from '@/components/ParticipantTile'
import { RoomHeader } from '@/components/RoomHeader'
import { ScreenView } from '@/components/ScreenView'
import { SecretaryPanel, type PanelTab, type SavingRecording } from '@/components/SecretaryPanel'
import { SummariesView } from '@/components/SummariesView'
import { useChat } from '@/hooks/useChat'
import { useBackendStatus } from '@/hooks/useBackendStatus'
import { DEFAULT_DSP, useRoom } from '@/hooks/useRoom'
import { fetchRecordings, startRecording, stopRecording, enableRecordingSummary, type RecordingFile, type Session } from '@/lib/api'
import { fromParticipant, type Member } from '@/lib/members'
import { cn } from '@/lib/utils'

export function RoomPage({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const [panelOpen, setPanelOpen] = useState(false)
  // Таб правой колонки живёт здесь, а не в SecretaryPanel: панель монтируется
  // в трёх местах (колонка, рельс, оверлей), и состояние должно быть одно.
  const [panel, setPanel] = useState<PanelTab>('summaries')
  // Микрофон/камера/экран: состояние в UI — источник правды, LiveKit — следствие.
  // (Геттеры LiveKit для локальных треков не меняются на mute — по ним UI не жил.)
  const [micOn, setMicOn] = useState(false)
  const [camOn, setCamOn] = useState(false)
  const [screenOn, setScreenOn] = useState(false)
  // Крупный план: любой видеопоток (экран или камера) можно развернуть кнопкой
  // на плитке и свернуть кнопкой в углу. Экран при старте выходит сам.
  const [stage, setStage] = useState<{ id: string; source: Track.Source.Camera | Track.Source.ScreenShare } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // «Все сводки»: личный режим чтения сводок в большом окне (кнопка в табе
  // «Сводки» — тумблер). Демонстрация экрана приоритетнее — закрывает сама.
  const [summariesOpen, setSummariesOpen] = useState(false)

  const { room, remote, speakers, connected, state, error, startedAt, clockOffsetMs, roomInfo } = useRoom(
    session.token,
    DEFAULT_DSP,
  )
  const backendOnline = useBackendStatus()
  const local = room.localParticipant
  // Люди из снимка /api/room, которых ещё нет в LiveKit у нас: рисуем их
  // плитки-заглушки (лоадер вместо аватарки), пока сами подключаемся.
  // Свой логин отсекаем на всякий случай — до коннекта нас в комнате нет,
  const chat = useChat(
    room,
    { identity: local?.identity ?? '', name: session.name, seed: session.avatar_seed },
    panel === 'chat',
  )

  // Счётчик непрочитанного в заголовке вкладки, пока она неактивна
  // (дизайн: состояние комнаты выносится в document.title).
  useEffect(() => {
    const sync = () => {
      document.title =
        chat.unread > 0 && document.hidden ? `(${chat.unread}) Iris · общая комната` : 'Iris · общая комната'
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [chat.unread])

  // Переключение на таб чата гасит счётчик непрочитанного.
  const onPanelChange = (t: PanelTab) => {
    setPanel(t)
    if (t === 'chat') chat.markRead()
  }

  // Браузер остановил показ сам (нативная плашка «Стоп»): LiveKit отзывает
  // публикацию, а UI узнаёт только из события — вернуть раскладку в сетку.
  useEffect(() => {
    const onUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) setScreenOn(false)
    }
    room.on(RoomEvent.LocalTrackUnpublished, onUnpublished)
    return () => {
      room.off(RoomEvent.LocalTrackUnpublished, onUnpublished)
    }
  }, [room])

  // Запись: состояние — метаданные комнаты (бэкенд пишет их при старте/стопе
  // egress), поэтому тег и кнопка синхронны у всех участников. При
  // подключении берём текущее значение — запись могла идти до нас.
  // aiSummary — запись заказана AI-кнопкой (со сводкой, эпик «Секретарь»).
  // recStartedAt — серверное время старта записи из тех же метаданных: по нему
  // панель показывает «Сейчас, 11:17 · 49 мин» (длительность именно записи,
  // не комнаты). recName — имя файла: по нему сопоставляем запись в списке.
  const [recording, setRecording] = useState(false)
  const [aiSummary, setAiSummary] = useState(false)
  const [recStartedAt, setRecStartedAt] = useState<Date | null>(null)
  const [recName, setRecName] = useState<string | null>(null)
  useEffect(() => {
    const sync = (meta: string) => {
      setRecording(meta.includes('"recording":true'))
      setAiSummary(meta.includes('"summary":true'))
      let started: Date | null = null
      let name: string | null = null
      try {
        const m = JSON.parse(meta)
        if (m?.rec_started_at) started = new Date(m.rec_started_at)
        if (m?.rec_name) name = m.rec_name
      } catch {
        // Не JSON — записи нет (пустая строка), старт не показываем.
      }
      setRecStartedAt(started)
      setRecName(name)
    }
    sync(room.metadata ?? '')
    room.on(RoomEvent.RoomMetadataChanged, sync)
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, sync)
    }
  }, [room, connected])

  // Короткий сигнал на старт/стоп (решение Q4): все слышат, что их
  // записывают. WebAudio, без ассетов.
  const beep = (freq: number) => {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
    osc.onended = () => void ctx.close()
  }
  const prevRecording = useRef(recording)
  useEffect(() => {
    if (recording === prevRecording.current) return
    prevRecording.current = recording
    beep(recording ? 880 : 440)
  }, [recording])

  const [actionError, setActionError] = useState('')
  // Тик принудительного обновления списка записей: файл финализируется
  // egress'ом с задержкой после стопа — без повтора список висит пустым.
  const [recTick, setRecTick] = useState(0)
  const onRecord = async () => {
    setActionError('')
    try {
      if (recording) {
        await stopRecording(session.login)
        setTimeout(() => setRecTick((t) => t + 1), 2000)
      } else {
        await startRecording(session.login)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  // AI-кнопка видна только при идущей записи (решение: не путать со стартом
  // записи) — заказывает сводку для текущей записи: бэкенд ставит флаг в
  // sidecar, по нему воркер-секретарь найдёт запись после стопа. Уже заказана —
  // ничего не делаем (кнопка серая).
  const onAi = async () => {
    if (!recording || aiSummary) return
    setActionError('')
    try {
      await enableRecordingSummary()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  // Список записей для таба «Сводки»: тянем при входе в комнату и после
  // каждого старта/стопа записи и по тику после стопа (файл дописывается).
  // Без panelOpen в условии: на широком экране колонка видна всегда, а
  // panelOpen описывает только оверлей на узком.
  const [recordings, setRecordings] = useState<RecordingFile[]>([])
  useEffect(() => {
    if (panel !== 'summaries' && !summariesOpen) return
    let alive = true
    fetchRecordings()
      .then((list) => alive && setRecordings(list))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [panel, panelOpen, recording, recTick, summariesOpen])

  // Сводки готовит воркер-секретарь фоном (STT занимает минуты) — таб и окно
  // «Все сводки» обновляются сами, пока открыты.
  useEffect(() => {
    if (panel !== 'summaries' && !summariesOpen) return
    const t = setInterval(() => setRecTick((x) => x + 1), 20000)
    return () => clearInterval(t)
  }, [panel, panelOpen, summariesOpen])

  // Доступность устройств: без микрофона/камеры кнопки серые. Проверяем по
  // перечню устройств (enumerateDevices не требует разрешения).
  const [micAvailable, setMicAvailable] = useState(true)
  const [camAvailable, setCamAvailable] = useState(true)
  useEffect(() => {
    let alive = true
    const check = async () => {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
      if (!alive) return
      setMicAvailable(list.some((d) => d.kind === 'audioinput'))
      setCamAvailable(list.some((d) => d.kind === 'videoinput'))
    }
    void check()
    return () => {
      alive = false
    }
  }, [])

  // Таймер встречи: тикает локально, но время — серверное (now + сдвиг часов),
  // поэтому у всех участников одинаковые цифры.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const elapsed = startedAt ? Math.max(0, now + clockOffsetMs - startedAt.getTime()) : 0
  // Длительность идущей записи — от её серверного старта; 0, пока старта нет.
  const recElapsedMs = recStartedAt ? Math.max(0, now + clockOffsetMs - recStartedAt.getTime()) : 0

  // Сохранение после стопа: egress дописывает файл секунды, и список про него
  // узнаёт не сразу — держим строку с лоадером, пока файл не появится в списке
  // (сопоставление по rec_name из метаданных). 60с потолок: если egress файл не
  // дописал вовсе (нет аудио — abort), строку убираем, а не крутим вечность.
  const [saving, setSaving] = useState<SavingRecording | null>(null)
  const recRef = useRef<SavingRecording | null>(null)
  useEffect(() => {
    if (recording && recStartedAt && recName) {
      recRef.current = { name: recName, startedAt: recStartedAt, elapsedMs: recElapsedMs, ai: aiSummary }
    } else if (!recording && recRef.current) {
      setSaving(recRef.current)
      recRef.current = null
    }
  }, [recording, recStartedAt, recName, aiSummary, recElapsedMs])
  useEffect(() => {
    if (!saving) return
    if (recordings.some((r) => r.name === saving.name)) {
      setSaving(null)
      return
    }
    const t = setTimeout(() => setSaving(null), 60_000)
    return () => clearTimeout(t)
  }, [saving, recordings])

  const members: Member[] = useMemo(() => {
    const list: Member[] = []
    if (local) {
      list.push({
        id: local.identity,
        participant: local,
        isLocal: true,
        name: `${session.name} (вы)`,
        role: session.role,
        seed: session.avatar_seed,
        speaking: speakers.has(local.identity),
        muted: !micOn,
        poor: false,
        cameraOn: camOn,
        screenSharing: screenOn,
      })
    }
    for (const p of remote) list.push(fromParticipant(p, false, speakers.has(p.identity)))
    return list
  }, [local, remote, speakers, session, micOn, camOn, screenOn])

  // ВРЕМЕННО: фейковые участники — посмотреть сетку при многих людях.
  const fakeMembers: Member[] = [
    { id: 'fake-1', name: 'Иван Петров', role: 'dev', seed: 'fake-1', speaking: true, muted: false, poor: false, cameraOn: false, screenSharing: false },
    { id: 'fake-2', name: 'Мария Смирнова', role: 'qa', seed: 'fake-2', speaking: false, muted: true, poor: false, cameraOn: false, screenSharing: false },
    { id: 'fake-3', name: 'Пётр Иванов', role: 'dev', seed: 'fake-3', speaking: false, muted: false, poor: true, cameraOn: false, screenSharing: false },
    { id: 'fake-4', name: 'Анна Кузнецова', role: 'qa', seed: 'fake-4', speaking: false, muted: false, poor: false, cameraOn: false, screenSharing: false },
    { id: 'fake-5', name: 'Сергей Волков', role: 'dev', seed: 'fake-5', speaking: false, muted: true, poor: false, cameraOn: false, screenSharing: false },
  ]

  // Люди из снимка /api/room, которых ещё нет в наших LiveKit-участниках:
  // рисуем плитку-заглушку (grayscale-аватарка с «дыханием»). Connected
  // приходит раньше ParticipantConnected для уже сидящих, поэтому заглушка
  // живёт до прихода реального участника, а не только до коннекта.
  // seenIds: кто уже приходил живым — из снапшота не воскрешаем, иначе
  // вышедший участник останется заглушкой навсегда (снапшот не обновляется).
  const seenIds = useRef(new Set<string>())
  useEffect(() => {
    for (const m of members) seenIds.current.add(m.id)
  }, [members])
  const pendingOthers = useMemo(() => {
    const have = new Set(members.map((m) => m.id))
    return roomInfo.filter(
      (p) => p.identity !== session.login && !have.has(p.identity) && !seenIds.current.has(p.identity),
    )
  }, [roomInfo, members, session.login])

  const sharer = members.find((m) => m.screenSharing)
  // Демонстрация занимает крупный план сама: кто первый начал — тот в приоритете.
  // Смена показывающего (или завершение показа) переключает/снимает крупный план;
  // ручной выбор (вебка/свёрнутый вид) при этом не сбрасывается.
  useEffect(() => {
    if (sharer) {
      setStage({ id: sharer.id, source: Track.Source.ScreenShare })
      // Демонстрация приоритетнее сводок: начали шарить — окно закрылось.
      setSummariesOpen(false)
    } else if (stage?.source === Track.Source.ScreenShare) setStage(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharer?.id])
  const stageMember = stage ? members.find((m) => m.id === stage.id) : undefined
  // Три раскладки: сетка, крупный план, «Все сводки». Демонстрация (sharer)
  // всегда побеждает — даже в кадр между её стартом и эффектом закрытия.
  const layout: 'grid' | 'stage' | 'summaries' =
    summariesOpen && !sharer ? 'summaries' : stageMember ? 'stage' : 'grid'

  // Клик по участнику в рельсе — на крупный план, экран приоритетнее вебки.
  // Из раскладки сводок рельс работает так же: сводки закрываются.
  const selectStage = (m: Member) => {
    setSummariesOpen(false)
    if (m.screenSharing) setStage({ id: m.id, source: Track.Source.ScreenShare })
    else if (m.cameraOn) setStage({ id: m.id, source: Track.Source.Camera })
  }

  // Развёрнутый источник исчез (выключили камеру/экран) — крупный план закрываем.
  // Но сначала: если человек перешёл с вебки на экран — крупный план следует
  // за ним (иначе гонка с «источник исчез» падала бы в сетку).
  useEffect(() => {
    if (!stage || !stageMember) return
    if (stage.source === Track.Source.Camera && stageMember.screenSharing) {
      setStage({ id: stageMember.id, source: Track.Source.ScreenShare })
      return
    }
    const has = stage.source === Track.Source.ScreenShare ? stageMember.screenSharing : stageMember.cameraOn
    if (!has) setStage(null)
  }, [stage, stageMember])
  const speaker = members.find((m) => m.speaking)

  // Заглушки рисуются и до, и после коннекта (пока не пришёл участник).
  const tileCount = (connected ? members.length : 1) + pendingOthers.length + (connected ? fakeMembers.length : 0)

  // Колонки подбираются под доступную высоту: плитки 16:9 всегда помещаются
  // в поле сетки (вместо фиксированных колонок от числа людей, которые при
  // низком окне вылезают за край и наезжают на панель звонка). На типичных
  // десктопах подбор даёт те же колонки, что диздок (2/3/4 по числу людей).
  const gridRef = useRef<HTMLDivElement>(null)
  // Ширина плитки, посчитанная подбором; передаётся каждой плитке напрямую.
  const [fitTileW, setFitTileW] = useState(0)
  // Считаем в layout-эффекте синхронно (до отрисовки), чтобы плитки не
  // рендерились на миг во всю ширину; RO — на ресайзы поля.
  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const compute = () => {
      const n = tileCount
      const gap = 12 // gap-3
      const { width: w, height: h } = el.getBoundingClientRect()
      if (w <= 0 || h <= 0) return
      // На телефоне ширина — чистый CSS (2 колонки, одному — вся ширина).
      if (matchMedia('(max-width: 40rem)').matches) {
        setFitTileW(0)
        return
      }
      if (n <= 1) {
        setFitTileW(0) // капы CSS: max-w-[50cqw], на телефоне max-w-full
        return
      }
      // На телефоне плитки-карточки 4:5, на остальных — 16:9.
      const ar = matchMedia('(max-width: 40rem)').matches ? 5 / 4 : 9 / 16
      let bestW = 0
      for (let k = 1; k <= n; k++) {
        const rows = Math.ceil(n / k)
        const tileW = (w - (k - 1) * gap) / k
        const needH = rows * tileW * ar + (rows - 1) * gap
        if (tileW > bestW && needH <= h) bestW = tileW
      }
      // Ни один вариант не влез по высоте — минимальное переполнение.
      if (bestW === 0) {
        let minNeed = Infinity
        for (let k = 1; k <= n; k++) {
          const rows = Math.ceil(n / k)
          const tileW = (w - (k - 1) * gap) / k
          const needH = rows * tileW * ar + (rows - 1) * gap
          if (needH < minNeed) {
            minNeed = needH
            bestW = tileW
          }
        }
      }
      setFitTileW(bestW)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tileCount])

  // Выключение = unpublishTrack: LiveKit mute() оставляет устройство живым
  // (индикатор микрофона в браузере не гаснет), а unpublish останавливает источник.
  // UI оптимистичный: кнопка переключается сразу, откат — только при ошибке.
  const setMic = async (on: boolean) => {
    if (!local) return
    setMicOn(on)
    try {
      // dtx:false — без этого egress не получает ни одного аудиокадра в тишине
      // (Opus DTX не шлёт пакеты) и на стопе падает «Start signal not received»:
      // файла нет, встреча исчезает из истории. Тишина теперь пишется всегда.
      if (on) await local.setMicrophoneEnabled(true, {}, { dtx: false })
      else {
        const pub = local.getTrackPublication(Track.Source.Microphone)
        if (pub?.track) await local.unpublishTrack(pub.track)
      }
    } catch {
      setMicOn(!on)
    }
  }
  const setCam = async (on: boolean) => {
    if (!local) return
    setCamOn(on)
    try {
      if (on) await local.setCameraEnabled(true)
      else {
        const pub = local.getTrackPublication(Track.Source.Camera)
        if (pub?.track) await local.unpublishTrack(pub.track)
      }
    } catch {
      setCamOn(!on)
    }
  }
  const setScreen = async (on: boolean) => {
    if (!local) return
    setScreenOn(on)
    try {
      if (!on) {
        await local.setScreenShareEnabled(false)
        return
      }
      // Без явного encoding SDK берёт h1080fps15 для экранов ≥1920: потолок
      // 15fps/2.5Mbps. Явно даём FHD 30fps/8Mbps (LAN потянет).
      await local.setScreenShareEnabled(true, { video: true, contentHint: 'motion' }, {
        screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 30 },
      })
    } catch {
      setScreenOn(!on)
    }
  }

  const callBar = (extra?: React.ReactNode) => (
    <CallBar
      muted={!micOn}
      cameraOn={camOn}
      screenOn={screenOn}
      recording={recording}
      aiSummary={aiSummary}
      micAvailable={micAvailable}
      camAvailable={camAvailable}
      onMic={() => void setMic(!micOn)}
      onCamera={() => void setCam(!camOn)}
      onScreen={() => void setScreen(!screenOn)}
      onRecord={() => void onRecord()}
      onAi={() => void onAi()}
      onLeave={onLeave}
      extra={extra}
    />
  )

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <RoomHeader
        count={members.length}
        elapsed={elapsed}
        recording={recording}
        secretary={aiSummary}
        connState={state}
        backendOnline={backendOnline}
        onOpenPanel={() => setPanelOpen(true)}
        panelBtnClass={
          layout === 'stage' || layout === 'summaries' ? 'min-xl:hidden' : 'min-lg:hidden'
        }
        screenLabel={
          // Тег в шапке: «Экран», если кто-то демонстрирует (независимо от того,
          // чей поток на крупном плане); иначе — развёрнутая камера.
          sharer
            ? 'Экран'
            : stage && stageMember
              ? `камера ${stageMember.name}`
              : undefined
        }
      />
      {(error || actionError) && (
        <div className="flex-none border-b border-border bg-card px-6 py-1.5 font-mono text-[11px] text-warn">
          {error || actionError}
        </div>
      )}

      <div
        className={cn(
          'grid min-h-0 flex-1 [grid-template-rows:minmax(0,1fr)]',
          layout === 'stage' || layout === 'summaries'
            ? '[grid-template-columns:1fr_208px_300px] max-xl:[grid-template-columns:1fr_208px] max-lg:[grid-template-columns:1fr]'
            : '[grid-template-columns:1fr_300px] max-lg:[grid-template-columns:1fr]',
        )}
      >
        {layout === 'summaries' ? (
          <SummariesView
            recordings={recordings}
            members={members}
            onSelect={selectStage}
            onCollapse={() => setSummariesOpen(false)}
            callBar={callBar()}
          />
        ) : stage && stageMember ? (
          <ScreenView
            member={stageMember}
            source={stage.source}
            members={members}
            speaker={speaker}
            stageRef={stageRef}
            onCollapse={() => setStage(null)}
            onSelect={selectStage}
            callBar={callBar(
              !stageMember.isLocal && (
                <Button
                  variant="ghost"
                  aria-label="Во весь экран"
                  className="gap-2 text-[12px] max-sm:hidden"
                  onClick={() => stageRef.current?.requestFullscreen()}
                >
                  <CornersOut className="h-[15px] w-[15px]" />
                  <span>Во весь экран</span>
                </Button>
              ),
            )}
          />
        ) : (
          <div className="flex min-h-0 min-w-0 flex-col gap-4 p-6">
            <div
              ref={gridRef}
              className="flex min-h-0 flex-1 flex-wrap content-center justify-center gap-3 @container"
            >
              {/* Плитка-заглушка себя, пока комната подключается. */}
              {!connected && !error && (
                <ParticipantTile
                  connecting
                  width={fitTileW || undefined}
                  state={{
                    id: session.login,
                    name: session.name,
                    role: session.role,
                    seed: session.avatar_seed,
                    speaking: false,
                    muted: true,
                    poor: false,
                    cameraOn: false,
                    screenSharing: false,
                  }}
                />
              )}
              {connected &&
                members.map((m) => (
                  <ParticipantTile
                    key={m.id}
                    participant={m.participant}
                    isLocal={m.isLocal}
                    width={fitTileW || undefined}
                    state={{
                      name: m.name,
                      role: m.role,
                      seed: m.seed,
                      speaking: m.speaking,
                      muted: m.muted,
                      poor: m.poor,
                      cameraOn: m.cameraOn,
                      screenSharing: m.screenSharing,
                    }}
                    onExpand={
                      (m.cameraOn || m.screenSharing) && m.participant
                        ? () =>
                            setStage({
                              id: m.id,
                              source: m.screenSharing ? Track.Source.ScreenShare : Track.Source.Camera,
                            })
                        : undefined
                    }
                  />
                ))}
              {fakeMembers.map((f) => (
                <ParticipantTile
                  key={f.id}
                  width={fitTileW || undefined}
                  state={{
                    name: f.name,
                    role: f.role,
                    seed: f.seed,
                    speaking: f.speaking,
                    muted: f.muted,
                    poor: f.poor,
                    cameraOn: false,
                    screenSharing: false,
                  }}
                />
              ))}
              {pendingOthers.map((p) => (
                <ParticipantTile
                  key={p.identity}
                  connecting
                  width={fitTileW || undefined}
                  state={{
                    id: p.identity,
                    name: p.name || p.identity,
                    role: p.role,
                    seed: p.seed,
                    speaking: false,
                    muted: true,
                    poor: false,
                    cameraOn: false,
                    screenSharing: false,
                  }}
                />
              ))}
            </div>
            {callBar()}
          </div>
        )}

        {layout === 'stage' || layout === 'summaries' ? (
          // В раскладке показа экран 16:9 оставляет место по бокам — колонки
          // живут вместе: рельс участников и панель секретаря одновременно.
          // Ниже xl панель скрывается, открывается кнопкой в шапке (оверлей).
          <div className="max-xl:hidden">
            <SecretaryPanel
            tab={panel}
            onTabChange={onPanelChange}
            messages={chat.messages}
            unread={chat.unread}
            connected={connected}
            onSend={chat.send}
            recordings={recordings}
            recording={recording}
            aiSummary={aiSummary}
            recStartedAt={recStartedAt}
            recElapsedMs={recElapsedMs}
            saving={saving}
            participantCount={members.length}
            summariesOpen={summariesOpen}
            summariesBlocked={!!sharer}
            onAllSummaries={() => setSummariesOpen((o) => !o)}
          />
          </div>
        ) : (
          <div className="hidden min-h-0 min-lg:block">
            <SecretaryPanel
              tab={panel}
              onTabChange={onPanelChange}
              messages={chat.messages}
              unread={chat.unread}
              connected={connected}
              onSend={chat.send}
              recordings={recordings}
              recording={recording}
              aiSummary={aiSummary}
              recStartedAt={recStartedAt}
              recElapsedMs={recElapsedMs}
              saving={saving}
              participantCount={members.length}
              summariesOpen={summariesOpen}
              summariesBlocked={!!sharer}
              onAllSummaries={() => setSummariesOpen((o) => !o)}
            />
          </div>
        )}
      </div>

      {panelOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-neutral-900/50" onClick={() => setPanelOpen(false)}>
          <div className="h-full" onClick={(e) => e.stopPropagation()}>
            <SecretaryPanel
              tab={panel}
              onTabChange={onPanelChange}
              messages={chat.messages}
              unread={chat.unread}
              connected={connected}
              onSend={chat.send}
              recordings={recordings}
              recording={recording}
              aiSummary={aiSummary}
              recStartedAt={recStartedAt}
              recElapsedMs={recElapsedMs}
              saving={saving}
              participantCount={members.length}
              summariesOpen={summariesOpen}
              summariesBlocked={!!sharer}
              onAllSummaries={() => setSummariesOpen((o) => !o)}
            />
          </div>
        </div>
      )}
    </div>
  )
}