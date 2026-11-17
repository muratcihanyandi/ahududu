// Gente (público, equipes, fiscais): cartões com figura recortada do atlas que giram em torno do eixo vertical para encarar
// a câmera — silhueta humana inteira de qualquer ângulo. pos = pé da figura; nrm.x = canto lateral (m), nrm.y = altura/2 (m).
// atlas: R sombreamento, G máscara da camisa (cor do vértice), B máscara de cabelo/calça, A recorte. mat.y = tom de pele, mat.z = cabelo.
struct VIn { @location(0) pos: vec3f, @location(1) nrm: vec4f, @location(2) uv: vec2f, @location(3) mat: vec4u, @location(4) col: vec4f }
@group(3) @binding(0) var tAtlas: texture_2d<f32>;
fn vert(in: VIn) -> VSOut {
  var o: VSOut;
  let tc = P.camPos.xyz - in.pos; let th = normalize(vec3f(tc.x, 0.0, tc.z) + vec3f(1e-5, 0.0, 0.0));
  let right = vec3f(th.z, 0.0, -th.x);
  o.wpos = in.pos + right * in.nrm.x + vec3f(0.0, in.nrm.y * 2.0, 0.0);
  o.pwpos = o.wpos;
  // corpo arredondado: a normal gira de um lado ao outro do cartão (cilindro) e aponta um pouco para cima —
  // o sol baixo ilumina um lado da figura e deixa o outro na sombra
  o.nrm = normalize(th * 0.72 + right * sign(in.nrm.x) * 0.85 + vec3f(0.0, 0.42, 0.0));
  o.uv = in.uv; o.mat = in.mat.x | (in.mat.y << 8u) | (in.mat.z << 16u) | (in.mat.w << 24u); o.col = in.col; o.ext = vec4f(0.0);
  return o;
}
fn surf(in: V2F, ff: bool) -> Surface {
  var s = surfDefault(normalize(in.nrm));
  let t = textureSampleBias(tAtlas, sLin, in.uv, -0.6);
  // recorte com borda de ~1 pixel: converte o alfa em cobertura pela derivada e sorteia só nessa faixa (o TAA resolve suave)
  let aw = max(fwidth(t.a) * 1.2, 0.04); let cov = sat((t.a - 0.5) / aw + 0.5);
#ifdef PASS_GBUF
  if (cov < ign(in.pos.xy, F.misc.y) * 0.98 + 0.01) { discard; }
#else
  if (t.a < 0.5) { discard; }
#endif
  let skin = mix(vec3f(0.5, 0.33, 0.24), vec3f(0.17, 0.1, 0.07), matA(in.mat));
  let hair = mix(vec3f(0.02, 0.016, 0.013), vec3f(0.32, 0.27, 0.22), smoothstep(0.55, 1.0, matB(in.mat)));
  var c = mix(skin, hair, smoothstep(0.3, 0.6, t.b)); c = mix(c, in.col.rgb, smoothstep(0.3, 0.6, t.g));
  // dobras e manchas de tecido (ruído por figura), sombreamento desenhado e base mais escura: nada de cor chapada
  let fold = textureSample(tNoise, sLin, in.uv * vec2f(46.0, 21.0) + vec2f(matA(in.mat), matB(in.mat)) * 3.7);
  let cloth = smoothstep(0.3, 0.6, t.g) + smoothstep(0.3, 0.6, t.b) * 0.5;
  s.albedo = c * (0.1 + 1.05 * t.r * t.r) * (1.0 - cloth * (0.3 * fold.r + 0.14 * fold.b - 0.1)); s.rough = 0.9; s.ao = in.col.a * (0.55 + 0.45 * t.r); s.sss = 0.06;
  return s;
}
