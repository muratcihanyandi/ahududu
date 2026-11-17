"""ChatView'a sayfalama (eski mesaj yükleme) ekler."""
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

p = pathlib.Path("frontend/src/components/ChatView.tsx")
t = p.read_text(encoding="utf-8")

# 1) PAGE_SIZE sabiti
marker = "/** Kısa bir bilgi baloncuğu göster (teknik terimsiz, sıcak dil). */"
page_const = """/**
 * Bir seferde yüklenecek mesaj sayfası. Sohbet geçmişi on binlerce mesaj
 * olabildiği için (WhatsApp aktarımı) hepsi birden indirilmez: en son sayfa
 * açılır, yukarı kaydırdıkça eskileri istenir.
 */
const PAGE_SIZE = 60;

"""
if "const PAGE_SIZE = 60;" not in t:
    assert marker in t, "marker yok"
    t = t.replace(marker, page_const + marker, 1)
    print("PAGE_SIZE eklendi")

# 2) loadOlderRef tanımını yukarı taşı (handleListScroll'dan önce)
old_decl = """  const loadOlderRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    loadOlderRef.current = async () => {"""
new_decl = """  useEffect(() => {
    loadOlderRef.current = async () => {"""
assert old_decl in t, "loadOlder decl yok"
t = t.replace(old_decl, new_decl, 1)

refs_anchor = "  const isLoadingOlderRef = useRef(false);"
refs_new = (
    refs_anchor
    + "\n  /** Yukarı kaydırınca çalışacak \"eski sayfayı yükle\" fonksiyonu. */"
    + "\n  const loadOlderRef = useRef<() => Promise<void>>(async () => {});"
)
assert refs_anchor in t
t = t.replace(refs_anchor, refs_new, 1)
print("loadOlderRef yukarı taşındı")

# 3) deps düzelt
t = t.replace("  }, [hasMoreOlder, PAGE_SIZE]);", "  }, [hasMoreOlder]);", 1)

p.write_text(t, encoding="utf-8")
print("ok")
