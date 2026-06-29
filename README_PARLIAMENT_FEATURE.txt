이라크 국회의원 현황 기능 파일 v3

수정사항:
1. 의원 리스트 컬럼 조정
   - 유지: No., 의원명, 종파, Coalition, Alliance, 체포
   - 제거: 정당, 비고
   - '종파/구분' → '종파'
   - 의원명 영문 표기는 첫 이름 + 패밀리네임만 표시
   - 전체 영문 표기에서 al-/AL-/Al- → Al-로 통일

2. 메인 대시보드
   - 큰 국회의원 현황 카드 제거
   - 국회 마크와 '이라크 국회의원 현황' 바로가기를 우측 상단 영역에 배치
   - 국회 마크의 짙은 네이비 배경 제거, 금색 원형 마크만 표시

3. 국회의원 현황 페이지 오른쪽 요약
   - 정당명은 16글자 초과 시 말줄임 처리
   - 의원 수는 줄바꿈되지 않도록 고정
   - 정당별/종파별 의원 수 옆에 전체 대비 비율 표시

업로드 파일:
- index.html
- app.js
- parliament.html
- parliament.js
- parliament.css
- data/mps.json
- assets/iraq-parliament.png

GitHub 저장소 root에 그대로 업로드하고 Commit changes 하면 됩니다.
