// 사이트 설정. 값을 바꾸고 main 브랜치에 푸시하면 GitHub Pages에 바로 반영된다.
window.IQ_CONFIG = {
  // 애드센스 게시자 ID(ca-pub-...)와 디스플레이 광고 단위 ID.
  // client만 넣으면 자동 광고, slot까지 넣으면 지정한 위치에 광고가 나온다.
  // client를 넣을 때는 저장소 최상위에 ads.txt 파일도 함께 만들어야 한다 (README 참고).
  adsense: { client: '', slot: '' },
  // 제한 시간(초)
  durationSec: 25 * 60,
};
