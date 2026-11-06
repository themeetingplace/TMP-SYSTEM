(() => {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const forcePreview = new URLSearchParams(window.location.search).has('production-hold-preview');
  if (localHosts.has(window.location.hostname) && !forcePreview) return;

  document.documentElement.classList.add('lobby-production-hold');
  const style = document.createElement('style');
  style.textContent = `
    html.lobby-production-hold,html.lobby-production-hold body{min-width:320px;min-height:100%;margin:0;background:#261f1a}
    html.lobby-production-hold body>*{display:none!important}
    html.lobby-production-hold body.production-hold-page{display:grid!important;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box;background:radial-gradient(circle at 50% 12%,#5a4435 0,#302720 48%,#1f1a16 100%);color:#392b23;font-family:"Microsoft JhengHei","Noto Sans TC",sans-serif}
    html.lobby-production-hold body.production-hold-page>.hold-card{display:grid!important;position:relative;width:min(520px,100%);overflow:hidden;border:4px solid #17120f;background:#fff1d2;box-shadow:10px 10px 0 rgba(0,0,0,.34)}
    .hold-card:before{content:"";height:12px;background:repeating-linear-gradient(135deg,#ef7c45 0 15px,#33271f 15px 30px)}
    .hold-scene{display:grid;place-items:center;min-height:190px;border-bottom:4px solid #4d392d;background-color:#dca66f;background-image:linear-gradient(45deg,rgba(255,245,215,.3) 25%,transparent 25%,transparent 75%,rgba(255,245,215,.3) 75%);background-size:32px 32px}
    .hold-build{position:relative;width:116px;height:98px;border:4px solid #2f241e;background:#f8d194;box-shadow:6px 6px 0 rgba(60,38,25,.26)}
    .hold-build:before,.hold-build:after{content:"";position:absolute;bottom:0;width:31px;height:47px;border:4px solid #2f241e;background:#ef7c45}
    .hold-build:before{left:10px}.hold-build:after{right:10px;background:#4d77a8}
    .hold-build i{position:absolute;left:50%;top:-28px;width:72px;height:34px;transform:translateX(-50%);border:4px solid #2f241e;background:#3e9c91;clip-path:polygon(50% 0,100% 100%,0 100%)}
    .hold-build b{position:absolute;left:50%;top:25px;transform:translateX(-50%);font:900 18px/1 ui-monospace,monospace;color:#8d4b2e;letter-spacing:4px}
    .hold-copy{padding:26px 30px 30px;text-align:center}
    .hold-kicker{margin:0 0 8px;color:#a05234;font:900 11px/1 ui-monospace,monospace;letter-spacing:.2em}
    .hold-copy h1{margin:0;font-size:clamp(25px,6vw,34px);letter-spacing:.04em}
    .hold-copy p{margin:13px auto 22px;max-width:390px;color:#705b4d;font-size:15px;line-height:1.75}
    .hold-progress{display:flex;justify-content:center;gap:7px;margin-bottom:22px}.hold-progress i{width:10px;height:10px;border:2px solid #49362b;background:#ef7c45}.hold-progress i:nth-child(2){background:#f1b447}.hold-progress i:nth-child(3){background:#3e9c91}
    .hold-back{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 18px;border:3px solid #2e241e;background:#fff8e8;color:#3b2c24;text-decoration:none;font-size:14px;font-weight:900;box-shadow:4px 4px 0 #c99264}.hold-back:hover{transform:translate(-1px,-1px);box-shadow:5px 5px 0 #b77c50}.hold-back:focus-visible{outline:3px solid #ef7c45;outline-offset:3px}
    @media(max-width:520px){html.lobby-production-hold body.production-hold-page{padding:14px}.hold-scene{min-height:165px}.hold-copy{padding:22px 20px 25px}}
    @media(prefers-reduced-motion:reduce){.hold-back{transition:none}}
  `;
  document.head.append(style);

  const renderHold = () => {
    document.title = '聚空間大廳｜建置中';
    document.body.className = 'production-hold-page';
    document.body.innerHTML = `
      <main class="hold-card" aria-labelledby="hold-title">
        <div class="hold-scene" aria-hidden="true"><div class="hold-build"><i></i><b>···</b></div></div>
        <section class="hold-copy">
          <p class="hold-kicker">MEETING PLACE WORLD</p>
          <h1 id="hold-title">角色大廳建置中</h1>
          <p>我們正在調整角色外觀、移動效果與留言功能。完成前暫不開放，其他 PMS 功能仍可正常使用。</p>
          <div class="hold-progress" aria-hidden="true"><i></i><i></i><i></i></div>
          <a class="hold-back" href="../../index.html#dashboard">返回 PMS 首頁</a>
        </section>
      </main>`;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderHold, { once:true });
  else renderHold();
})();
