// Varsayılan sunucu yapılandırması — ilk açılışta app_config tablosuna tohumlanır.
// Bu belge, APK gerektirmeden güncellenebilen içerikleri tanımlar (bkz. docs/MODULE_SYSTEM.md).
export interface AppConfigDocument {
  schemaVersion: number
  themes: {
    active: string
    available: Array<{ id: string; name: string; colors: Record<string, string> }>
  }
  letters: {
    papers: Array<{ id: string; name: string; background: string; lines: boolean }>
    envelopes: Array<{ id: string; name: string }>
  }
  interactions: Array<{
    kind: string
    label: string
    message: string
    cooldownSec: number
    notify: boolean
  }>
  strings: Record<string, string>
  featureFlags: Record<string, boolean>
  limits: { imageMaxBytes: number; videoMaxBytes: number }
}

export const DEFAULT_CONFIG: AppConfigDocument = {
  schemaVersion: 1,
  themes: {
    active: 'pudra',
    available: [
      {
        id: 'pudra',
        name: 'Pudra',
        colors: {
          primary: '#C4536B',
          background: '#FAF3EE',
          surface: '#FFFDF9',
          text: '#3E2B31',
          mutedText: '#8C737B',
          accent: '#E8A0B4',
        },
      },
      {
        id: 'murdum',
        name: 'Mürdüm',
        colors: {
          primary: '#8E4A66',
          background: '#F5EFF2',
          surface: '#FDFBFc',
          text: '#33222E',
          mutedText: '#83707B',
          accent: '#B98AA3',
        },
      },
      {
        id: 'krem',
        name: 'Krem',
        colors: {
          primary: '#B0765A',
          background: '#FAF6EF',
          surface: '#FFFDF8',
          text: '#3B2F28',
          mutedText: '#8A7A6E',
          accent: '#D9B295',
        },
      },
    ],
  },
  letters: {
    papers: [
      { id: 'klasik', name: 'Klasik Mektup', background: 'krem', lines: false },
      { id: 'cizgili', name: 'Çizgili Defter', background: 'beyaz', lines: true },
      { id: 'minimal', name: 'Minimal Krem', background: 'krem', lines: false },
      { id: 'ozelgun', name: 'Özel Gün', background: 'pembe', lines: false },
    ],
    envelopes: [
      { id: 'klasik', name: 'Klasik Zarf' },
      { id: 'muhur', name: 'Mühürlü Zarf' },
    ],
  },
  interactions: [
    {
      kind: 'attention',
      label: 'Biraz ilgini istiyorum',
      message: 'Biraz ilgini istiyorum 💗',
      cooldownSec: 600,
      notify: true,
    },
    { kind: 'heart', label: 'Kalp gönder', message: 'Sana bir kalp gönderdim ❤', cooldownSec: 30, notify: true },
    { kind: 'kiss', label: 'Öpücük gönder', message: 'Sana bir öpücük yolladım 😘', cooldownSec: 30, notify: true },
    { kind: 'hug', label: 'Sarıl', message: 'Sarılmaya ihtiyacım var 🤗', cooldownSec: 60, notify: true },
    { kind: 'star', label: 'Yıldız gönder', message: 'Sana bir yıldız ✨', cooldownSec: 30, notify: false },
    { kind: 'flower', label: 'Çiçek gönder', message: 'Sana bir çiçek 🌸', cooldownSec: 30, notify: false },
  ],
  strings: {
    'home.greeting': 'Merhaba canım',
    'home.emptyLetters': 'Henüz mektup yok. İlk mektubu sen yazabilirsin.',
    'home.emptyMessages': 'Sohbeti sen başlat.',
    'home.emptyGallery': 'Anılarınızı burada biriktirin.',
  },
  featureFlags: {
    locationSharing: true,
    voiceLink: false,
    wearApp: true,
  },
  limits: {
    imageMaxBytes: 26_214_400,
    videoMaxBytes: 209_715_200,
  },
}
