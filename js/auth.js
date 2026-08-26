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

  // 설정은 두 곳에서 온다.
  //  1) config.js — 배포본에 박아 두는 값(모든 사람에게 적용)
  //  2) 이 기기에 저장한 값 — 대표님이 앱 안 화면에서 붙여넣은 값(먼저 적용)
  // 2번을 둔 이유: 제가 대표님 대신 서버 계정을 만들 수 없어서, 키만 받으면
  // 코드를 고치지 않고도 바로 켜 볼 수 있게 하기 위해서다.
  var LOCAL_KEY = 'langdaily.server';

  function localCfg() {
    try {
      var raw = w.localStorage.getItem(LOCAL_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && o.supabaseUrl && o.supabaseKey) ? o : null;
    } catch (e) { return null; }
  }

  var CFG = localCfg() || w.LANG_CONFIG || {};
  var DOMAIN = 'lang-daily.local';          // 아이디를 이메일 꼴로 바꿀 때 붙이는 내부 도메인
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  var Auth = {
    enabled: !!(CFG.supabaseUrl && CFG.supabaseKey),
    sb: null,
    user: null,
    profile: null,
    ready: false,

    LOCAL_KEY: LOCAL_KEY,
    fromLocal: !!localCfg(),
    cfg: CFG,

    // 이 기기에 서버 설정을 저장한다(붙여넣기로 켜 보기용)
    saveConfig: function (url, key) {
      var u = String(url || '').trim().replace(/\/+$/, '');
      var k = String(key || '').trim();
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u)) {
        return { ok: false, msg: '주소 형식이 다릅니다. https://xxxx.supabase.co 꼴이어야 합니다.' };
      }
      if (k.length < 20) return { ok: false, msg: '키가 너무 짧습니다. anon(공개) 키를 그대로 붙여넣어 주십시오.' };
      try {
        w.localStorage.setItem(LOCAL_KEY, JSON.stringify({ supabaseUrl: u, supabaseKey: k }));
      } catch (e) { return { ok: false, msg: '이 브라우저에 저장하지 못했습니다.' }; }
      return { ok: true };
    },

    clearConfig: function () {
      try { w.localStorage.removeItem(LOCAL_KEY); } catch (e) {}
    },

    // 서버가 살아 있는지, 표가 깔렸는지 실제로 확인한다
    diagnose: function () {
      var self = this;
      if (!this.enabled) return Promise.resolve({ step: 'config', msg: '아직 서버 주소·키가 없습니다.' });
      return this._loadSdk()
        .then(function () {
          if (!self.sb) self.sb = w.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
          return self.sb.from('profiles').select('id').limit(1);
        })
        .then(function (r) {
          if (r.error) {
            var m = r.error.message || '';
            if (/relation .* does not exist|schema cache|Could not find the table/i.test(m)) {
              return { step: 'schema', msg: '서버에는 닿았지만 표가 없습니다. SQL 편집기에 schema.sql 을 실행해 주십시오.' };
            }
            if (/JWT|Invalid API key|apikey|401|403/i.test(m)) {
              return { step: 'key', msg: '키가 맞지 않습니다. anon(공개) 키를 다시 확인해 주십시오.' };
            }
            // 없는 주소면 fetch 자체가 실패한다. 이걸 '정상'으로 넘기면 안 된다.
            if (/Failed to fetch|NetworkError|TypeError|ERR_/i.test(m)) {
              return { step: 'net', msg: '그 주소의 서버에 닿지 못했습니다. Project URL 을 다시 확인해 주십시오.' };
            }
            // 로그인 전에는 행이 안 보이는 것이 정상(RLS)
            return { step: 'ok', msg: '서버와 표가 준비됐습니다. 이제 가입하시면 됩니다.' };
          }
          return { step: 'ok', msg: '서버와 표가 준비됐습니다. 이제 가입하시면 됩니다.' };
        })
        .catch(function (e) {
          return { step: 'net', msg: '서버에 닿지 못했습니다. 주소를 확인하고 인터넷 연결을 봐 주십시오.' };
        });
    },

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
        // 이메일 확인을 끈 프로젝트에서는 곧바로 세션이 생긴다.
        // 세션이 없다면 'Confirm email' 이 켜져 있다는 뜻 — 아이디 로그인이 막히므로 바로 알려 준다.
        var hasSession = !!(r.data && r.data.session);
        if (r.data && r.data.user) self.user = r.data.user;
        if (!hasSession) {
          var e = new Error('confirm-email-on');
          e.code = 'confirm-email-on';
          throw e;
        }
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
      if (e && e.code === 'confirm-email-on') {
        return '계정은 만들어졌지만 로그인이 열리지 않았습니다. Supabase → Authentication → ' +
               'Sign In / Providers → Email 에서 "Confirm email" 을 끄고, 로그인 탭에서 다시 들어와 주십시오.';
      }
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

    /* ---------- 실시간 ----------
     * 남이 공부하면 내 순위표가 바로 움직인다.
     * 바뀐 내용을 그대로 쓰지 않고 '바뀌었다'는 신호만 받아 다시 조회한다.
     * 그래야 행 수준 보안에 걸려 일부만 오는 경우에도 화면이 어긋나지 않는다.
     */
    watch: function (lang, onChange) {
      if (!this.sb || !this.isApproved()) return function () {};
      var ch = this.sb.channel('rank-' + lang)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'progress', filter: 'lang=eq.' + lang },
            function () { try { onChange(); } catch (e) {} })
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'duels' },
            function () { try { onChange(); } catch (e) {} })
        .subscribe();
      var sb = this.sb;
      return function () { try { sb.removeChannel(ch); } catch (e) {} };
    },

    /* ---------- 전화번호 (동의 기반 친구 찾기) ----------
     * 번호 자체는 서버에 올리지 않는다. 이 기기에서 해시로 바꿔 그것만 보낸다.
     * 그래서 서버가 털려도 번호는 나오지 않고, 번호를 이미 아는 사람만 찾을 수 있다.
     */
    normPhone: function (s) {
      var d = String(s || '').replace(/[^0-9]/g, '');
      if (!d) return '';
      if (d.indexOf('82') === 0 && d.length >= 11) d = '0' + d.slice(2);   // +82 10 … → 010 …
      return d;
    },

    hashPhone: function (phone) {
      var n = this.normPhone(phone);
      if (n.length < 9) return Promise.resolve(null);
      if (!(w.crypto && w.crypto.subtle)) return Promise.resolve(null);
      var buf = new TextEncoder().encode('lang-daily:' + n);
      return w.crypto.subtle.digest('SHA-256', buf).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      }).catch(function () { return null; });
    },

    // 동의 없이는 저장하지 않는다. consent 가 참일 때만 부른다.
    savePhone: function (phone, consent) {
      var self = this;
      if (!this.sb || !this.user) return Promise.resolve({ ok: false, msg: '로그인이 필요합니다.' });
      if (!consent) return Promise.resolve({ ok: false, msg: '동의하셔야 저장할 수 있습니다.' });
      return this.hashPhone(phone).then(function (h) {
        if (!h) return { ok: false, msg: '번호 형식을 확인해 주십시오(숫자 9자리 이상).' };
        return self.sb.from('phone_index').upsert({
          user_id: self.user.id,
          phone_hash: h,
          consent_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' }).then(function (r) {
          if (r.error) return { ok: false, msg: r.error.message };
          return { ok: true };
        });
      });
    },

    myPhoneState: function () {
      if (!this.sb || !this.user) return Promise.resolve(null);
      return this.sb.from('phone_index').select('consent_at,updated_at')
        .eq('user_id', this.user.id).maybeSingle()
        .then(function (r) { return (r && r.data) || null; })
        .catch(function () { return null; });
    },

    deletePhone: function () {
      if (!this.sb || !this.user) return Promise.resolve(false);
      return this.sb.from('phone_index').delete().eq('user_id', this.user.id)
        .then(function (r) { return !r.error; }).catch(function () { return false; });
    },

    findByPhone: function (phone) {
      var self = this;
      if (!this.sb || !this.isApproved()) return Promise.resolve(null);
      return this.hashPhone(phone).then(function (h) {
        if (!h) return null;
        return self.sb.rpc('find_by_phone', { h: h }).then(function (r) {
          var rows = (r && r.data) || [];
          return rows.length ? rows[0] : null;
        }).catch(function () { return null; });
      });
    },

    /* ---------- 대결 ---------- */

    // 순위표에 있는 사람들 = 대결을 걸 수 있는 사람들
    opponents: function (lang) {
      var me = this.user && this.user.id;
      return this.ranking(lang, 50).then(function (rows) {
        return rows.filter(function (r) { return r.id !== me; });
      });
    },

    listDuels: function () {
      var me = this.user && this.user.id;
      if (!this.sb || !me) return Promise.resolve([]);
      return this.sb.from('duels').select('*')
        .or('challenger.eq.' + me + ',opponent.eq.' + me)
        .in('status', ['pending', 'active', 'done'])
        .order('created_at', { ascending: false }).limit(20)
        .then(function (r) { return (r && r.data) || []; })
        .catch(function () { return []; });
    },

    createDuel: function (opponentId, lang, days) {
      var self = this;
      if (!this.sb || !this.user || !this.isApproved()) {
        return Promise.resolve({ ok: false, msg: '승인된 계정만 대결을 걸 수 있습니다.' });
      }
      return this.sb.from('duels').insert({
        lang: lang, challenger: this.user.id, opponent: opponentId, days: days || 7, status: 'pending'
      }).then(function (r) {
        return r.error ? { ok: false, msg: self.errorText(r.error) } : { ok: true };
      });
    },

    acceptDuel: function (id) {
      if (!this.sb) return Promise.resolve(false);
      return this.sb.rpc('accept_duel', { duel_id: id })
        .then(function (r) { return !r.error; }).catch(function () { return false; });
    },

    // 거절·취소는 상태만 바꾼다(기록은 남긴다)
    setDuelStatus: function (id, status) {
      if (!this.sb) return Promise.resolve(false);
      return this.sb.from('duels').update({ status: status }).eq('id', id)
        .then(function (r) { return !r.error; }).catch(function () { return false; });
    },

    duelStanding: function (id) {
      if (!this.sb) return Promise.resolve(null);
      return this.sb.rpc('duel_standing', { duel_id: id })
        .then(function (r) {
          var rows = (r && r.data) || [];
          return rows.length ? rows[0] : null;
        }).catch(function () { return null; });
    },

    closeDuel: function (id) {
      if (!this.sb) return Promise.resolve(null);
      return this.sb.rpc('close_duel', { duel_id: id })
        .then(function (r) { return (r && r.data) || null; }).catch(function () { return null; });
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
