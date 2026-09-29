const CONFIG = {
  AUDIT_API_URL: '/api/audit',
  FORMSPREE_URL: 'https://formspree.io/f/xjykjojn'
};

document.addEventListener('DOMContentLoaded', () => {
  bindMenu();
  bindAuditForm();
  bindLeadForm();
  bindPlanButtons();
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
});

function bindMenu() {
  const menuBtn = document.querySelector('.menu-toggle');
  const navLinks = document.getElementById('nav-menu');
  if (!menuBtn || !navLinks) return;

  menuBtn.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    });
  });
}

function bindAuditForm() {
  const form = document.getElementById('auditForm');
  if (form) form.addEventListener('submit', handleAuditSubmit);
}

function bindLeadForm() {
  const form = document.getElementById('leadGateForm');
  if (form) form.addEventListener('submit', handleLeadGateSubmit);

  const printBtn = document.getElementById('printReportBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());
}

function bindPlanButtons() {
  // Reserved for future CTA integrations without adding inline event handlers.
}

async function handleAuditSubmit(event) {
  event.preventDefault();

  const urlInput = document.getElementById('website-url');
  const tradeInput = document.getElementById('trade-category');
  const button = document.getElementById('auditBtn');
  const error = document.getElementById('auditError');

  clearError(error);

  const formattedUrl = normalizeUrl(urlInput?.value || '');
  if (!formattedUrl) {
    showError(error, 'Enter a full website address, for example https://example.co.uk');
    urlInput?.focus();
    return;
  }

  urlInput.value = formattedUrl;
  button.disabled = true;
  button.textContent = 'Scanning website…';

  try {
    const response = await fetch(CONFIG.AUDIT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        url: formattedUrl,
        trade: tradeInput?.value || ''
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'The audit could not reach that website.');
    }

    if (!data || typeof data.score !== 'number' || !data.categories) {
      throw new Error('The audit returned an unexpected result. Please try again.');
    }

    renderAuditResults(formattedUrl, data);
  } catch (errorValue) {
    showError(error, errorValue instanceof Error ? errorValue.message : 'Connection error while auditing the website.');
  } finally {
    button.disabled = false;
    button.textContent = 'Check my website';
  }
}

