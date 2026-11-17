import React, { useState, useEffect, useRef } from 'react';
import { Heart, Feather, Sparkles, Plus, ChevronRight, UserCheck, Archive } from 'lucide-react';
import { UserId, UserProfile, LoveLetter, CoupleStatus, USERS, partnerOf, nameOf, SnapFeed, Showtime } from './types';
import { api } from './services/api';
import { wsClient } from './services/websocket';
import {
  initNotifications, clearAllNotifications, onNotificationTap,
} from './services/notifications';
import {
  startNativeNotifications, consumeOpenChat, clearPendingOpenChat,
} from './services/nativeNotify';
import { Navigation, TabType } from './components/Navigation';
import { LiveStatusWidget } from './components/LiveStatusWidget';
import { NudgeButton } from './components/NudgeButton';
import { LetterEditor } from './components/LetterEditor';
import { LetterViewer } from './components/LetterViewer';
import { ChatView } from './components/ChatView';
import { MemoryGallery } from './components/MemoryGallery';
import { SharedNotes } from './components/SharedNotes';
import { CoupleRadar } from './components/CoupleRadar';
import { UpdateBanner } from './components/UpdateBanner';
import { MoreHub } from './components/MoreHub';
import { GardenView } from './components/GardenView';
import { CinemaSalon } from './components/CinemaSalon';
import { GamesList, GamePlayer, GameEntry } from './components/GamesView';
import { playHaptic } from './services/haptics';
import { registerBackHandler, installBackNavigation } from './services/backButton';
import { getRealBatteryStatus, subscribeToBatteryChanges, BatteryStatus } from './services/battery';

