// js/ui.js
// 담당: C (UI/UX & 부스 연출)
//
// game-core.js가 쏘는 이벤트(game:stateChange / game:countdownTick / game:result)만 구독합니다.
// 여기 내용은 테스트용 최소 구현이니 C가 자유롭게 갈아엎어도 game-core.js는 안 건드려도 됩니다.

const stateLabel = document.getElementById("stateLabel");
const countdownEl = document.getElementById("countdown");
const resultEl = document.getElementById("resultHand");
const modeLabel = document.getElementById("modeLabel");

window.addEventListener("game:stateChange", (e) => {
  stateLabel.textContent = e.detail.state;
  modeLabel.textContent = window.GameCore.isMockMode ? "MOCK" : "LIVE MODEL";

  if (e.detail.state === "IDLE") {
    countdownEl.textContent = "";
    resultEl.textContent = "";
  }
});

window.addEventListener("game:countdownTick", (e) => {
  countdownEl.textContent = e.detail.label;
});

window.addEventListener("game:result", (e) => {
  const { userHand, winHand } = e.detail;
  countdownEl.textContent = "";
  resultEl.textContent = winHand
    ? `당신: ${userHand} → AI: ${winHand}`
    : "손을 못 봤어요.. 다시 시도!";
});

// mock 테스트용 키보드 입력 (실제 부스에서는 카메라 인식으로 대체됨)
window.addEventListener("keydown", (e) => {
  const map = { "1": "가위", "2": "바위", "3": "보", "0": "대기" };
  if (map[e.key] && window.GameCore.isMockMode) window.GameCore.mockPredict(map[e.key]);
  if (e.key === "r") window.GameCore.forceReset();
});
