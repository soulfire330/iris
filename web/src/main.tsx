import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode выключен: его двойной эффект в dev рвёт живое соединение LiveKit
// (cleanup отменяет connect первого прохода — комната остаётся в рассинхроне).
createRoot(document.getElementById('root')!).render(<App />)