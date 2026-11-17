// Terreno: malha estática, material do chão compartilhado. cor.r do vértice = densidade de mata.
#include mesh_vert
#include world_ground
fn surf(in: V2F, ff: bool) -> Surface { return groundSurf(in.wpos, normalize(in.nrm), in.col.r); }
