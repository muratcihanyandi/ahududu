// Faixa da pista. uv = (s, d). cor do vértice: r = trajetória (afastamento/hw*0.5+0.5), g = zona molhada, b = curva, a = presença de zebra.
// material: 0 asfalto, 1 zebra (vira chão onde não há zebra), 2 acostamento (chão)
#include mesh_vert
#include world_ground
fn aaLine(x: f32, halfW: f32, aa: f32) -> f32 { return 1.0 - smoothstep(halfW - aa, halfW + aa, abs(x)); }
fn asphaltSurf(in: V2F) -> Surface {
  var sf = surfDefault(normalize(in.nrm));
  let Ng = sf.normal;
  let s = in.uv.x; let d = in.uv.y; let xz = in.wpos.xz;
#ifdef PASS_CUBE
  let dist = distance(in.wpos, P.camPos.xyz);
#else
  let dist = distance(in.wpos, F.camPos.xyz);
#endif
  let near = 1.0 - smoothstep(15.0, 80.0, dist); let near2 = 1.0 - smoothstep(3.0, 22.0, dist);
  let aaD = max(fwidth(d), 0.0015); let aaS = max(fwidth(s), 0.0015);
  let n1 = textureSample(tNoise, sLin, xz * 0.0293);
  let n2 = textureSample(tNoise, sLin, vec2f(xz.x * 0.8 - xz.y * 0.6, xz.x * 0.6 + xz.y * 0.8) * 0.33);
  // agregado: duas escalas, cada uma com duas amostras giradas (sem grade periódica). Não há corte por distância:
  // os mips levam o grão à média sozinhos, então o tom de perto e de longe é o mesmo.
  let n3 = (textureSample(tNoise, sLin, xz * 0.93) + textureSample(tNoise, sLin, vec2f(xz.x * 0.342 - xz.y * 0.94, xz.x * 0.94 + xz.y * 0.342) * 0.71 + 0.41)) * 0.5;
  let n4 = (textureSample(tNoise, sLin, vec2f(xz.x * 0.6 + xz.y * 0.8, -xz.x * 0.8 + xz.y * 0.6) * 3.1) + textureSample(tNoise, sLin, vec2f(xz.x * 0.966 + xz.y * 0.259, -xz.x * 0.259 + xz.y * 0.966) * 2.37 + 0.23)) * 0.5;
  // ---- recapeamentos: trechos com tons diferentes, emenda transversal entre eles ----
  let secLen = 52.0; let sqv = (s + (n1.r - 0.5) * 1.6 + (n2.r - 0.5) * 0.35) / secLen; let sec = floor(sqv);   // emenda sinuosa, não uma reta
  let h1 = hash11(sec * 1.37 + 3.1); let h0 = hash11((sec - 1.0) * 1.37 + 3.1);
  var tone = 0.86 + 0.3 * h1;
  // remendo de meia pista em alguns trechos
  let hp = hash11(sec * 7.9 + 1.7);
  let patchOn = step(0.62, hp); let pe = (hp - 0.62) * 9.0 - 1.7 + (n2.r - 0.5) * 0.08 + (n1.g - 0.5) * 0.7;      // borda lateral do remendo
  let fs = fract(sqv) * secLen;
  let p1 = 30.0 + 14.0 * h1;
  let inPatch = patchOn * smoothstep(-aaD - 0.06, aaD + 0.06, d - pe) * smoothstep(-aaS - 0.06, aaS + 0.06, fs - 6.0) * (1.0 - smoothstep(-aaS - 0.06, aaS + 0.06, fs - p1));
  tone = mix(tone, 0.82 + 0.26 * h0, inPatch);
  // emendas: linhas de piche finas, irregulares e interrompidas (nunca um risco preto contínuo)
  let brk = smoothstep(0.3, 0.55, n2.b) * (0.5 + 0.5 * n1.a);                 // falhas ao longo da linha
  let seamT = min(fs, secLen - fs) + (n2.r - 0.5) * 0.05;
  var tar = aaLine(seamT, 0.011, aaS) * 0.7 * brk;
  let pEdge = patchOn * max(aaLine(d - pe, 0.006, aaD) * step(6.0, fs) * step(fs, p1), max(aaLine(fs - 6.0 + (n2.g - 0.5) * 0.04, 0.006, aaS), aaLine(fs - p1 + (n2.g - 0.5) * 0.04, 0.006, aaS)) * step(pe, d));
  tar = max(tar, pEdge * 0.45 * brk);
  // junta longitudinal no eixo: quase apagada, só em trechos
  tar = max(tar, aaLine(d - 0.12 - (n1.g - 0.5) * 0.25, 0.005, aaD) * 0.3 * smoothstep(0.5, 0.7, n1.r) * brk);
  // trincas seladas: pedaços curtos de linhas sinuosas, só onde o asfalto é mais velho
  let cv = n1.b * 0.55 + n2.g * 0.45 - 0.5; let cw = max(fwidth(cv), 1e-4);
  let old = smoothstep(0.55, 0.85, h1) * (1.0 - inPatch);
  let crack = (1.0 - smoothstep(0.0, cw * 0.9 + 0.0003, abs(cv))) * old * smoothstep(0.52, 0.66, n1.r) * smoothstep(0.45, 0.6, n2.r);
  tar = max(tar, crack * 0.75);
  tar *= 1.0 - smoothstep(25.0, 90.0, dist) * 0.7;
  // ---- base: agregado ----
  // base: asfalto cinza-escuro neutro (albedo ≈ 0,055) com manchas de 3–6 m e de 15–20 m; o mesmo tom ao sol e na sombra
  let nM = textureSample(tNoise, sLin, vec2f(xz.x * 0.8 + xz.y * 0.6, -xz.x * 0.6 + xz.y * 0.8) * 0.0061 + 0.27);
  var alb = vec3f(0.083, 0.081, 0.078) * tone * (0.74 + 0.52 * n2.r) * (0.66 + 0.68 * n1.r) * (0.76 + 0.48 * nM.g);
  // manchas de média escala que sobrevivem à distância e à lente longa: óleo/piche (0,5–2 m) e áreas mais gastas e claras
  let stain = smoothstep(0.6, 0.76, n2.b * 0.55 + n3.g * 0.5);
  let dust = smoothstep(0.58, 0.8, n2.g * 0.6 + n1.b * 0.5);
  alb *= (1.0 - 0.42 * stain) * (1.0 + 0.34 * dust);
  // ---- micro-detalhe: agregado de 3–8 mm com contraste de albedo BAIXO (±8%). A cara de asfalto vem do relevo fino
  // (normal) com brilho rasante suave e da variação de média escala, não de pintas claras e escuras.
  let stones = smoothstep(0.58, 0.8, n4.b);
  let n5 = textureSample(tNoise, sLin, xz * 9.7 + 0.13);                                                  // células de ~4 mm
  let n6 = textureSample(tNoise, sLin, vec2f(xz.x * 0.6 + xz.y * 0.8, -xz.x * 0.8 + xz.y * 0.6) * 5.9 + 0.19);   // células de ~7 mm
  let grain = (n5.b - 0.55) + (n6.b - 0.55) * 0.8;
  alb *= 1.0 + grain * 0.085 + (n3.b - 0.5) * 0.05;
  let cav = smoothstep(-0.3, 0.2, grain);                                   // cavidades entre os grãos
  let pale = smoothstep(0.8, 0.94, n5.b) * smoothstep(0.5, 0.7, n6.b);      // raras pedrinhas claras expostas
  alb = mix(alb, alb * 1.5 + 0.01, pale * 0.35);
  // rugosidade 0,76–0,9: agregado polido (manchas gastas, pedras expostas) brilha um pouco sob luz rasante
  var rough = 0.88 - 0.05 * stones - 0.05 * smoothstep(0.45, 0.75, n1.g) - 0.06 * stain + 0.02 * cav;
  // ---- borracha na trajetória ----
  let lineD = (in.col.r * 2.0 - 1.0) * TRK_HW; let dl = d - lineD;
  let streak = 0.55 + 0.45 * textureSample(tNoise, sLin, vec2f(d * 0.9, s * 0.012)).r;
  // a borracha não é uma faixa de tinta: largura e intensidade variam ao longo da pista (forte nas freadas e saídas de curva —
  // in.col.b —, falhada nas retas), com manchas que somem e voltam
  let along = textureSample(tNoise, sLin, vec2f(s * 0.0043, 0.31)); let along2 = textureSample(tNoise, sLin, vec2f(s * 0.021, 0.77));
  let rsig = 1.35 * (0.6 + 0.7 * along.g);
  let rint = (0.16 + 0.84 * in.col.b) * (0.35 + 0.65 * smoothstep(0.3, 0.62, along.r)) * (0.6 + 0.4 * along2.b);
  let rub = exp(-dl * dl / (2.0 * rsig * rsig)) * rint * streak;
  // dois sulcos de roda mais marcados
  let rutG = exp(-sq(abs(dl) - 0.68) / 0.09);
  let ruts = rutG * rint * streak;
  let rb = sat(rub * 1.05 + ruts * 0.5);
  alb = mix(alb, alb * vec3f(0.2, 0.2, 0.215), rb);
  rough = mix(rough, 0.95, rb);
  // marcas de frenagem antes das curvas (byte a do material = intensidade): pares de riscos escuros, descontínuos
  let bz = matA(in.mat);
  if (bz > 0.01) {
    let bn = textureSample(tNoise, sLin, vec2f(d * 1.7, s * 0.021 + 0.4));
    let bn2 = textureSample(tNoise, sLin, vec2f(d * 0.35 + 0.3, s * 0.006));
    let off = (bn2.g - 0.5) * 1.6;                                     // cada frenagem um pouco deslocada
    let pair = exp(-sq(abs(dl - off) - 0.68) / 0.012) + 0.6 * exp(-sq(abs(dl + off * 0.7 - 0.9) - 0.66) / 0.014);
    let bm = sat(pair * smoothstep(0.42, 0.6, bn.r) * (0.4 + 0.6 * smoothstep(0.35, 0.65, bn2.r)) * bz * 1.3);
    alb = mix(alb, alb * 0.26, bm); rough = mix(rough, 0.95, bm);
  }
  // desgaste claro (polido) fora da trajetória
  let wear = smoothstep(0.5, 0.8, n2.b * 0.5 + n1.g * 0.6) * 0.22 * (1.0 - rb);
  alb = mix(alb, alb * 1.3 + 0.006, wear); rough = mix(rough, 0.77, wear);
  // piche das emendas e trincas: cinza-escuro, um pouco mais liso
  alb = mix(alb, alb * 0.38 + vec3f(0.004), tar); rough = mix(rough, 0.74, tar);
  {
    let dn = textureSample(tNoise, sLin, vec2f(s * 0.0037 + 0.21, d * 0.045)).g * 0.6 + n1.b * 0.4;
    let dampG = smoothstep(0.6, 0.74, dn) * (1.0 - smoothstep(0.0, 0.2, in.col.g));
    alb = mix(alb, alb * 0.72, dampG); rough = mix(rough, 0.88, dampG * 0.6);
  }
  // borda do asfalto irregular: terra e grama invadindo os últimos centímetros (a divisa não é uma reta limpa)
  {
    let eN = abs(d) - TRK_HW + 0.1 + (n2.g - 0.5) * 0.34 + (n3.r - 0.5) * 0.12 + (n1.a - 0.5) * 0.16;
    let dirt = smoothstep(-0.05, 0.03, eN);
    let dcol = mix(vec3f(0.085, 0.068, 0.045), COL_GRASS * 0.9, smoothstep(0.02, 0.12, eN) * (0.4 + 0.6 * n3.g)) * (0.7 + 0.6 * n4.g);
    alb = mix(alb, dcol, dirt * 0.9); rough = mix(rough, 0.95, dirt);
  }
  // ---- pintura ----
  let chip = 0.72 + 0.28 * smoothstep(0.25, 0.55, n3.b + (n2.g - 0.5) * 0.6);
  var paint = aaLine(abs(d) - (TRK_HW - 0.23), 0.09, aaD) * chip;
  // linha de largada: xadrez de 3 fileiras
  var sw = s; if (sw > TRK_LEN * 0.5) { sw -= TRK_LEN; }
  let inSF = aaLine(sw, 0.6, aaS) * step(abs(d), TRK_HW - 0.34);
  let chk = step(0.5, fract(floor((sw + 0.6) / 0.4) * 0.5 + floor((d + 20.0) / 0.4) * 0.5 + 0.25));
  // vagas do grid (10), alternando os lados a cada 8 m
  let q = (-11.9 - sw) / 8.0; let k = floor(q + 0.02); let u = (q - k) * 8.0;
  let dc = d - select(1.6, -1.6, (i32(k) & 1) == 0);
  let slot = max(aaLine(u - 0.07, 0.07, aaS) * step(abs(dc), 1.25), aaLine(abs(dc) - 1.19, 0.06, aaD) * step(u, 1.35) * step(0.0, u)) * step(0.0, k) * step(k, 9.0);
  paint = max(paint, slot * chip);
  {
    let on = step(0.0, k) * step(k, 9.0);
    let ob = textureSample(tNoise, sLin, vec2f(u * 0.21 + k * 0.37, dc * 0.3 + 0.11));
    let oil = on * sat(exp(-(sq(u - 2.3) / 1.6 + sq(dc) / 0.45)) * 1.5 - 0.25 + (ob.r - 0.5) * 0.9);
    let drip = on * smoothstep(0.72, 0.8, ob.b) * exp(-sq(dc) / 0.8) * step(0.8, u) * step(u, 5.5) * 0.7;
    let om = sat(max(oil, drip));
    alb = mix(alb, alb * 0.5, om); rough = mix(rough, 0.62, om);
  }
  let white = vec3f(0.66, 0.66, 0.63) * (0.8 + 0.2 * n2.r);
  alb = mix(alb, white * mix(1.0, 0.45, rb * 0.8), paint * 0.95 * (1.0 - 0.75 * smoothstep(-0.02, 0.04, abs(d) - TRK_HW + 0.1 + (n2.g - 0.5) * 0.34 + (n3.r - 0.5) * 0.12 + (n1.a - 0.5) * 0.16)));
  alb = mix(alb, mix(vec3f(0.02), white, chk), inSF);
  rough = mix(rough, 0.55, max(paint, inSF) * 0.8);
  // ---- microrelevo ----
  var grad = (n3.rg - 0.5) * 0.14 * near + (n4.rg - 0.5) * 0.4 * near2 + (n2.rg - 0.5) * 0.04 * near + ((n5.rg - 0.5) * 0.75 + (n6.rg - 0.5) * 0.55) * near2;
  grad *= 1.0 - 0.6 * max(paint, tar);
  rough += 0.05 * (1.0 - near2);            // longe: o relevo que some vira rugosidade
  var N = bumpXZ(Ng, grad);
  // ---- trechos molhados ----
  var wet = 0.0;
  if (in.col.g > 0.001) {
    // "profundidade" da água: depressões de baixa frequência + sulcos das rodas + beira da pista; borda orgânica por ruído fino
    let lo = textureSample(tNoise, sLin, vec2f(s * 0.0125 + 0.37, d * 0.062)).r * 0.56 + textureSample(tNoise, sLin, vec2f(s * 0.031, d * 0.11 + 0.4)).g * 0.24 + textureSample(tNoise, sLin, xz * 0.047 + 0.13).r * 0.2;
    let fine = (n2.r - 0.5) * 0.02 + (n3.r - 0.5) * 0.035 + (n4.r - 0.5) * 0.012;    // a borda segue o agregado: nítida e irregular, não uma máscara mole
    let edge = smoothstep(2.4, 5.2, abs(d)) * 0.05 + rutG * 0.085;      // a água junta nos trilhos de roda e na beira
    let lvl = lo + fine + edge - mix(0.78, 0.665, in.col.g);
    // seco → úmido (halo largo, escurece e alisa um pouco) → filme d'água → lâmina. Tudo em rampas largas: sem borda dura.
    let lw = fwidth(lvl) * 0.75;                                        // largura de 1 pixel em unidades do nível
    let damp = smoothstep(-0.09, -0.035, lvl);
    let film = smoothstep(-0.05 - lw, 0.02 + lw, lvl);
    let pud = smoothstep(0.015 - lw, 0.07 + lw, lvl);
    alb = mix(alb, alb * 0.8, damp);
    alb = mix(alb, alb * 0.55, pud);                                       // água sobre asfalto escuro: fundo mais escuro, nada leitoso
    rough = mix(rough, 0.6, damp * 0.8); rough = mix(rough, 0.36, film); rough = mix(rough, 0.09, pud * pud);
    // normal: o filme ainda segue o agregado; a lâmina é plana, com ondulação leve do vento
    let rp = (textureSampleLevel(tNoise, sLin, xz * 0.31 + 0.17, 1.0).rg - 0.5) * 0.016 + (textureSampleLevel(tNoise, sLin, xz * 0.11 + 0.4, 0.0).rg - 0.5) * 0.014;
    N = normalize(mix(N, bumpXZ(Ng, grad * 0.35), film));
    N = normalize(mix(N, bumpXZ(Ng, rp), pud));
    // reflexo em espaço de tela entra aos poucos com o filme e fica total na lâmina
    wet = film * 0.2 + pud * 0.7;
  }
  sf.albedo = alb; sf.rough = rough; sf.normal = N; sf.wet = wet;
  sf.ao = (1.0 - tar * 0.3) * mix(1.0, 0.84 + 0.16 * cav, 1.0 - wet);
  return sf;
}
fn kerbSurf(in: V2F) -> Surface {
  var sf = surfDefault(normalize(in.nrm));
  let s = in.uv.x; let x = abs(in.uv.y) - TRK_HW;       // 0 na borda do asfalto .. KERB_WID
#ifdef PASS_CUBE
  let dist = distance(in.wpos, P.camPos.xyz);
#else
  let dist = distance(in.wpos, F.camPos.xyz);
#endif
  let near = 1.0 - smoothstep(6.0, 40.0, dist);
  let n1 = textureSample(tNoise, sLin, in.wpos.xz * 0.11);
  let n2 = textureSample(tNoise, sLin, in.wpos.xz * 0.9); let n3 = textureSample(tNoise, sLin, in.wpos.xz * 6.1);
  let aaS = max(fwidth(s), 0.002);
  let ph = s / 5.0; let f = fract(ph);
  let red = smoothstep(0.5 - aaS / 5.0, 0.5 + aaS / 5.0, abs(f - 0.5) * 2.0);   // 2,5 m vermelho / 2,5 m branco
  var alb = mix(vec3f(0.5, 0.5, 0.48), vec3f(0.3, 0.005, 0.004), red);         // vermelho escuro saturado, tinta fosca
  alb *= 0.8 + 0.28 * n2.r;
  // ---- dentes transversais (ranhuras de 30 cm): relevo com sombra própria. A amplitude cai suavemente com o tamanho do
  // dente na tela (fwidth), então de longe ou em ângulo rasante não sobra padrão para fazer moiré.
  let PER = 0.3;
  let fw = fwidth(s) / PER;
  let tf = 1.0 - smoothstep(0.1, 0.34, fw);
  let inK = smoothstep(0.08, 0.3, x) * (1.0 - smoothstep(1.02, 1.16, x));
  let saw = fract(s / PER);
  // perfil: rampa longa subindo (0..0,78) e face curta descendo (0,78..1), com transições alargadas pelo tamanho do pixel
  let e = clamp(fw * 1.2, 0.02, 0.2);
  let back = smoothstep(0.78 - e, 0.78 + e, saw) * (1.0 - smoothstep(1.0 - e, 1.0, saw));
  let tnx = (0.22 * (1.0 - back) - 0.95 * back) * 0.42 * tf * inK;
  let ts = normalize(dpdx(in.wpos) * dpdy(s) - dpdy(in.wpos) * dpdx(s) + vec3f(1e-9, 0.0, 0.0));
  let tdir = normalize(cross(sf.normal, ts));
  // sombra própria na face de trás do dente + sujeira/borracha acumulada no pé de cada dente
  let foot = (1.0 - smoothstep(0.0, 0.16 + e, saw)) * tf * inK;
  alb *= 1.0 - 0.3 * back * tf * inK - 0.22 * foot * (0.5 + 0.5 * n2.g);
  // junta entre os blocos de concreto (a cada 1,25 m)
  let jl = 1.0 - smoothstep(0.012, 0.012 + aaS, min(fract(s / 1.25), 1.0 - fract(s / 1.25)) * 1.25);
  alb = mix(alb, vec3f(0.05), jl * 0.7 * (1.0 - smoothstep(30.0, 90.0, dist)));
  // sujeira: terra no lado de fora, escorridos e manchas de média escala
  let grime = smoothstep(0.5, 1.25, x) * (0.3 + 0.5 * n2.g) + smoothstep(0.55, 0.8, n1.r) * 0.35;
  alb = mix(alb, vec3f(0.1, 0.085, 0.06), sat(grime) * 0.55);
  // tinta gasta: lascas mostrando o concreto
  let chip = smoothstep(0.6, 0.78, n3.b * 0.6 + n2.g * 0.55);
  alb = mix(alb, vec3f(0.24, 0.235, 0.22), chip * 0.75);
  // borracha dos pneus: riscos escuros no lado da pista, mais fortes nas curvas (in.col.b)
  let streak = textureSample(tNoise, sLin, vec2f(x * 2.3, s * 0.035)).r;
  let rub = (1.0 - smoothstep(0.05, 0.95, x)) * (0.25 + 0.75 * smoothstep(0.35, 0.6, streak)) * (0.35 + 0.65 * in.col.b) * (0.5 + 0.5 * n1.g);
  alb = mix(alb, alb * 0.2 + vec3f(0.006), sat(rub) * 0.85);
  sf.albedo = alb; sf.rough = 0.9 - 0.06 * sat(rub);
  sf.normal = normalize(sf.normal - tdir * tnx + vec3f(n3.r - 0.5, 0.0, n3.g - 0.5) * 0.22 * near);
  sf.ao = 1.0 - 0.3 * back * tf * inK - 0.15 * foot;
  return sf;
}
fn surf(in: V2F, ff: bool) -> Surface {
  let id = matId(in.mat);
  if (id == 0u) { return asphaltSurf(in); }
  if (id == 1u && in.col.a > 0.5) { return kerbSurf(in); }
  return groundSurf(in.wpos, normalize(in.nrm), 0.0);
}
