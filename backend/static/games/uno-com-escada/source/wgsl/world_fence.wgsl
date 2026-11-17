// Alambrado (passe de transparentes): malha de arame em losango com cobertura analítica (sem serrilhado nem cintilação).
// uv em metros. De perto aparecem os fios; de longe vira um véu de opacidade constante.
#include mesh_vert
#include fwd_common
fn wireCov(x: f32, w: f32) -> f32 {
  let f = max(fwidth(x), 1e-4);
  let c = min(clamp((w + f * 0.5 - abs(fract(x) - 0.5)) / f, 0.0, 1.0), 2.0 * w / f);
  return mix(c, 2.0 * w, smoothstep(0.5, 1.2, f));
}
fn shade(in: V2F, ff: bool) -> vec4f {
  let u = in.uv.x / 0.06; let v = in.uv.y / 0.06;
  let ca = wireCov(u + v, 0.021); let cb = wireCov(u - v, 0.021);
  var alpha = 1.0 - (1.0 - ca) * (1.0 - cb);
  // de longe, postes (a cada 4 m) e cabos são desenhados aqui, com cobertura analítica; de perto são geometria
  let dcam = distance(F.camPos.xyz, in.wpos); let farK = smoothstep(44.0, 61.0, dcam);
  let post = wireCov(in.uv.x / 4.0 + 0.5, 0.009) * farK;
  let hh = in.col.r * 25.5;                                  // altura da tela em metros (cor.r do vértice)
  let fy = max(fwidth(in.uv.y), 1e-4);
  let cab = max(clamp((0.02 + fy * 0.5 - abs(in.uv.y - 0.05)) / fy, 0.0, min(1.0, 0.04 / fy)), clamp((0.02 + fy * 0.5 - abs(in.uv.y - hh + 0.03)) / fy, 0.0, min(1.0, 0.04 / fy))) * farK;
  alpha = 1.0 - (1.0 - alpha) * (1.0 - post) * (1.0 - cab);
  var N = normalize(in.nrm); if (!ff) { N = -N; }
  let V = F.camPos.xyz - in.wpos; let dist = length(V); let dir = -V / dist;
  // arame cilíndrico: iluminação média, sem depender da normal do plano
  let sh = sunShadow(in.wpos, N, in.pos.xy, 0.5);
  // arame galvanizado escurecido pelo tempo: fio escuro contra o fundo (uma tela clara vira película leitosa sobre tudo atrás)
  let alb = vec3f(0.075, 0.08, 0.085);
  var col = alb * (F.sunCol.rgb * sh * 0.16 + shIrr(vec3f(0.0, 1.0, 0.0)) * 0.5);
  let T = exp(-fogOD(F.camPos.xyz, dir, dist));
  col = col * T + fogAmbCol(dir) * (1.0 - T) * 0.5;
  // nada de plano translúcido colado na lente: some a menos de ~2,5 m
  return vec4f(col, alpha * smoothstep(0.7, 2.6, dist));
}
