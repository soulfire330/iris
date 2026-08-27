import { ConnectionQuality, Participant } from 'livekit-client'
import { parseMeta } from '@/lib/names'

// Нормализованный участник для UI (дизайн: id, name, роль, состояния).
export interface Member {
  id: string
  participant?: Participant
  isLocal?: boolean
  name: string
  role?: string
  seed?: string
  speaking: boolean
  muted: boolean
  poor: boolean
  cameraOn: boolean
  screenSharing: boolean
}

export function fromParticipant(p: Participant, isLocal: boolean, speaking: boolean): Member {
  const meta = isLocal ? {} : parseMeta(p.metadata)
  return {
    id: p.identity,
    participant: p,
    isLocal,
    name: p.name || p.identity,
    role: meta.role,
    seed: meta.seed,
    speaking,
    muted: !p.isMicrophoneEnabled,
    poor:
      p.connectionQuality === ConnectionQuality.Poor ||
      p.connectionQuality === ConnectionQuality.Lost,
    cameraOn: p.isCameraEnabled,
    screenSharing: p.isScreenShareEnabled,
  }
}