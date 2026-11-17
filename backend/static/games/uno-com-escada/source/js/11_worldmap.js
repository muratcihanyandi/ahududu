// Mapas do mundo na GPU (em volta do circuito): altura e zonas (rgba8, 0,5 m/texel).
// Altura em 'rgba16float' (R = altura + H_OFF, em metros), e NÃO 'r32float': a
// maioria das GPUs móveis não tem o recurso float32-filterable, e sem ele r32float
// não pode ser filtrado (nem convive com o amostrador filtrante do grupo 0), o que
// impedia o jogo de abrir no celular. rgba16float é filtrável em todo lugar.
const WM = { height: null, zone: null, x0: 0, z0: 0, sx: 1, sz: 1, zw: 0, zh: 0, zdata: null };
const H_OFF = 512;   // deslocamento para manter as alturas positivas (m)
// float32 → half (IEEE 754 binary16), arredondamento ao mais próximo
const _f2hBuf = new Float32Array(1), _f2hU32 = new Uint32Array(_f2hBuf.buffer);
function floatToHalf(v) {
  _f2hBuf[0] = v;
  const x = _f2hU32[0], sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff, man = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0);      // Inf / NaN
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;                             // taşma → Inf
  if (e <= 0) {                                                    // normal altı / sıfır
    if (e < -10) return sign;
    man |= 0x800000;
    const shift = 14 - e;
    let h = (man + (1 << (shift - 1))) >>> shift;
    return sign | h;
  }
  man = (man + 0x1000) >>> 13;                                     // yuvarla (11 bit mantis)
  if (man === 0x400) { man = 0; e++; if (e >= 0x1f) return sign | 0x7c00; }
  return sign | (e << 10) | man;
}
function worldMapBuild() {
  const dev = G.dev;
  WM.x0 = HF.x0; WM.z0 = HF.z0; WM.sx = HF.w - 1; WM.sz = HF.h - 1;
  // RGBA16F: mevcut veriyi yarı duyarlıklı float'a çevir (R = yükseklik, G/B/A = 0)
  const n = HF.w * HF.h, half = new Uint16Array(n * 4);
  for (let i = 0; i < n; i++) half[i * 4] = floatToHalf(HF.d[i] + H_OFF);
  WM.height = mkTex(HF.w, HF.h, 'rgba16float', TU.TB | TU.CD);
  dev.queue.writeTexture({ texture: WM.height }, half, { bytesPerRow: HF.w * 8 }, [HF.w, HF.h]);
  const zw = WM.zw = (HF.w - 1) * 2 + 1, zh = WM.zh = (HF.h - 1) * 2 + 1, z = WM.zdata = new Uint8Array(zw * zh * 4), loc = new Float64Array(4);
  const enc = (v, lo, hi) => Math.round(sat((v - lo) / (hi - lo)) * 255);
  for (let j = 0; j < zh; j++) for (let i = 0; i < zw; i++) {
    const x = WM.x0 + i * 0.5, zz = WM.z0 + j * 0.5, o = (j * zw + i) * 4;
    if (trackFarDist(x, zz) > 70) { z[o] = 255; z[o + 1] = 0; z[o + 2] = 255; z[o + 3] = 0; continue; }
    trackLocate(x, zz, -1, loc); const d = loc[1], ad = Math.abs(d), i0 = loc[2], f = loc[3], hw = TRK.hw, left = d < 0;
    z[o] = enc(ad - hw, -8, 24);
    const g = trkAt(left ? TRK.gravL : TRK.gravR, i0, f), g0 = hw + 2.4;
    z[o + 1] = enc(g > 1 ? Math.min(ad - g0, g0 + g - ad) : -8, -8, 8);
    const bar = trkAt(left ? TRK.barL : TRK.barR, i0, f);
    z[o + 2] = enc(ad - bar, -1.0, 5.0);
    // concreto: boxes + paddock à direita da reta, base da arquibancada à esquerda
    const s = loc[0], sr = s > TRK.L / 2 ? s - TRK.L : s, p = TRK.pit; let c = -8;
    if (!left) {
      const e = Math.min(1, (sr - p.s0) / 45, (p.s1 - sr) / 45), d0 = lerp(hw, p.laneD0, sat(e)), d1 = lerp(hw + 4.5, p.laneD1, sat(e));
      c = Math.min(d - d0, d1 - d, (sr - p.s0) * 0.25, (p.s1 - sr) * 0.25);
      c = Math.max(c, Math.min(d - p.laneD1 + 0.5, p.padD1 - d, sr - (p.bldS0 - 25), p.bldS1 + 25 - sr));
    } else c = Math.min(-d - (hw + 3.2), d - (TRK.stand.d1 - 8), sr - (TRK.stand.s0 - 12), TRK.stand.s1 + 12 - sr);
    z[o + 3] = enc(c, -8, 8);
  }
  WM.zone = mkTex(zw, zh, 'rgba8unorm', TU.TB | TU.CD);
  dev.queue.writeTexture({ texture: WM.zone }, z, { bytesPerRow: zw * 4 }, [zw, zh]);
}
