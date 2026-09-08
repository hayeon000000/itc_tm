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
  const MODEL_URL = "model/"; // A가 model/ 폴더에 모델을 넣어줬으므로 연결
  // 0.85는 실제 웹캠 환경(조명/배경)에서 모델이 도달하기엔 너무 높아 항상 "다시 시도"로 빠지던 값.
  // 우선 0.6으로 낮춰둠 — 실제 테스트하면서 game:predict 이벤트로 뜨는 실시간 신뢰도를 보고 다시 튜닝할 것.
  const CONFIDENCE_THRESHOLD = 0.6;
  const JUDGE_CAPTURE_MS = 500; // "보!" 시점부터 판정까지 손을 읽는 캡처 창. 300ms는 실제 추론 지연 탓에 프레임을 하나도 못 받는 경우가 있어 늘림
  const PREDICT_INTERVAL_MS = 120;
  const COUNTDOWN_STEPS = ["가위", "바위", "보!"];
  const COUNTDOWN_STEP_MS = 500;
  const RESULT_DISPLAY_MS = 3000;

  const STATE = { IDLE: "IDLE", COUNTDOWN: "COUNTDOWN", JUDGE: "JUDGE", RESULT: "RESULT" };
  let currentState = STATE.IDLE;
  let latestSmoothedHand = "대기";
  let latestConfidence = 0; // 판정 캡처 창에 프레임이 하나도 안 잡혔을 때 fallback으로 쓸 최근 신뢰도
  let recentBuffer = [];
  let judgeBuffer = []; // "보!" 이후에만 채워지는 판정 전용 버퍼
  let capturingForJudge = false;
  let tmModel = null;
  let webcamEl = null;
  // 카운트다운 tick / 판정 캡처 / 결과 표시 종료 중 "지금 예약된" 다음 단계 타이머 하나.
  // forceReset()이 라운드 도중에 불려도(다시하기 버튼, r 키, 무입력 리셋 등) 이전 라운드의
  // 예약된 다음 단계가 새 라운드 도중에 뒤늦게 끼어들지 않도록 반드시 이 변수로 취소함.
  let pendingTimer = null;

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
    latestConfidence = confidence;

    // 부스 운영/튜닝용: 매 프레임의 클래스·신뢰도를 그대로 내보냄 (판정 로직과는 무관, 디버그 표시 전용)
    window.dispatchEvent(new CustomEvent("game:predict", { detail: { hand, confidence } }));

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
        pendingTimer = setTimeout(tick, COUNTDOWN_STEP_MS);
      }
    };
    tick();
  }

  function beginJudgeCapture() {
    judgeBuffer = [];
    capturingForJudge = true;
    pendingTimer = setTimeout(judge, JUDGE_CAPTURE_MS);
  }

  function judge() {
    capturingForJudge = false;
    setState(STATE.JUDGE);

    // "보!" 이후 캡처 창에서 들어온 프레임만으로 판정.
    // 모델 지연 등으로 하나도 못 받았으면 최신 스무딩 값 + 그때의 실제 신뢰도로 fallback.
    // (신뢰도를 0으로 고정하면 캡처 창을 못 맞춘 것뿐인데도 항상 "대기"=인식 실패로 처리돼버림)
    const samples = judgeBuffer.length > 0
      ? judgeBuffer
      : [{ hand: latestSmoothedHand, confidence: latestConfidence }];
    const bestConfidence = Math.max(...samples.map((s) => s.confidence));
    const majorityHand = mostFrequent(samples.map((s) => s.hand));

    const userHand = bestConfidence >= CONFIDENCE_THRESHOLD ? majorityHand : "대기";
    const winHand = getWinningHand(userHand);

    setState(STATE.RESULT);
    window.dispatchEvent(new CustomEvent("game:result", { detail: { userHand, winHand } }));
    pendingTimer = setTimeout(resetToIdle, RESULT_DISPLAY_MS);
  }

  function resetToIdle() {
    // 이전 라운드에서 예약해둔 다음 단계(카운트다운 tick / judge / 자동 리셋)가 남아있다면 취소.
    // 안 그러면 "다시하기"로 새 라운드를 시작해도 이전 라운드의 예약된 리셋이 뒤늦게 튀어나와
    // 새 라운드를 중간에 끊어버림 (몇 번 다시하기 하면 게임이 멈추는 것처럼 보이던 원인)
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    recentBuffer = [];
    judgeBuffer = [];
    latestSmoothedHand = "대기";
    latestConfidence = 0;
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
      try {
        const predictions = await tmModel.predict(webcamEl);
        const top = predictions.reduce((a, b) => (a.probability > b.probability ? a : b));
        onNewPrediction(top.className, top.probability);
      } catch (err) {
        // 프레임 하나가 실패해도 루프 자체는 계속 돌아야 함 (안 그러면 이후 판정이 전부 "대기"=인식 실패로 고정됨)
        console.warn("[predictLoop] 예측 실패, 다음 프레임에서 재시도:", err);
        window.dispatchEvent(new CustomEvent("game:predict", { detail: { hand: "(예측 실패 — 콘솔 확인)", confidence: 0 } }));
      }
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
    try {
      await setupWebcam();
    } catch (err) {
      console.error("[GameCore] 웹캠 권한/연결 실패 — 브라우저 카메라 권한을 확인하세요:", err);
    }
    try {
      await setupModel();
    } catch (err) {
      // tmImage.load()가 실패하면(모델 파일 경로/버전 문제 등) 여기서 조용히 죽어서
      // setState(IDLE)까지 실행이 안 되고, isMockMode는 이미 false로 바뀐 채라 화면엔
      // 아무 표시도 안 뜨는 것처럼 보였음 — 반드시 잡아서 mock 모드로라도 복귀시킴
      console.error("[GameCore] 모델 로드 실패 — model/ 경로나 tfjs·teachablemachine 버전을 확인하세요:", err);
      window.GameCore.isMockMode = true;
    }
    setState(STATE.IDLE);
  })();
})();
