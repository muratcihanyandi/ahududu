// Poses fixas para verificação visual (usadas só pelos scripts de captura via __cap.pose(i)).
// tipo 'carro': carro parado em (s, d, direção), câmera livre em coordenadas do carro [x frente, y cima, z direita].
// tipo 'volta': reproduz os comandos gravados até o instante t (s) e captura o quadro em movimento, com a câmera cam.
const POSES = [
  { nome: 'araba-on-34', tipo: 'carro', s: 160, d: -1.0, yaw: 3.75, olho: [4.9, 1.35, -3.3], alvo: [0.1, 0.72, 0], fov: 0.5 },
  { nome: 'araba-arka-34', tipo: 'carro', s: 160, d: -1.0, yaw: 0.61, olho: [-5.0, 1.75, 3.4], alvo: [-0.1, 0.8, 0], fov: 0.5 },
  { nome: 'araba-yan-alcak', tipo: 'carro', s: 160, d: -1.0, yaw: 2.1, olho: [0.9, 0.62, -5.2], alvo: [0.05, 0.8, 0], fov: 0.6 },
  { nome: 'viraj-takip', tipo: 'volta', t: 11.8, cam: 0 },
  { nome: 'tv-viraj-drift', tipo: 'volta', t: 21.55, cam: 2 },
  { nome: 'kaput-arka-duzluk', tipo: 'volta', t: 30.4, cam: 1 },
];
function poseApply(i) {
  const P = POSES[i];
  GS.fxOn = true;
  if (P.tipo === 'carro') {
    gameRestart(); vehicleReset(P.s, P.d, P.yaw); GS.frozen = true; GS.freeCam = true; GS.alpha = 1; gamePose();
    const B = GS.body, o = P.olho, a = P.alvo, q = CAMQ;
    q[0] = B[0] * o[0] + B[4] * o[1] + B[8] * o[2] + B[12]; q[1] = B[1] * o[0] + B[5] * o[1] + B[9] * o[2] + B[13]; q[2] = B[2] * o[0] + B[6] * o[1] + B[10] * o[2] + B[14];
    q[3] = B[0] * a[0] + B[4] * a[1] + B[8] * a[2] + B[12]; q[4] = B[1] * a[0] + B[5] * a[1] + B[9] * a[2] + B[13]; q[5] = B[2] * a[0] + B[6] * a[1] + B[10] * a[2] + B[14];
    q[6] = P.fov; q[7] = 0; setCameraQ(); GS.cut = true; R.casc.focusOn = false;
    RT[2] = 1 / 60; for (let k = 0; k < 60; k++) { gameTick(true); renderFrame(); }
  } else {
    GS.frozen = false; GS.freeCam = false; const was = GS.replayOn; GS.replayOn = true; gameRestart(); GS.cam = P.cam; GS.cut = true;
    const n = Math.round(P.t * 60), warm = 45; RT[2] = 1 / 60;
    for (let k = 0; k < n; k++) { const camKeep = GS.cam; gameTick(true); GS.cam = P.cam; if (k >= n - warm) renderFrame(); }
    GS.replayOn = was;
  }
}
