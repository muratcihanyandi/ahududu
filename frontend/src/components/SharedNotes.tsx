import React, { useState, useEffect } from 'react';
import { CheckSquare, Square, Plus, Pin, Trash2, Heart, Film, MapPin, Gift, BookOpen } from 'lucide-react';
import { SharedNote, UserId } from '../types';
import { api } from '../services/api';
import { wsClient } from '../services/websocket';
import { playHaptic } from '../services/haptics';

interface SharedNotesProps {
  currentUserId: UserId;
}

const CATEGORIES = [
  { id: 'all', name: 'Tümü', icon: BookOpen },
  { id: 'movies', name: 'İzlenecekler', icon: Film },
  { id: 'places', name: 'Gezilecek Yerler', icon: MapPin },
  { id: 'wishlist', name: 'İstek Listemiz', icon: Gift },
  { id: 'note', name: 'Özel Notlar', icon: Heart },
];

export const SharedNotes: React.FC<SharedNotesProps> = ({ currentUserId }) => {
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('note');

  useEffect(() => {
    loadNotes();

    const unsubNew = wsClient.on('new_note', () => loadNotes());
    const unsubUpdate = wsClient.on('note_updated', () => loadNotes());
    const unsubDelete = wsClient.on('note_deleted', () => loadNotes());

    return () => {
      unsubNew();
      unsubUpdate();
      unsubDelete();
    };
  }, [activeCategory]);

  const loadNotes = async () => {
    try {
      const cat = activeCategory === 'all' ? undefined : activeCategory;
      const data = await api.listNotes(cat);
      setNotes(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    playHaptic(25);

    try {
      const created = await api.createNote({
        creator: currentUserId,
        title: title.trim(),
        content: content.trim() || undefined,
        category,
      });
      setNotes((prev) => [created, ...prev]);
      setTitle('');
      setContent('');
      setShowAddForm(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleComplete = async (note: SharedNote) => {
    playHaptic(30);
    try {
      const updated = await api.updateNote(note.id, {
        is_completed: !note.is_completed,
      });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: number) => {
    playHaptic(35);
    try {
      await api.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Category Pills & Add Button */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
        <div className="flex items-center gap-1.5">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id);
                  playHaptic(20);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  activeCategory === cat.id
                    ? 'bg-berry-500 text-white shadow-xs'
                    : 'bg-white/80 border border-rose-100 text-stone-600 hover:bg-rose-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cat.name}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-gradient-to-r from-berry-500 to-rose-500 text-white text-xs font-semibold shadow-xs shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Not Ekle
        </button>
      </div>

      {/* Add Note Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateNote}
          className="bg-white rounded-2xl p-4 border border-rose-200/80 shadow-sm space-y-3"
        >
          <input
            type="text"
            placeholder="Ne eklemek istersin? (örn: Interstellar izlenecek)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-rose-100 focus:outline-none focus:ring-2 focus:ring-berry-400"
            autoFocus
          />
          <textarea
            placeholder="Açıklama / detay (isteğe bağlı)..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            className="w-full text-xs px-3 py-2 rounded-xl border border-rose-100 focus:outline-none focus:ring-2 focus:ring-berry-400 resize-none"
          />
          <div className="flex items-center justify-between">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-xl border border-rose-200 bg-white text-stone-700"
            >
              <option value="note">Özel Not</option>
              <option value="movies">İzlenecek Film / Dizi</option>
              <option value="places">Gezilecek Yer</option>
              <option value="wishlist">İstek Listesi</option>
              <option value="shopping">Alışveriş</option>
            </select>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 text-xs text-stone-500"
              >
                İptal
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-berry-500 hover:bg-berry-600 text-white rounded-xl text-xs font-semibold shadow-xs"
              >
                Kaydet
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Notes List */}
      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 bg-white/60 rounded-3xl border border-rose-100 text-center opacity-60">
          <BookOpen className="w-10 h-10 text-berry-400 mb-2 animate-float" />
          <p className="font-serif text-sm font-semibold text-berry-900">
            Henüz not eklenmemiş
          </p>
          <p className="text-xs text-stone-500 mt-1">
            Birlikte yapacağınız planları buraya yazabilirsiniz ✨
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`flex items-start justify-between p-3.5 rounded-2xl border transition-all ${
                note.is_completed
                  ? 'bg-stone-50/70 border-stone-200 opacity-60'
                  : 'bg-white/90 border-rose-100 shadow-xs'
              }`}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <button
                  onClick={() => handleToggleComplete(note)}
                  className="mt-0.5 text-berry-500 hover:text-berry-700 shrink-0"
                >
                  {note.is_completed ? (
                    <CheckSquare className="w-5 h-5 text-berry-600" />
                  ) : (
                    <Square className="w-5 h-5 text-rose-300 hover:text-berry-400" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-semibold text-stone-800 break-words ${
                      note.is_completed ? 'line-through text-stone-400' : ''
                    }`}
                  >
                    {note.title}
                  </p>
                  {note.content && (
                    <p className="text-xs text-stone-500 mt-0.5 break-words">
                      {note.content}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 ml-2 shrink-0">
                <button
                  onClick={() => handleDelete(note.id)}
                  className="p-1.5 text-stone-400 hover:text-rose-500 rounded-lg"
                  title="Sil"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
