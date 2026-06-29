v9 수정본

수정 내용:
1. 이라크 국회의원 현황 카드를 다시 오른쪽 상단 영역으로 이동
2. 메인 중간의 큰 국회의원 현황 카드 제거
3. 국내/글로벌/SNS/COM 버튼 크기를 통계 카드 수준으로 키움
4. 통계 카드(전체 기사 수 등)는 더 작고 얇게 조정
5. 국내 언론사 섹션은 원문 제목/요약/출처 기준 한국 언론 기사만 표시
   - AI 번역문 때문에 이라크/아랍 매체가 국내 언론사로 잘못 들어가는 문제 수정
6. 기존 news.json에 잘못 domestic으로 들어간 외신도 다음 workflow 실행 시 global로 정리

업로드:
- .github
- assets
- scripts
- index.html
- app.js
- section-tabs.css

업로드 후 Actions → Daily Bismayah News Update → Run workflow 실행
사이트에서 Ctrl + F5
