import React, { useState, useEffect } from 'react';
import { Heart, Feather, Sparkles, Plus, Watch, ChevronRight, UserCheck } from 'lucide-react';
import { UserId, UserProfile, LoveLetter, WatchBiometrics, CoupleStatus } from './types';
import { api } from './services/api';
import { wsClient } from './services/websocket';
import { Navigation, TabType } from './components/Navigation';
import { LiveStatusWidget } from './components/LiveStatusWidget';
import { NudgeButton } from './components/NudgeButton';
import { WalkieTalkie } from './components/WalkieTalkie';
import { LetterEditor } from './components/LetterEditor';
import { LetterViewer } from './components/LetterViewer';
import { ChatView } from './components/ChatView';
import { MemoryGallery } from './components/MemoryGallery';
import { SharedNotes } from './components/SharedNotes';
import { CoupleRadar } from './components/CoupleRadar';
import { WatchCompanion } from './components/WatchCompanion';
import { WatchInstallModal } from './components/WatchInstallModal';
import { UpdateBanner } from './components/UpdateBanner';
import { playHaptic } from './services/haptics';

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserId | null>(() => {
    return (localStorage.getItem('ahududu_user') as UserId) || null;
  });
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [partnerProfile, setPartnerProfile] = useState<UserProfile | null>(null);
  const [partnerBiometrics, setPartnerBiometrics] = useState<WatchBiometrics | null>(null);
  const [letters, setLetters] = useState<LoveLetter[]>([]);
  const [distanceKm, setDistanceKm] = useState<number | undefined>(undefined);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<LoveLetter | null>(null);
  const [isWatchModalOpen, setIsWatchModalOpen] = useState(false);
  const [memorySubTab, setMemorySubTab] = useState<'gallery' | 'notes'>('gallery');

  const partnerId: UserId = currentUser === 'murat' ? 'sevgilim' : 'murat';
  const partnerName = currentUser === 'murat' ? 'Sevgilim' : 'Murat';

  useEffect(() => {
    if (!currentUser) return;
    localStorage.setItem('ahududu_user', currentUser);
    wsClient.connect(currentUser);

    // Initial data load
    loadInitialData();

    // WS Listeners
    const unsubLetter = wsClient.on('new_letter', () => loadLetters());
    const unsubStatus = wsClient.on('partner_location_update', (d: any) => {
      setDistanceKm(d.distance_km);
    });

    return () => {
      unsubLetter();
      unsubStatus();
    };
  }, [currentUser]);

  const loadInitialData = async () => {
    if (!currentUser) return;
    try {
      const [partnerProf, partnerBio, coupleStat, letterList] = await Promise.all([
        api.getProfile(partnerId),
        api.getWatchBiometrics(partnerId),
        api.getCoupleStatus(),
        api.listLetters(),
      ]);

      setPartnerProfile(partnerProf);
      setPartnerBiometrics(partnerBio);
      setDistanceKm(coupleStat.distance_km);
      setLetters(letterList);
    } catch (e) {
      console.error(e);
    }
  };

  const loadLetters = async () => {
    try {
      const data = await api.listLetters();
      setLetters(data);
    } catch (e) {}
  };

  // If opened directly on Samsung Galaxy Watch (/watch URL)
  if (window.location.pathname === '/watch') {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden">
        <div className="w-full h-full max-w-[450px] max-h-[450px] rounded-full overflow-hidden flex items-center justify-center">
          <WatchCompanion
            currentUserId={currentUser || 'sevgilim'}
            partnerName={currentUser === 'murat' ? 'Sevgilim' : 'Murat'}
            onOpenInstallModal={() => {}}
          />
        </div>
      </div>
    );
  }

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

          <h1 className="font-serif text-2xl font-bold text-berry-950 mb-1">
            Ahududu'ya Hoş Geldin
          </h1>
          <p className="text-xs text-stone-500 mb-6">
            Sadece ikimize özel, aşk dolu dünyamız 💕
          </p>

          <p className="font-serif text-sm font-semibold text-berry-900 mb-4">
            Bu telefonda kim oturuyor?
          </p>

          <div className="space-y-3">
            <button
              onClick={() => {
                playHaptic(30);
                setCurrentUser('sevgilim');
              }}
              className="w-full flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-rose-50 to-pink-50 hover:from-rose-100 hover:to-pink-100 border border-rose-200 text-berry-900 transition-all active:scale-95 shadow-xs group"
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">🌸</span>
                <div className="text-left">
                  <span className="font-serif text-base font-bold block">
                    Ben Sevgilimiyim
                  </span>
                  <span className="text-[11px] text-stone-500">
                    Samsung Galaxy S24 Ultra & Watch 7
                  </span>
                </div>
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
                <div className="text-left">
                  <span className="font-serif text-base font-bold block">
                    Ben Murat'ım
                  </span>
                  <span className="text-[11px] text-stone-500">
                    Samsung Galaxy S23 & Watch Ultra
                  </span>
                </div>
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

  return (
    <div className="min-h-screen pb-24 font-sans select-none">
      {/* Live Zero-Reinstall OTA Update Banner */}
      <UpdateBanner />

      {/* App Bar / Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-rose-100/80 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="Ahududu"
              className="w-9 h-9 object-contain drop-shadow-xs"
            />
            <div>
              <h1 className="font-serif text-lg font-bold text-berry-950 leading-tight">
                Ahududu
              </h1>
              <p className="text-[10px] text-stone-500 font-medium">
                {currentUser === 'murat' ? 'Murat 🐻' : 'Canım 🌸'} Dünyası
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                playHaptic(20);
                const nextUser = currentUser === 'murat' ? 'sevgilim' : 'murat';
                setCurrentUser(nextUser);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 hover:bg-rose-100 border border-rose-200/70 text-xs font-semibold text-berry-900 transition-colors"
              title="Profil Değiştir"
            >
              <span>{currentUser === 'murat' ? '🐻' : '🌸'}</span>
              <span className="text-[11px]">Değiştir</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="max-w-md mx-auto p-4">
        {/* Home Tab */}
        {activeTab === 'home' && (
          <div className="flex flex-col space-y-4">
            {/* Live Status Card */}
            <LiveStatusWidget
              partnerProfile={partnerProfile}
              partnerBiometrics={partnerBiometrics}
              distanceKm={distanceKm}
            />

            {/* Giant Attention Nudge Button */}
            <NudgeButton
              currentUserId={currentUser}
              partnerName={partnerName}
            />

            {/* Walkie-Talkie Push-to-Talk Intercom */}
            <WalkieTalkie
              currentUserId={currentUser}
              partnerName={partnerName}
            />

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
                <p className="text-xs text-stone-500">
                  Kalpten yazılan mektuplar ve el çizimleri
                </p>
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
                <Feather className="w-12 h-12 text-berry-400 mb-2 animate-bounce" />
                <p className="font-serif text-sm font-semibold text-berry-900">
                  Henüz mektup yok
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  Sevgiline ilk aşk mektubunu veya S-Pen çizimini hemen yaz ✨
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

                      <div className="shrink-0 ml-2">
                        {isUnread ? (
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-berry-500 text-white">
                            Mühürlü ✨
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-stone-400">
                            Okundu ✓
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <ChatView
            currentUserId={currentUser}
            partnerName={partnerName}
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

        {/* Radar Tab */}
        {activeTab === 'radar' && (
          <CoupleRadar
            currentUserId={currentUser}
            partnerName={partnerName}
          />
        )}

        {/* Watch Tab */}
        {activeTab === 'watch' && (
          <WatchCompanion
            currentUserId={currentUser}
            partnerName={partnerName}
            onOpenInstallModal={() => setIsWatchModalOpen(true)}
          />
        )}
      </main>

      {/* Floating Bottom Navigation Bar */}
      <Navigation
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        unreadLettersCount={unreadLetters.length}
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

      {/* Watch Installation Helper Modal */}
      {isWatchModalOpen && (
        <WatchInstallModal onClose={() => setIsWatchModalOpen(false)} />
      )}
    </div>
  );
};
