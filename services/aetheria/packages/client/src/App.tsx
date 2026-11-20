import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Login } from "./ui/Login";
import { CharacterSelect } from "./ui/CharacterSelect";
import { Game } from "./Game";
import { OrientationHint } from "./ui/OrientationPrompt";
import { LoadingScreen } from "./ui/LoadingScreen";
import { apiUrl } from "./utils/apiBase";

function resolveAhududuUser(): "murat" | "selin" | null {
  try {
    const q = new URLSearchParams(window.location.search).get("u")?.toLowerCase();
    if (q === "murat" || q === "selin") return q;
  } catch {
    /* ignore */
  }
  try {
    const busUser = (window as unknown as { __ahududuGameBus?: { user?: string } }).__ahududuGameBus?.user?.toLowerCase();
    if (busUser === "murat" || busUser === "selin") return busUser;
  } catch {
    /* ignore */
  }
  return null;
}

export function App() {
  const token = useStore((s) => s.token);
  const username = useStore((s) => s.username);
  const characterId = useStore((s) => s.characterId);
  const setAuth = useStore((s) => s.setAuth);
  const selectCharacter = useStore((s) => s.selectCharacter);
  const [ssoPending, setSsoPending] = useState<boolean>(() => Boolean(resolveAhududuUser()));

  useEffect(() => {
    (window as unknown as { __aetheriaStatus?: () => Record<string, unknown> }).__aetheriaStatus = () => {
      const s = useStore.getState();
      const players = (s.room?.state as { players?: { size?: number } } | undefined)?.players;
      return {
        user: s.username,
        hasToken: Boolean(s.token),
        characterId: s.characterId,
        mapId: (window as unknown as { __aetheriaMapId?: string }).__aetheriaMapId ?? null,
        roomConnected: Boolean(s.room),
        playersInRoom: players?.size ?? 0,
      };
    };
  }, []);

  useEffect(() => {
    const targetUser = resolveAhududuUser();
    if (!targetUser) {
      setSsoPending(false);
      return;
    }
    if (token && username === targetUser) {
      setSsoPending(false);
      return;
    }
    let cancelled = false;
    setSsoPending(true);
    fetch(apiUrl("/api/auth/ahududu-sso"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: targetUser }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`SSO HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const chars = Array.isArray(data.characters) ? data.characters : [];
        const curCharId = useStore.getState().characterId;
        if (curCharId && !chars.some((c: { id?: string }) => c.id === curCharId)) {
          selectCharacter(null);
        }
        setAuth(data.token, data.username, chars);
      })
      .catch(() => {
        /* Fallback to normal Login UI */
      })
      .finally(() => {
        if (!cancelled) setSsoPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, username, setAuth, selectCharacter]);

  if (ssoPending && !token) {
    return (
      <>
        <OrientationHint />
        <LoadingScreen title="Aetheria" subtitle="Ahududu hesabı ile bağlanılıyor..." />
      </>
    );
  }

  return (
    <>
      <OrientationHint />
      {!token ? <Login /> : !characterId ? <CharacterSelect /> : <Game />}
    </>
  );
}
