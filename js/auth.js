/* 계정 — 아이디·비밀번호 로그인, 관리자 승인, 진도 동기화
 *
 * 설계 원칙
 *  1) 비밀번호는 이 코드가 절대 저장하지 않는다. Supabase Auth 가 해싱해 보관하고,
 *     여기서는 입력값을 그대로 넘기기만 한다. 대표님 비밀번호는 나도 볼 수 없다.
 *  2) 설정(config.js)이 비어 있으면 지금까지처럼 '혼자 쓰기'로 돈다. 로그인 없이 학습이 열린다.
 *  3) 학습은 늘 이 기기(localStorage)가 먼저다. 서버는 진도를 옮겨 담고 순위를 보여 주는 곳일 뿐이라
 *     인터넷이 끊겨도 오늘 공부는 된다.
 *  4) 화면에서는 '아이디'를 받지만 Supabase 는 이메일을 쓰므로 아이디@내부도메인 으로 바꿔 넘긴다.
 */
(function (w) {
  'use strict';

  var CFG = w.LANG_CONFIG || {};
  var DOMAIN = 'lang-daily.local';          // 아이디를 이메일 꼴로 바꿀 때 붙이는 내부 도메인
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  var Auth = {
    enabled: !!(CFG.supabaseUrl && CFG.supabaseKey),
    sb: null,
    user: null,
    profile: null,
    ready: false,

    // 아이디 → 내부 이메일. 대표님은 'coqss1' 만 치면 된다.
    toEmail: function (id) {
      var s = String(id || '').trim().toLowerCase();
      if (!s) return '';
      return s.indexOf('@') >= 0 ? s : (s + '@' + DOMAIN);
    },
    toId: function (email) {
      var s = String(email || '');
      return s.indexOf('@' + DOMAIN) > 0 ? s.split('@')[0] : s;
    },

    /* ---------- 시작 ---------- */

    init: function () {
      var self = this;
      if (!this.enabled) { this.ready = true; return Promise.resolve(null); }
      return this._loadSdk()
        .then(function () {
          self.sb = w.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
          return self.sb.auth.getSession();
        })
        .then(function (res) {
          var s = res && res.data && res.data.session;
          if (!s) { self.ready = true; return null; }
          self.user = s.user;
          return self.loadProfile();
        })
        .then(function (p) { self.ready = true; return p; })
        .catch(function (e) {
          // 인터넷이 없거나 CDN 이 막혀도 앱은 살아 있어야 한다
          self.ready = true; self.offline = true;
          return null;
        });
    },

    _loadSdk: function () {
      if (w.supabase && w.supabase.createClient) return Promise.resolve();
      return new Promise(function (ok, no) {
        var s = w.document.createElement('script');
        s.src = SDK;
        s.onload = function () { ok(); };
        s.onerror = function () { no(new Error('sdk')); };
        w.document.head.appendChild(s);
        setTimeout(function () { no(new Error('timeout')); }, 8000);
      });
    },

    /* ---------- 가입·로그인 ---------- */

    signUp: function (id, password, name) {
      var self = this;
      if (!this.sb) return Promise.reject(new Error('서버가 설정되지 않았습니다.'));
      return this.sb.auth.signUp({
        email: this.toEmail(id),
        password: password,
        options: { data: { name: name || id } }
      }).then(function (r) {
        if (r.error) throw r.error;
        // 이메일 확인을 끈 프로젝트에서는 곧바로 세션이 생긴다
        if (r.data && r.data.user) self.user = r.data.user;
        return self.loadProfile();
      });
    },

    signIn: function (id, password) {
      var self = this;
      if (!this.sb) return Promise.reject(new Error('서버가 설정되지 않았습니다.'));
      return this.sb.auth.signInWithPassword({
        email: this.toEmail(id), password: password
      }).then(function (r) {
        if (r.error) throw r.error;
        self.user = r.data.user;
        return self.loadProfile();
      });
    },

    signOut: function () {
      var self = this;
      if (!this.sb) return Promise.resolve();
      return this.sb.auth.signOut().then(function () {
        self.user = null; self.profile = null;
      });
    },

    loadProfile: function () {
      var self = this;
      if (!this.sb || !this.user) { this.profile = null; return Promise.resolve(null); }
      return this.sb.from('profiles').select('*').eq('id', this.user.id).maybeSingle()
        .then(function (r) {
          self.profile = (r && r.data) || null;
          return self.profile;
        })
        .catch(function () { self.profile = null; return null; });
    },

    isApproved: function () { return !!(this.profile && this.profile.status === 'approved'); },
    isAdmin: function () { return !!(this.profile && this.profile.role === 'admin'); },
    isBlocked: function () { return !!(this.profile && this.profile.status === 'blocked'); },
    displayName: function () {
      if (!this.profile) return '';
      return this.profile.name || this.toId(this.profile.email) || '';
    },

    errorText: function (e) {
      var m = (e && (e.message || e.error_description)) || '';
      if (/Invalid login credentials/i.test(m)) return '아이디나 비밀번호가 맞지 않습니다.';
      if (/already registered|already exists/i.test(m)) return '이미 있는 아이디입니다. 로그인해 주십시오.';
      if (/Password should be at least/i.test(m)) return '비밀번호가 너무 짧습니다. 6자 이상으로 해 주십시오.';
      if (/Email address .* invalid|invalid format/i.test(m)) return '아이디에 쓸 수 없는 글자가 있습니다. 영문·숫자로 지어 주십시오.';
      if (/rate limit|too many/i.test(m)) return '시도가 너무 잦습니다. 잠시 뒤 다시 해 주십시오.';
      if (/fetch|network|Failed to/i.test(m)) return '서버에 닿지 못했습니다. 인터넷 연결을 확인해 주십시오.';
      return m || '처리하지 못했습니다.';
    },

    /* ---------- 진도 동기화 ----------
     * 로컬이 원본이다. 서버 값이 더 크면(다른 기기에서 더 했다면) 그때만 내려받는다.
     */

    pull: function (lang) {
      var self = this;
      if (!this.sb || !this.user) return Promise.resolve(null);
      return this.sb.from('progress').select('*')
        .eq('user_id', this.user.id).eq('lang', lang).maybeSingle()
        .then(function (r) { return (r && r.data) || null; })
        .catch(function () { return null; });
    },

    push: function (lang, payload) {
      if (!this.sb || !this.user || !this.isApproved()) return Promise.resolve(false);
      return this.sb.from('progress').upsert({
        user_id: this.user.id,
        lang: lang,
        data: payload.data,
        xp: payload.xp | 0,
        streak: payload.streak | 0,
        done_count: payload.doneCount | 0,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,lang' })
        .then(function (r) { return !r.error; })
        .catch(function () { return false; });
    },

    ranking: function (lang, limit) {
      if (!this.sb || !this.isApproved()) return Promise.resolve([]);
      return this.sb.from('leaderboard').select('*')
        .eq('lang', lang).order('xp', { ascending: false }).limit(limit || 20)
        .then(function (r) { return (r && r.data) || []; })
        .catch(function () { return []; });
    },

    /* ---------- 관리자 ---------- */

    listUsers: function (status) {
      if (!this.sb || !this.isAdmin()) return Promise.resolve([]);
      var q = this.sb.from('profiles').select('*').order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      return q.then(function (r) { return (r && r.data) || []; }).catch(function () { return []; });
    },

    setStatus: function (id, status) {
      var self = this;
      if (!this.sb || !this.isAdmin()) return Promise.resolve(false);
      var patch = { status: status };
      if (status === 'approved') {
        patch.approved_at = new Date().toISOString();
        patch.approved_by = this.user.id;
      }
      return this.sb.from('profiles').update(patch).eq('id', id)
        .then(function (r) { return !r.error; }).catch(function () { return false; });
    },

    setRole: function (id, role) {
      if (!this.sb || !this.isAdmin()) return Promise.resolve(false);
      return this.sb.from('profiles').update({ role: role }).eq('id', id)
        .then(function (r) { return !r.error; }).catch(function () { return false; });
    }
  };

  w.Auth = Auth;
})(window);
