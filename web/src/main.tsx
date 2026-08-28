import { createRoot } from 'react-dom/client'
import { setLogLevel } from 'livekit-client'
import './index.css'
import App from './App.tsx'

// SDK-логгер LiveKit по умолчанию пишет каждое событие комнаты (info) — шум,
// в котором тонет всё остальное. warn: остаются только ошибки WebRTC/комнаты.
// Для отладки подключения временно верни 'info'.
setLogLevel('warn')

// StrictMode выключен: его двойной эффект в dev рвёт живое соединение LiveKit
// (cleanup отменяет connect первого прохода — комната остаётся в рассинхроне).
createRoot(document.getElementById('root')!).render(<App />)