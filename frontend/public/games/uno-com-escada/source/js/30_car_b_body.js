// Carroceria: pintura, borrachas, vidros, forro interno e lentes — tudo recortado da mesma pele paramétrica.
const CM = { PAINT: 1, PLASTIC: 2, RUBBER: 3, TIRE: 4, HUBCAP: 5, STEEL: 6, CHROME: 7, INTERIOR: 8, LENS: 9, ALU: 10, STRAP: 11, DECAL: 12, UNDER: 13, REFLECTOR: 14, MIRROR: 15, GRILLE: 16, GLOSS: 17 };
const _cuv = [0, 0];
// patch de um trecho da pele: x0 > x1 (frente → trás), faixa de v, tamanho de célula alvo
function carSub(mb, off, x0, x1, va, vb, cell, opts) {
  const u0 = carUofX(x0), u1 = carUofX(x1);
  opts.nu = Math.max(2, Math.ceil((u1 - u0) * CAR_UT.L / cell)); opts.nv = Math.max(2, Math.ceil((vb - va) * 3.2 / cell)); opts.flip = opts.flip === undefined ? true : opts.flip;
  mb.patch(carSkinFn(off), u0, u1, va, vb, opts);
}
function carBuildBody(mb, gl) {
  const seamUV = (u, v, P) => { _cuv[0] = carSeam(P, v); _cuv[1] = v; return _cuv; };
  const plainUV = (u, v, P) => { _cuv[0] = 1; _cuv[1] = v; return _cuv; };
  const v0 = mb.nv, i0 = mb.ni, gv0 = gl.nv, gi0 = gl.ni;
  // --- pintura ---
  // dois trechos da mesma pele (emenda numa linha da grade): embaixo a aba dos recortes (caixas de roda) é na cor do carro;
  // em cima (janelas, farol, grade) a aba é escura — por dentro não aparece moldura azul em volta dos vidros
  const paintField = (u, v, P) => {
    let f = 1;
    if (v < 0.42) f = carArchF(P);
    else if (v < 0.66) f = Math.min(carWinDoor(P), carWinQuarter(P));
    if (v > 0.6) { f = Math.min(f, carWindshield(P), carHatchGlass(P)); if (P[0] > 1.6) f = Math.min(f, carHeadlight(P), carGrille(P)); }
    // atrás dos para-choques a pele é removida (a borda vertical do corte cai dentro da caixa de roda: nenhuma lasca à vista)
    f = Math.min(f, Math.max(CS.AXF - P[0], P[1] - 0.586), Math.max(P[0] - CS.AXR, P[1] - 0.556));
    return -f;
  };
  const VS = 64 / 152;
  mb.mat(CM.PAINT).color(1, 1, 1);
  mb.patch(carSkinFn(0), 0, 1, 0, VS, { nu: 384, nv: 64, flip: true, uv: seamUV, rim: 0.016, rimMat: m => m.mat(CM.PAINT, 255), field: paintField });
  mb.mat(CM.PAINT).color(1, 1, 1);
  mb.patch(carSkinFn(0), 0, 1, VS, 1, { nu: 384, nv: 100, flip: true, uv: seamUV, rim: 0.016, rimMat: m => m.mat(CM.RUBBER).color(0.018, 0.018, 0.02), field: paintField });
  // --- borrachas das janelas (anel preto sobre a borda do recorte) ---
  const band = (fn, a, b) => (u, v, P) => { const f = fn(P, v); return Math.max(f - b, a - f); };
  mb.mat(CM.RUBBER).color(0.02, 0.02, 0.02);
  carSub(mb, 0.0015, 0.74, -0.39, 0.40, 0.64, 0.012, { field: band(carWinDoor, -0.012, 0.003), uv: plainUV });
  carSub(mb, 0.0015, -0.41, -1.58, 0.40, 0.64, 0.012, { field: band(carWinQuarter, -0.012, 0.003), uv: plainUV });
  carSub(mb, 0.0015, 0.80, 0.02, 0.60, 1, 0.012, { field: band(carWindshield, -0.014, 0.004), uv: plainUV });
  carSub(mb, 0.0015, -1.27, -1.62, 0.60, 1, 0.012, { field: band(carHatchGlass, -0.014, 0.004), uv: plainUV });
  carSub(mb, 0.0012, 1.86, 1.70, 0.62, 1, 0.006, { field: band(carHeadlight, -0.0035, 0.002), uv: plainUV });
  // --- lentes opacas sobrepostas: pisca de canto (âmbar) e lanterna traseira ---
  mb.mat(CM.LENS, 2).color(0.62, 0.3, 0.05);
  carSub(mb, 0.002, 1.84, 1.70, 0.25, 0.86, 0.006, { field: (u, v, P) => carCornerLamp(P, v), uv: (u, v, P) => { _cuv[0] = P[0] + P[2]; _cuv[1] = P[1]; return _cuv; }, rim: 0.004 });
  // lanterna traseira: lente rente à carroceria (saliência de 2,5 mm), dobrando a quina; a moldura escura é desenhada no shader
  mb.mat(CM.LENS, 1).color(0.75, 0.03, 0.02);
  carSub(mb, 0.0025, -1.48, -1.688, 0.12, 0.94, 0.007, { field: (u, v, P) => carTailLamp(P, v) - 0.003, uv: (u, v, P) => { _cuv[0] = (P[2] - CT.z0) / (0.74 - CT.z0); _cuv[1] = (P[1] - CT.y0) / (CT.y1 - CT.y0); return _cuv; }, rim: 0.0025 });
  // pisca lateral no para-lama
  mb.mat(CM.LENS, 2).color(0.5, 0.17, 0.012);
  carSub(mb, 0.003, 0.86, 0.74, 0.2, 0.36, 0.005, { field: (u, v, P) => carRRect(P[0] - 0.797, P[1] - 0.745, 0.026, 0.011, 0.004), uv: plainUV, rim: 0.003 });
  // maçaneta (preta, vertical, na borda traseira da porta) e fechadura
  mb.mat(CM.PLASTIC).color(0.03, 0.03, 0.03);
  carSub(mb, 0.004, -0.30, -0.42, 0.2, 0.37, 0.005, { field: (u, v, P) => carRRect(P[0] + 0.366, P[1] - 0.862, 0.02, 0.055, 0.008), uv: plainUV, rim: 0.004 });
  // fundo das fendas da grade (palhetas pretas)
  mb.mat(CM.GRILLE).color(0.012, 0.012, 0.013);
  carSub(mb, -0.024, 1.86, 1.70, 0.62, 1, 0.012, { field: (u, v, P) => carRRect(P[2], P[1] - 0.694, 0.372, 0.055, 0.005), uv: plainUV });
  // barra central da grade, na cor do carro (malha própria: fina demais para o recorte da pele)
  mb.mat(CM.PAINT, 255).color(1, 1, 1);
  mb.patch((u, v, o) => { o[0] = carTopX(u, v, false) - 0.003; o[1] = v; o[2] = u; }, 0, 0.3565, 0.6845, 0.7045, { nu: 24, nv: 2, flip: true, uv: plainUV });
  mb.quad(carTopX(0.3565, 0.6845, false) - 0.003, 0.6845, 0.3565, carTopX(0, 0.6845, false) - 0.003, 0.6845, 0, carTopX(0, 0.6845, false) - 0.02, 0.6845, 0, carTopX(0.3565, 0.6845, false) - 0.02, 0.6845, 0.3565);
  mb.quad(carTopX(0, 0.7045, false) - 0.003, 0.7045, 0, carTopX(0.3565, 0.7045, false) - 0.003, 0.7045, 0.3565, carTopX(0.3565, 0.7045, false) - 0.02, 0.7045, 0.3565, carTopX(0, 0.7045, false) - 0.02, 0.7045, 0);
  // --- forro interno (visto pelos vidros): portas/laterais escuras, teto claro ---
  const inner = (u, v, P) => -(Math.min(carWinDoor(P), carWinQuarter(P), v > 0.55 ? Math.min(carWindshield(P), carHatchGlass(P)) : 1) - 0.014);
  mb.mat(CM.INTERIOR).color(0.075, 0.078, 0.085);
  carSub(mb, -0.03, 0.80, -1.63, 0.03, 0.60, 0.026, { field: inner, uv: plainUV, flip: false });
  mb.mat(CM.INTERIOR, 1).color(0.2, 0.2, 0.195);
  carSub(mb, -0.03, 0.80, -1.63, 0.60, 1, 0.026, { field: inner, uv: plainUV, flip: false });
  // --- vidros ---
  gl.mat(0).color(0.83, 0.915, 0.88);
  const glz = fn => (u, v, P) => fn(P, v) + 0.008;
  carSub(gl, -0.005, 0.74, -0.39, 0.40, 0.64, 0.02, { field: glz(carWinDoor), uv: plainUV });
  carSub(gl, -0.005, -0.41, -1.58, 0.40, 0.64, 0.02, { field: glz(carWinQuarter), uv: plainUV });
  carSub(gl, -0.005, 0.80, 0.02, 0.60, 1, 0.02, { field: glz(carWindshield), uv: plainUV });
  carSub(gl, -0.005, -1.27, -1.62, 0.60, 1, 0.02, { field: glz(carHatchGlass), uv: plainUV });
  gl.mat(1).color(0.93, 0.95, 0.95);
  carSub(gl, -0.003, 1.86, 1.70, 0.62, 1, 0.012, { field: (u, v, P) => carHeadlight(P) + 0.002, uv: (u, v, P) => { _cuv[0] = P[2]; _cuv[1] = P[1]; return _cuv; } });
  mb.mirror(v0, i0, 2); gl.mirror(gv0, gi0, 2);
}
