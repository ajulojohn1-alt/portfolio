const CONFIG = {
  AUDIT_API_URL: '/api/audit',
  // REPLACE THIS VALUE with your Formspree Endpoint ID (e.g., 'https://formspree.io/f/xjykjojn')
  FORMSPREE_URL: 'https://formspree.io/f/xjykjojn'
};

document.addEventListener('DOMContentLoaded', () => {
  const menuBtn = document.querySelector('.menu-toggle');
  const navLinks = document.getElementById('nav-menu');
  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', isOpen);
    });
  }

  const auditForm = document.getElementById('auditForm');
  const leadForm = document.getElementById('leadGateForm');

  if (auditForm) auditForm.addEventListener('submit', handleAuditSubmit);
  if (leadForm) leadForm.addEventListener('submit', handleLeadGateSubmit);
});

async function handleAuditSubmit(e) {
  e.preventDefault();

  const urlInputEl = document.getElementById('website-url');
  const categoryInput = document.getElementById('trade-category').value;
  const submitBtn = document.getElementById('auditBtn');

  if (!urlInputEl || !urlInputEl.value.trim() || !categoryInput) return;

  // 1. Clean raw input: strip existing protocol/slashes
  let rawUrl = urlInputEl.value.trim().toLowerCase();
  rawUrl = rawUrl.replace(/^https?:\/\//i, '').replace(/^\/+/, '');

  // 2. Prepend clean https:// protocol
  const formattedUrl = 'https://' + rawUrl;

  // 3. Update field visually and for lead gate submission
  urlInputEl.value = formattedUrl;

  const cleanDomain = rawUrl.replace(/\/.*$/, '');
  
  submitBtn.disabled = true;
  submitBtn.textContent = 'Scanning Site...';

  try {
    const response = await fetch(CONFIG.AUDIT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: formattedUrl, trade: categoryInput })
    });

    const data = await response.json();

    if (!response.ok) {
      alert(data.error || 'Could not reach website. Check the URL and try again.');
      return;
    }

    renderAuditResults(cleanDomain, data);

  } catch (err) {
    alert('Connection error while auditing website. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Audit My Site';
  }
}

function renderAuditResults(domain, data) {
  document.getElementById('targetDomainDisplay').textContent = domain;
  document.getElementById('unlockedDomainName').textContent = domain;
  document.getElementById('overallScore').textContent = data.score;

  updateCard('card-geo', data.metrics.geo);
  updateCard('card-nap', data.metrics.nap);
  updateCard('card-mobile', data.metrics.mobile);
  updateCard('card-conversion', data.metrics.conversion);

  const container = document.getElementById('resultsContainer');
  container.style.display = 'block';
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateCard(id, metric) {
  const card = document.getElementById(id);
  if (!card) return;

  card.className = 'metric-card ' + metric.status;
  const statusSpan = card.querySelector('.metric-head span:last-child');
  const descP = card.querySelector('.metric-desc');

  if (metric.status === 'pass') {
    statusSpan.textContent = 'Passed';
    statusSpan.style.color = '#10b981';
  } else if (metric.status === 'warn') {
    statusSpan.textContent = 'Partial';
    statusSpan.style.color = '#ffb800';
  } else {
    statusSpan.textContent = 'Needs Work';
    statusSpan.style.color = '#ff5c1f';
  }

  descP.textContent = metric.desc;
}

async function handleLeadGateSubmit(e) {
  e.preventDefault();

  const consentCheckbox = document.getElementById('marketing-consent');
  const emailInput = document.getElementById('lead-email').value;
  const websiteUrl = document.getElementById('website-url').value;
  const tradeCategory = document.getElementById('trade-category').value;
  const score = document.getElementById('overallScore').textContent;
  const submitBtn = document.getElementById('submitGateBtn');
  const errorMsg = document.getElementById('gateErrorMsg');

  if (!consentCheckbox.checked) {
    alert('Please tick the consent checkbox to receive your report.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Unlocking...';
  errorMsg.style.display = 'none';

  try {
    const response = await fetch(CONFIG.FORMSPREE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email: emailInput,
        website: websiteUrl,
        trade: tradeCategory,
        audit_score: score,
        marketing_consent: 'Yes',
        source: 'Free SEO & GEO Checker'
      })
    });

    if (response.ok) {
      document.getElementById('previewBlurSection').style.display = 'none';
      document.getElementById('gateOverlay').style.display = 'none';
      document.getElementById('gateSuccessContainer').style.display = 'block';
    } else {
      errorMsg.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get Full Report';
    }
  } catch (err) {
    errorMsg.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Get Full Report';
  }
}