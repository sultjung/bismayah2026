# BNCP 국내/해외/SNS/COM 뉴스 버튼 패치

## 무엇을 고치는 패치인가

기존 웹사이트의 `국내 언론` 버튼이 기사 검색 결과를 못 가져오는 문제를 우회/수정합니다.

핵심 변경:
- 브라우저에서 Google 검색을 직접 긁지 않습니다.
- GitHub Actions가 정기적으로 Google News RSS를 조회합니다.
- 결과를 `data/*.json` 파일로 저장합니다.
- 웹사이트 버튼은 이 JSON 파일을 읽어서 화면에 표시합니다.

## 업로드할 파일

이 ZIP 안의 아래 파일/폴더를 GitHub repository 루트에 그대로 업로드하세요.

```text
.github/workflows/collect-news.yml
scripts/collect-news.mjs
assets/news-patch.js
data/domestic-news.json
data/overseas-news.json
data/sns-news.json
data/com-news.json
data/news-index.json
```

## index.html에 추가할 코드

기존 웹사이트의 `index.html` 파일에서 `</body>` 바로 위에 아래 한 줄을 추가하세요.

```html
<script src="./assets/news-patch.js" defer></script>
```

이 한 줄을 넣어야 버튼 클릭 시 JSON 뉴스를 불러옵니다.

## GitHub Actions 실행

GitHub에서:

```text
Repository → Actions → Collect BNCP News → Run workflow
```

수동 실행하세요.

실행이 끝나면 repository의 `data/domestic-news.json` 파일에 기사 결과가 자동으로 채워집니다.

## 버튼 인식 방식

이 패치는 아래 텍스트/ID/class를 가진 버튼을 자동으로 찾아서 연결합니다.

- 국내 / 국내 언론 / domestic / korea / kr
- 해외 / 해외 언론 / overseas / global / world / foreign
- SNS / sns / social
- COM / com / cabinet / council

버튼을 더 확실하게 연결하고 싶으면 기존 버튼 HTML에 아래처럼 속성을 추가하세요.

```html
<button data-news-category="domestic">국내 언론</button>
<button data-news-category="overseas">해외 언론</button>
<button data-news-category="sns">SNS</button>
<button data-news-category="com">COM</button>
```

## 국내 검색 키워드

```text
"한화" "이라크"
"한화건설" "이라크"
"한화 건설" "이라크"
"비스마야"
"비스마야 신도시"
"한화" "비스마야"
"한화" "BNCP"
"Bismayah" "한화"
"이라크 신도시" "한화"
"이라크 사업" "한화"
```

## 로컬 테스트

Node.js가 있으면 repository 루트에서:

```bash
node scripts/collect-news.mjs
```

그 다음 웹사이트를 열어 국내 언론 버튼을 눌러보세요.

## 주의

GitHub Pages 정적 웹사이트에서는 브라우저가 Google 검색결과를 직접 읽기 어렵습니다.
그래서 이 패치는 “GitHub Actions에서 먼저 수집 → JSON으로 저장 → 프론트에서 JSON 표시” 방식으로 만들었습니다.
