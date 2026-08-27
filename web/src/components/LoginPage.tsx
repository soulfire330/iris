import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login, type Session } from '@/lib/api'

export function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onLogin(await login(loginName.trim(), password))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-md ring-1 ring-foreground/10">
        <h1 className="text-xl font-medium">Iris</h1>
        <p className="mt-1 text-sm text-muted-foreground">Виртуальный офис · вход по учётной записи</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="login">Логин</Label>
              <Input
                id="login"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? 'Входим…' : 'Войти'}
            </Button>
          </form>
        </div>
      </div>
  )
}
