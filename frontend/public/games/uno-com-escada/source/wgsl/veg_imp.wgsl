// Vegetação — impostores: um cartão por árvore, virado para a câmera (ou para o sol nos passes de sombra),
// com atlas de 8 azimutes por arquétipo (albedo+alfa e normal+máscara de folha), iluminado no G-buffer.
#include veg_common
struct VIn { @builtin(vertex_index) vi: u32, @location(5) i0: vec4f, @location(6) i1: vec4f }
struct ImpU { a: array<vec4f, 12> }   // por arquétipo: (meia largura, altura, _, _)
@group(3) @binding(0) var tImpA: texture_2d_array<f32>;
@group(3) @binding(1) var tImpN: texture_2d_array<f32>;
@group(3) @binding(2) var sImp: sampler;
@group(3) @binding(3) var<uniform> IU: ImpU;
fn vert(in: VIn) -> VSOut {
  var o: VSOut;
  let base = in.i0.xyz; let s = in.i0.w; let c = in.i1.x; let sn = in.i1.y; let arch = in.i1.w;
  let ai = u32(arch); let dim = IU.a[min(ai, 11u)];
  let slot = P.camPos.w;
  let d = distance(base.xz, F.camPos.xz) * vegZoom();   // distância efetiva (com o zoom da lente)
  var fade = vegFade(d, in.i1.z, VEG_D0, VEG_D1);
  var kill = arch >= VEG_NT;
#ifdef PASS_GBUF
  var h = P.camPos.xz - base.xz;
  if (fade <= 0.0) { kill = true; }
#endif
#ifdef PASS_SHADOW
  var h = F.sunDir.xz;
  if (vegShadowMesh(base, fade)) { kill = true; }
  if (vegShadowCull(base, dim.y * s)) { kill = true; }
  fade = 1.0;
#endif
#ifdef PASS_CUBE
  var h = P.camPos.xz - base.xz;
  fade = 1.0;
  if (distance(base.xz, P.camPos.xz) > 700.0) { kill = true; }
#endif
  h = normalize(h);
  let right = vec3f(h.y, 0.0, -h.x);
  let cx = f32(in.vi & 1u) * 2.0 - 1.0; let cy = f32(in.vi >> 1u);
  var wp = base + right * (cx * dim.x * s) + vec3f(0.0, cy * dim.y * s, 0.0);
#ifdef PASS_SHADOW
  wp -= vec3f(F.sunDir.x, 0.0, F.sunDir.z) * (dim.x * s * 0.55);   // afasta do sol: a própria copa não se sombreia inteira
#endif
  if (kill) { wp = base; }
  // quadro do atlas: ângulo da direção câmera→árvore no espaço local da árvore
  let hl = vec2f(h.x * c + h.y * sn, -h.x * sn + h.y * c);
  let f = fract(atan2(hl.y, hl.x) / 6.2831853 + 1.0) * 8.0;
  o.wpos = wp; o.pwpos = wp;
  o.nrm = vec3f(c, sn, fract(f));
  o.uv = vec2f(cx * 0.5 + 0.5, 1.0 - cy);
  o.mat = ai | (u32(floor(f)) << 8u);
  o.col = vec4f(vegTintA(in.i1.z, arch), 1.0);
  o.ext = vec4f(fade, d, 0.0, 0.0);
  return o;
}
fn impLayers(in: V2F) -> vec2i {
  let f0 = (in.mat >> 8u) & 255u; let b = (in.mat & 255u) * 8u;
  return vec2i(i32(b + f0), i32(b + ((f0 + 1u) & 7u)));
}
fn surfAlpha(in: V2F) -> f32 {
  let L = impLayers(in);
  // sombra da copa com recorte de folhagem: o alfa do atlas é furado por ruído celular (buracos de luz pequenos e variados, borda
  // desfiada) em vez da silhueta maciça do cartão. Uma amostra só, com o amostrador simples (este passe tem muita sobreposição).
  let a = textureSampleBias(tImpA, sImp, in.uv, select(L.x, L.y, in.nrm.z > 0.5), 0.3).a + 0.06;
  let n = textureSampleLevel(tNoise, sImp, in.uv * 6.0 + f32(L.x) * 0.37, 0.0).b;
  return a * (0.52 + 0.6 * smoothstep(0.3, 0.62, n));
}
fn surf(in: V2F, ff: bool) -> Surface {
  let nz = 1.0 - vegNoise(in.pos.xy);   // complementar ao da malha: na troca de LOD cada pixel é de um ou de outro
  // mistura os dois azimutes vizinhos do atlas (a silhueta se transforma aos poucos)
  let L = impLayers(in); let t = smoothstep(0.15, 0.85, in.nrm.z);
  let a = mix(textureSample(tImpA, sImp, in.uv, L.x), textureSample(tImpA, sImp, in.uv, L.y), t);
  // quanto o atlas está ampliado na tela (lente longa): 0 = 1 texel por pixel ou menos, 1 = muito ampliado
  let tpp = max(fwidth(in.uv.x), fwidth(in.uv.y)) * 512.0; let mag = sat(1.0 - tpp);
  // ampliado, o atlas borrado vira mancha: quebra a silhueta e o tom com ruído na escala de folha
  let dn = textureSample(tNoise, sLin, in.uv * 7.0 + f32(L.x) * 0.37);
  let dn2 = textureSample(tNoise, sLin, in.uv * 19.0 + f32(L.x) * 0.11);
  // ao longe os mips afinam a copa: compensa o limiar
  let thr = 0.5 - 0.22 * smoothstep(120.0, 600.0, in.ext.y);
  let aa = a.a + (dn.r * 0.6 + dn2.g * 0.4 - 0.5) * 0.5 * mag * smoothstep(0.05, 0.4, a.a) * (1.0 - smoothstep(0.75, 1.0, a.a));
  if (vegCover(aa, thr) * in.ext.x <= nz) { discard; }
  let nt = mix(textureSample(tImpN, sImp, in.uv, L.x), textureSample(tImpN, sImp, in.uv, L.y), t);
  var nl = nt.xyz * 2.0 - 1.0; let c = in.nrm.x; let sn = in.nrm.y;
  nl += vec3f(dn.g - 0.5, dn2.r - 0.5, dn.b - 0.5) * (0.2 + 0.3 * mag) * nt.a;
  // normais mais lisas ao longe (copa como volume, sem ruído de folha a folha)
  let far = smoothstep(90.0, 450.0, in.ext.y);
  nl = normalize(mix(nl, vec3f(nl.x * 0.5, abs(nl.y) * 0.5 + 0.6, nl.z * 0.5), far * 0.7));
  var s = surfDefault(normalize(vec3f(nl.x * c - nl.z * sn, nl.y, nl.x * sn + nl.z * c)));
  // como na malha: normal que aponta para longe do observador vira para ele (verso da folha não recebe sol de frente)
  let Vd = normalize(F.camPos.xyz - in.wpos); let nvd = dot(s.normal, Vd);
  if (nvd < 0.0) { s.normal = normalize(s.normal - Vd * (nvd * 1.7)); }
  // mesmo tom da malha (ver veg_tree.wgsl), com variação de massa clara/escura na escala de tufo
  // 0,69 ≈ média das modulações de tufo da malha (ruído celular × miolo escuro), para as duas cores médias coincidirem
  var lc = a.rgb * mix(vec3f(0.8), in.col.rgb * vec3f(0.57, 0.64, 0.33) * 0.74, nt.a);
  // tufos claros e escuros (mesma ideia da malha), que somem ao longe
  let tuft = (0.66 + 0.68 * smoothstep(0.25, 0.8, dn.b)) * (0.8 + 0.4 * dn2.r);
  s.albedo = lc * mix(1.0, tuft, nt.a * (1.0 - 0.6 * far)) * mix(1.0, 0.85, far * nt.a);
  // translucidez mais forte na borda da silhueta (cobertura borrada baixa), menor ao longe; folhagem fosca
  let ab = textureSampleBias(tImpA, sImp, in.uv, L.x, 3.0).a;
  let edge = 1.0 - smoothstep(0.5, 0.92, ab);
  s.sss = 0.24 * nt.a * mix(0.3, 1.0, edge) * mix(1.0, 0.4, far);
  let back = smoothstep(0.15, 0.8, dot(-Vd, F.sunDir.xyz)) * edge * nt.a * (1.0 - 0.6 * far);
  s.albedo = mix(s.albedo, s.albedo * vec3f(1.28, 1.22, 0.66), back * 0.7);
  s.emissive = 0.04 * back;   // luz atravessando a borda da copa (como na malha)
  s.rough = mix(0.9, 0.95, nt.a) + 0.04 * far; s.ao = mix(1.0, 0.8, far * (1.0 - edge));
  return s;
}
