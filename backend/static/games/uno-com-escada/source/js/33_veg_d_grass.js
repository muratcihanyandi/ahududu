// Vegetação — grama em anéis (GPU). Culling por bloco na CPU, sem alocação por quadro.
const GRASS = {
  // anel: célula (m), células por bloco, blocos por lado, segmentos, [entra0, entra1, sai0, sai1] em DISTÂNCIA EFETIVA
  // (distância à câmera × zoom da lente: 1 m efetivo = o que a câmera de perseguição vê a 1 m), largura base, anel anterior
  // (o anel aparece onde o anterior não cobre: fora da área dele ou além do seu alcance).
  // Os anéis são centrados no PONTO DE INTERESSE: perto da câmera nas câmeras de perseguição/capô, no carro nas câmeras de TV
  // (a lente longa enquadra um gramado a 30–400 m da câmera: é lá que as lâminas precisam existir).
  // K = 0: anel de tufos (cartão com a textura de capim do atlas: dezenas de lâminas finas por cartão)
  rings: [
    { cell: 0.075, bs: 36, B: 10, K: 3, q: [-1, -0.5, 7.2, 11.2], w: 0.0095, prev: -1 },   // primeiro plano: lâminas finas e densas (178/m²)
    { cell: 0.13, bs: 40, B: 12, K: 2, q: [7.5, 10.5, 26, 31.5], w: 0.017, prev: 0 },      // lâminas (59/m²), aparada e alta
    { cell: 0.38, bs: 48, B: 10, K: 0, q: [9, 16, 64, 82], w: 0.36, prev: 1 },
    // anel de touceiras grandes e esparsas: encostas distantes
    { cell: 0.6, bs: 48, B: 14, K: 0, q: [58, 80, 225, 268], w: 0.8, prev: 2 },
    // anel só das lentes longas (câmeras de TV): touceiras além do anel anterior, para a encosta do fundo do plano não ficar lisa
    { cell: 0.9, bs: 64, B: 14, K: 0, q: [215, 262, 480, 545], w: 1.1, prev: 3, tele: 1 },
    // lâminas largas e esparsas (17/m², um triângulo cada) além do anel 1: o gramado junto à pista tem relevo até ~70 m,
    // sem fronteira entre "tapete com lâminas" e textura lisa (fica no fim da lista para não mudar o índice dos anéis de tufos)
    { cell: 0.24, bs: 40, B: 16, K: 1, q: [23, 30, 58, 74], w: 0.03, prev: 1 },
  ],
  u: new Float32Array(6 * 64), dyn: new Uint32Array(1), blades: 0, cx: new Float64Array(6), cz: new Float64Array(6),
  // MOBİL: çim çizim menzili katsayısı (1 = tam). Yalnızca menzil kısalır;
  // anel dizisi ve shader aynı kalır, arada boşluk oluşmaz.
  mobileRange: (typeof G !== 'undefined' && G.mobile) ? 0.78 : 1,
};
function grassBuild() {
  const dev = G.dev, V = VEG;
  // máscara de mata (2 m/texel) na área dos mapas do mundo
  const fw = Math.ceil(HF.w / 2), fh = Math.ceil(HF.h / 2), fd = new Uint8Array(fw * fh);
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) fd[j * fw + i] = Math.round(255 * forestAt(HF.x0 + i * 2, HF.z0 + j * 2));
  const ft = mkTex(fw, fh, 'r8unorm', TU.TB | TU.CD); dev.queue.writeTexture({ texture: ft }, fd, { bytesPerRow: fw }, [fw, fh]);
  GRASS.fam = mkFamily('vegGrass', { src: 'veg_grass', buffers: [], cull: 'none', topology: 'triangle-strip', noShadow: true, noCube: true });
  GRASS.buf = mkBuf(GRASS.u.byteLength, BU.U);
  GRASS.bg = dev.createBindGroup({ layout: GRASS.fam.bgl3, entries: [{ binding: 0, resource: ft.createView() }, { binding: 1, resource: { buffer: GRASS.buf, size: 96 } }, { binding: 2, resource: V.leafView }] });
  R.drawables.push({
    draw(pass, ctx) {
      if (ctx.kind !== KIND.GBUF || !V.onGrass) return; const pipe = GRASS.fam.pipe[0]; if (!pipe) return;
      const camx = R.cam.pos[0], camy = R.cam.pos[1], camz = R.cam.pos[2], u = GRASS.u; GRASS.blades = 0;
      // fora da área dos mapas não há grama
      if (camx < WM.x0 - 80 || camz < WM.z0 - 80 || camx > WM.x0 + WM.sx + 80 || camz > WM.z0 + WM.sz + 80) return;
      // zoom da lente (1 = câmera de perseguição) ve ponto de interesse
      let zfac = Math.tan(R.cam.fovy * 0.5) * 2; if (zfac > 1.3) zfac = 1.3;
      // MOBİL: çim menzili %22 kısalır. Çim, ilk karelerdeki en pahalı tek
      // sistem (blok başına yüzlerce bıçak); 60-80 m ötesi zaten tüylü doku
      // ile örtülüyor, bu yüzden görüntüde fark edilmez.
      const f = FR.data, px = f[FO.carMat + 12], pz = f[FO.carMat + 14], ddx = px - camx, ddz = pz - camz, dcc = Math.sqrt(ddx * ddx + ddz * ddz);
      let wf = (dcc - 12) / 18; wf = wf < 0 ? 0 : wf > 1 ? 1 : wf;
      const fx = R.cam.fwd[0], fz = R.cam.fwd[2];
      // o anel de lente longa entra aos poucos conforme o zoom fecha (sem estalo na troca)
      let zf = (0.62 - zfac) * 5; zf = zf < 0 ? 0 : zf > 1 ? 1 : zf; const nr = GRASS.rings.length;
      for (let r = 0; r < GRASS.rings.length; r++) {
        const g = GRASS.rings[r], bsz = g.cell * g.bs, o = r * 64, half = bsz * g.B * 0.5;
        // centro: câmera (adiantado na direção do olhar: atrás da câmera não se vê grama) → carro, conforme a distância câmera–carro
        const ccx = camx + fx * half * 0.35 * (1 - wf) + ddx * wf, ccz = camz + fz * half * 0.35 * (1 - wf) + ddz * wf;
        const obx = Math.floor(ccx / bsz) - g.B / 2, obz = Math.floor(ccz / bsz) - g.B / 2; GRASS.cx[r] = (obx + g.B / 2) * bsz; GRASS.cz[r] = (obz + g.B / 2) * bsz;
        u[o] = g.cell; u[o + 1] = g.bs; u[o + 2] = g.B; u[o + 3] = g.K; u[o + 4] = g.q[0]; u[o + 5] = g.q[1]; u[o + 6] = g.q[2]; u[o + 7] = g.q[3];
        u[o + 8] = g.w; u[o + 9] = r; u[o + 10] = obx; u[o + 11] = obz;
        u[o + 12] = g.tele ? zf : 1; u[o + 13] = half; u[o + 14] = GRASS.cx[r]; u[o + 15] = GRASS.cz[r];
        const pv = g.prev; u[o + 16] = zfac; u[o + 17] = pv >= 0 ? GRASS.rings[pv].cell * GRASS.rings[pv].bs * GRASS.rings[pv].B * 0.5 : 0; u[o + 18] = pv >= 0 ? GRASS.cx[pv] : 0; u[o + 19] = pv >= 0 ? GRASS.cz[pv] : 0;
      }
      G.dev.queue.writeBuffer(GRASS.buf, 0, u);
      pass.setPipeline(pipe);
      for (let r = 0; r < nr; r++) {
        const g = GRASS.rings[r]; if (g.tele && zf <= 0) continue;
        const bsz = g.cell * g.bs, o = r * 64, ox = u[o + 10], oz = u[o + 11], B = g.B, per = g.bs * g.bs, nv = g.K ? 2 * g.K + 1 : 4, rad = bsz * 0.7072 + 1.2;
        const pv = g.prev, ph = pv >= 0 ? u[o + 17] * 0.8 : 0, pcx = u[o + 18], pcz = u[o + 19], qin = g.q[0], qout = g.q[3];
        // MOBİL: menzil kısalır; TV lente aneli (r>=4) daha da dar
        const GR = GRASS.mobileRange * (r >= 4 ? 0.5 : 1);
        GRASS.dyn[0] = r * 256; pass.setBindGroup(3, GRASS.bg, GRASS.dyn, 0, 1);
        for (let bz = 0; bz < B; bz++) {
          let run = -1;
          for (let bx = 0; bx <= B; bx++) {
            let vis = false;
            if (bx < B) {
              const x = (ox + bx + 0.5) * bsz, z = (oz + bz + 0.5) * bsz, dx = x - camx, dz = z - camz, d = Math.sqrt(dx * dx + dz * dz);
              // bloco além do alcance (em distância efetiva), ou todo dentro da cobertura do anel anterior: não desenha
              let ok = (d - rad) * zfac < qout * GR;
              if (ok && pv >= 0 && (d + rad) * zfac < qin * GR) { const ex = x - pcx, ez = z - pcz, ax = ex < 0 ? -ex : ex, az = ez < 0 ? -ez : ez; if ((ax > az ? ax : az) + bsz * 0.5 < ph) ok = false; }
              // blocos fora da área dos mapas do mundo não têm grama (e hfAtQ cairia no cálculo lento do terreno)
              if (ok && x > HF.x0 + 2 && z > HF.z0 + 2 && x < HF.x0 + HF.w - 3 && z < HF.z0 + HF.h - 3) vis = (SQ[0] = x, SQ[1] = (_gq[0] = x, _gq[1] = z, hfAtQ(_gq), _gq[6]) + 0.3, SQ[2] = z, SQ[3] = rad, sphereQ(ctx.planes, ctx.nPlanes));
            }
            if (vis && run < 0) run = bx;
            else if (!vis && run >= 0) { pass.draw(nv, (bx - run) * per, 0, (bz * B + run) * per); GRASS.blades += (bx - run) * per; run = -1; }
          }
        }
      }
    }
  });
}