function renderAuditResults(url, data) {
  const domain = safeHostname(url);
  const results = document.getElementById('resultsContainer');
  const display = document.getElementById('targetDomainDisplay');
  const scoreEl = document.getElementById('overallScore');
  const bandEl = document.getElementById('scoreBand');
  const leadDomain = document.getElementById('unlockedDomainName');
  const leadScore = document.getElementById('lead-score');

  if (display) display.textContent = domain || url;
  if (scoreEl) scoreEl.textContent = String(data.score);
  if (bandEl) bandEl.textContent = scoreBand(data.score);
  if (leadDomain) leadDomain.value = domain || url;
  if (leadScore) leadScore.value = String(data.score);

  const scoreCard = document.querySelector('.score-card');
  if (scoreCard) scoreCard.style.setProperty('--score', `${clamp(data.score, 0, 100)}%`);

  renderSummary(data);
  renderCategories(data.categories);
  renderCrawlers(data.crawlers || {});
  renderPriorities(data);
  renderFullReport(data);

  if (results) {
    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderSummary(data) {
  const target = document.getElementById('summaryBar');
  if (!target) return;

  const total = Number.isFinite(data.totalChecks) ? data.totalChecks : 0;
  const passed = Number.isFinite(data.passedChecks) ? data.passedChecks : 0;
  const warnings = Number.isFinite(data.warningChecks) ? data.warningChecks : 0;
  const failures = Number.isFinite(data.failedChecks) ? data.failedChecks : 0;

  target.innerHTML = `
    <strong>${escapeHtml(String(total))} checks</strong>
    <span>${escapeHtml(String(passed))} passed</span>
    <span>${escapeHtml(String(warnings))} partial</span>
    <span>${escapeHtml(String(failures))} need work</span>
    <span>Scanned: ${escapeHtml(data.scannedAt || 'just now')}</span>
  `;
}

function renderCategories(categories) {
  const grid = document.getElementById('metricGrid');
  if (!grid) return;

  const entries = Object.values(categories);
  grid.innerHTML = entries.map(category => {
    const status = categoryStatus(category.score);
    return `
      <article class="metric-card ${status}">
        <div class="metric-status">${escapeHtml(statusLabel(status))}</div>
        <h3>${escapeHtml(category.name)}</h3>
        <div class="metric-score">${escapeHtml(String(category.score))}<span class="metric-out-of">/100</span></div>
        <p class="metric-desc">${escapeHtml(category.summary)}</p>
      </article>
    `;
  }).join('');
}

function renderCrawlers(crawlers) {
  const grid = document.getElementById('crawlerGrid');
  if (!grid) return;

  const items = [
    ['OAI-SearchBot', 'OpenAI search', crawlers.oaiSearchBot],
    ['PerplexityBot', 'Perplexity search', crawlers.perplexityBot],
    ['Claude-SearchBot', 'Anthropic search', crawlers.claudeSearchBot],
    ['GPTBot', 'OpenAI training', crawlers.gptBot],
    ['ClaudeBot', 'Anthropic training', crawlers.claudeBot]
  ];

  grid.innerHTML = items.map(([name, use, info]) => {
    const status = info?.status || 'warn';
    const text = info?.label || statusLabel(status);
    return `
      <div class="crawler-item ${escapeAttr(status)}">
        <span class="crawler-name">${escapeHtml(name)}</span>
        <span class="crawler-use">${escapeHtml(use)}</span>
        <span class="crawler-status">${escapeHtml(text)}</span>
      </div>
    `;
  }).join('');
}

function renderPriorities(data) {
  const list = document.getElementById('priorityList');
  if (!list) return;

  const priorities = Array.isArray(data.priorities) ? data.priorities.slice(0, 5) : [];
  if (!priorities.length) {
    list.innerHTML = '<li><div><strong>Keep monitoring</strong><span>No major checklist failures were returned by this scan.</span></div></li>';
    return;
  }

  list.innerHTML = priorities.map(item => `
    <li>
      <div>
        <strong>${escapeHtml(item.title || 'Improvement')}</strong>
        <span>${escapeHtml(item.reason || '')}</span>
      </div>
    </li>
  `).join('');
}

function renderFullReport(data) {
  const target = document.getElementById('fullReport');
  if (!target) return;

  target.innerHTML = Object.values(data.categories).map(category => {
    const checks = Array.isArray(category.checks) ? category.checks : [];
    return `
      <section class="report-category">
        <header>
          <h3>${escapeHtml(category.name)}</h3>
          <span>${escapeHtml(String(category.score))}/100</span>
        </header>
        ${checks.map(check => `
          <div class="report-check ${escapeAttr(check.status)}">
            <span class="status-dot" aria-hidden="true"></span>
            <div>
              <strong>${escapeHtml(check.label)}</strong>
              <p>${escapeHtml(check.detail)}</p>
            </div>
            <span class="status-text">${escapeHtml(statusLabel(check.status))}</span>
          </div>
        `).join('')}
      </section>
    `;
  }).join('');
}

async function handleLeadGateSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const email = document.getElementById('lead-email')?.value.trim() || '';
  const domain = document.getElementById('unlockedDomainName')?.value || '';
  const score = document.getElementById('lead-score')?.value || '';
  const reportConsent = document.getElementById('report-consent');
  const marketingConsent = document.getElementById('marketing-consent');
  const button = document.getElementById('submitGateBtn');
  const error = document.getElementById('gateErrorMsg');
  const report = document.getElementById('unlockedReport');
  const gate = document.getElementById('leadGateSection');

  clearError(error);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError(error, 'Enter a valid email address.');
    return;
  }

  if (!reportConsent?.checked) {
    showError(error, 'Please agree to receive the requested audit report.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Sending report…';

  try {
    const response = await fetch(CONFIG.FORMSPREE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        email,
        website: domain,
        audit_score: score,
        report_consent: 'Yes',
        marketing_consent: marketingConsent?.checked ? 'Yes' : 'No',
        source: 'Free SEO & GEO Checker'
      })
    });

    if (!response.ok) throw new Error('The report request could not be submitted. Please try again.');

    if (gate) gate.hidden = true;
    if (report) {
      report.hidden = false;
      report.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (errorValue) {
    showError(error, errorValue instanceof Error ? errorValue.message : 'The report request failed.');
  } finally {
    button.disabled = false;
    button.textContent = 'Email my full report';
  }
}

function normalizeUrl(input) {
  let value = input.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (!url.hostname) return '';
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function safeHostname(value) {
  try { return new URL(value).hostname; } catch { return ''; }
}

function scoreBand(score) {
  if (score >= 90) return 'Strong foundation';
  if (score >= 75) return 'Good foundation';
  if (score >= 60) return 'Mixed';
  return 'Priority work';
}

function categoryStatus(score) {
  if (score >= 80) return 'pass';
  if (score >= 60) return 'warn';
  return 'fail';
}

function statusLabel(status) {
  if (status === 'pass') return 'Pass';
  if (status === 'fail') return 'Needs work';
  return 'Partial';
}

function showError(target, message) {
  if (!target) return;
  target.textContent = message;
  target.hidden = false;
}

function clearError(target) {
  if (!target) return;
  target.textContent = '';
  target.hidden = true;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/\s/g, '');
}
