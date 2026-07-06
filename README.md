# Bismayah News Monitor

비스마야 신도시 / BNCP / Hanwha Iraq / NIC 관련 뉴스를 매일 자동 수집해서 보여주는 GitHub Pages 대시보드입니다.

## 파일 구조

```text
.
├─ index.html
├─ style.css
├─ app.js
├─ data/
│  └─ news.json
├─ scripts/
│  └─ fetch_news.py
└─ .github/
   └─ workflows/
      └─ daily-news.yml
```

## 1. GitHub Pages 배포

1. GitHub에서 새 저장소를 만듭니다.
   - 추천 이름: `bismayah-news-monitor`
   - Public 권장
2. 이 프로젝트 파일을 업로드합니다.
3. 저장소에서 `Settings` → `Pages`로 이동합니다.
4. `Build and deployment`에서
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. 저장하면 아래 주소 형태로 사이트가 열립니다.

```text
https://YOUR_GITHUB_ID.github.io/bismayah-news-monitor/
```

## 2. 자동 업데이트

`.github/workflows/daily-news.yml` 파일이 매일 오전 8시 한국시간 기준으로 실행됩니다.

수동 실행:
1. GitHub 저장소 → `Actions`
2. `Daily Bismayah News Update`
3. `Run workflow`

## 3. 검색 키워드 수정

`scripts/fetch_news.py` 파일의 `KEYWORDS` 배열을 수정하면 됩니다.

## 4. 주의

1차 MVP는 Google News RSS 기반입니다.
기사 본문 전체 번역/요약이 아니라 제목과 RSS 설명 기반으로 정리합니다.
업무 판단에는 반드시 원문 출처와 공식 자료를 확인하세요.

## 주간 보고서 생성 기능

- 화면의 `주간 보고서` 버튼을 누르면 `data/` 폴더에 누적된 최근 7일치 국내/글로벌 뉴스, COM 주요활동, SNS 데이터를 취합합니다.
- 먼저 보고서 후보 목록을 미리보기로 보여주며, 불필요한 항목은 체크 해제할 수 있습니다.
- `Word 다운로드`를 누르면 기존 `이라크 주간 종합 상황보고` 형식에 맞춘 `.docx` 파일이 브라우저에서 생성됩니다.
- API 키를 브라우저에 노출하지 않기 위해, 버튼 클릭 시 실시간 OpenAI 호출은 하지 않습니다. 보고서는 이미 저장된 한국어 제목/요약 데이터를 기준으로 생성됩니다.
- `scripts/collect-news.mjs`에는 주간 보고서용 `weekly-context-news.json` 수집 범위를 추가했습니다. 다음 workflow 실행부터 이라크 정국·치안·경제·건설 관련 참고 기사가 별도 누적됩니다.
