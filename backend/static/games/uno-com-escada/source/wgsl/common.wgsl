// Comum às famílias de geometria: utilitários + bindings globais do grupo 0.
#include util
@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var sLin: sampler;     // trilinear, repeat, anisotrópico
@group(0) @binding(2) var sClamp: sampler;   // linear, clamp
@group(0) @binding(3) var tNoise: texture_2d<f32>;   // ruído ladrilhável 512²: R,G = fbm de valor (2 sementes), B = celular, A = ruído branco
@group(0) @binding(4) var tNoise3: texture_3d<f32>;  // ruído 3D 64³ ladrilhável: R = fbm perlin, G = worley fbm, B = worley fino, A = perlin fino
// altura do terreno (m), 1 m/texel em volta do circuito
@group(0) @binding(5) var tHeight: texture_2d<f32>;
@group(0) @binding(6) var tZone: texture_2d<f32>;    // zonas (ver 11_worldmap.js)
// mapas do mundo: F.wm = (x0, z0, tamanhoX, tamanhoZ) em metros
fn wmIn(xz: vec2f) -> bool { let p = xz - F.wm.xy; return p.x >= 0.0 && p.y >= 0.0 && p.x <= F.wm.z && p.y <= F.wm.w; }
// Altura do terreno: rgba16float (R = altura + H_OFF). rgba16float é filtrável em
// qualquer GPU; r32float exigiria float32-filterable, que a maioria dos celulares
// não tem (o jogo não abria no celular por causa disso).
const H_OFF: f32 = 512.0;
#ifdef HEIGHT_BILINEAR
fn wmHeight(xz: vec2f) -> f32 {
  let dims = textureDimensions(tHeight);
  let uv = (xz - F.wm.xy + 0.5) / vec2f(dims);
  let p = uv * vec2f(dims) - 0.5;
  let f = floor(p);
  let t = clamp(p - f, vec2f(0.0), vec2f(1.0));
  let maxI = vec2i(dims) - 1;
  let i0 = clamp(vec2i(f), vec2i(0), maxI);
  let i1 = clamp(vec2i(f) + 1, vec2i(0), maxI);
  let h00 = textureLoad(tHeight, vec2i(i0.x, i0.y), 0).r;
  let h10 = textureLoad(tHeight, vec2i(i1.x, i0.y), 0).r;
  let h01 = textureLoad(tHeight, vec2i(i0.x, i1.y), 0).r;
  let h11 = textureLoad(tHeight, vec2i(i1.x, i1.y), 0).r;
  return mix(mix(h00, h10, t.x), mix(h01, h11, t.x), t.y) - H_OFF;
}
#else
fn wmHeight(xz: vec2f) -> f32 { return textureSampleLevel(tHeight, sClamp, (xz - F.wm.xy + 0.5) / vec2f(textureDimensions(tHeight)), 0.0).r - H_OFF; }
#endif
fn wmZone(xz: vec2f) -> vec4f { if (!wmIn(xz)) { return vec4f(1.0, 0.0, 1.0, 0.0); } return textureSampleLevel(tZone, sClamp, ((xz - F.wm.xy) * 2.0 + 0.5) / vec2f(textureDimensions(tZone)), 0.0); }
