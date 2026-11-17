// Interface entre famílias de material e os passes de geometria.
struct Pass { viewProj: mat4x4f, camPos: vec4f, p: vec4f }
@group(1) @binding(0) var<uniform> P: Pass; // @dyn

struct VSOut { wpos: vec3f, pwpos: vec3f, nrm: vec3f, uv: vec2f, mat: u32, col: vec4f, ext: vec4f }
struct V2F {
  @builtin(position) pos: vec4f,
  @location(0) wpos: vec3f,
  @location(1) nrm: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) mat: u32,   // 4 bytes: id | a<<8 | b<<16 | c<<24
  @location(4) col: vec4f,
  @location(5) ext: vec4f,
#ifdef PASS_GBUF
  @location(6) cur: vec4f,
  @location(7) prv: vec4f,
#endif
}
struct Surface {
  albedo: vec3f,    // linear
  normal: vec3f,    // mundo, normalizada
  rough: f32,
  metal: f32,
  ao: f32,          // oclusão do material (1 = sem)
  emissive: f32,    // radiância emitida = albedo * emissive * 16
  coat: f32,        // verniz 0..1 (camada dielétrica lisa por cima)
  sss: f32,         // translucidez (folhagem) 0..1
  wet: f32,         // filme de água 0..1 (liga reflexo em espaço de tela)
}
fn surfDefault(n: vec3f) -> Surface { var s: Surface; s.albedo = vec3f(0.5); s.normal = n; s.rough = 0.6; s.metal = 0.0; s.ao = 1.0; s.emissive = 0.0; s.coat = 0.0; s.sss = 0.0; s.wet = 0.0; return s; }
fn matId(m: u32) -> u32 { return m & 255u; }
fn matA(m: u32) -> f32 { return f32((m >> 8u) & 255u) / 255.0; }
fn matB(m: u32) -> f32 { return f32((m >> 16u) & 255u) / 255.0; }
fn matC(m: u32) -> f32 { return f32((m >> 24u) & 255u) / 255.0; }
