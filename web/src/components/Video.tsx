import { useEffect, useRef } from 'react'
import { Track } from 'livekit-client'
import type { Participant, VideoTrack } from 'livekit-client'

// Крепит трек источника (камера/экран) участника к <video>.
export function Video({
  participant,
  source,
  muted,
  className,
}: {
  participant: Participant
  source: Track.Source
  muted?: boolean
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const pub = participant.getTrackPublication(source)
  const track = pub?.track

  useEffect(() => {
    const el = ref.current
    if (!el || !track) return
    const vt = track as VideoTrack
    vt.attach(el)
    return () => {
      vt.detach(el)
    }
  }, [track])

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />
}