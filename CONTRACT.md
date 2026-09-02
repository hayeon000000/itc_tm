# 팀 인터페이스 규약

이 문서에 적힌 이름/형식을 바꾸게 되면 팀 채팅에 공지하고 이 문서도 같이 고칠 것.

## 1. A → B: 모델 전달 방식

- 위치: `model/model.json`, `model/weights.bin`, `model/metadata.json`
  (Teachable Machine에서 "Export Model" → Tensorflow.js → 다운로드 후 이 세 파일을 그대로 여기 넣기, 파일명 변경 금지)
- 클래스 이름은 아래 4개 문자열과 **정확히** 일치해야 함 (띄어쓰기 포함):
  `가위`, `바위`, `보`, `대기`
- 신뢰도 임계값(threshold): A가 튜닝한 값을 알려주면 B가 `js/game-core.js`의
  `CONFIDENCE_THRESHOLD`에 반영.

## 2. B → C: 이벤트 인터페이스

`js/game-core.js`는 DOM을 직접 건드리지 않고 아래 `CustomEvent`만 `window`에 발행함.
C는 이 이벤트만 구독하면 game-core.js 내부를 몰라도 UI/연출을 붙일 수 있음.

### `game:stateChange`
```
detail: { state: "IDLE" | "COUNTDOWN" | "JUDGE" | "RESULT" }
```

### `game:countdownTick`
```
detail: { label: string }   // "가위" / "바위" / "보!" 등, COUNTDOWN_STEPS 배열 값 그대로
```

### `game:result`
```
detail: { userHand: string, winHand: string | null }
```
`winHand`이 `null`이면 판독 시점에 손이 인식되지 않은 경우 → "다시 시도" 류 문구 표시 권장.

## 3. C → B: 강제 리셋 훅

부스 단축키 등에서 아래 함수를 그대로 호출하면 즉시 IDLE로 복귀:
```js
window.GameCore.forceReset()
```

모델 없이 테스트할 때 손모양을 흉내내려면:
```js
window.GameCore.mockPredict("가위" | "바위" | "보" | "대기")
```

## 4. 현재 합의된 설정값 (`js/game-core.js` 상단)

| 값 | 현재 | 비고 |
|---|---|---|
| CONFIDENCE_THRESHOLD | 0.85 | 임시값, A 튜닝 후 갱신 |
| STABLE_FRAMES_TO_START | 4 | 지터 방지용 연속 인식 프레임 수 |
| PREDICT_INTERVAL_MS | 120 | 부스 노트북 성능 테스트 후 조정 |
| COUNTDOWN_STEP_MS | 500 | C와 연출 맞춰서 조정 가능 |
| RESULT_DISPLAY_MS | 3000 | C와 연출 맞춰서 조정 가능 |
