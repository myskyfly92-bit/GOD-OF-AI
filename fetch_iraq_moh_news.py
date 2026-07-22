name: Update Iraq MOH News

# 매일 자동 실행 + 필요할 때 수동 실행(Actions 탭 → Run workflow) 둘 다 가능
on:
  schedule:
    - cron: "0 3 * * *"   # 매일 UTC 03:00 = 바그다드 06:00
  workflow_dispatch: {}

permissions:
  contents: write   # news.json을 저장소에 커밋하기 위한 권한

jobs:
  update-news:
    runs-on: ubuntu-latest
    steps:
      - name: 저장소 체크아웃
        uses: actions/checkout@v4

      - name: Python 설정
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: 의존성 설치
        run: pip install requests feedparser deep-translator

      - name: 뉴스 수집 및 한국어 번역 실행
        run: python scripts/fetch_iraq_moh_news.py

      - name: 변경사항 자동 커밋
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: 이라크 MOH 뉴스 자동 업데이트"
          file_pattern: news.json
