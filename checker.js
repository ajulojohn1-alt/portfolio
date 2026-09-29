document.addEventListener('DOMContentLoaded', () => {
  // Update footer year
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear().toString();
  }

  // Mobile navigation toggle
  const menuToggle = document.querySelector('.menu-toggle');
  const navMenu = document.getElementById('nav-menu');
  if (menuToggle && navMenu) {
    menuToggle.addEventListener('click', () => {
      const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
      menuToggle.setAttribute('aria-expanded', !expanded);
      navMenu.classList.toggle('active');
    });
  }

  // Form & Result UI Elements
  const auditForm = document.getElementById('auditForm');
  const websiteUrlInput = document.getElementById('website-url');
  const tradeCategorySelect = document.getElementById('trade-category');
  const auditBtn = document.getElementById('auditBtn');
  const exampleFillBtn = document.getElementById('exampleFill');
  const auditStatus = document.getElementById('auditStatus');

  const resultsContainer = document.getElementById('resultsContainer');
  const scoreCircle = document.getElementById('scoreCircle');
  const overallScore = document.getElementById('overallScore');
  const targetDomainDisplay = document.getElementById('targetDomainDisplay');

  const cards = {
    geo: document.getElementById('card-geo'),
    nap: document.getElementById('card-nap'),
    mobile: document.getElementById('card-mobile'),
    conversion: document.getElementById('card-conversion')
  };

  const leadGateForm = document.getElementById('leadGateForm');
  const leadEmailInput = document.getElementById('lead-email');
  const marketingConsent = document.getElementById('marketing-consent');
  const gateOverlay = document.getElementById('gateOverlay');
  const previewBlurSection = document.getElementById('previewBlurSection');
  const gateSuccessContainer = document.getElementById('gateSuccessContainer');
  const gateErrorMsg = document.getElementById('gateErrorMsg');
  const unlockedDomainName = document.getElementById('unlockedDomainName');

  let currentTargetDomain = '';

  function setStatus(msg, isError = false) {
    if (!auditStatus) return;
    if (!msg) {
      auditStatus.hidden = true;
      auditStatus.textContent = '';
      auditStatus.classList.remove('error');
    } else {
      auditStatus.hidden = false;
      auditStatus.textContent = msg;
      if (isError) {
        auditStatus.classList.add('error');
      } else {
        auditStatus.classList.remove('error');
      }
    }
  }

  function updateCard(cardEl, categoryData, defaultTitle) {
    if (!cardEl) return;
    const titleSpan = cardEl.querySelector('.metric-head span:first-child');
    const badgeSpan = cardEl.querySelector('.metric-head span:last-child');
    const descP = cardEl.querySelector('.metric-desc');

    cardEl.classList.remove('pass', 'warn', 'fail');

    if (!categoryData) {
      cardEl.classList.add('warn');
      if (badgeSpan) badgeSpan.textContent = 'Warning';
      return;
    }

    const status = categoryData.status || 'warn';
    cardEl.classList.add(status);

    if (titleSpan) titleSpan.textContent = categoryData.name || defaultTitle;
    if (badgeSpan) {
      badgeSpan.textContent = status === 'pass' ? 'Pass' : status === 'warn' ? 'Warning' : 'Needs work';
    }

    if (descP && categoryData.checks && categoryData.checks.length > 0) {
      const topChecks = categoryData.checks.map(c => `${c.name}: ${c.detail}`).slice(0, 2).join(' · ');
      descP.textContent = topChecks;
    }
  }

  if (auditForm) {
    auditForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setStatus('');

      let url = websiteUrlInput.value.trim();
      const trade = tradeCategorySelect.value;

      if (!url) {
        setStatus('Please enter your website address.', true);
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
      }

      try {
        const parsedUrl = new URL(url);
        currentTargetDomain = parsedUrl.hostname.replace(/^www\./, '');
      } catch {
        setStatus('Please enter a valid website URL.', true);
        return;
      }

      auditBtn.disabled = true;
      auditBtn.textContent = 'Auditing site...';
      setStatus('Analyzing website SEO, local NAP signals, mobile structure, and GEO AI readiness...');

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

        setStatus('');

        if (overallScore) overallScore.textContent = data.score;
        if (targetDomainDisplay) targetDomainDisplay.textContent = currentTargetDomain;

        if (scoreCircle) {
          scoreCircle.classList.remove('score-good', 'score-mid');
          if (data.score >= 75) {
            scoreCircle.classList.add('score-good');
          } else if (data.score >= 50) {
            scoreCircle.classList.add('score-mid');
          }
        }

        updateCard(cards.geo, data.categories?.answers || data.categories?.entity, 'GEO & AI readiness');
        updateCard(cards.nap, data.categories?.entity, 'Local signals (NAP)');
        updateCard(cards.mobile, data.categories?.search, 'Mobile experience');
        updateCard(cards.conversion, data.categories?.conversion, 'Lead capture');

        if (resultsContainer) {
          resultsContainer.style.display = 'block';
          resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (err) {
        setStatus(err.message || 'An error occurred during the audit. Please try again.', true);
      } finally {
        auditBtn.disabled = false;
        auditBtn.textContent = 'Audit my site';
      }
    });
  }

  if (exampleFillBtn) {
    exampleFillBtn.addEventListener('click', () => {
      if (websiteUrlInput) websiteUrlInput.value = 'joelremovals.co.uk';
      if (tradeCategorySelect) tradeCategorySelect.value = 'Removals and man and van';
      if (auditForm) {
        auditForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    });
  }

  if (leadGateForm) {
    leadGateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (gateErrorMsg) gateErrorMsg.style.display = 'none';

      const email = leadEmailInput?.value.trim();
      const consented = marketingConsent?.checked;

      if (!email || !consented) {
        if (gateErrorMsg) {
          gateErrorMsg.textContent = 'Please enter a valid email and accept the consent checkbox.';
          gateErrorMsg.style.display = 'block';
        }
        return;
      }

      if (unlockedDomainName) {
        unlockedDomainName.textContent = currentTargetDomain || 'your business';
      }

      if (gateOverlay) gateOverlay.style.display = 'none';
      if (previewBlurSection) previewBlurSection.style.display = 'none';
      if (gateSuccessContainer) gateSuccessContainer.style.display = 'block';
    });
  }
});