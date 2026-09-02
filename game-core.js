// js/game-core.js
// 담당: B (코어 로직 & 연동)
//
// 이 파일은 DOM을 직접 그리지 않습니다. 상태 변화와 결과는 CustomEvent로만 알립니다.
// 이벤트 이름/필드는 /CONTRACT.md 참고. UI 연출은 js/ui.js(C 담당)에서 처리합니다.

(function () {
  /* ====== 설정값 — 값 의미는 /CONTRACT.md 참고 ====== */
  const MODEL_URL = null; // A가 모델 넘기면 "model/" 로 채우기 (마지막 슬래시 포함)
  const CONFIDENCE_THRESHOLD = 0.85;
  const STABLE_FRAMES_TO_START = 4;
  const PREDICT_INTERVAL_MS = 120;
  const COUNTDOWN_STEPS = ["가위", "바위", "보!"];
  const COUNTDOWN_STEP_MS = 500;
  const RESULT_DISPLAY_MS = 3000;

  const STATE = { IDLE: "IDLE", COUNTDOWN: "COUNTDOWN", JUDGE: "JUDGE", RESULT: "RESULT" };
  let currentState = STATE.IDLE;
  let latestSmoothedHand = "대기";
  let recentBuffer = [];
  let stableCount = 0;
  let tmModel = null;
  let webcamEl = null;

  function setState(next) {
    currentState = next;
    window.dispatchEvent(new CustomEvent("game:stateChange", { detail: { state: next } }));
  }

  function getWinningHand(userHand) {
    if (userHand === "가위") return "바위";
    if (userHand === "바위") return "보";
    if (userHand === "보") return "가위";
    return null; // 대기 또는 인식 실패
  }

  function mostFrequent(arr) {
    const count = {};
    let best = arr[arr.length - 1], bestCount = 0;
    for (const v of arr) {
      count[v] = (count[v] || 0) + 1;
      if (count[v] > bestCount) { bestCount = count[v]; best = v; }
    }
    return best;
  }

  function onNewPrediction(hand, confidence) {
    recentBuffer.push(hand);
    if (recentBuffer.length > 5) recentBuffer.shift();
    latestSmoothedHand = mostFrequent(recentBuffer);

    if (currentState === STATE.IDLE) {
      if (latestSmoothedHand !== "대기" && confidence >= CONFIDENCE_THRESHOLD) {
        stableCount++;
        if (stableCount >= STABLE_FRAMES_TO_START) {
          stableCount = 0;
          startCountdown();
        }
      } else {
        stableCount = 0;
      }
    }
    // COUNTDOWN 중에는 latestSmoothedHand만 계속 갱신해둔다.
    // -> JUDGE 시점에 새로 추론을 기다리지 않고 즉시 사용 가능 (반응속도 목표의 핵심)
  }

  function startCountdown() {
    setState(STATE.COUNTDOWN);
    let step = 0;
    const tick = () => {
      if (step >= COUNTDOWN_STEPS.length) { judge(); return; }
      window.dispatchEvent(new CustomEvent("game:countdownTick", { detail: { label: COUNTDOWN_STEPS[step] } }));
      step++;
      setTimeout(tick, COUNTDOWN_STEP_MS);
    };
    tick();
  }

  function judge() {
    setState(STATE.JUDGE);
    const userHand = latestSmoothedHand;
    const winHand = getWinningHand(userHand);
    setState(STATE.RESULT);
    window.dispatchEvent(new CustomEvent("game:result", { detail: { userHand, winHand } }));
    setTimeout(resetToIdle, RESULT_DISPLAY_MS);
  }

  function resetToIdle() {
    recentBuffer = [];
    stableCount = 0;
    setState(STATE.IDLE);
  }

  async function setupWebcam() {
    webcamEl = document.getElementById("webcam");
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    webcamEl.srcObject = stream;
    await new Promise((res) => (webcamEl.onloadedmetadata = res));
  }

  async function setupModel() {
    if (!MODEL_URL) {
      window.GameCore.isMockMode = true;
      console.log("[MOCK MODE] 모델 없음. GameCore.mockPredict(hand)로 테스트하거나 ui.js의 키보드 입력을 쓰세요.");
      return;
    }
    window.GameCore.isMockMode = false;
    tmModel = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
    predictLoop();
  }

  async function predictLoop() {
    if (tmModel) {
      const predictions = await tmModel.predict(webcamEl);
      const top = predictions.reduce((a, b) => (a.probability > b.probability ? a : b));
      onNewPrediction(top.className, top.probability);
    }
    setTimeout(predictLoop, PREDICT_INTERVAL_MS);
  }

  // C(또는 부스 운영자)가 쓸 수 있는 최소한의 공개 API
  window.GameCore = {
    forceReset: resetToIdle,
    mockPredict: (hand) => onNewPrediction(hand, 0.99), // ui.js가 키보드 mock 입력에 사용
    isMockMode: true,
  };

  (async function init() {
    await setupWebcam();
    await setupModel();
    setState(STATE.IDLE);
  })();
})();
