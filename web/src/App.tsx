import { useState } from "react";
import { InvitePage } from "@/components/InvitePage";
import { LoginPage } from "@/components/LoginPage";
import { RoomPage } from "@/components/RoomPage";
import { setAuthToken, type Session } from "@/lib/api";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);

  const onLogin = (s: Session) => {
    setAuthToken(s.token); // токен авторизует внутренний API (Bearer)
    setSession(s);
  };
  const onLeave = () => {
    setAuthToken("");
    setSession(null);
  };

  if (!session) {
    // Путь /invite/<токен> — гость по ссылке: вход без логина/пароля.
    // После выхода гость возвращается на свою страницу (инвайт многоразовый,
    // URL остался прежним) — ветка сработает снова.
    const token = window.location.pathname.startsWith("/invite/")
      ? window.location.pathname.slice("/invite/".length)
      : null;
    return token ? <InvitePage token={token} onLogin={onLogin} /> : <LoginPage onLogin={onLogin} />;
  }
  return <RoomPage session={session} onLeave={onLeave} />;
}
