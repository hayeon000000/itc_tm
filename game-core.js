// js/game-core.js
// 담당: B (코어 로직 & 연동)
//
// 이 파일은 DOM을 직접 그리지 않습니다. 상태 변화와 결과는 CustomEvent로만 알립니다.
// 이벤트 이름/필드는 /CONTRACT.md 참고. UI 연출은 js/ui.js(C 담당)에서 처리합니다.
//
// [변경사항]
// - 라운드 시작 트리거: "손모양 안정성 감지" -> "버튼 클릭(GameCore.startRound() 호출)"
// - 판정 타이밍: "보!" 이후 한 스텝(500ms) 더 기다리던 것 -> "보!" 시점에 바로 300ms짜리
//   짧은 캡처 창을 열어 그 안에 들어온 프레임만으로 즉시 판정 (참가자가 "보!"에 맞춰 손을
//   내는 순간을 빠르게 읽기 위함. 이전 대기/구버퍼 프레임은 섞이지 않음)

(function () {
  /* ====== 설정값 — 값 의미는 /CONTRACT.md 참고 ====== */
  const MODEL_URL = null; // A가 모델 넘기면 "model/" 로 채우기 (마지막 슬래시 포함)
  const CONFIDENCE_THRESHOLD = 0.85; // 최종 판정에 쓰는 최소 신뢰도 (미달 시 "대기"=인식 실패 처리)
  const JUDGE_CAPTURE_MS = 300; // "보!" 시점부터 판정까지 손을 읽는 캡처 창. 짧을수록 빠르지만 노이즈에 약해짐
  const PREDICT_INTERVAL_MS = 120;
  const COUNTDOWN_STEPS = ["가위", "바위", "보!"];
  const COUNTDOWN_STEP_MS = 500;
  const RESULT_DISPLAY_MS = 3000;

  const STATE = { IDLE: "IDLE", COUNTDOWN: "COUNTDOWN", JUDGE: "JUDGE", RESULT: "RESULT" };
  let currentState = STATE.IDLE;
  let latestSmoothedHand = "대기";
  let recentBuffer = [];
  let judgeBuffer = []; // "보!" 이후에만 채워지는 판정 전용 버퍼
  let capturingForJudge = false;
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

    // "보!" 이후 캡처 창이 열려 있을 때만 판정용 버퍼에 쌓는다.
    // -> 라운드 시작 전 대기 프레임이나 이전 라운드 잔상이 판정에 섞이지 않는다.
    if (capturingForJudge) {
      judgeBuffer.push({ hand, confidence });
    }
  }

  // 버튼 클릭(운영자/참가자) 등 외부 트리거로 라운드를 시작한다.
  // 이미 라운드가 진행 중(IDLE이 아님)이면 무시.
  function startRound() {
    if (currentState !== STATE.IDLE) return;
    startCountdown();
  }

  function startCountdown() {
    setState(STATE.COUNTDOWN);
    let step = 0;
    const tick = () => {
      const label = COUNTDOWN_STEPS[step];
      window.dispatchEvent(new CustomEvent("game:countdownTick", { detail: { label } }));

      if (step === COUNTDOWN_STEPS.length - 1) {
        // "보!" 순간 -> 바로 짧은 판정 캡처 창을 연다.
        beginJudgeCapture();
      } else {
        step++;
        setTimeout(tick, COUNTDOWN_STEP_MS);
      }
    };
    tick();
  }

  function beginJudgeCapture() {
    judgeBuffer = [];
    capturingForJudge = true;
    setTimeout(judge, JUDGE_CAPTURE_MS);
  }

  function judge() {
    capturingForJudge = false;
    setState(STATE.JUDGE);

    // "보!" 이후 캡처 창에서 들어온 프레임만으로 판정.
    // 모델 지연 등으로 하나도 못 받았으면 최신 스무딩 값으로 fallback.
    const samples = judgeBuffer.length > 0
      ? judgeBuffer
      : [{ hand: latestSmoothedHand, confidence: 0 }];
    const bestConfidence = Math.max(...samples.map((s) => s.confidence));
    const majorityHand = mostFrequent(samples.map((s) => s.hand));

    const userHand = bestConfidence >= CONFIDENCE_THRESHOLD ? majorityHand : "대기";
    const winHand = getWinningHand(userHand);

    setState(STATE.RESULT);
    window.dispatchEvent(new CustomEvent("game:result", { detail: { userHand, winHand } }));
    setTimeout(resetToIdle, RESULT_DISPLAY_MS);
  }

  function resetToIdle() {
    recentBuffer = [];
    judgeBuffer = [];
    capturingForJudge = false;
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
    startRound, // 버튼 클릭 시 호출 -> "가위, 바위, 보!" 카운트다운 시작 (IDLE일 때만 동작)
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
