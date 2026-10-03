document.addEventListener('DOMContentLoaded', () => {
  // Footer year + mobile nav (kept from original page behaviour)
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear().toString();

  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.getElementById('nav-menu');
  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
      const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', String(!expanded));
      navMenu.classList.toggle('active');
    });
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Element refs ---------------- */
  const auditForm = document.getElementById('auditForm');
  const websiteUrlInput = document.getElementById('website-url');
  const tradeCategorySelect = document.getElementById('trade-category');
  const auditBtn = document.getElementById('auditBtn');
  const auditStatus = document.getElementById('auditStatus');

  const report = document.getElementById('resultsContainer');
  const gaugeFill = document.getElementById('gaugeFill');
  const overallScore = document.getElementById('overallScore');
  const reportDomain = document.getElementById('reportDomain');
  const reportTrade = document.getElementById('reportTrade');
  const reportStamp = document.getElementById('reportStamp');
  const scoreBand = document.getElementById('scoreBand');
  const countLine = document.getElementById('countLine');
  const miniBars = document.getElementById('miniBars');

  const execHeadline = document.getElementById('execHeadline');
  const execSummary = document.getElementById('execSummary');
  const execList = document.getElementById('execList');

  const alertsCard = document.getElementById('alertsCard');
  const alertList = document.getElementById('alertList');
  const alertCount = document.getElementById('alertCount');

  const psiGrid = document.getElementById('psiGrid');
  const psiWeight = document.getElementById('psiWeight');
  const psiPill = document.getElementById('psiPill');
  const psiNote = document.getElementById('psiNote');

  const deepSub = document.getElementById('deepSub');
  const groupsWrap = document.getElementById('groupsWrap');
  const modePlain = document.getElementById('modePlain');
  const modeTech = document.getElementById('modeTech');
  const showPass = document.getElementById('showPass');

  const upsellWrap = document.getElementById('upsellWrap');

  const leadGateForm = document.getElementById('leadGateForm');
  const leadEmailInput = document.getElementById('lead-email');
  const marketingConsent = document.getElementById('marketing-consent');
  const gateFormWrap = document.getElementById('gateFormWrap');
  const gateSuccessContainer = document.getElementById('gateSuccessContainer');
  const gateErrorMsg = document.getElementById('gateErrorMsg');
  const unlockedDomainName = document.getElementById('unlockedDomainName');
  const GAUGE_CIRC = 527.8;
  const RING_CIRC = 157.1;
  const STATUS_META = {
    pass: { label: 'Pass', icon: '✓' },
    warn: { label: 'Review', icon: '!' },
    fail: { label: 'Fail', icon: '✕' }
  };

  let currentTargetDomain = '';

  /* ---------------- Helpers ---------------- */
  function setStatus(msg, isError = false) {
    if (!auditStatus) return;
    if (!msg) {
      auditStatus.hidden = true;
      auditStatus.textContent = '';
      auditStatus.classList.remove('error');
    } else {
      auditStatus.hidden = false;
      auditStatus.textContent = msg;
      auditStatus.classList.toggle('error', isError);
    }
  }

  let statusCycleTimer = null;
  function startStatusCycle() {
    const phases = [
      'Fetching your homepage and response headers…',
      'Checking AI crawler permissions and structured data…',
      'Resolving DNS records (SPF, DKIM, DMARC, MTA-STS)…',
      'Testing sitemaps, 404 handling and asset caching…',
      'Scoring 85 checks and building your report…'
    ];
    let i = 0;
    setStatus(phases[0]);
    stopStatusCycle();
    statusCycleTimer = setInterval(() => {
      i = Math.min(i + 1, phases.length - 1);
      setStatus(phases[i]);
    }, 1600);
  }
  function stopStatusCycle() {
    if (statusCycleTimer) {
      clearInterval(statusCycleTimer);
      statusCycleTimer = null;
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function scoreColor(score) {
    return score >= 75 ? '#10b981' : score >= 50 ? 'var(--gold)' : 'var(--accent)';
  }

  function animateNumber(node, end, duration, suffix) {
    if (reduceMotion) {
      node.textContent = end + (suffix || '');
      return;
    }
    const t0 = performance.now();
    function frame(t) {
      const p = Math.min((t - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(end * eased) + (suffix || '');
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- Hero: gauge + summary ---------------- */
  function renderHero(data) {
    if (gaugeFill) {
      gaugeFill.classList.remove('band-good', 'band-mid');
      if (data.score >= 75) gaugeFill.classList.add('band-good');
      else if (data.score >= 50) gaugeFill.classList.add('band-mid');
      // Trigger the CSS transition on the next frame so it animates from empty
      requestAnimationFrame(() => {
        gaugeFill.style.strokeDashoffset = String(GAUGE_CIRC * (1 - data.score / 100));
      });
    }
    if (overallScore) animateNumber(overallScore, data.score, 1400);
    if (reportDomain) reportDomain.textContent = currentTargetDomain || 'your site';
    if (reportTrade && data.trade) {
      reportTrade.textContent = data.trade;
      reportTrade.hidden = false;
    }
    if (reportStamp) {
      const when = data.scannedAt ? new Date(data.scannedAt) : new Date();
      reportStamp.textContent =
        `${data.counts.total} checks · ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (scoreBand) {
      scoreBand.textContent = `${data.scoreBand} — ${data.score}/100`;
      scoreBand.style.color = scoreColor(data.score);
    }
    if (countLine) {
      countLine.innerHTML =
        `<b>${data.counts.pass}</b> passed · <b>${data.counts.warn}</b> need attention · <b>${data.counts.fail}</b> failed, out of ${data.counts.total} checks.`;
    }
    renderMiniBars(data.groups);
  }

  function renderMiniBars(groups) {
    if (!miniBars) return;
    miniBars.innerHTML = '';
    groups.forEach(g => {
      const counts = countByStatus(g.checks);
      const total = Math.max(1, g.checks.length);

      const bar = el('button', 'mini-bar');
      bar.type = 'button';
      bar.setAttribute('aria-label', `Open ${g.name} section, score ${g.score} out of 100`);

      const name = el('span', 'mini-name', g.name);
      const track = el('span', 'mini-track');
      [['mp', counts.pass], ['mw', counts.warn], ['mf', counts.fail]].forEach(([cls, n]) => {
        if (!n) return;
        const seg = el('i', cls);
        seg.style.width = `${(n / total) * 100}%`;
        track.appendChild(seg);
      });
      const score = el('span', 'mini-score', String(g.score));

      bar.append(name, track, score);
      bar.addEventListener('click', () => {
        openGroup(g.id);
        const target = document.getElementById(`acc-${g.id}`);
        if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
      miniBars.appendChild(bar);
    });
  }

  function countByStatus(checks) {
    const c = { pass: 0, warn: 0, fail: 0 };
    checks.forEach(ch => { c[ch.status] = (c[ch.status] || 0) + 1; });
    return c;
  }

  /* ---------------- Executive overview ---------------- */
  function renderExec(data) {
    if (execHeadline) execHeadline.textContent = data.exec.headline;
    if (execSummary) execSummary.textContent = data.exec.summary;
    if (execList) {
      execList.innerHTML = '';
      data.exec.items.forEach(item => {
        const li = el('li');
        li.appendChild(el('strong', null, item.title));
        li.appendChild(el('p', null, item.body));
        execList.appendChild(li);
      });
    }
  }

  /* ---------------- Priority fixes ---------------- */
  function renderAlerts(priorities) {
    if (!alertsCard || !alertList) return;
    alertList.innerHTML = '';

    if (!priorities.length) {
      const li = el('li');
      li.appendChild(el('strong', null, 'No red-flag failures found.'));
      li.appendChild(el('p', null, 'Nothing critical failed in this scan. Keep an eye on the "review" items in the full report below — they are the difference between passable and dominant.'));
      alertList.appendChild(li);
      alertsCard.style.background = 'linear-gradient(180deg,rgba(16,185,129,.09),var(--panel) 65%)';
      alertsCard.style.borderColor = '#10b981';
      if (alertCount) {
        alertCount.textContent = 'All clear';
        alertCount.style.background = '#10b981';
        alertCount.style.color = '#04120c';
      }
      return;
    }

    const hardFails = priorities.filter(p => p.status === 'fail').length;
    if (alertCount) alertCount.textContent = `${hardFails} red flag${hardFails === 1 ? '' : 's'}`;

    priorities.forEach(p => {
      const li = el('li', p.status === 'fail' ? '' : 'warn-item');
      const ico = el('span', 'alert-ico', p.status === 'fail' ? '✕' : '!');
      const body = el('div');
      body.appendChild(el('strong', null, p.title));
      body.appendChild(el('p', null, p.plain));
      body.appendChild(el('span', 'alert-src', p.group));
      li.append(ico, body);
      alertList.appendChild(li);
    });
  }

  /* ---------------- Simulated PageSpeed ---------------- */
  function ringPct(band) {
    return band === 'good' ? 0.9 : band === 'needs-work' ? 0.55 : 0.28;
  }

  function formatMetric(m) {
    if (m.unit === 'ms') return { val: m.value.toLocaleString('en-GB'), unit: 'ms' };
    if (m.unit === 's') return { val: String(m.value), unit: 's' };
    return { val: String(m.value), unit: '' };
  }

  function renderPsi(psi) {
    if (!psiGrid) return;
    psiGrid.innerHTML = '';

    const live = psi.source === 'psi';
    if (psiPill) psiPill.textContent = live ? 'Google PageSpeed Insights · mobile' : 'PageSpeed-style lab estimate';
    if (psiNote) psiNote.textContent = live
      ? `Measured live by Google's PageSpeed Insights API (mobile emulation, Lighthouse run). See the full report at pagespeed.web.dev.`
      : `Simulated lab data derived from your page's HTML, response headers and resource hints — directionally accurate, but not a Lighthouse run. Book a health check for measured field data on real devices.`;

    const metrics = [
      { key: 'fcp', code: 'FCP', full: 'First Contentful Paint — how long before anything appears' },
      { key: 'lcp', code: 'LCP', full: 'Largest Contentful Paint — how long before the main content shows' },
      { key: 'tbt', code: 'TBT', full: 'Total Blocking Time — how long the page freezes while scripts run' },
      { key: 'cls', code: 'CLS', full: 'Cumulative Layout Shift — how much the page jumps while loading' }
    ];

    metrics.forEach(m => {
      const data = psi[m.key];
      const card = el('div', `psi-metric ${data.band}`);

      const ring = el('div', 'psi-ring');
      ring.innerHTML =
        `<svg viewBox="0 0 120 66" aria-hidden="true">` +
        `<path class="psi-track" d="M10 60 A50 50 0 0 1 110 60"/>` +
        `<path class="psi-fill ${data.band}" d="M10 60 A50 50 0 0 1 110 60" stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${RING_CIRC}"/>` +
        `</svg>`;
      const fmt = formatMetric(data);
      const val = el('span', 'psi-val');
      val.append(document.createTextNode(fmt.val));
      if (fmt.unit) val.appendChild(el('small', null, fmt.unit));
      ring.appendChild(val);

      const label = el('h4', null, m.code);
      const sub = el('p', null, m.full);

      card.append(ring, label, sub);
      psiGrid.appendChild(card);

      const fillPath = ring.querySelector('.psi-fill');
      requestAnimationFrame(() => {
        fillPath.style.strokeDashoffset = String(RING_CIRC * (1 - ringPct(data.band)));
      });
    });

    if (psiWeight) {
      psiWeight.textContent = live
        ? `${psi.images} images · ${psi.thirdParties} third-party domains on the page`
        : `~${psi.estWeightKB.toLocaleString('en-GB')} KB estimated weight · ${psi.blocking.scripts} blocking script${psi.blocking.scripts === 1 ? '' : 's'}`;
    }
  }

  /* ---------------- Deep dive accordions ---------------- */
  function renderGroups(groups) {
    if (!groupsWrap) return;
    groupsWrap.innerHTML = '';
    const worst = groups.reduce((w, g) => (g.score < w.score ? g : w), groups[0]);

    groups.forEach(g => {
      const counts = countByStatus(g.checks);
      const total = Math.max(1, g.checks.length);

      const acc = el('article', 'acc');
      acc.id = `acc-${g.id}`;
      if (g.id === worst.id) acc.classList.add('open');

      const head = el('button', 'acc-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', String(g.id === worst.id));
      head.setAttribute('aria-controls', `acc-body-${g.id}`);

      const dot = el('span', `acc-dot ${g.status}`);
      const mid = el('div');
      const title = el('div', 'acc-title');
      title.appendChild(el('h3', null, g.name));
      title.appendChild(el('span', 'acc-score', `${g.score}/100`));
      const bar = el('div', 'acc-bar');
      [['bp', counts.pass], ['bw', counts.warn], ['bf', counts.fail]].forEach(([cls, n]) => {
        if (!n) return;
        const seg = el('i', cls);
        seg.style.width = `${(n / total) * 100}%`;
        bar.appendChild(seg);
      });
      mid.append(title, bar);

      const tally = el('span', 'acc-count');
      tally.innerHTML = `<b>${counts.pass}</b> pass · <b>${counts.warn}</b> review · <b>${counts.fail}</b> fail`;

      const chev = el('span', 'acc-chevron', '▾');

      head.append(dot, mid, tally, chev);
      head.addEventListener('click', () => toggleGroup(g.id));

      const body = el('div', 'acc-body');
      body.id = `acc-body-${g.id}`;
      const inner = el('div', 'acc-body-inner');
      const pad = el('div', 'acc-body-pad');
      pad.appendChild(el('p', 'acc-desc', g.description));

      const list = el('ul', 'chk-list');
      g.checks.forEach(c => {
        const meta = STATUS_META[c.status] || STATUS_META.warn;
        const li = el('li', `chk ${c.status}`);
        li.appendChild(el('span', 'chk-state', meta.icon));
        const txt = el('div');
        txt.appendChild(el('h4', 'chk-name', c.name));
        txt.appendChild(el('p', 'chk-plain', c.plain));
        txt.appendChild(el('p', 'chk-tech', c.detail));
        li.appendChild(txt);
        li.appendChild(el('span', 'chk-tag', meta.label));
        list.appendChild(li);
      });
      pad.appendChild(list);

      inner.appendChild(pad);
      body.appendChild(inner);
      acc.append(head, body);
      groupsWrap.appendChild(acc);
    });

    updateDeepSub(groups);
  }

  function toggleGroup(id) {
    const acc = document.getElementById(`acc-${id}`);
    if (!acc) return;
    const head = acc.querySelector('.acc-head');
    const open = acc.classList.toggle('open');
    if (head) head.setAttribute('aria-expanded', String(open));
  }

  function openGroup(id) {
    const acc = document.getElementById(`acc-${id}`);
    if (!acc) return;
    acc.classList.add('open');
    const head = acc.querySelector('.acc-head');
    if (head) head.setAttribute('aria-expanded', 'true');
  }

  function updateDeepSub(groups) {
    if (!deepSub || !groups) return;
    const shown = showPass && showPass.checked;
    deepSub.textContent = shown
      ? 'Every check the audit ran, colour-coded. Open each area to see what passed, what needs attention and what failed.'
      : 'Showing only the checks that need attention. Switch "Show passing checks" back on to see the full picture.';
  }

  /* ---------------- Toggle wiring ---------------- */
  if (modePlain && modeTech && report) {
    modePlain.addEventListener('click', () => {
      report.classList.remove('mode-tech');
      modePlain.classList.add('active');
      modePlain.setAttribute('aria-pressed', 'true');
      modeTech.classList.remove('active');
      modeTech.setAttribute('aria-pressed', 'false');
    });
    modeTech.addEventListener('click', () => {
      report.classList.add('mode-tech');
      modeTech.classList.add('active');
      modeTech.setAttribute('aria-pressed', 'true');
      modePlain.classList.remove('active');
      modePlain.setAttribute('aria-pressed', 'false');
    });
  }
  if (showPass && report) {
    showPass.addEventListener('change', () => {
      report.classList.toggle('hide-pass', !showPass.checked);
      updateDeepSub(lastData && lastData.groups);
    });
  }

  /* ---------------- Upsell routing ---------------- */
  function upsellCard(product, reasons, variant, tag) {
    const card = el('article', `upsell-card ${variant}`);
    card.appendChild(el('p', 'upsell-tag', tag));
    card.appendChild(el('h3', null, product.name));
    card.appendChild(el('p', 'upsell-price', product.price));
    card.appendChild(el('p', 'upsell-blurb', product.blurb));
    if (reasons && reasons.length) {
      const ul = el('ul', 'upsell-reasons');
      reasons.slice(0, 3).forEach(r => ul.appendChild(el('li', null, r)));
      card.appendChild(ul);
    }
    const cta = el('a', `btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} wide`, `Fix this — ${product.name.replace('The ', '')}`);
    cta.href = product.href;
    card.appendChild(cta);
    return card;
  }

  function renderUpsells(upsells) {
    if (!upsellWrap) return;
    upsellWrap.innerHTML = '';
    let shown = 0;

    if (upsells.geo && upsells.geo.show) {
      upsellWrap.appendChild(upsellCard(upsells.geo.product, upsells.geo.reasons, 'primary', 'Recommended for your audit results'));
      shown += 1;
    }
    if (upsells.technical && upsells.technical.show) {
      upsellWrap.appendChild(upsellCard(upsells.technical.product, upsells.technical.reasons, shown === 0 ? 'primary' : '', 'Best fix for widespread technical failures'));
      shown += 1;
    }
    if (upsells.conversion && upsells.conversion.show) {
      upsells.conversion.products.forEach(p => {
        upsellWrap.appendChild(upsellCard(p, upsells.conversion.reasons, 'quiet', 'Stop losing enquiries'));
        shown += 1;
      });
    }

    if (!shown) {
      const card = el('article', 'upsell-card quiet');
      card.appendChild(el('p', 'upsell-tag', 'Strong result'));
      card.appendChild(el('h3', null, 'Your site is in better shape than most'));
      card.appendChild(el('p', 'upsell-blurb', 'No critical failures found. The next level is measured field data, competitor benchmarking and a content plan — that is what the free health check covers.'));
      const cta = el('a', 'btn btn-primary wide', 'Book your free health check');
      cta.href = '/#contact';
      card.appendChild(cta);
      upsellWrap.appendChild(card);
    }
  }

  /* ---------------- Audit submission ---------------- */
  let lastData = null;

  if (auditForm) {
    auditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setStatus('');
      stopStatusCycle();

      let url = websiteUrlInput.value.trim();
      const trade = tradeCategorySelect.value;

      if (!url) {
        setStatus('Please enter your website address.', true);
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

      try {
        currentTargetDomain = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        setStatus('Please enter a valid website URL.', true);
        return;
      }

      auditBtn.disabled = true;
      auditBtn.textContent = 'Auditing site…';
      startStatusCycle();

      try {
        const response = await fetch('/api/audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, trade })
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data.error || `Server returned HTTP ${response.status}`);
        }

        stopStatusCycle();
        setStatus('');

        lastData = data;
        renderHero(data);
        renderExec(data);
        renderAlerts(data.priorities);
        renderPsi(data.psi);
        renderGroups(data.groups);
        renderUpsells(data.upsells);

        // Reset interactive controls to defaults for the new report; full analysis locked behind email gate
        if (report) {
          report.classList.add('gated');
          report.classList.remove('mode-tech', 'hide-pass', 'unlocked');
        }
        if (gateFormWrap) gateFormWrap.style.display = '';
        if (gateSuccessContainer) gateSuccessContainer.style.display = 'none';
        if (gateErrorMsg) gateErrorMsg.style.display = 'none';
        if (showPass) showPass.checked = true;
        if (modePlain && modeTech) {
          modePlain.classList.add('active');
          modePlain.setAttribute('aria-pressed', 'true');
          modeTech.classList.remove('active');
          modeTech.setAttribute('aria-pressed', 'false');
        }

        if (report) {
          report.style.display = 'block';
          report.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        }
      } catch (err) {
        stopStatusCycle();
        setStatus(err.message || 'An error occurred during the audit. Please try again.', true);
      } finally {
        auditBtn.disabled = false;
        auditBtn.textContent = 'Run my free audit';
      }
    });
  }

  /* ---------------- Email gate ---------------- */
  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xjykjojn';
  const submitGateBtn = document.getElementById('submitGateBtn');

  if (leadGateForm) {
    leadGateForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (gateErrorMsg) gateErrorMsg.style.display = 'none';

      const email = leadEmailInput ? leadEmailInput.value.trim() : '';
      const consented = marketingConsent && marketingConsent.checked;

      if (!email || !consented) {
        if (gateErrorMsg) {
          gateErrorMsg.textContent = 'Please enter a valid email and tick the consent checkbox to unlock your report.';
          gateErrorMsg.style.display = 'block';
        }
        return;
      }

      if (submitGateBtn) {
        submitGateBtn.disabled = true;
        submitGateBtn.textContent = 'Unlocking…';
      }

      try {
        const payload = new FormData();
        payload.append('email', email);
        payload.append('consent', 'yes — marketing emails agreed');
        payload.append('audited_site', currentTargetDomain || 'unknown');
        payload.append('trade', tradeCategorySelect ? tradeCategorySelect.value : '');
        payload.append('score', lastData ? String(lastData.score) : '');
        payload.append('source', 'SEO & GEO checker report unlock');
        payload.append('_gotcha', '');

        const res = await fetch(FORMSPREE_ENDPOINT, {
          method: 'POST',
          body: payload,
          headers: { Accept: 'application/json' }
        });
        if (!res.ok) throw new Error(`Formspree returned HTTP ${res.status}`);
      } catch (err) {
        if (submitGateBtn) {
          submitGateBtn.disabled = false;
          submitGateBtn.textContent = 'Unlock full report';
        }
        if (gateErrorMsg) {
          gateErrorMsg.textContent = 'Submission failed — please try again.';
          gateErrorMsg.style.display = 'block';
        }
        return;
      }

      if (unlockedDomainName) unlockedDomainName.textContent = currentTargetDomain || 'your site';

      // Release the wall: reveal the full analysis, swap the card to the confirmation panel
      if (report) {
        report.classList.remove('gated');
        report.classList.add('unlocked');
      }
      if (gateFormWrap) gateFormWrap.style.display = 'none';
      if (gateSuccessContainer) gateSuccessContainer.style.display = 'block';

      const deepDive = document.querySelector('.report .deepdive');
      if (deepDive && !reduceMotion) {
        setTimeout(() => deepDive.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
      }
    });
  }
});
