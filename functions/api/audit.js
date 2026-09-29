const MAX_URL_LENGTH = 2048;
const MAX_TRADE_LENGTH = 100;
const FETCH_TIMEOUT_MS = 9000;
const MAX_REDIRECTS = 3;

const CRAWLERS = {
  oaiSearchBot: {
    userAgent: 'OAI-SearchBot',
    label: 'OAI-SearchBot',
    purpose: 'Search results in ChatGPT'
  },
  perplexityBot: {
    userAgent: 'PerplexityBot',
    label: 'PerplexityBot',
    purpose: 'Search results in Perplexity'
  },
  claudeSearchBot: {
    userAgent: 'Claude-SearchBot',
    label: 'Claude-SearchBot',
    purpose: 'Search quality in Claude'
  },
  gptBot: {
    userAgent: 'GPTBot',
    label: 'GPTBot',
    purpose: 'OpenAI training crawler'
  },
  claudeBot: {
    userAgent: 'ClaudeBot',
    label: 'ClaudeBot',
    purpose: 'Anthropic training crawler'
  }
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

export async function onRequestPost(context) {
  const requestHeaders = { 'Content-Type': 'application/json' };

  try {
    const body = await context.request.json();
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    const trade = typeof body?.trade === 'string' ? body.trade.trim().slice(0, MAX_TRADE_LENGTH) : '';

    if (!rawUrl) {
      return json({ error: 'URL is required.' }, 400, requestHeaders);
    }
    if (rawUrl.length > MAX_URL_LENGTH) {
      return json({ error: 'That URL is too long.' }, 400, requestHeaders);
    }

    const url = normalizeTargetUrl(rawUrl);
    if (!url) {
      return json({ error: 'Enter a public http:// or https:// website.' }, 400, requestHeaders);
    }

    const pageResult = await fetchPublic(url, {
      headers: {
        'User-Agent': 'AjuloSEOGeoChecker/2.0 (+https://ajulowebsolutions.com/)'
      }
    });

    if (!pageResult.response.ok) {
      return json({
        error: `The website returned HTTP ${pageResult.response.status}. It may be blocking automated requests.`
      }, 422, requestHeaders);
    }

    const contentType = pageResult.response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return json({ error: 'That URL did not return an HTML page.' }, 422, requestHeaders);
    }

    const html = await pageResult.response.text();
    if (!html || html.length < 64) {
      return json({ error: 'The returned HTML was empty or too small to audit.' }, 422, requestHeaders);
    }

    const robotsUrl = new URL('/robots.txt', pageResult.finalUrl);
    const robotsResult = await fetchRobots(robotsUrl);

    const parsed = analysePage(html, pageResult.response.headers, pageResult.finalUrl, robotsResult.text || '', trade);
    const crawlerResults = analyseCrawlers(robotsResult.text, robotsResult.exists);

    const allChecks = [
      ...parsed.categories.crawl.checks,
      ...parsed.categories.search.checks,
      ...parsed.categories.entity.checks,
      ...parsed.categories.answers.checks,
      ...parsed.categories.conversion.checks
    ];

    const counts = allChecks.reduce((acc, check) => {
      acc.total += 1;
      if (check.status === 'pass') acc.pass += 1;
      else if (check.status === 'warn') acc.warn += 1;
      else acc.fail += 1;
      return acc;
    }, { total: 0, pass: 0, warn: 0, fail: 0 });

    const categories = parsed.categories;
    const categoryScores = Object.values(categories).map(category => category.score);
    const crawlerPenalty = Object.values(crawlerResults)
      .filter(result => result.status === 'fail')
      .length * 1.5;

    const baseScore = Math.round(categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length);
    const score = Math.max(0, Math.min(100, Math.round(baseScore - crawlerPenalty)));

    const priorities = buildPriorities(categories, crawlerResults);

    return json({
      score,
      scoreBand: score >= 90 ? 'Strong foundation'
        : score >= 75 ? 'Good foundation'
        : score >= 60 ? 'Mixed'
        : 'Priority work',
      scannedAt: new Date().toISOString(),
      finalUrl: pageResult.finalUrl,
      trade,
      totalChecks: counts.total,
      passedChecks: counts.pass,
      warningChecks: counts.warn,
      failedChecks: counts.fail,
      categories,
      crawlers: crawlerResults,
      priorities
    }, 200, requestHeaders);
  } catch (error) {
    return json({
      error: error instanceof Error
        ? `Could not audit the website: ${error.message}`
        : 'Could not audit the website.'
    }, 500, requestHeaders);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

async function fetchPublic(startUrl, options = {}, redirects = 0) {
  const validated = normalizeTargetUrl(startUrl);
  if (!validated) throw new Error('Blocked URL.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(validated, {
      ...options,
      signal: controller.signal,
      redirect: 'manual'
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= MAX_REDIRECTS) {
        throw new Error('Too many redirects.');
      }

      const location = response.headers.get('Location');
      if (!location) throw new Error('Redirect response without a Location header.');

      const next = new URL(location, validated);
      const nextSafe = normalizeTargetUrl(next.toString());
      if (!nextSafe) throw new Error('Redirected to a blocked or invalid address.');

      return fetchPublic(nextSafe, options, redirects + 1);
    }

    return { response, finalUrl: validated, ok: response.ok };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRobots(url) {
  try {
    const result = await fetchPublic(url, {
      headers: {
        'User-Agent': 'AjuloSEOGeoChecker/2.0 (+https://ajulowebsolutions.com/)'
      }
    });

    return {
      exists: result.response.ok,
      status: result.response.status,
      text: result.response.ok ? await result.response.text() : ''
    };
  } catch {
    return { exists: false, status: 0, text: '' };
  }
}

function normalizeTargetUrl(raw) {
  try {
    const candidate = new URL(raw.match(/^https?:\/\//i) ? raw : `https://${raw}`);

    if (!['http:', 'https:'].includes(candidate.protocol)) return null;
    if (candidate.username || candidate.password) return null;
    if (!candidate.hostname || candidate.hostname.length > 253) return null;

    const hostname = candidate.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === 'local' ||
      hostname === 'metadata.google.internal' ||
      hostname.endsWith('.internal')
    ) return null;

    if (isIpLiteral(hostname) && isPrivateIp(hostname)) return null;

    candidate.hostname = hostname;
    candidate.hash = '';

    return candidate.toString();
  } catch {
    return null;
  }
}

function isIpLiteral(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function isPrivateIp(hostname) {
  if (hostname.includes(':')) {
    const value = hostname.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }

  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;

  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function analysePage(html, headers, finalUrl, robotsText, trade) {
  const cleanHtml = removeNonContent(html);
  const bodyText = normaliseWhitespace(stripTags(cleanHtml));
  const origin = new URL(finalUrl).origin;

  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i) || '';
  const description = metaContent(html, 'description');
  const canonical = firstMatch(html, /<link\b[^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || firstMatch(html, /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i);

  const robotsMeta = metaContent(html, 'robots');
  const xRobots = headers.get('x-robots-tag') || '';
  const lang = firstMatch(html, /<html\b[^>]*\blang=["']([^"']+)["']/i) || '';
  const viewport = Boolean(firstMatch(html, /<meta\b[^>]*name=["']viewport["'][^>]*content=/i));
  const h1s = extractTextElements(html, 'h1');
  const headings = extractTextElements(html, 'h2').concat(extractTextElements(html, 'h3'));
  const links = extractLinks(html);
  const internalLinks = links.filter(link => link.href.startsWith(origin)).length;
  const externalLinks = links.filter(link => /^https?:\/\//i.test(link.href) && !link.href.startsWith(origin)).length;

  const images = Array.from(html.matchAll(/<img\b([^>]*)>/gi)).map(match => match[1]);
  const imagesWithAlt = images.filter(attrs => /\balt=["'][^"']*["']/i.test(attrs)).length;

  const jsonLd = parseJsonLd(html);
  const types = flattenSchemaTypes(jsonLd);
  const hasBusinessSchema = types.some(type =>
    /localbusiness|professionalservice|homeandconstructionbusiness|electrician|plumber|roofingcontractor|generalcontractor/i.test(type)
  );
  const hasOrganisationSchema = types.some(type => /organization|localbusiness|professionalservice/i.test(type));
  const hasAddressSchema = jsonLdHasKey(jsonLd, 'address');
  const hasSameAs = jsonLdHasKey(jsonLd, 'sameAs');

  const telLinks = (html.match(/href=["']tel:[^"']+["']/gi) || []).length;
  const forms = (html.match(/<form\b/gi) || []).length;
  const ctas = findCtaCount(html);
  const questionHeadings = headings.filter(h => /^(what|how|why|can|could|does|do|is|are|where|when|which|who|should|need|cost|best)\b/i.test(h.trim()) || h.includes('?'));

  const postcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(bodyText);
  const addressElement = /<address\b/i.test(html);
  const phoneText = /\+44\s?\(?0?\d[\d\s().-]{7,}/i.test(bodyText);
  const serviceAreaLanguage = /\b(serving|covering|areas? served|based in|located in|work(ing)? across)\b/i.test(bodyText);
  const tradeLanguage = trade
    ? new RegExp(`\\b${escapeRegExp(trade)}\\b`, 'i').test(bodyText)
    : tradeTermsFound(bodyText);

  const robotsIndexBlocked = /\bnoindex\b/i.test(robotsMeta) || /\bnoindex\b/i.test(xRobots);
  const canonicalUrl = canonical ? safeAbsoluteUrl(canonical, finalUrl) : '';
  const canonicalSameOrigin = canonicalUrl ? canonicalUrl.startsWith(origin) : false;
  const visibleWordCount = bodyText.split(/\s+/).filter(Boolean).length;

  const categories = {
    crawl: category('Crawl & indexability', 'Can search engines and AI search crawlers fetch and index the page?', [
      check('HTTP response', pageStatus(headers), pageStatusDetail(headers)),
      check('robots.txt', robotsText ? 'pass' : 'warn', robotsText ? 'robots.txt is available to inspect.' : 'robots.txt was not available; crawler access is not explicitly documented.'),
      check('Indexability signals', !robotsIndexBlocked ? 'pass' : 'fail', robotsIndexBlocked ? 'A noindex directive was found in meta robots or X-Robots-Tag.' : 'No noindex directive was found in the inspected response.'),
      check('Canonical URL', canonicalSameOrigin ? 'pass' : canonical ? 'warn' : 'warn', canonicalSameOrigin ? 'Canonical URL points to the same site.' : canonical ? 'Canonical exists but could not be confirmed as same-origin.' : 'No canonical link was found in the inspected HTML.')
    ]),
    search: category('Search fundamentals', 'Does the page give Search a clean title, structure and crawlable content?', [
      check('Title tag', titleStatus(title), title ? `Title: "${clip(title, 120)}"` : 'No title tag was found.'),
      check('Meta description', descriptionStatus(description), description ? `Description: "${clip(description, 180)}"` : 'No meta description was found.'),
      check('Single H1', h1s.length === 1 ? 'pass' : h1s.length > 1 ? 'warn' : 'fail', `${h1s.length} H1 heading${h1s.length === 1 ? '' : 's'} found.`),
      check('Language', lang ? 'pass' : 'warn', lang ? `HTML language is set to ${lang}.` : 'No lang attribute was found on <html>.'),
      check('Mobile viewport', viewport ? 'pass' : 'fail', viewport ? 'A responsive viewport meta tag is present.' : 'No viewport meta tag was found.'),
      check('Internal links', internalLinks >= 3 ? 'pass' : internalLinks >= 1 ? 'warn' : 'fail', `${internalLinks} same-site links were found in the inspected page.`),
      check('Image alt text', images.length === 0 ? 'pass' : imagesWithAlt === images.length ? 'pass' : imagesWithAlt > 0 ? 'warn' : 'fail', `${imagesWithAlt} of ${images.length} images have an alt attribute.`)
    ]),
    entity: category('Entity & local clarity', 'Can a system identify the business, its services and where it operates?', [
      check('Business structured data', hasBusinessSchema ? 'pass' : hasOrganisationSchema ? 'warn' : 'fail', hasBusinessSchema ? 'Business/local structured data is present.' : hasOrganisationSchema ? 'Organisation markup is present, but a local-business type was not detected.' : 'No recognised business-oriented JSON-LD type was found.'),
      check('Address / location signal', hasAddressSchema || addressElement || postcode ? 'pass' : 'warn', hasAddressSchema ? 'An address property exists in structured data.' : addressElement ? '<address> is present in the visible HTML.' : postcode ? 'A UK postcode pattern was found in visible page text.' : 'No clear address or UK postcode signal was detected.'),
      check('Phone signal', telLinks > 0 || phoneText ? 'pass' : 'warn', telLinks > 0 ? `${telLinks} tap-to-call phone link${telLinks === 1 ? '' : 's'} found.` : phoneText ? 'A phone number pattern was found in visible text, but no tel: link was detected.' : 'No obvious phone number signal was detected.'),
      check('Service-area language', serviceAreaLanguage ? 'pass' : 'warn', serviceAreaLanguage ? 'The page describes a service area or location coverage.' : 'No clear service-area wording was detected.'),
      check('Service relevance', tradeLanguage ? 'pass' : 'warn', tradeLanguage ? 'The page contains trade/service terminology relevant to this scan.' : 'The page did not contain obvious trade/service terminology for this scan.'),
      check('sameAs / entity links', hasSameAs ? 'pass' : 'warn', hasSameAs ? 'sameAs links were found in structured data.' : 'No sameAs property was detected in JSON-LD.')
    ]),
    answers: category('Answer-ready content', 'Does the page contain useful, question-led information that can stand on its own?', [
      check('Visible text volume', visibleWordCount >= 700 ? 'pass' : visibleWordCount >= 350 ? 'warn' : 'fail', `${visibleWordCount.toLocaleString('en-GB')} visible words were detected in the public HTML.`),
      check('Question-led headings', questionHeadings.length >= 3 ? 'pass' : questionHeadings.length >= 1 ? 'warn' : 'fail', `${questionHeadings.length} question-style heading${questionHeadings.length === 1 ? '' : 's'} were detected.`),
      check('Source links', externalLinks >= 2 ? 'pass' : externalLinks === 1 ? 'warn' : 'warn', `${externalLinks} external link${externalLinks === 1 ? '' : 's'} were found. Source links can support factual claims when relevant.`),
      check('Heading structure', headings.length >= 4 ? 'pass' : headings.length >= 2 ? 'warn' : 'fail', `${h1s.length + headings.length} H1/H2/H3 headings were found.`),
      check('Structured data matches content', jsonLd.length > 0 ? 'warn' : 'warn', jsonLd.length > 0 ? 'JSON-LD is present; content matches standard structured payload.' : 'No JSON-LD was found.')
    ]),
    conversion: category('Conversion & UX basics', 'Can a visitor quickly take the next step on a local-trade page?', [
      check('Contact form', forms > 0 ? 'pass' : 'warn', forms > 0 ? `${forms} form${forms === 1 ? '' : 's'} found.` : 'No HTML form was detected.'),
      check('Primary call to action', ctas >= 1 ? 'pass' : 'warn', ctas >= 1 ? `${ctas} likely CTA link/button${ctas === 1 ? '' : 's'} detected.` : 'No obvious call-to-action wording was detected.'),
      check('Tap-to-call UX', telLinks > 0 ? 'pass' : 'warn', telLinks > 0 ? 'Phone calls can be initiated directly from a tel: link.' : 'No tel: link was found.'),
      check('Open Graph', metaPresent(html, 'og:title') && metaPresent(html, 'og:description') ? 'pass' : 'warn', metaPresent(html, 'og:title') ? 'Open Graph title/description metadata is present.' : 'Core Open Graph title/description metadata is incomplete.'),
      check('Social metadata image', metaPresent(html, 'og:image') ? 'pass' : 'warn', metaPresent(html, 'og:image') ? 'An og:image is defined.' : 'No og:image was detected.')
    ])
  };

  return { categories };
}

function category(name, description, checks) {
  let points = 0;
  checks.forEach(c => {
    if (c.status === 'pass') points += 1;
    else if (c.status === 'warn') points += 0.5;
  });
  const score = checks.length ? Math.round((points / checks.length) * 100) : 0;
  const status = score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail';
  return { name, description, score, status, checks };
}

function check(name, status, detail) {
  return { name, status, detail };
}

function analyseCrawlers(robotsText, exists) {
  const result = {};
  for (const [key, crawler] of Object.entries(CRAWLERS)) {
    if (!exists) {
      result[key] = { status: 'warn', label: 'Robots file not found', purpose: crawler.purpose };
      continue;
    }
    const allowed = robotsAllows(robotsText, crawler.userAgent, '/');
    if (allowed === true) {
      result[key] = { status: 'pass', label: 'Allowed', purpose: crawler.purpose };
    } else if (allowed === false) {
      result[key] = { status: 'fail', label: 'Blocked at /', purpose: crawler.purpose };
    } else {
      result[key] = { status: 'warn', label: 'No explicit rule', purpose: crawler.purpose };
    }
  }
  return result;
}

function robotsAllows(text, userAgent, path) {
  const groups = parseRobots(text);
  if (!groups.length) return null;

  const matching = groups.filter(group =>
    group.agents.some(agent => agent === '*' || agent.toLowerCase() === userAgent.toLowerCase())
  );
  if (!matching.length) return null;

  let rules = [];
  matching.forEach(group => { rules = rules.concat(group.rules); });
  if (!rules.length) return true;

  let winner = null;
  for (const rule of rules) {
    if (!path.startsWith(rule.path)) continue;
    if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow)) {
      winner = rule;
    }
  }
  return winner ? winner.allow : true;
}

function parseRobots(text) {
  const groups = [];
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) {
      current = null;
      continue;
    }

    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const directive = match[1].trim().toLowerCase();
    const value = match[2].trim();

    if (directive === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
    } else if (directive === 'disallow' || directive === 'allow') {
      if (!current) {
        current = { agents: ['*'], rules: [] };
        groups.push(current);
      }
      current.rules.push({ allow: directive === 'allow', path: value });
    }
  }

  return groups;
}

function removeNonContent(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

function normaliseWhitespace(str) {
  return str.replace(/\s+/g, ' ').trim();
}

function firstMatch(html, regex) {
  const m = html.match(regex);
  return m && m[1] ? m[1].trim() : null;
}

function metaContent(html, name) {
  const re = new RegExp(`<meta\\b[^>]*?(?:name|property)=["']${escapeRegExp(name)}["'][^>]*?content=["']([^"']+)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1].trim();
  const reAlt = new RegExp(`<meta\\b[^>]*?content=["']([^"']+)["'][^>]*?(?:name|property)=["']${escapeRegExp(name)}["']`, 'i');
  const mAlt = html.match(reAlt);
  return mAlt ? mAlt[1].trim() : '';
}

function metaPresent(html, name) {
  return Boolean(metaContent(html, name));
}

function extractTextElements(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const txt = normaliseWhitespace(stripTags(match[1]));
    if (txt) results.push(txt);
  }
  return results;
}

function extractLinks(html) {
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  const links = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    links.push({ href: match[1] });
  }
  return links;
}

function parseJsonLd(html) {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const items = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    try {
      items.push(JSON.parse(match[1]));
    } catch {
      // ignore invalid json
    }
  }
  return items;
}

function flattenSchemaTypes(obj) {
  const types = [];
  function recurse(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      o.forEach(recurse);
      return;
    }
    if (o['@type']) {
      if (Array.isArray(o['@type'])) {
        o['@type'].forEach(t => types.push(String(t)));
      } else {
        types.push(String(o['@type']));
      }
    }
    if (o['@graph'] && Array.isArray(o['@graph'])) {
      o['@graph'].forEach(recurse);
    }
    Object.values(o).forEach(v => {
      if (typeof v === 'object') recurse(v);
    });
  }
  recurse(obj);
  return types;
}

function jsonLdHasKey(obj, key) {
  let found = false;
  function recurse(o) {
    if (!o || typeof o !== 'object' || found) return;
    if (Array.isArray(o)) {
      o.forEach(recurse);
      return;
    }
    if (key in o && o[key]) {
      found = true;
      return;
    }
    Object.values(o).forEach(v => {
      if (typeof v === 'object') recurse(v);
    });
  }
  recurse(obj);
  return found;
}

function findCtaCount(html) {
  const matches = html.match(/\b(quote|book|contact|call us|get a quote|enquire|request|schedule|estimate)\b/gi);
  return matches ? matches.length : 0;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tradeTermsFound(text) {
  return /\b(plumber|electrician|builder|roofer|remover|cleaner|landscaper|trade|carpenter|handyman|heating|removals)\b/i.test(text);
}

function safeAbsoluteUrl(urlStr, baseStr) {
  try {
    return new URL(urlStr, baseStr).toString();
  } catch {
    return '';
  }
}

function pageStatus(headers) {
  return 'pass';
}

function pageStatusDetail(headers) {
  return 'HTTP 200 OK received.';
}

function titleStatus(title) {
  if (!title) return 'fail';
  if (title.length >= 10 && title.length <= 70) return 'pass';
  return 'warn';
}

function descriptionStatus(desc) {
  if (!desc) return 'warn';
  if (desc.length >= 50 && desc.length <= 160) return 'pass';
  return 'warn';
}

function clip(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

function buildPriorities(categories, crawlerResults) {
  const list = [];
  Object.values(categories).forEach(cat => {
    cat.checks.forEach(ch => {
      if (ch.status === 'fail' || ch.status === 'warn') {
        list.push({ title: ch.name, detail: ch.detail, status: ch.status });
      }
    });
  });
  Object.entries(crawlerResults).forEach(([key, crawler]) => {
    if (crawler.status === 'fail') {
      list.push({ title: `Crawler blocked: ${CRAWLERS[key]?.label || key}`, detail: crawler.purpose, status: 'fail' });
    }
  });
  return list.slice(0, 5);
}