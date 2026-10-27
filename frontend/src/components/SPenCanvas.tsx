import React, { useRef, useState, useEffect } from 'react';
import { Eraser, Undo, Trash2, PenTool, Sparkles, Check } from 'lucide-react';
import { playHaptic } from '../services/haptics';

interface Point {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  points: Point[];
  color: string;
  size: number;
  isEraser: boolean;
}

interface SPenCanvasProps {
  onSave?: (dataUrl: string, strokesJson: string) => void;
  initialStrokesJson?: string;
  readOnly?: boolean;
}

const INK_COLORS = [
  { name: 'Ahududu', value: '#be185d' },
  { name: 'Gül Kurusu', value: '#831843' },
  { name: 'Mürekkep', value: '#1e1b4b' },
  { name: 'Zümrüt', value: '#065f46' },
  { name: 'Balmumu Altın', value: '#d97706' },
];

export const SPenCanvas: React.FC<SPenCanvasProps> = ({
  onSave,
  initialStrokesJson,
  readOnly = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#be185d');
  const [brushSize, setBrushSize] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentStrokeRef = useRef<Point[]>([]);

  // Initialize and load initial strokes if provided
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Resize canvas to match display size
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    if (initialStrokesJson) {
      try {
        const loaded = JSON.parse(initialStrokesJson);
        setStrokes(loaded);
        redrawAll(loaded);
      } catch (e) {
        console.error('Error loading strokes:', e);
      }
    }
  }, [initialStrokesJson]);

  const redrawAll = (strokeList: Stroke[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    strokeList.forEach((st) => {
      if (st.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = st.isEraser ? '#fffdf7' : st.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < st.points.length - 1; i++) {
        const p1 = st.points[i];
        const p2 = st.points[i + 1];
        const avgPressure = (p1.pressure + p2.pressure) / 2 || 0.5;
        ctx.lineWidth = st.size * (0.6 + avgPressure * 0.8);

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      }
      ctx.stroke();
    });
  };

  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, pressure: 0.5 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDrawing(true);
    const point = getCanvasCoords(e);
    currentStrokeRef.current = [point];

    // Subtle haptic tick for S-Pen initial touch
    if (e.pointerType === 'pen') {
      playHaptic(15);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || readOnly) return;
    const point = getCanvasCoords(e);
    currentStrokeRef.current.push(point);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const points = currentStrokeRef.current;
    if (points.length > 1) {
      const p1 = points[points.length - 2];
      const p2 = points[points.length - 1];
      const avgPressure = (p1.pressure + p2.pressure) / 2 || 0.5;

      ctx.beginPath();
      ctx.strokeStyle = isEraser ? '#fffdf7' : color;
      ctx.lineWidth = brushSize * (0.6 + avgPressure * 0.8);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      ctx.stroke();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || readOnly) return;
    setIsDrawing(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}

    if (currentStrokeRef.current.length > 0) {
      const newStroke: Stroke = {
        points: [...currentStrokeRef.current],
        color,
        size: brushSize,
        isEraser,
      };
      const updated = [...strokes, newStroke];
      setStrokes(updated);
      currentStrokeRef.current = [];
    }
  };

  const handleUndo = () => {
    if (strokes.length === 0) return;
    playHaptic(30);
    const updated = strokes.slice(0, -1);
    setStrokes(updated);
    redrawAll(updated);
  };

  const handleClear = () => {
    playHaptic(50);
    setStrokes([]);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  };

  const handleSave = () => {
    playHaptic(40);
    const canvas = canvasRef.current;
    if (!canvas || !onSave) return;
    const dataUrl = canvas.toDataURL('image/png');
    const strokesJson = JSON.stringify(strokes);
    onSave(dataUrl, strokesJson);
  };

  return (
    <div className="flex flex-col h-full bg-parchment-light rounded-2xl shadow-sm border border-rose-200/60 overflow-hidden">
      {!readOnly && (
        <div className="flex items-center justify-between px-3 py-2 bg-rose-50/70 border-b border-rose-100">
          {/* Colors */}
          <div className="flex items-center gap-1.5">
            {INK_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => {
                  setColor(c.value);
                  setIsEraser(false);
                  playHaptic(20);
                }}
                className={`w-6 h-6 rounded-full transition-transform ${
                  color === c.value && !isEraser
                    ? 'ring-2 ring-offset-1 ring-berry-500 scale-110'
                    : 'opacity-85 hover:opacity-100'
                }`}
                style={{ backgroundColor: c.value }}
                title={c.name}
              />
            ))}
          </div>

          {/* Tools: Eraser, Undo, Clear, Save */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setIsEraser(!isEraser);
                playHaptic(25);
              }}
              className={`p-1.5 rounded-lg text-sm transition-colors ${
                isEraser
                  ? 'bg-berry-500 text-white shadow-sm'
                  : 'bg-white text-stone-600 hover:bg-rose-100'
              }`}
              title="Silgi"
            >
              <Eraser className="w-4 h-4" />
            </button>
            <button
              onClick={handleUndo}
              disabled={strokes.length === 0}
              className="p-1.5 rounded-lg bg-white text-stone-600 hover:bg-rose-100 disabled:opacity-40"
              title="Geri Al"
            >
              <Undo className="w-4 h-4" />
            </button>
            <button
              onClick={handleClear}
              className="p-1.5 rounded-lg bg-white text-stone-600 hover:bg-rose-100"
              title="Temizle"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            {onSave && (
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-berry-500 hover:bg-berry-600 text-white text-xs font-semibold shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                Mektuba Ekle
              </button>
            )}
          </div>
        </div>
      )}

      {/* Drawing Surface with romantic paper background texture */}
      <div className="relative flex-1 w-full min-h-[360px] bg-parchment touch-none cursor-crosshair">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute inset-0 w-full h-full"
          style={{ touchAction: 'none' }}
        />
        {strokes.length === 0 && !readOnly && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
            <PenTool className="w-8 h-8 text-berry-400 mb-2 stroke-[1.5]" />
            <p className="font-handwriting text-2xl text-berry-700">
              S-Pen veya parmağınla kalbinden geçeni çiz...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