/** Sohbet mesajının tek satırlık önizlemesi (bildirim ve ekran üstü ipucu). */
const previewOfMessage = (msg: { message_type?: string; content?: string }): string => {
  const text = (msg.content || '').trim();
  switch (msg.message_type) {
    case 'image':
      return '📷 Fotoğraf';
    case 'video':
      return '🎬 Video';
    case 'voice':
    case 'walkie_talkie':
      return '🎙️ Sesli mesaj';
    default:
      return text.length > 60 ? `${text.slice(0, 60)}…` : text || '💌';
  }
};

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserId | null>(() => {
    return (localStorage.getItem('ahududu_user') as UserId) || null;
  });
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [partnerProfile, setPartnerProfile] = useState<UserProfile | null>(null);
  const [letters, setLetters] = useState<LoveLetter[]>([]);
  const [distanceKm, setDistanceKm] = useState<number | undefined>(undefined);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<LoveLetter | null>(null);
  const [memorySubTab, setMemorySubTab] = useState<'gallery' | 'notes'>('gallery');
  const [myBattery, setMyBattery] = useState<BatteryStatus | undefined>(undefined);
  const [isPartnerOnline, setIsPartnerOnline] = useState(false);
  /** Partner'in en son görüldüğü an (ISO). Çevrimiçiyken kullanılmaz. */
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [snapFeed, setSnapFeed] = useState<SnapFeed | null>(null);
  const [isCinemaOpen, setIsCinemaOpen] = useState(false);
  /** Açık oyun (tam ekran iframe). null = kapalı. */
  const [activeGame, setActiveGame] = useState<GameEntry | null>(null);
  const [showRadar, setShowRadar] = useState(false);
  const [gardenNews, setGardenNews] = useState(false);
  const cinemaInnerBackRef = useRef<(() => boolean) | null>(null);
  const [cinemaPartnerStatus, setCinemaPartnerStatus] = useState<{
    watching: boolean;
    title?: string;
  }>({ watching: false });
  const [snapToast, setSnapToast] = useState<string | null>(null);
  const [tonightCinema, setTonightCinema] = useState<Showtime | null>(null);
  /** Sunucu arşivi: silinmiş olsa da mektuplar burada tutulur (kaybolmaz). */
  const [archivedLetters, setArchivedLetters] = useState<LoveLetter[]>([]);
  /** Sohbette kaç yeni mesaj var (diğer sekmelerdeyken gelen) */
  const [unreadChat, setUnreadChat] = useState(0);
  /** Birlikte olduğumuz gün sayısı (ilişki başlangıcından bu yana) */
  const daysTogether = (() => {
    const start = new Date(2026, 4, 31, 0, 0, 0);
    const diff = Date.now() - start.getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  })();

  /** Bu cihazda arşive alınan mektup kimlikleri (localStorage'da kalıcı). */
  const readHiddenLetters = (owner: UserId): number[] => {
    try {
      const raw = localStorage.getItem(`ahududu_hidden_letters_${owner}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'number') : [];
    } catch {
      return [];
    }
  };

  const [letterHideList, setLetterHideList] = useState<number[]>(() =>
    readHiddenLetters((localStorage.getItem('ahududu_user') as UserId) || 'murat')
  );

  // Telefon el değiştirdiyse (kullanıcı değiştiyse) o kişinin listesine geç.
  useEffect(() => {
    if (!currentUser) return;
    setLetterHideList(readHiddenLetters(currentUser));
  }, [currentUser]);

  const saveLetterHideList = (list: number[]) => {
    if (!currentUser) return;
    setLetterHideList(list);
    try {
      localStorage.setItem(`ahududu_hidden_letters_${currentUser}`, JSON.stringify(list));
    } catch {
      /* yok say */
    }
  };

  /** Arşivde ne kadar mektup var? (arşiv bölümü her zaman görünür) */
  const archivedCount = archivedLetters.length;
  /** Mektup arşivi bölümü açık mı? */
  const [showLetterArchive, setShowLetterArchive] = useState(false);

  const partnerId: UserId = partnerOf(currentUser ?? 'murat');
  const partnerName = nameOf(partnerId);

  /** Sohbet ekranı görünür mü? (dinleyici stale state'e takılmasın) */
  const chatVisibleRef = useRef(false);
  chatVisibleRef.current =
    activeTab === 'chat' && !isCinemaOpen && !selectedLetter && !isEditorOpen;

  // Sync real hardware battery with server
  const syncBattery = async (userId: UserId) => {
    try {
      const b = await getRealBatteryStatus();
      setMyBattery(b);
      await api.updateProfile(userId, {
        battery_level: b.level,
        is_charging: b.isCharging,
      });
    } catch (e) {
      console.warn('Battery sync error:', e);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    localStorage.setItem('ahududu_user', currentUser);
    wsClient.connect(currentUser);

    // Bildirim iznini al, kanali kur (yalnizca native kabukta etkili).
    // Native servis calisirsa bildirimleri o gosterir (uygulama kapaliyken de).
    void initNotifications(currentUser);
    // Uygulama kapaliyken/arka plandayken bildirim: native servis kendi
    // WebSocket'ini acik tutar, boylece mesaj kacmaz.
    void startNativeNotifications(currentUser);

    /** Bildirime dokunulduysa sohbeti ac. */
    const openChatFromNotification = async () => {
      try {
        const pending = await consumeOpenChat();
        if (pending) {
          setActiveTab('chat');
          setUnreadChat(0);
          await clearPendingOpenChat();
          void clearAllNotifications();
        }
      } catch {
        /* yok say */
      }
    };
    void openChatFromNotification();

    // Uygulama on plana dondugunde bekleyen "sohbeti ac" istegini isle.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void openChatFromNotification();
    };
    // Native taraftan (MainActivity) gelen bildirim dokunusu sinyali.
    const onNativeOpenChat = () => {
      void openChatFromNotification();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('ahududu:open-chat', onNativeOpenChat);

    const offTap = onNotificationTap(() => {
      setActiveTab('chat');
      setUnreadChat(0);
      void clearAllNotifications();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('ahududu:open-chat', onNativeOpenChat);
      offTap();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;

    // Initial data load
    loadInitialData();
    syncBattery(currentUser);

    // Subscribe to live battery changes (charging plugged/unplugged, percentage drop)
    const unsubBattery = subscribeToBatteryChanges((status) => {
      setMyBattery(status);
      api.updateProfile(currentUser, {
        battery_level: status.level,
        is_charging: status.isCharging,
      }).catch(() => {});
    });

    // Periodic battery update every 30 seconds
    const batteryInterval = setInterval(() => {
      syncBattery(currentUser);
    }, 30000);

    // WS Listeners
    const unsubLetter = wsClient.on('new_letter', () => loadLetters());
    const unsubStatus = wsClient.on('partner_location_update', (d: any) => {
      setDistanceKm(d.distance_km);
    });
    const unsubProfile = wsClient.on('partner_profile_updated', (d: any) => {
      if (d.profile) {
        setPartnerProfile((prev) => ({
          ...(prev as UserProfile),
          ...d.profile,
        }));
      }
    });
    const unsubPartnerStatus = wsClient.on('partner_status', (d: any) => {
      if (d.user_id === partnerId) {
        const online = Boolean(d.is_online);
        setIsPartnerOnline(online);
        // Sunucu ayrılırken son görülme zamanını da gönderir; ek istek gerekmez.
        if (!online && d.last_seen) setPartnerLastSeen(d.last_seen);
      }
    });

    // Yeni an / sinema daveti gibi olayları ana ekranda da yakala
    const unsubSnap = wsClient.on('new_snap', (d: any) => {
      if (d?.snap?.sender === partnerId) {
        setSnapToast(`${nameOf(partnerId)} yeni bir an paylaştı! 📸 "Anlar" sekmesinden bak`);
        window.setTimeout(() => setSnapToast(null), 4000);
        loadSnapFeed();
      }
    });
    const unsubCinema = wsClient.on('cinema_started', (d: any) => {
      if (d?.started_by && d.started_by !== (currentUser as UserId)) {
        // Partner filmi başlattı: ZORLA salona sokmuyoruz, sadece haber veriyoruz.
        // Senkronizasyon "izinli" çalışır: kullanıcı isterse dokunup girer.
        setSnapToast(`${nameOf(d.started_by)} ${d.title ? `"${d.title}"` : 'bir film'} başlattı 🍿`);
        window.setTimeout(() => setSnapToast(null), 5000);
      }
    });

    // Partner sinema salonuna girdi: bildirim + durumu "Sinemada"
    const unsubPartnerJoined = wsClient.on('cinema_partner_joined', (d: any) => {
      if (!d?.user_id || d.user_id === currentUser) return;
      playHaptic([120, 100, 180, 800, 120, 100, 180]);
      setSnapToast(
        `${nameOf(d.user_id)} sinema salonuna girdi! 🍿${d.title ? ` · ${d.title}` : ''}`
      );
      window.setTimeout(() => setSnapToast(null), 7000);
      setCinemaPartnerStatus({ watching: true, title: d.title });
    });

    const unsubCinemaPresence = wsClient.on('cinema_presence', (d: any) => {
      if (!d?.user_id || d.user_id === currentUser) return;
      setCinemaPartnerStatus({
        watching: Boolean(d.is_watching),
        title: d.title,
      });
    });

    // Her ekranda gelen mesajı yakala: alt barda sayaç ve üstte kısa ipucu.
    const unsubChat = wsClient.on('new_chat_message', (d: any) => {
      const msg = d?.message;
      if (!msg || msg.sender === currentUser) return;

      // Sohbet sekmesi açık değilken sayacı artır.
      if (!chatVisibleRef.current) setUnreadChat((prev) => prev + 1);
      setSnapToast(`${nameOf(msg.sender)}: ${previewOfMessage(msg)}`);
      window.setTimeout(() => setSnapToast(null), 3500);
    });

    loadSnapFeed();

    return () => {
      clearInterval(batteryInterval);
      unsubBattery();
      unsubLetter();
      unsubStatus();
      unsubProfile();
      unsubPartnerStatus();
      unsubSnap();
      unsubCinema();
      unsubPartnerJoined();
      unsubCinemaPresence();
      unsubChat();
    };
  }, [currentUser]);

  // Sohbet sekmesi açıkken yeni mesaj sayacını sıfırla.
  useEffect(() => {
    if (activeTab === 'chat') setUnreadChat(0);
  }, [activeTab]);

  // ------------------------------------------------------------------
  // Android geri tuşu: uygulamadan çıkmasın.
  //   1) Açık pencereyi kapat  2) Ana ekrana dön  3) Uygulamayı arkaya al.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!currentUser) return;

    const closeTopmost = (): boolean => {
      if (activeGame) {
        setActiveGame(null);
        return true;
      }
      if (isEditorOpen) {
        setIsEditorOpen(false);
        return true;
      }
      if (selectedLetter) {
        setSelectedLetter(null);
        return true;
      }
      if (isCinemaOpen) {
        // Sinema ekranı açıksa kapat; salon içindeyse CinemaSalon kendi
        // handler'ıyla önce salondan çıkar (aşağıdaki kayda bakın).
        if (cinemaInnerBackRef.current && cinemaInnerBackRef.current()) return true;
        setIsCinemaOpen(false);
        return true;
      }
      return false;
    };

    const unregister = registerBackHandler(closeTopmost);
    const uninstall = installBackNavigation(() => {
      // Açık pencere yok:
      // - Alt sekmedeysek ana ekrana dön (işlenmiş sayılır)
      // - Ana ekrandaysak false döndür → native taraf uygulamayı arkaya alır
      if (isEditorOpen || selectedLetter || isCinemaOpen || activeGame) return true;
      if (activeTab !== 'home') {
        setActiveTab('home');
        return true;
      }
      return false;
    });

    return () => {
      unregister();
      uninstall();
    };
  }, [currentUser, isEditorOpen, selectedLetter, isCinemaOpen, activeTab, activeGame]);

  const loadSnapFeed = async () => {
    if (!currentUser) return;
    try {
      const f = await api.getSnapFeed(currentUser);
      setSnapFeed(f);
    } catch (e) {
      // Sessizce yut: anlar yüklenemezse uygulamanın geri kalanı çalışsın
    }
  };

  /** Bu akşamki sinema seansı (ana ekran kartı için) */
  const loadTonightCinema = async (userId: UserId) => {
    try {
      const show = await api.getTonightShowtime(userId);
      setTonightCinema(show);
    } catch {
      // Takvim yoksa kart gizli kalır
    }
  };

  const loadInitialData = async () => {
    if (!currentUser) return;
    try {
      const [partnerProf, coupleStat] = await Promise.all([
        api.getProfile(partnerId),
        api.getCoupleStatus(),
      ]);

      setPartnerProfile(partnerProf);
      // Sohbet başlığındaki "son görülme" ilk açılışta doğru görünsün.
      if (partnerProf?.last_seen) setPartnerLastSeen(partnerProf.last_seen);
      setDistanceKm(coupleStat.distance_km);
    } catch (e) {
      console.error(e);
    }
    // Mektuplar ayrı yüklenir: bu adım patlasa bile mektuplar kaybolmasın.
    await loadLetters();
  };

  /**
   * Mektupları yükle. Sunucudan gelen liste TEK gerçek kaynaktır.
   * Bir mektup sunucuda duruyorsa arayüzden asla düşmez; yalnızca açıkça
   * "arşive alınan" mektuplar ayrı bir bölümde gösterilir ve geri getirilebilir.
   */
  const loadLetters = async (): Promise<void> => {
    try {
      const data = await api.listLetters();
      const all = Array.isArray(data) ? data : [];
      const archivedIds = new Set(
        all.filter((l) => Boolean(l.is_deleted)).map((l) => l.id)
      );
      setLetters(all.filter((l) => !archivedIds.has(l.id)));
      setArchivedLetters(all.filter((l) => archivedIds.has(l.id)));
    } catch (e) {
      console.warn('[Ahududu] Mektuplar yüklenemedi', e);
    }
  };

  /** Bir mektubu arşive al (sunucudaki kayıt SİLİNMEZ, geri getirilebilir). */
  const hideLetter = (letter: LoveLetter) => {
    setLetters((prev) => prev.filter((l) => l.id !== letter.id));
    setArchivedLetters((prev) => [letter, ...prev.filter((l) => l.id !== letter.id)]);
    api.deleteLetter(letter.id).catch(() => {
      // Sunucuya ulaşılamazsa mektup listede kalsın (kaybolmasın).
      void loadLetters();
    });
  };

  /** Arşive alınan mektubu geri getir. */
  const restoreLetter = (letter: LoveLetter) => {
    setArchivedLetters((prev) => prev.filter((l) => l.id !== letter.id));
    setLetters((prev) => [letter, ...prev].sort((a, b) => b.id - a.id));
    api.restoreLetter(letter.id).catch(() => {
      void loadLetters();
    });
  };

  // If user is not yet selected, show the cute sweet welcome profile picker
  if (!currentUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-b from-rose-50 via-pink-50 to-amber-50">
        <div className="w-full max-w-sm bg-white/90 backdrop-blur-xl rounded-3xl p-8 border border-rose-100 shadow-2xl shadow-berry-900/10 text-center">
          <div className="relative mx-auto w-24 h-24 mb-4">
            <img
              src="/logo.png"
              alt="Ahududu Logo"
              className="w-full h-full object-contain drop-shadow-md animate-float"
            />
          </div>

          <h1 className="font-serif text-2xl font-bold text-berry-950 mb-6">
            Ahududu'ya Hoş Geldin
          </h1>

          <p className="font-serif text-sm font-semibold text-berry-900 mb-4">
            Bu telefonda kim oturuyor?
          </p>

          <div className="space-y-3">
            <button
              onClick={() => {
                playHaptic(30);
                setCurrentUser('selin');
              }}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-rose-50 to-pink-50 hover:from-rose-100 hover:to-pink-100 border border-rose-200 text-berry-900 transition-all active:scale-95 shadow-xs group"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">🌸</span>
                <span className="font-serif text-base font-bold">
                  Ben Selin'im
                </span>
              </div>
              <ChevronRight className="w-5 h-5 text-berry-400 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={() => {
                playHaptic(30);
                setCurrentUser('murat');
              }}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-berry-50 to-rose-50 hover:from-berry-100 hover:to-rose-100 border border-rose-200 text-berry-900 transition-all active:scale-95 shadow-xs group"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">🐻</span>
                <span className="font-serif text-base font-bold">
                  Ben Murat'ım
                </span>
              </div>
              <ChevronRight className="w-5 h-5 text-berry-400 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const unreadLetters = letters.filter(
    (l) => !l.is_opened && l.sender !== currentUser
  );

  /**
   * Sohbet ekranı tam ekran bir dünyadır (WhatsApp gibi):
   * başlık en üstte, mesaj listesi ortada kayar, yazma alanı en altta
   * navigasyon barına yapışır. Diğer sekmeler kaydırılabilir sayfa olarak kalır.
   */
  const isChatTab = activeTab === 'chat';

  return (
    <div
      className={`font-sans select-none ${
        isChatTab ? 'h-[100dvh] overflow-hidden flex flex-col' : 'min-h-screen'
      }`}
      style={
        isChatTab
          ? undefined
          : { paddingBottom: 'calc(6rem + var(--safe-bottom, 0px))' }
      }
    >
      {/* Live Zero-Reinstall OTA Update Banner */}
      <UpdateBanner />

      {/* App Bar / Header */}
      <header
        className={`z-30 shrink-0 bg-white/80 backdrop-blur-md border-b border-rose-100/80 px-4 ${
          isChatTab ? 'relative' : 'sticky top-0'
        }`}
      >
        <div
          className="max-w-md mx-auto flex items-center justify-between py-3"
          style={{ paddingTop: 'calc(var(--safe-top, 0px) + 0.75rem)' }}
        >
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Ahududu"
              className="w-9 h-9 object-contain drop-shadow-xs"
            />
            <h1 className="font-serif text-lg font-bold text-berry-950 leading-tight">
              Ahududu
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main
        className={
          isChatTab
            ? 'flex-1 min-h-0 w-full max-w-md mx-auto flex flex-col overflow-hidden'
            : 'max-w-md mx-auto p-4 w-full'
        }
      >
        {/* Home Tab */}
        {activeTab === 'home' && (
          <div className="flex flex-col space-y-4">
            {/* Live Status Card */}
            <LiveStatusWidget
              partnerProfile={partnerProfile}
              myBattery={myBattery}
              distanceKm={distanceKm}
              partnerName={partnerName}
              isPartnerOnline={isPartnerOnline}
              daysTogether={daysTogether}
            />

            {/* Giant Attention Nudge Button */}
            <NudgeButton
              currentUserId={currentUser}
              partnerName={partnerName}
            />

            {/* Hızlı erişim: Bahçe · Sinema · Anlar · Oyunlar */}
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => {
                  playHaptic(20);
                  setActiveTab('garden');
                }}
                className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/85 border border-emerald-100 shadow-xs active:scale-95 transition-transform"
              >
                <span className="text-xl">🌸</span>
                <span className="text-[10px] font-bold text-berry-900">Bahçe</span>
              </button>
              <button
                onClick={() => {
                  playHaptic(25);
                  setIsCinemaOpen(true);
                }}
                className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/85 border border-amber-200 shadow-xs active:scale-95 transition-transform"
              >
                <span className="text-xl">🎬</span>
                <span className="text-[10px] font-bold text-berry-900">Sinema</span>
              </button>
              <button
                onClick={() => {
                  playHaptic(20);
                  setActiveTab('memories');
                }}
                className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/85 border border-rose-100 shadow-xs active:scale-95 transition-transform"
              >
                <span className="text-xl">📸</span>
                <span className="text-[10px] font-bold text-berry-900">Anlar</span>
              </button>
              <button
                onClick={() => {
                  playHaptic(25);
                  setActiveTab('games');
                }}
                className="relative flex flex-col items-center gap-1 py-3 rounded-2xl bg-white/85 border border-violet-200 shadow-xs active:scale-95 transition-transform"
              >
                <span className="text-xl">🎮</span>
                <span className="text-[10px] font-bold text-berry-900">Oyunlar</span>
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
              </button>
            </div>

            {/* Sinema daveti: partner salonda ya da bu akşam seans var */}
            {(cinemaPartnerStatus.watching || tonightCinema) && (
              <div
                onClick={() => {
                  playHaptic(25);
                  setIsCinemaOpen(true);
                }}
                className="relative overflow-hidden rounded-3xl p-3.5 cursor-pointer active:scale-[0.98] transition-transform shadow-lg shadow-berry-900/20 border border-amber-400/30"
                style={{
                  background: 'linear-gradient(120deg, #2a0713 0%, #5c0a20 55%, #7f1030 100%)',
                }}
              >
                <div
                  className="absolute inset-0 opacity-35 animate-[lightsSweep_8s_ease-in-out_infinite] pointer-events-none"
                  style={{
                    background:
                      'conic-gradient(from 205deg at 15% 0%, rgba(255,220,160,0.45), transparent 38%)',
                  }}
                />
                <div className="relative flex items-center gap-3">
                  <span className="text-2xl animate-float">🍿</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-bold tracking-[0.22em] text-amber-300/85 uppercase">
                      Sinema Salonu
                    </p>
                    <p className="font-serif text-sm font-bold text-white leading-tight">
                      {cinemaPartnerStatus.watching
                        ? `${partnerName} sinemada! 🎬`
                        : `Bu akşam: ${tonightCinema?.show_time ?? ''} ${tonightCinema?.title ?? ''}`}
                    </p>
                    {cinemaPartnerStatus.watching && (
                      <p className="text-[10px] text-white/65 mt-0.5">
                        {cinemaPartnerStatus.title
                          ? `Şu an izliyor: ${cinemaPartnerStatus.title}`
                          : 'Hazır olduğunda katıl'}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-amber-200 text-lg">›</span>
                </div>
              </div>
            )}

            {/* Quick Unread Letter Banner */}
            {unreadLetters.length > 0 && (
              <div
                onClick={() => {
                  setSelectedLetter(unreadLetters[0]);
                  playHaptic(25);
                }}
                className="bg-gradient-to-r from-amber-500 via-rose-500 to-berry-600 rounded-3xl p-4 text-white shadow-lg cursor-pointer hover:shadow-xl transition-all flex items-center justify-between animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">💌</span>
                  <div>
                    <h4 className="font-serif text-sm font-bold">
                      Okunmamış Mektubun Var!
                    </h4>
                    <p className="text-[11px] text-pink-100">
                      "{unreadLetters[0].title}"
                    </p>
                  </div>
                </div>
                <span className="text-xs font-semibold bg-white/20 px-3 py-1.5 rounded-full">
                  Mührü Aç ✨
                </span>
              </div>
            )}

            {/* Bahçe özeti — bugün bir şey bekliyor mu? */}
            <button
              onClick={() => {
                playHaptic(20);
                setActiveTab('garden');
              }}
              className="flex items-center gap-3 rounded-3xl bg-white/85 border border-emerald-100 shadow-sm px-4 py-3 text-left active:scale-[0.99] transition-transform"
            >
              <span className="text-xl shrink-0">🌱</span>
              <span className="min-w-0 flex-1">
                <span className="block font-serif text-sm font-bold text-berry-950">
                  Bahçede bugün
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
            </button>
          </div>
        )}

        {/* Letters Tab */}
        {activeTab === 'letters' && (
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-serif text-lg font-bold text-berry-950">
                  Mektup Kutumuz 💌
                </h2>
              </div>

              <button
                onClick={() => {
                  playHaptic(25);
                  setIsEditorOpen(true);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-r from-berry-500 to-rose-500 text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
              >
                <Feather className="w-3.5 h-3.5" />
                Mektup Yaz
              </button>
            </div>

            {/* Letters list */}
            {letters.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 bg-white/60 rounded-3xl border border-rose-100 text-center opacity-60">
                <Feather className="w-12 h-12 text-berry-400 mb-2 animate-float" />
                <p className="font-serif text-sm font-semibold text-berry-900">
                  Henüz mektup yok
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {letters.map((l) => {
                  const isFromMe = l.sender === currentUser;
                  const isUnread = !l.is_opened && !isFromMe;

                  return (
                    <div
                      key={l.id}
                      onClick={() => {
                        playHaptic(20);
                        setSelectedLetter(l);
                      }}
                      className={`p-4 rounded-3xl border shadow-xs cursor-pointer hover:shadow-md transition-all flex items-center justify-between ${
                        isUnread
                          ? 'bg-gradient-to-r from-rose-50 to-pink-50 border-berry-300 ring-2 ring-berry-400/30'
                          : 'bg-white/85 border-rose-100'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0 ${
                            isUnread ? 'bg-berry-500 text-white shadow-xs' : 'bg-rose-100 text-berry-700'
                          }`}
                        >
                          {isUnread ? '💌' : '📜'}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-serif text-sm font-bold text-berry-950 truncate">
                            {l.title}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] text-stone-500 mt-0.5">
                            <span>{isFromMe ? 'Ben yazdım' : partnerName}</span>
                            <span>•</span>
                            <span>
                              {new Date(l.created_at).toLocaleDateString('tr-TR')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 ml-2 flex items-center gap-1.5">
                        {isUnread ? (
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-berry-500 text-white">
                            Mühürlü ✨
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-stone-400">
                            Okundu ✓
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            playHaptic(15);
                            hideLetter(l);
                          }}
                          className="p-1.5 rounded-full text-stone-300 hover:text-berry-600"
                          title="Arşive al (silinmez)"
                          aria-label="Arşive al"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---- Arşiv: mektuplar asla silinmez, buradan geri getirilir ---- */}
            {archivedCount > 0 && (
              <div className="rounded-3xl border border-amber-200/70 bg-amber-50/60 p-3">
                <button
                  onClick={() => {
                    setShowLetterArchive((open) => !open);
                    playHaptic(15);
                  }}
                  className="w-full flex items-center justify-between gap-2"
                  aria-expanded={showLetterArchive}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Archive className="w-4 h-4 text-amber-700 shrink-0" />
                    <span className="min-w-0 text-left">
                      <span className="block font-serif text-sm font-bold text-berry-950">
                        Mektup Arşivi ({archivedCount})
                      </span>
                      <span className="block text-[10px] text-stone-500">
                        Arşive aldığın mektuplar burada saklanır, hiçbiri kaybolmaz
                      </span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-bold text-amber-800">
                      {showLetterArchive ? 'Gizle' : 'Aç'}
                    </span>
                    <ChevronRight
                      className={`w-4 h-4 text-stone-400 transition-transform ${
                        showLetterArchive ? 'rotate-90' : ''
                      }`}
                    />
                  </span>
                </button>

                {showLetterArchive && (
                  <div className="mt-2 space-y-2">
                    {archivedLetters.map((l) => (
                      <div
                        key={`arch-${l.id}`}
                        className="flex items-center justify-between gap-2 rounded-2xl bg-white/85 border border-amber-100 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="font-serif text-xs font-bold text-berry-950 truncate">
                            {l.title}
                          </p>
                          <p className="text-[10px] text-stone-500">
                            {l.sender === currentUser ? 'Ben yazdım' : partnerName} ·{' '}
                            {new Date(l.created_at).toLocaleDateString('tr-TR')}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              playHaptic(20);
                              restoreLetter(l);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-berry-500 text-white text-[10px] font-bold active:scale-95"
                          >
                            Geri Getir
                          </button>
                          <button
                            onClick={() => {
                              playHaptic(12);
                              setSelectedLetter(l);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white border border-rose-200 text-berry-800 text-[10px] font-bold active:scale-95"
                          >
                            Oku
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <ChatView
            currentUserId={currentUser}
            partnerName={partnerName}
            isPartnerOnline={isPartnerOnline}
            partnerLastSeen={partnerLastSeen}
            onOpenMemories={() => {
              playHaptic(15);
              setActiveTab('memories');
            }}
            onOpenCinema={() => {
              playHaptic(20);
              setIsCinemaOpen(true);
            }}
          />
        )}

        {/* Memories & Notes Tab */}
        {activeTab === 'memories' && (
          <div className="flex flex-col space-y-4">
            {/* Sub-tab switch */}
            <div className="flex items-center bg-rose-100/70 p-1 rounded-2xl">
              <button
                onClick={() => {
                  setMemorySubTab('gallery');
                  playHaptic(15);
                }}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                  memorySubTab === 'gallery'
                    ? 'bg-white text-berry-900 shadow-xs'
                    : 'text-stone-600 hover:text-berry-900'
                }`}
              >
                📸 Ortak Fotoğraf Galerimiz
              </button>
              <button
                onClick={() => {
                  setMemorySubTab('notes');
                  playHaptic(15);
                }}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                  memorySubTab === 'notes'
                    ? 'bg-white text-berry-900 shadow-xs'
                    : 'text-stone-600 hover:text-berry-900'
                }`}
              >
                📝 Notlarımız & İsteklerimiz
              </button>
            </div>

            {memorySubTab === 'gallery' ? (
              <MemoryGallery currentUserId={currentUser} />
            ) : (
              <SharedNotes currentUserId={currentUser} />
            )}
          </div>
        )}

        {/* Bahçe: Günün sorusu · Zaman kapsülleri · Şarkılarımız · Duygu havası (demo) */}
        {activeTab === 'garden' && <GardenView currentUserId={currentUser} />}

        {/* Oyunlar: eklediğimiz oyunların listesi (tıklayınca tam ekran açılır) */}
        {activeTab === 'games' && (
          <GamesList
            currentUserId={currentUser}
            onOpen={(game) => {
              playHaptic(30);
              setActiveGame(game);
            }}
          />
        )}

        {/* Anılar: Anlık · Günlük · Hayvanlar · Sinema · Radar */}
        {activeTab === 'memories' && (
          <div className="flex flex-col space-y-4">
            <MoreHub
              currentUserId={currentUser}
              onOpenCinema={() => setIsCinemaOpen(true)}
              onOpenRadar={() => setShowRadar(true)}
            />
            {showRadar && (
              <div className="animate-[fadeIn_0.25s_ease-out]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-serif text-sm font-bold text-berry-950">Neredeyiz?</h3>
                  <button
                    onClick={() => setShowRadar(false)}
                    className="text-[11px] font-semibold text-stone-500 px-2.5 py-1 rounded-full bg-white/80 border border-rose-100"
                  >
                    Kapat
                  </button>
                </div>
                <CoupleRadar currentUserId={currentUser} partnerName={partnerName} />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar — her zaman 5 tuş.
          Sohbette mesaj yazma alanının altına YAPIŞIK, diğer sekmelerde yüzen bar. */}
      <Navigation
        activeTab={activeTab}
        variant={isChatTab ? 'attached' : 'floating'}
        onChangeTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'chat') setUnreadChat(0);
        }}
        unreadLettersCount={unreadLetters.length}
        unreadChatCount={unreadChat}
        hasNewSnaps={Boolean(snapFeed?.partner && (snapFeed.partner.unseen ?? 0) > 0)}
        hasGardenNews={Boolean(gardenNews)}
      />

      {/* Letter Editor Modal */}
      {isEditorOpen && (
        <LetterEditor
          currentUserId={currentUser}
          onLetterSent={() => {
            setIsEditorOpen(false);
            loadLetters();
          }}
          onClose={() => setIsEditorOpen(false)}
        />
      )}

      {/* Letter Viewer Modal */}
      {selectedLetter && (
        <LetterViewer
          letter={selectedLetter}
          onClose={() => setSelectedLetter(null)}
          onLetterOpened={(updated) => {
            setLetters((prev) =>
              prev.map((l) => (l.id === updated.id ? updated : l))
            );
          }}
        />
      )}

      {/* Sinema Salonu — kendi tam ekran dünyası */}
      {isCinemaOpen && (
        <div className="fixed inset-0 z-[85] bg-stone-950 overflow-y-auto safe-area-all">
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-stone-950/95 backdrop-blur-md border-b border-amber-500/20">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎬</span>
              <span className="font-serif text-sm font-bold text-amber-100">Sinema Salonu</span>
            </div>
            <button
              onClick={() => {
                setIsCinemaOpen(false);
                playHaptic(18);
              }}
              className="px-3 py-1.5 rounded-full bg-white/10 text-white text-[11px] font-bold active:scale-95"
            >
              Kapat ✕
            </button>
          </div>
          <div className="max-w-md mx-auto p-4 pb-24">
            <CinemaSalon
              currentUserId={currentUser}
              onBackHandlerReady={(handler) => {
                cinemaInnerBackRef.current = handler;
              }}
            />
          </div>
        </div>
      )}

      {/* Oyun oynatıcı — tam ekran iframe (Escape / geri tuşu kapatır) */}
      {activeGame && (
        <GamePlayer
          game={activeGame}
          currentUserId={currentUser}
          onClose={() => setActiveGame(null)}
        />
      )}

      {/* Yeni an / sinema bildirimi */}
      {snapToast && (
        <div
          onClick={() => {
            setActiveTab('memories');
            setSnapToast(null);
          }}
          className="fixed left-1/2 -translate-x-1/2 top-16 z-[95] max-w-[92%] px-4 py-2.5 rounded-2xl bg-berry-900/95 text-white text-xs font-semibold shadow-2xl flex items-center gap-2 animate-[fadeIn_0.3s_ease-out] cursor-pointer"
        >
          <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
          <span>{snapToast}</span>
        </div>
      )}
    </div>
  );
};
