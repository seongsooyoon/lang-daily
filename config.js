/* 계정 서버 설정
 *
 * 비워 두면 지금처럼 '혼자 쓰기'로 돕니다(로그인 없이 이 기기에만 저장).
 * 값을 채우면 여러 사람이 계정으로 쓰고, 관리자가 승인해야 학습이 열립니다.
 *
 * 채우는 법은 SETUP.md 참고. anon key 는 공개돼도 되는 키이며,
 * 실제 접근 통제는 Supabase 쪽 행 수준 보안(RLS)이 맡습니다.
 */
window.LANG_CONFIG = {
  supabaseUrl: 'https://tbljuqfcnzvwfwwzjxhn.supabase.co',
  supabaseKey: 'sb_publishable_oIH3VcNe9SbPppklmKWAww_aoxNsQ0p',   // 공개용(publishable) 키. 비밀키는 절대 넣지 않는다.

  // 계정을 쓰더라도 학습 자체는 인터넷 없이 되게 한다(진도는 나중에 올린다)
  offlineFirst: true
};
