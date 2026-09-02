# 절대 이길 수 없는 가위바위보

## 폴더 구조

```
index.html          # 뼈대 HTML (video, 상태 표시 영역)
css/style.css        # 담당 C — 스타일/연출
js/game-core.js      # 담당 B — 웹캠·모델 추론·상태머신 (이벤트만 발행, DOM 직접 조작 X)
js/ui.js             # 담당 C — game-core 이벤트 구독해서 화면/효과음 처리
model/               # 담당 A — Teachable Machine 내보내기 파일(model.json 등) 넣는 곳
CONTRACT.md           # A/B/C 간 이벤트·데이터 형식 규약
```

## 로컬 실행

`index.html`을 더블클릭하면 `file://`로 열려서 웹캠 권한이 막힙니다.
반드시 로컬 서버로 띄우세요 (localhost면 https 없이도 카메라 권한 정상 동작):

```bash
python -m http.server 8000
# 이후 브라우저에서 http://localhost:8000 접속
```

또는 VS Code Live Server 확장 사용.

## 현재 상태

- `js/game-core.js`의 `MODEL_URL`이 비어 있으면 mock 모드로 동작합니다.
  키보드 `1`(가위) `2`(바위) `3`(보) `0`(대기) `r`(강제 리셋)로 전체 상태 흐름을 테스트할 수 있습니다.
- A가 `model/`에 모델 파일을 넣고 클래스 이름/threshold를 확정하면,
  `index.html`의 tfjs·teachablemachine-image 스크립트 태그 주석을 해제하고
  `js/game-core.js`의 `MODEL_URL`을 `"model/"`로 채우면 실제 모델과 연동됩니다.
- 자세한 인터페이스 규약은 `CONTRACT.md` 참고.

# model/

A 담당: Teachable Machine에서 "Export Model" → "Upload your model" 대신
"Tensorflow.js" 탭에서 다운로드 받은 아래 3개 파일을 이 폴더에 그대로 넣어주세요.
파일명은 바꾸지 마세요 (js/game-core.js의 경로와 맞춰져 있습니다).

- model.json
- weights.bin (또는 group1-shard1of1.bin 등, Teachable Machine이 준 이름 그대로)
- metadata.json

클래스 이름과 threshold 값은 /CONTRACT.md 문서에 맞춰주세요.
