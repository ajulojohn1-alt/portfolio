const MAX_URL_LENGTH = 2048;
const MAX_TRADE_LENGTH = 100;
const FETCH_TIMEOUT_MS = 9000;
const DNS_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

const UA = 'AjuloSEOGeoChecker/3.0 (+https://ajulowebsolutions.com/)';

const CRAWLERS = {
  oaiSearchBot: { userAgent: 'OAI-SearchBot', label: 'OAI-SearchBot (ChatGPT search)', purpose: 'Live search results quoted inside ChatGPT' },
  perplexityBot: { userAgent: 'PerplexityBot', label: 'PerplexityBot', purpose: 'Search results and citations in Perplexity' },
  claudeSearchBot: { userAgent: 'Claude-SearchBot', label: 'Claude-SearchBot', purpose: 'Search quality for answers in Claude' },
  gptBot: { userAgent: 'GPTBot', label: 'GPTBot', purpose: 'OpenAI model training crawler' },
  claudeBot: { userAgent: 'ClaudeBot', label: 'ClaudeBot', purpose: 'Anthropic model training crawler' },
  googleBot: { userAgent: 'Googlebot', label: 'Googlebot', purpose: 'Google Search and AI Overviews' }
};

const DKIM_SELECTORS = ['default', 'google', 'selector1', 'k1'];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
    const trade = typeof body?.trade === 'string' ? body.trade.trim().slice(0, MAX_TRADE_LENGTH) : '';

    if (!rawUrl) return json({ error: 'URL is required.' }, 400);
    if (rawUrl.length > MAX_URL_LENGTH) return json({ error: 'That URL is too long.' }, 400);

    const url = normalizeTargetUrl(rawUrl);
    if (!url) return json({ error: 'Enter a public http:// or https:// website.' }, 400);

    // Round 1: the page itself (gives us origin + headers + HTML)
    const pageResult = await fetchPublic(url, { headers: { 'User-Agent': UA } });

    if (!pageResult.response.ok) {
      return json({
        error: `The website returned HTTP ${pageResult.response.status}. It may be blocking automated requests.`
      }, 422);
    }

    const contentType = pageResult.response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return json({ error: 'That URL did not return an HTML page.' }, 422);
    }

    const html = await pageResult.response.text();
    if (!html || html.length < 64) {
      return json({ error: 'The returned HTML was empty or too small to audit.' }, 422);
    }

    const finalUrl = pageResult.finalUrl;
    const origin = new URL(finalUrl).origin;
    const rootDomain = registrableDomain(new URL(finalUrl).hostname);

    // Round 2: everything else in parallel. Failures degrade to warn-level checks.
    const [robotsRes, sitemapRes, llmsRes, missingRes, dnsRoot, dnsDmarc, dnsMtaSts, dnsDkim, assetRes] = await Promise.allSettled([
      fetchRobots(new URL('/robots.txt', finalUrl)),
      fetchText(new URL('/sitemap.xml', finalUrl)),
      fetchText(new URL('/llms.txt', finalUrl)),
      fetchStatusOnly(new URL(`/ajulo-404-probe-${Date.now().toString(36)}.html`, origin)),
      dnsTxt(rootDomain),
      dnsTxt(`_dmarc.${rootDomain}`),
      dnsTxt(`_mta-sts.${rootDomain}`),
      Promise.all(DKIM_SELECTORS.map(s => dnsTxt(`${s}._domainkey.${rootDomain}`))),
      fetchAssetCacheHeaders(html, origin)
    ]);

    let mtaStsPolicy = null;
    const mtaStsRecords = valueOf(dnsMtaSts);
    if (mtaStsRecords && mtaStsRecords.length) {
      mtaStsPolicy = await fetchText(new URL(`https://mta-sts.${rootDomain}/.well-known/mta-sts.txt`)).catch(() => null);
    }

    const page = analysePage(html, pageResult.response.headers, finalUrl, valueOf(robotsRes) || { exists: false, status: 0, text: '' }, {
      trade,
      sitemap: valueOf(sitemapRes),
      llmsTxt: valueOf(llmsRes),
      missingUrlResult: valueOf(missingRes),
      redirects: pageResult.redirects,
      rootDomain,
      assetCache: valueOf(assetRes)
    });

    const crawlerResults = analyseCrawlers(valueOf(robotsRes)?.text || '', valueOf(robotsRes)?.exists === true);

    const security = analyseSecurity(pageResult.response.headers, html, finalUrl, {
      spf: valueOf(dnsRoot),
      dmarc: valueOf(dnsDmarc),
      mtaSts: mtaStsRecords,
      mtaStsPolicy,
      dkim: valueOf(dnsDkim)
    });

    const groups = [
      buildGeoGroup(page, crawlerResults),
      buildSeoGroup(page),
      buildPerformanceGroup(page, pageResult.response.headers),
      security,
      buildConversionGroup(page)
    ];

    const counts = { total: 0, pass: 0, warn: 0, fail: 0 };
    groups.forEach(g => g.checks.forEach(c => {
      counts.total += 1;
      if (c.status === 'pass') counts.pass += 1;
      else if (c.status === 'warn') counts.warn += 1;
      else counts.fail += 1;
    }));

    const WEIGHTS = { geo: 0.25, seo: 0.25, perf: 0.2, sec: 0.15, conv: 0.15 };
    const score = Math.max(0, Math.min(100, Math.round(
      groups.reduce((sum, g) => sum + g.score * (WEIGHTS[g.id] || 0.2), 0)
    )));

    const priorities = buildPriorities(groups);
    const exec = buildExecOverview(priorities, groups, counts);
    const psi = buildSimulatedPsi(page);
    const upsells = buildUpsellRoutes(groups, psi);

    return json({
      score,
      scoreBand: score >= 90 ? 'Strong foundation'
        : score >= 75 ? 'Good foundation'
        : score >= 60 ? 'Mixed — fixable'
        : 'Priority work needed',
      scannedAt: new Date().toISOString(),
      finalUrl,
      trade,
      counts,
      groups,
      priorities,
      exec,
      psi,
      upsells
    });
  } catch (error) {
    return json({
      error: error instanceof Error
        ? `Could not audit the website: ${error.message}`
        : 'Could not audit the website.'
    }, 500);
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

/* ============================== Fetch helpers ============================== */

function valueOf(settled) {
  return settled && settled.status === 'fulfilled' ? settled.value : null;
}

async function fetchPublic(startUrl, options = {}, redirects = 0) {
  const validated = normalizeTargetUrl(startUrl);
  if (!validated) throw new Error('Blocked URL.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(validated, { ...options, signal: controller.signal, redirect: 'manual' });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects >= MAX_REDIRECTS) throw new Error('Too many redirects.');
      const location = response.headers.get('Location');
      if (!location) throw new Error('Redirect response without a Location header.');
      const nextSafe = normalizeTargetUrl(new URL(location, validated).toString());
      if (!nextSafe) throw new Error('Redirected to a blocked or invalid address.');
      return fetchPublic(nextSafe, options, redirects + 1);
    }

    return { response, finalUrl: validated, redirects };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRobots(url) {
  try {
    const result = await fetchPublic(url, { headers: { 'User-Agent': UA } });
    return {
      exists: result.response.ok,
      status: result.response.status,
      text: result.response.ok ? await result.response.text() : ''
    };
  } catch {
    return { exists: false, status: 0, text: '' };
  }
}

async function fetchText(url) {
  const result = await fetchPublic(url, { headers: { 'User-Agent': UA } });
  if (!result.response.ok) return null;
  const text = await result.response.text();
  return text ? { text, status: result.response.status, finalUrl: result.finalUrl } : null;
}

async function fetchStatusOnly(url) {
  const result = await fetchPublic(url, { headers: { 'User-Agent': UA } });
  return { status: result.response.status, finalUrl: result.finalUrl };
}

async function fetchAssetCacheHeaders(html, origin) {
  const match = html.match(/(?:src|href)=["'](\/[^"']+\.(?:css|js|png|jpe?g|webp|avif|woff2?))["']/i)
    || html.match(/(?:src|href)=["']([^"']+\/(?:img|images|assets|static|wp-content)\/[^"']+\.(?:css|js|png|jpe?g|webp|avif|woff2?))["']/i);
  if (!match) return null;
  const assetUrl = safeAbsoluteUrl(match[1], origin);
  if (!assetUrl) return null;
  const result = await fetchPublic(assetUrl, { method: 'HEAD', headers: { 'User-Agent': UA } });
  return {
    url: assetUrl,
    status: result.response.status,
    cacheControl: result.response.ok ? (result.response.headers.get('cache-control') || '') : '',
    etag: result.response.headers.get('etag'),
    lastModified: result.response.headers.get('last-modified')
  };
}

async function dnsTxt(name) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
      { headers: { accept: 'application/dns-json' }, signal: controller.signal }
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.Answer || !Array.isArray(data.Answer)) return null;
    return data.Answer
      .filter(a => a.type === 16)
      .map(a => String(a.data || '').replace(/^"|"$/g, ''));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function registrableDomain(hostname) {
  return hostname.toLowerCase().replace(/^www\./, '');
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
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/* ============================== Page analysis ============================== */

function analysePage(html, headers, finalUrl, robotsResult, extra) {
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
  const viewport = /<meta\b[^>]*name=["']viewport["'][^>]*content=/i.test(html)
    || /<meta\b[^>]*content=[^>]*name=["']viewport["']/i.test(html);
  const h1s = extractTextElements(html, 'h1');
  const h2s = extractTextElements(html, 'h2');
  const h3s = extractTextElements(html, 'h3');
  const headings = h2s.concat(h3s);
  const links = extractLinks(html);
  const resolvedLinks = links
    .map(l => ({ href: l.href, abs: safeAbsoluteUrl(l.href, finalUrl) }))
    .filter(l => l.abs);
  const internalLinks = resolvedLinks.filter(l => {
    try { return new URL(l.abs).origin === origin; } catch { return false; }
  }).length;
  const externalLinks = resolvedLinks.filter(l => {
    if (!/^https?:\/\//i.test(l.href)) return false;
    try { return new URL(l.abs).origin !== origin; } catch { return false; }
  }).length;

  // --- images ---
  const imgTags = Array.from(html.matchAll(/<img\b([^>]*)>/gi)).map(m => m[1]);
  const imagesWithAlt = imgTags.filter(a => /\balt=["'][^"']*["']/i.test(a)).length;
  const lazyImages = imgTags.filter(a => /\bloading=["']lazy["']/i.test(a)).length;
  const modernImages = imgTags.filter(a => /\.(webp|avif)["'?#]/i.test(a) || /type=["']image\/(?:webp|avif)["']/i.test(a) || /\bsrcset=/i.test(a)).length;
  const sizedImages = imgTags.filter(a => (/\bwidth=["']\d+/i.test(a) && /\bheight=["']\d+/i.test(a)) || /\bsizes=/i.test(a)).length;
  const fetchPriorityImages = imgTags.filter(a => /fetchpriority=["']high["']/i.test(a)).length;

  // --- scripts & css ---
  const scriptTags = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)).map(m => ({ attrs: m[1], body: m[2] || '' }));
  const externalScripts = scriptTags.filter(s => /\bsrc=/i.test(s.attrs));
  const deferredScripts = externalScripts.filter(s => /\b(defer|async)=/i.test(s.attrs));
  const headHtml = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [null, ''])[1] || '';
  const headScripts = Array.from(headHtml.matchAll(/<script\b([^>]*)>/gi)).map(m => m[1]);
  const blockingHeadScripts = headScripts.filter(a => /\bsrc=/i.test(a) && !/\b(defer|async|type=["']module["'])/i.test(a));
  const stylesheetLinks = Array.from(html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi)).map(m => m[0]);
  const headStylesheets = stylesheetLinks.filter(t => headHtml.includes(t)).length;
  const inlineScriptBytes = scriptTags.reduce((n, s) => (!/\bsrc=/i.test(s.attrs) ? n + s.body.length : n), 0);
  const inlineStyleTags = (html.match(/<style\b/gi) || []).length;

  const thirdPartyDomains = new Set(
    externalScripts
      .map(s => (s.attrs.match(/\bsrc=["']([^"']+)["']/i) || [null, ''])[1])
      .filter(src => /^https?:\/\//i.test(src))
      .map(src => { try { return new URL(src).hostname; } catch { return ''; } })
      .filter(Boolean)
      .filter(h => !h.endsWith(registrableDomain(new URL(finalUrl).hostname)) && h !== new URL(finalUrl).hostname)
  );

  const preconnects = (html.match(/<link\b[^>]*rel=["'][^"']*preconnect[^"']*["']/gi) || []).length;
  const preloads = (html.match(/<link\b[^>]*rel=["'][^"']*preload[^"']*["']/gi) || []).length;
  const fontSwaps = /font-display\s*:\s*swap/i.test(html) || /display=swap/i.test(html);
  const fontPreloads = (html.match(/<link\b[^>]*rel=["'][^"']*preload[^"']*["'][^>]*as=["']font["']/gi) || []).length;
  const googleFonts = /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(html);
  const iframes = (html.match(/<iframe\b/gi) || []).length;

  // --- schema ---
  const jsonLd = parseJsonLd(html);
  const types = flattenSchemaTypes(jsonLd);
  const hasBusinessSchema = types.some(t => /localbusiness|professionalservice|homeandconstructionbusiness|electrician|plumber|roofingcontractor|generalcontractor|movingcompany|housingsociety/i.test(t));
  const hasOrganisationSchema = types.some(t => /organization|organisation|localbusiness|professionalservice/i.test(t));
  const hasAddressSchema = jsonLdHasKey(jsonLd, 'address');
  const hasTelephoneSchema = jsonLdHasKey(jsonLd, 'telephone');
  const hasGeoSchema = jsonLdHasKey(jsonLd, 'geo');
  const hasHoursSchema = jsonLdHasKey(jsonLd, 'openingHoursSpecification') || jsonLdHasKey(jsonLd, 'openingHours');
  const hasSameAs = jsonLdHasKey(jsonLd, 'sameAs');
  const hasRatingSchema = jsonLdHasKey(jsonLd, 'aggregateRating') || jsonLdHasKey(jsonLd, 'review');
  const hasBreadcrumbSchema = types.some(t => /breadcrumblist/i.test(t));
  const hasServiceSchema = types.some(t => /service|offer|offercatalog/i.test(t));
  const hasFaqSchema = types.some(t => /faqpage|questionandanswer/i.test(t));

  // --- conversion signals ---
  const telLinks = (html.match(/href=["']tel:[^"']+["']/gi) || []).length;
  const forms = (html.match(/<form\b/gi) || []).length;
  const ctas = findCtaCount(html);
  const mailtoLinks = (html.match(/href=["']mailto:[^"']+["']/gi) || []).length;
  const whatsapp = /wa\.me|api\.whatsapp\.com/i.test(html);
  const socialProof = /\b(reviews?|testimonials?|rated|stars?|trustpilot|checkatrade|which\?? ?trusted)\b/i.test(bodyText);
  const trustMarkers = /\b(insured|guarantee[d]?|accredited|certified|fully qualified|gas safe|niceic|fidra|bartec)\b/i.test(bodyText);
  const questionHeadings = headings.filter(h => /^(what|how|why|can|could|does|do|is|are|where|when|which|who|should|need|cost|best)\b/i.test(h.trim()) || h.includes('?'));

  const postcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(bodyText);
  const addressElement = /<address\b/i.test(html);
  const phoneText = /\+44\s?\(?0?\d[\d\s().-]{7,}/i.test(bodyText);
  const serviceAreaLanguage = /\b(serving|covering|areas? served|based in|located in|work(ing)? across)\b/i.test(bodyText);
  const tradeLanguage = extra.trade
    ? new RegExp(`\\b${escapeRegExp(extra.trade)}\\b`, 'i').test(bodyText)
    : tradeTermsFound(bodyText);

  const robotsIndexBlocked = /\bnoindex\b/i.test(robotsMeta) || /\bnoindex\b/i.test(xRobots);
  const canonicalUrl = canonical ? safeAbsoluteUrl(canonical, finalUrl) : '';
  const canonicalSameOrigin = canonicalUrl ? canonicalUrl.startsWith(origin) : false;
  const visibleWordCount = bodyText.split(/\s+/).filter(Boolean).length;
  const domElementCount = (html.match(/<\/?[a-z][^>]*>/gi) || []).length;
  const hreflangTags = (html.match(/<link\b[^>]*hreflang=/gi) || []).length;
  const favicon = /<link\b[^>]*rel=["'][^"']*icon[^"']*["']/i.test(html);
  const ogComplete = metaPresent(html, 'og:title') && metaPresent(html, 'og:description') && metaPresent(html, 'og:image');
  const ogPartial = metaPresent(html, 'og:title') || metaPresent(html, 'og:description');
  const twitterCard = metaPresent(html, 'twitter:card');
  const mixedContent = /^https:/i.test(finalUrl) ? (html.match(/(?:src|href)=["']http:\/\/(?!localhost)/gi) || []).length : -1;

  // --- sitemap & llms.txt ---
  const sitemap = extra.sitemap ? parseSitemap(extra.sitemap.text) : null;
  const llms = extra.llmsTxt ? analyseLlmsTxt(extra.llmsTxt.text) : null;

  // --- 404 probe ---
  const missing = extra.missingUrlResult || null;
  const soft404 = missing ? missing.status >= 200 && missing.status < 300 : null;

  return {
    html, headers, finalUrl, origin, title, description, canonical, canonicalUrl, canonicalSameOrigin,
    robotsMeta, robotsIndexBlocked, lang, viewport, h1s, h2s, h3s, headings, links, internalLinks, externalLinks,
    imgTags, imagesWithAlt, lazyImages, modernImages, sizedImages, fetchPriorityImages,
    scriptTags, externalScripts, deferredScripts, blockingHeadScripts, stylesheetLinks, headStylesheets,
    inlineScriptBytes, inlineStyleTags, thirdPartyDomains, preconnects, preloads, fontSwaps, fontPreloads,
    googleFonts, iframes,
    jsonLd, types, hasBusinessSchema, hasOrganisationSchema, hasAddressSchema, hasTelephoneSchema,
    hasGeoSchema, hasHoursSchema, hasSameAs, hasRatingSchema, hasBreadcrumbSchema, hasServiceSchema, hasFaqSchema,
    telLinks, forms, ctas, mailtoLinks, whatsapp, socialProof, trustMarkers, questionHeadings,
    postcode, addressElement, phoneText, serviceAreaLanguage, tradeLanguage,
    visibleWordCount, domElementCount, hreflangTags, favicon, ogComplete, ogPartial, twitterCard, mixedContent,
    sitemap, llms, missing, soft404, robotsResult, extra
  };
}

function parseSitemap(text) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<')) return { valid: false, urls: 0, isIndex: false, lastmods: [] };
  const locs = trimmed.match(/<loc>\s*[^<]+?\s*<\/loc>/gi) || [];
  const lastmods = (trimmed.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/gi) || []).map(t => t.replace(/<\/?lastmod>/g, '').trim());
  return {
    valid: /<urlset|<sitemapindex/i.test(trimmed),
    urls: locs.length,
    isIndex: /<sitemapindex/i.test(trimmed),
    lastmods
  };
}

function analyseLlmsTxt(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const h1 = /^#\s+.+/m.test(trimmed);
  const links = (trimmed.match(/^#{1,6}\s+.*\[.*\]\(https?:\/\/.*\)/gm) || []).length;
  const mentionsSite = /https?:\/\//.test(trimmed);
  return { h1, links, mentionsSite, length: trimmed.length };
}

/* ============================== Group builders ============================== */

function category(id, name, description, checks) {
  let points = 0;
  checks.forEach(c => {
    if (c.status === 'pass') points += 1;
    else if (c.status === 'warn') points += 0.5;
  });
  const score = checks.length ? Math.round((points / checks.length) * 100) : 0;
  const status = score >= 80 ? 'pass' : score >= 50 ? 'warn' : 'fail';
  return { id, name, description, score, status, checks };
}

function check(name, status, detail, plain, sev) {
  return { name, status, detail, plain, sev: sev || 'normal' };
}

function buildGeoGroup(page, crawlerResults) {
  const checks = [];

  const crawlerPlans = {
    oaiSearchBot: ['pass', 'ChatGPT search can crawl your pages', 'ChatGPT search is blocked from your pages — you cannot be quoted in answers', 'sev-critical'],
    perplexityBot: ['pass', 'Perplexity can crawl your pages', 'Perplexity is blocked from your pages — you cannot be cited in its answers', 'sev-critical'],
    claudeSearchBot: ['pass', 'Claude search can crawl your pages', 'Claude search is blocked from your pages', 'sev-high'],
    gptBot: ['pass', 'OpenAI training crawler allowed', 'OpenAI training crawler is blocked — future models learn nothing about your business', 'sev-high'],
    claudeBot: ['pass', 'Anthropic training crawler allowed', 'Anthropic training crawler is blocked', 'sev-normal'],
    googleBot: ['pass', 'Googlebot allowed — Search and AI Overviews can index you', 'Googlebot is blocked — you will not appear in Google Search or AI Overviews', 'sev-critical']
  };

  Object.entries(crawlerResults).forEach(([key, result]) => {
    const plan = crawlerPlans[key];
    if (!plan) return;
    const crawler = CRAWLERS[key];
    if (result.status === 'pass') {
      checks.push(check(crawler.label, 'pass', `${crawler.purpose}. robots.txt rule: allowed at /.`, plan[1]));
    } else if (result.status === 'fail') {
      checks.push(check(crawler.label, 'fail', `${crawler.purpose}. robots.txt disallows this crawler at /.`, plan[2], plan[3]));
    } else {
      checks.push(check(crawler.label, 'warn', `${crawler.purpose}. No explicit robots.txt rule for this crawler (defaults to allowed).`, `${crawler.purpose}. No explicit rule — currently allowed by default, but not declared.`, 'sev-normal'));
    }
  });

  const llms = page.llms;
  checks.push(check(
    'llms.txt guidance file',
    llms ? 'pass' : 'warn',
    llms ? `Found at /llms.txt (${llms.length.toLocaleString('en-GB')} bytes${llms.h1 ? ', H1 title present' : ''}, ${llms.links} linked sections).` : 'No /llms.txt was found. Emerging convention that gives AI models a curated map of your site.',
    llms ? 'Your site ships an llms.txt file — a curated map that helps AI assistants understand your business.' : 'Your site has no llms.txt file. Think of it as a welcome sheet for AI assistants: what you do, where, and which pages matter. Optional today, but early adopters get cited.',
    'sev-normal'
  ));
  if (llms) {
    checks.push(check(
      'llms.txt structure quality',
      llms.h1 && llms.links >= 3 ? 'pass' : 'warn',
      llms.h1 && llms.links >= 3
        ? `Well-formed: H1 title and ${llms.links} linked sections with URLs.`
        : `Basic file only: ${llms.h1 ? 'H1 present' : 'no H1 title'}, ${llms.links} linked sections. Convention expects a title and linked page list.`,
      llms.h1 && llms.links >= 3
        ? 'Your llms.txt is well structured with linked sections.'
        : 'Your llms.txt exists but is thin — it should name your business and link your key pages.',
      'sev-normal'
    ));
  }

  checks.push(check(
    'JSON-LD structured data',
    page.jsonLd.length > 0 ? 'pass' : 'fail',
    page.jsonLd.length > 0 ? `${page.jsonLd.length} JSON-LD block(s) parsed successfully. Types detected: ${page.types.slice(0, 8).join(', ') || 'none'}.` : 'No <script type="application/ld+json"> blocks were found in the page.',
    page.jsonLd.length > 0 ? 'Your page includes machine-readable structured data that search and AI engines can parse.' : 'Your page has no structured data — the machine-readable labels that tell Google and AI assistants who you are, what you do and where. Without it, you rely on them guessing.',
    'sev-critical'
  ));
  checks.push(check(
    'LocalBusiness / Organization entity',
    page.hasBusinessSchema ? 'pass' : page.hasOrganisationSchema ? 'warn' : 'fail',
    page.hasBusinessSchema
      ? `Local-business schema type detected (${page.types.filter(t => /localbusiness|professionalservice|homeandconstructionbusiness|movingcompany|electrician|plumber|roofingcontractor|generalcontractor/i.test(t)).join(', ')}).`
      : page.hasOrganisationSchema
        ? 'Generic Organization markup found; a local-business type (e.g. LocalBusiness with areaServed) was not detected.'
        : 'No Organization or LocalBusiness entity was found in JSON-LD.',
    page.hasBusinessSchema ? 'Your business is declared as a local business — exactly what Maps and AI recommendations look for.' : 'Your site never declares itself as a local business entity. This is the single biggest AI-visibility fix for most trades.',
    'sev-critical'
  ));
  checks.push(check(
    'Schema address property',
    page.hasAddressSchema ? 'pass' : 'warn',
    page.hasAddressSchema ? 'An address property is present inside JSON-LD.' : 'No address property found in structured data.',
    page.hasAddressSchema ? 'Your address is machine-readable.' : 'Your address is not machine-readable — engines verifying your service area have to guess.',
    'sev-high'
  ));
  checks.push(check(
    'Schema telephone property',
    page.hasTelephoneSchema ? 'pass' : 'warn',
    page.hasTelephoneSchema ? 'A telephone property is present inside JSON-LD.' : 'No telephone property found in structured data.',
    page.hasTelephoneSchema ? 'Your phone number is machine-readable.' : 'Your phone number is not in your structured data — voice assistants and AI answers prefer to quote it.',
    'sev-normal'
  ));
  checks.push(check(
    'Schema geo coordinates',
    page.hasGeoSchema ? 'pass' : 'warn',
    page.hasGeoSchema ? 'Geo latitude/longitude present in JSON-LD.' : 'No geo coordinates in structured data.',
    page.hasGeoSchema ? 'Your exact location is pinned with coordinates — strong for map relevance.' : 'No map coordinates in your markup — you miss a proximity signal for "near me" searches.',
    'sev-normal'
  ));
  checks.push(check(
    'Schema opening hours',
    page.hasHoursSchema ? 'pass' : 'warn',
    page.hasHoursSchema ? 'Opening hours are declared in JSON-LD.' : 'No openingHours / openingHoursSpecification in structured data.',
    page.hasHoursSchema ? 'Your opening hours are machine-readable.' : 'Your hours are not in markup, so assistants cannot say when you take calls.',
    'sev-normal'
  ));
  checks.push(check(
    'sameAs entity links',
    page.hasSameAs ? 'pass' : 'warn',
    page.hasSameAs ? 'sameAs links connect your entity to profiles and directories.' : 'No sameAs property detected in JSON-LD.',
    page.hasSameAs ? 'Your site links your business to its profiles — engines can cross-check you.' : 'Your markup does not link to your Google Business Profile or socials, so engines cannot easily join the dots.',
    'sev-normal'
  ));
  checks.push(check(
    'Rating / review schema',
    page.hasRatingSchema ? 'pass' : 'warn',
    page.hasRatingSchema ? 'aggregateRating or review markup detected.' : 'No aggregateRating or review markup in JSON-LD.',
    page.hasRatingSchema ? 'Star ratings are machine-readable.' : 'No review or rating markup — star ratings are absent from how machines see you.',
    'sev-normal'
  ));
  checks.push(check(
    'FAQ / answer-ready content',
    page.hasFaqSchema ? 'pass' : page.questionHeadings.length >= 3 ? 'warn' : 'fail',
    page.hasFaqSchema
      ? 'FAQPage schema detected.'
      : `${page.questionHeadings.length} question-style H2/H3 headings found${page.hasFaqSchema ? ' with FAQPage schema' : ' but no FAQPage schema'}.`,
    page.hasFaqSchema
      ? 'Your FAQs are marked up in a format AI answers can lift directly.'
      : page.questionHeadings.length >= 3
        ? 'You answer customer questions in headings, but not in the marked-up format AI engines quote.'
        : 'Your page does not answer customer questions in headings — AI answers are built from exactly that shape of content.',
    'sev-high'
  ));
  checks.push(check(
    'Breadcrumb / Service schema',
    page.hasBreadcrumbSchema || page.hasServiceSchema ? 'pass' : 'warn',
    page.hasBreadcrumbSchema || page.hasServiceSchema
      ? `${page.hasBreadcrumbSchema ? 'BreadcrumbList ' : ''}${page.hasServiceSchema ? 'Service/Offer ' : ''}schema detected.`
      : 'No BreadcrumbList or Service/Offer schema found.',
    page.hasBreadcrumbSchema || page.hasServiceSchema
      ? 'Your services and page structure are described in markup.'
      : 'Your services are not individually marked up — each service should be its own machine-readable entity.',
    'sev-normal'
  ));
  checks.push(check(
    'Answer-ready text volume',
    page.visibleWordCount >= 700 ? 'pass' : page.visibleWordCount >= 350 ? 'warn' : 'fail',
    `${page.visibleWordCount.toLocaleString('en-GB')} visible words detected in server-rendered HTML.`,
    page.visibleWordCount >= 700
      ? 'Plenty of substantive text for engines to quote.'
      : `Only ${page.visibleWordCount.toLocaleString('en-GB')} words of visible text — thin pages give AI engines nothing to recommend you for.`,
    'sev-high'
  ));

  return category('geo', 'GEO & AI readiness', 'Whether ChatGPT, Perplexity, Claude and Google AI can read, trust and recommend your business.', checks);
}

function buildSeoGroup(page) {
  const sitemap = page.sitemap;
  const lastmodFresh = sitemap && sitemap.lastmods.length
    ? sitemap.lastmods.some(d => { const t = Date.parse(d); return !Number.isNaN(t) && t > Date.now() - 1000 * 60 * 60 * 24 * 365; })
    : null;

  const checks = [
    check('Homepage HTTP status', 'pass', `HTTP 200 OK received for ${page.finalUrl}.`, 'Your homepage loads correctly for crawlers.', 'sev-normal'),
    check(
      'HTTPS protocol',
      /^https:/i.test(page.finalUrl) ? 'pass' : 'fail',
      /^https:/i.test(page.finalUrl) ? `Final URL is served over TLS${page.extra.redirects ? ` after ${page.extra.redirects} redirect(s)` : ''}.` : 'The page is served over plain HTTP.',
      /^https:/i.test(page.finalUrl) ? 'Your site uses a secure HTTPS connection.' : 'Your site is not secure — browsers warn visitors and Google demotes you.',
      'sev-critical'
    ),
    check(
      'robots.txt present',
      page.robotsResult.exists ? 'pass' : 'warn',
      page.robotsResult.exists
        ? `robots.txt returned HTTP ${page.robotsResult.status} (${(page.robotsResult.text || '').length.toLocaleString('en-GB')} bytes).`
        : 'robots.txt was not found (HTTP ' + (page.robotsResult.status || '0') + ').',
      page.robotsResult.exists ? 'Your robots.txt exists and documents crawler access.' : 'No robots.txt — crawler rules are undeclared.',
      'sev-normal'
    ),
    check(
      'robots.txt syntax',
      page.robotsResult.exists ? (/user-agent/i.test(page.robotsResult.text) ? 'pass' : 'warn') : 'warn',
      page.robotsResult.exists
        ? /user-agent/i.test(page.robotsResult.text)
          ? 'User-agent groups parse correctly.'
          : 'File exists but contains no User-agent directives.'
        : 'Cannot validate — file missing.',
      page.robotsResult.exists && /user-agent/i.test(page.robotsResult.text)
        ? 'Your robots.txt is valid.'
        : 'Your robots.txt is missing or malformed — crawlers fall back to defaults.',
      'sev-normal'
    ),
    check(
      'Sitemap declared in robots.txt',
      /sitemap\s*:/i.test(page.robotsResult.text || '') ? 'pass' : 'warn',
      /sitemap\s*:/i.test(page.robotsResult.text || '')
        ? 'A Sitemap: directive is declared in robots.txt.'
        : 'No Sitemap: directive found in robots.txt.',
      /sitemap\s*:/i.test(page.robotsResult.text || '')
        ? 'Search engines are pointed to your sitemap from robots.txt.'
        : 'Your robots.txt does not point to your sitemap — engines have to find your pages by luck.',
      'sev-normal'
    ),
    check(
      'XML sitemap reachable',
      sitemap ? 'pass' : 'warn',
      sitemap
        ? `/sitemap.xml returned HTTP 200, ${sitemap.urls.toLocaleString('en-GB')} <loc> entries${sitemap.isIndex ? ' (sitemap index file)' : ''}.`
        : 'GET /sitemap.xml did not return a usable sitemap.',
      sitemap
        ? `Your sitemap lists ${sitemap.urls.toLocaleString('en-GB')} page${sitemap.urls === 1 ? '' : 's'} for engines to discover.`
        : 'No XML sitemap found at /sitemap.xml — engines must crawl blind to discover your pages.',
      'sev-high'
    ),
    check(
      'Sitemap validity',
      sitemap ? (sitemap.valid ? 'pass' : 'warn') : 'warn',
      sitemap
        ? sitemap.valid
          ? `Well-formed XML${sitemap.isIndex ? ' (index referencing child sitemaps)' : ' (<urlset>)'}.`
          : 'Response was not recognisable sitemap XML.'
        : 'Cannot validate — no sitemap.',
      sitemap && sitemap.valid ? 'Your sitemap is well-formed XML.' : 'Your sitemap is missing or malformed.',
      'sev-normal'
    ),
    check(
      'Sitemap freshness',
      lastmodFresh === null ? 'warn' : lastmodFresh ? 'pass' : 'warn',
      lastmodFresh === null
        ? 'No <lastmod> dates present in sitemap entries.'
        : lastmodFresh
          ? 'At least one <lastmod> within the last 12 months.'
          : 'All <lastmod> dates are older than 12 months.',
      lastmodFresh === null
        ? 'Your sitemap does not tell engines when pages changed.'
        : lastmodFresh
          ? 'Your sitemap shows recent updates — engines revisit sooner.'
          : 'Your sitemap looks stale — engines deprioritise sitemaps that never change.',
      'sev-normal'
    ),
    check(
      'Canonical tag',
      page.canonicalUrl ? 'pass' : 'warn',
      page.canonicalUrl
        ? `Canonical declared: ${clip(page.canonicalUrl, 100)}${page.canonicalSameOrigin ? ' (same-origin ✓)' : ' (cross-origin!)'}.`
        : 'No canonical link element found.',
      page.canonicalUrl ? 'Each page tells Google its official address — no duplicates.' : 'No canonical tag — Google can index duplicate versions of your pages.',
      'sev-normal'
    ),
    check(
      'Canonical consistency',
      page.canonicalUrl ? (page.canonicalSameOrigin ? 'pass' : 'warn') : 'warn',
      page.canonicalUrl
        ? page.canonicalSameOrigin
          ? 'Canonical URL is on the same site as the page.'
          : 'Canonical points to a different origin — this page is delegating its indexing elsewhere.'
        : 'No canonical to evaluate.',
      page.canonicalUrl && page.canonicalSameOrigin
        ? 'Your canonical is consistent.'
        : 'Your canonical tag points somewhere unexpected, which can de-index the page.',
      'sev-normal'
    ),
    check(
      '404 handling for missing URLs',
      page.soft404 === null ? 'warn' : page.soft404 ? 'fail' : 'pass',
      page.soft404 === null
        ? 'Probe could not be completed.'
        : page.soft404
          ? `A nonexistent URL returned HTTP ${page.missing.status} (soft 404) — crawlers waste budget indexing error pages.`
          : `A nonexistent URL correctly returned HTTP ${page.missing.status}.`,
      page.soft404 === null
        ? 'Could not test missing-page behaviour.'
        : page.soft404
          ? 'Missing pages on your site return a fake "success" — this bloats Google\'s index with junk and hides real errors.'
          : 'Missing pages correctly return a 404 — clean for crawlers.',
      'sev-high'
    ),
    check(
      'URL structure',
      /^[a-z0-9-./?=&#]+$/.test(new URL(page.finalUrl).pathname + new URL(page.finalUrl).search) ? 'pass' : 'warn',
      `Final URL path: ${clip(new URL(page.finalUrl).pathname + new URL(page.finalUrl).search, 90)}. ${/[^a-z0-9-./?=&#]/i.test(new URL(page.finalUrl).pathname) ? 'Contains uppercase or unusual characters.' : 'Lowercase, no odd characters.'}`,
      'Your page address is clean and readable.',
      'sev-normal'
    ),
    check(
      'Title tag',
      titleStatus(page.title) === 'pass' ? 'pass' : page.title ? 'warn' : 'fail',
      page.title ? `Title (${page.title.length} chars): "${clip(page.title, 120)}".` : 'No title tag found.',
      page.title && page.title.length >= 10 && page.title.length <= 70
        ? 'Your page title is a good length for search results.'
        : page.title
          ? 'Your page title is the wrong length — it gets cut off or wastes space in Google.'
          : 'Your page has no title — the single most basic search signal there is.',
      'sev-high'
    ),
    check(
      'Meta description',
      descriptionStatus(page.description) === 'pass' ? 'pass' : 'warn',
      page.description ? `Description (${page.description.length} chars): "${clip(page.description, 160)}".` : 'No meta description found.',
      page.description && page.description.length >= 50
        ? 'Your meta description gives searchers a reason to click.'
        : 'Your page summary (meta description) is missing or too short — Google writes its own, usually worse.',
      'sev-normal'
    ),
    check(
      'Single H1 heading',
      page.h1s.length === 1 ? 'pass' : page.h1s.length > 1 ? 'warn' : 'fail',
      `${page.h1s.length} H1 heading(s) found${page.h1s.length ? `: "${clip(page.h1s[0], 80)}"` : ''}.`,
      page.h1s.length === 1 ? 'Your page has one clear main heading.' : 'Your page should have exactly one main H1 heading.',
      'sev-normal'
    ),
    check(
      'Heading structure',
      page.h2s.length + page.h3s.length >= 4 ? 'pass' : page.h2s.length + page.h3s.length >= 2 ? 'warn' : 'fail',
      `${page.h1s.length} H1, ${page.h2s.length} H2, ${page.h3s.length} H3 headings detected.`,
      page.h2s.length + page.h3s.length >= 4
        ? 'Your content is broken into clear sections.'
        : 'Your page has little structure — sections and subheadings help both readers and search engines.',
      'sev-normal'
    ),
    check(
      'Language declaration',
      page.lang ? 'pass' : 'warn',
      page.lang ? `HTML lang attribute: ${page.lang}.` : 'No lang attribute on <html>.',
      page.lang ? 'Your page declares its language.' : 'Your page does not declare a language — small accessibility and relevance signal.',
      'sev-normal'
    ),
    check(
      'Hreflang internationalisation',
      page.hreflangTags > 0 ? 'pass' : 'warn',
      page.hreflangTags > 0
        ? `${page.hreflangTags} hreflang link(s) found.`
        : 'No hreflang tags found (fine for single-country sites).',
      page.hreflangTags > 0
        ? 'Language/region versions of your pages are declared.'
        : 'No hreflang tags — not a problem while you only target the UK.',
      'sev-normal'
    ),
    check(
      'Internal linking',
      page.internalLinks >= 8 ? 'pass' : page.internalLinks >= 3 ? 'warn' : 'fail',
      `${page.internalLinks} same-site links found in the homepage HTML.`,
      page.internalLinks >= 8
        ? 'Your pages are well connected internally.'
        : `Only ${page.internalLinks} internal links — crawlers and customers struggle to reach your service pages.`,
      'sev-high'
    ),
    check(
      'Image alt text',
      page.imgTags.length === 0 ? 'pass' : page.imagesWithAlt === page.imgTags.length ? 'pass' : page.imagesWithAlt > 0 ? 'warn' : 'fail',
      `${page.imagesWithAlt} of ${page.imgTags.length} <img> tags carry an alt attribute.`,
      page.imgTags.length === 0 || page.imagesWithAlt === page.imgTags.length
        ? 'Your images describe themselves to screen readers and engines.'
        : `${page.imgTags.length - page.imagesWithAlt} of your images have no description text.`,
      'sev-normal'
    ),
    check(
      'Open Graph completeness',
      page.ogComplete ? 'pass' : page.ogPartial ? 'warn' : 'fail',
      page.ogComplete
        ? 'og:title, og:description and og:image all present.'
        : page.ogPartial
          ? 'Partial Open Graph tags (missing og:image or og:description).'
          : 'No core Open Graph tags found.',
      page.ogComplete
        ? 'Your page previews properly when shared on socials and messaging apps.'
        : 'Your page previews badly when shared — missing social share cards look unprofessional in group chats where trades get recommended.',
      'sev-normal'
    ),
    check(
      'Favicon',
      page.favicon ? 'pass' : 'warn',
      page.favicon ? 'Icon link tag(s) present in <head>.' : 'No favicon link detected.',
      page.favicon ? 'Your site has a browser-tab icon.' : 'No favicon — a small trust detail missing from browser tabs and Google results.',
      'sev-normal'
    )
  ];

  return category('seo', 'Technical SEO & architecture', 'How cleanly search engines can crawl, understand and index your site structure.', checks);
}

function buildPerformanceGroup(page, headers) {
  const htmlKB = Math.round(page.html.length / 1024);
  const imgCount = page.imgTags.length;
  const extScriptCount = page.externalScripts.length;
  const deferRatio = extScriptCount ? page.deferredScripts.length / extScriptCount : 1;
  const lazyRatio = imgCount ? page.lazyImages / imgCount : 1;
  const modernRatio = imgCount ? page.modernImages / imgCount : 1;
  const sizedRatio = imgCount ? page.sizedImages / imgCount : 1;
  const cacheControl = headers.get('cache-control') || '';
  const contentEncoding = headers.get('content-encoding') || '';
  const etag = headers.get('etag');
  const lastModified = headers.get('last-modified');
  const asset = page.extra.assetCache || null;

  const checks = [
    check(
      'HTML document weight',
      htmlKB <= 150 ? 'pass' : htmlKB <= 300 ? 'warn' : 'fail',
      `Server-rendered HTML is ${htmlKB.toLocaleString('en-GB')} KB (decompressed).`,
      htmlKB <= 150 ? 'Your page code is lean.' : `Your page code alone is ${htmlKB} KB before images and scripts — the first thing every visitor downloads.`,
      'sev-high'
    ),
    check(
      'Render-blocking scripts',
      page.blockingHeadScripts.length === 0 ? 'pass' : page.blockingHeadScripts.length <= 2 ? 'warn' : 'fail',
      `${page.blockingHeadScripts.length} synchronous <head> script(s) without defer/async.`,
      page.blockingHeadScripts.length === 0
        ? 'No scripts block first paint.'
        : `${page.blockingHeadScripts.length} scripts block your page from appearing — visitors stare at a blank screen while they load.`,
      'sev-high'
    ),
    check(
      'Script deferral strategy',
      extScriptCount === 0 || deferRatio >= 0.8 ? 'pass' : deferRatio >= 0.5 ? 'warn' : 'fail',
      `${page.deferredScripts.length} of ${extScriptCount} external scripts use defer/async.`,
      deferRatio >= 0.8 || extScriptCount === 0
        ? 'Your scripts load without holding up the page.'
        : 'Most of your scripts load synchronously — they should be deferred so content appears first.',
      'sev-normal'
    ),
    check(
      'Render-blocking stylesheets',
      page.headStylesheets <= 1 ? 'pass' : page.headStylesheets <= 3 ? 'warn' : 'fail',
      `${page.headStylesheets} stylesheet(s) loaded in <head>.`,
      page.headStylesheets <= 1
        ? 'Your styling is consolidated — minimal render blocking.'
        : `${page.headStylesheets} separate stylesheets each delay your page appearing.`,
      'sev-normal'
    ),
    check(
      'JavaScript payload',
      extScriptCount <= 5 ? 'pass' : extScriptCount <= 12 ? 'warn' : 'fail',
      `${extScriptCount} external script(s), ~${Math.round(page.inlineScriptBytes / 1024)} KB inline JS, ${page.thirdPartyDomains.size} third-party script domain(s).`,
      extScriptCount <= 5
        ? 'Your page carries a light JavaScript load.'
        : `${extScriptCount} scripts from ${page.thirdPartyDomains.size + 1} sources — every one is a speed and privacy liability.`,
      'sev-high'
    ),
    check(
      'Modern image formats (WebP/AVIF)',
      modernRatio >= 0.6 || imgCount === 0 ? 'pass' : modernRatio > 0 ? 'warn' : 'fail',
      `${page.modernImages} of ${imgCount} images use WebP/AVIF or responsive srcset.`,
      modernRatio >= 0.6 || imgCount === 0
        ? 'Your images use modern, compressed formats.'
        : 'Your images are in older formats (JPEG/PNG) — WebP would typically cut their weight by a third.',
      'sev-normal'
    ),
    check(
      'Lazy loading',
      lazyRatio >= 0.5 || imgCount <= 2 ? 'pass' : lazyRatio > 0 ? 'warn' : 'fail',
      `${page.lazyImages} of ${imgCount} images carry loading="lazy".`,
      lazyRatio >= 0.5 || imgCount <= 2
        ? 'Off-screen images wait to load — bandwidth goes to what visitors see first.'
        : 'All your images try to load at once — below-the-fold images should wait their turn.',
      'sev-normal'
    ),
    check(
      'LCP image priority',
      page.fetchPriorityImages > 0 || imgCount <= 1 ? 'pass' : 'warn',
      page.fetchPriorityImages > 0
        ? `${page.fetchPriorityImages} image(s) marked fetchpriority="high".`
        : imgCount <= 1
          ? 'Single image page — priority marking is not critical.'
          : 'No hero image marked fetchpriority="high".',
      page.fetchPriorityImages > 0 || imgCount <= 1
        ? 'Your main image is flagged for priority loading.'
        : 'Your hero image is not flagged as the priority asset — browsers discover it late and your page feels slow.',
      'sev-high'
    ),
    check(
      'Image dimensions (CLS protection)',
      sizedRatio >= 0.8 || imgCount === 0 ? 'pass' : sizedRatio >= 0.5 ? 'warn' : 'fail',
      `${page.sizedImages} of ${imgCount} images declare width/height or sizes.`,
      sizedRatio >= 0.8 || imgCount === 0
        ? 'Your images reserve their space — no layout jumping.'
        : 'Images without set dimensions make your page jump around while loading — customers tap the wrong thing.',
      'sev-normal'
    ),
    check(
      'Preconnect hints',
      page.preconnects >= 1 ? 'pass' : 'warn',
      page.preconnects >= 1 ? `${page.preconnects} preconnect hint(s) found.` : 'No preconnect/preload hints found in <head>.',
      page.preconnects >= 1 ? 'Your page warms up connections to third-party origins.' : 'Your page opens third-party connections late — each one adds avoidable delay.',
      'sev-normal'
    ),
    check(
      'Resource preloading',
      page.preloads >= 1 ? 'pass' : 'warn',
      page.preloads >= 1 ? `${page.preloads} preload hint(s) found.` : 'No <link rel=preload> usage detected.',
      page.preloads >= 1 ? 'Key assets are discovered early.' : 'Critical assets like fonts and hero images are discovered late in loading.',
      'sev-normal'
    ),
    check(
      'Font loading strategy',
      !page.googleFonts || page.fontSwaps || page.fontPreloads > 0 ? 'pass' : 'warn',
      !page.googleFonts
        ? 'No remote webfont dependency detected.'
        : `${page.fontSwaps ? 'font-display: swap in use' : 'no font-display swap'}; ${page.fontPreloads} font preload(s).`,
      !page.googleFonts || page.fontSwaps || page.fontPreloads > 0
        ? 'Your text renders immediately instead of waiting for custom fonts.'
        : 'Your text is invisible while custom fonts download (no font-display: swap) — visitors see a blank pause.',
      'sev-high'
    ),
    check(
      'Compression',
      contentEncoding ? 'pass' : 'warn',
      contentEncoding ? `Response content-encoding: ${contentEncoding}.` : 'No content-encoding header observable on the HTML response (may be stripped by the edge).',
      contentEncoding ? 'Your pages travel compressed.' : 'Compression could not be confirmed on your HTML — uncompressed pages crawl slower.',
      'sev-normal'
    ),
    check(
      'HTML cache policy',
      cacheControl ? 'pass' : 'warn',
      cacheControl ? `cache-control: ${clip(cacheControl, 90)}.` : 'No cache-control header on the HTML response.',
      cacheControl ? 'Your HTML declares how caches should treat it.' : 'Your HTML sends no caching instructions — every visit may re-download everything.',
      'sev-normal'
    ),
    check(
      'Static asset caching',
      asset && /max-age=\d{7,}/i.test(asset.cacheControl) ? 'pass' : asset ? 'warn' : 'warn',
      asset
        ? `Probed ${clip(asset.url, 90)}: cache-control "${clip(asset.cacheControl, 60) || 'none'}".`
        : 'No cacheable same-origin asset found to probe.',
      asset && /max-age=\d{7,}/i.test(asset.cacheControl)
        ? 'Your static assets are cached for long periods — repeat visits are fast.'
        : 'Your images and files re-download too often — they should be cached for months.',
      'sev-normal'
    ),
    check(
      'Cache validators',
      etag || lastModified ? 'pass' : 'warn',
      etag || lastModified ? `${etag ? 'ETag present' : ''}${etag && lastModified ? ', ' : ''}${lastModified ? 'Last-Modified present' : ''}.` : 'Neither ETag nor Last-Modified returned.',
      etag || lastModified ? 'Returning visitors revalidate efficiently.' : 'No cache validators — browsers cannot check if files changed.',
      'sev-normal'
    ),
    check(
      'Third-party impact',
      page.thirdPartyDomains.size <= 2 ? 'pass' : page.thirdPartyDomains.size <= 5 ? 'warn' : 'fail',
      Array.from(page.thirdPartyDomains).slice(0, 6).join(', ') || 'none',
      page.thirdPartyDomains.size <= 2
        ? 'Your page depends on very few outside services.'
        : `${page.thirdPartyDomains.size} third-party domains load code on your page — each is a speed risk you do not control.`,
      'sev-normal'
    ),
    check(
      'Iframes & embeds',
      page.iframes === 0 ? 'pass' : page.iframes <= 2 ? 'warn' : 'fail',
      `${page.iframes} <iframe> embed(s) detected.`,
      page.iframes === 0 ? 'No heavy embeds slowing your page.' : `${page.iframes} embeds (maps, videos) each drag load time.`,
      'sev-normal'
    ),
    check(
      'DOM complexity',
      page.domElementCount <= 1500 ? 'pass' : page.domElementCount <= 3200 ? 'warn' : 'fail',
      `~${page.domElementCount.toLocaleString('en-GB')} element tags in the document.`,
      page.domElementCount <= 1500 ? 'Your page structure is simple for devices to render.' : 'Your page has an unusually complex structure — slow on cheap phones, which most customers use.',
      'sev-normal'
    )
  ];

  return category('perf', 'Performance & rendering', 'How fast your page renders on the phones your customers actually use.', checks);
}

function analyseSecurity(headers, html, finalUrl, dns) {
  const hsts = headers.get('strict-transport-security') || '';
  const hstsMaxAge = (hsts.match(/max-age=(\d+)/i) || [null, 0])[1];
  const xcto = headers.get('x-content-type-options') || '';
  const xfo = headers.get('x-frame-options') || '';
  const csp = headers.get('content-security-policy') || '';
  const referrer = headers.get('referrer-policy') || '';
  const perms = headers.get('permissions-policy') || '';
  const isHttps = /^https:/i.test(finalUrl);
  const spfRecord = (dns.spf || []).find(r => /^v=spf1/i.test(r));
  const spfCount = (dns.spf || []).filter(r => /^v=spf1/i.test(r)).length;
  const spfHard = Boolean(spfRecord && /(~all|-all)/i.test(spfRecord));
  const dmarcRecord = (dns.dmarc || []).find(r => /^v=DMARC1/i.test(r));
  const dmarcPolicy = dmarcRecord ? ((dmarcRecord.match(/\bp=(none|quarantine|reject)/i) || [null, 'none'])[1].toLowerCase()) : null;
  const mtaStsRecord = (dns.mtaSts || []).find(r => /^v=STSv1/i.test(r));
  const dkimFound = (dns.dkim || []).some(r => Array.isArray(r) && r.length > 0);
  const mixed = typeof mixedContentCount(html, finalUrl) === 'number' ? mixedContentCount(html, finalUrl) : null;

  const checks = [
    check(
      'HTTPS transport',
      isHttps ? 'pass' : 'fail',
      isHttps ? 'Page served over TLS.' : 'Page served over plaintext HTTP.',
      isHttps ? 'Your site is served over an encrypted connection.' : 'Your site is not encrypted — browsers label it "Not secure".',
      'sev-critical'
    ),
    check(
      'HSTS (Strict-Transport-Security)',
      hsts ? 'pass' : 'fail',
      hsts ? `Header: ${clip(hsts, 100)}.` : 'No Strict-Transport-Security header on the response.',
      hsts ? 'Your site forces browsers to always use HTTPS.' : 'No HSTS header — browsers can be trickled back to insecure HTTP on the first visit. This is a security-grade miss that takes one line of server config.',
      'sev-high'
    ),
    check(
      'HSTS max-age & scope',
      Number(hstsMaxAge) >= 15552000 ? 'pass' : hsts ? 'warn' : 'fail',
      hsts
        ? `max-age=${hstsMaxAge} (${Math.round(Number(hstsMaxAge) / 86400)} days)${/includesubdomains/i.test(hsts) ? ', includeSubDomains' : ''}${/preload/i.test(hsts) ? ', preload' : ''}.`
        : 'No HSTS header to evaluate.',
      Number(hstsMaxAge) >= 15552000
        ? 'Your HSTS policy is long enough to be meaningful.'
        : 'Your HSTS policy is too short or missing subdomain coverage.',
      'sev-normal'
    ),
    check(
      'X-Content-Type-Options',
      xcto ? 'pass' : 'warn',
      xcto ? `Header: ${clip(xcto, 40)}.` : 'No X-Content-Type-Options header.',
      xcto ? 'MIME-sniffing attacks are mitigated.' : 'A minor hardening header is missing (nosniff).',
      'sev-normal'
    ),
    check(
      'Clickjacking protection',
      xfo || /frame-ancestors/i.test(csp) ? 'pass' : 'warn',
      xfo ? `X-Frame-Options: ${clip(xfo, 40)}.` : csp ? 'CSP frame-ancestors provides framing protection.' : 'Neither X-Frame-Options nor CSP frame-ancestors set.',
      xfo || /frame-ancestors/i.test(csp) ? 'Your site cannot be framed inside other sites.' : 'Your site can be embedded in other sites — used for clickjacking scams that damage trust.',
      'sev-normal'
    ),
    check(
      'Referrer-Policy',
      referrer ? 'pass' : 'warn',
      referrer ? `Header: ${clip(referrer, 60)}.` : 'No Referrer-Policy header.',
      referrer ? 'Referrer leakage is controlled.' : 'No Referrer-Policy — visitor browsing leaks to third parties.',
      'sev-normal'
    ),
    check(
      'Permissions-Policy',
      perms ? 'pass' : 'warn',
      perms ? `Header: ${clip(perms, 80)}.` : 'No Permissions-Policy header.',
      perms ? 'Browser features are explicitly scoped.' : 'No Permissions-Policy — features like camera/location are unscoped.',
      'sev-normal'
    ),
    check(
      'Content-Security-Policy',
      csp ? 'pass' : 'warn',
      csp ? `CSP present (${csp.length.toLocaleString('en-GB')} chars, directives: ${(csp.match(/[a-z-]+(?==|-source)/gi) || []).slice(0, 6).join(', ') || 'detected'}).` : 'No Content-Security-Policy header.',
      csp ? 'Your page has a content security policy.' : 'No Content-Security-Policy — injected scripts would run unchallenged.',
      'sev-normal'
    ),
    check(
      'Mixed content',
      mixed === null ? 'warn' : mixed === 0 ? 'pass' : 'fail',
      mixed === null ? 'Not applicable (page not HTTPS).' : `${mixed} insecure http:// subresource reference(s) found.`,
      mixed === null || mixed === 0 ? 'No insecure resources on your secure page.' : `${mixed} elements load over insecure HTTP — browsers block them and show warnings.`,
      'sev-high'
    ),
    check(
      'SPF email authentication',
      spfRecord ? 'pass' : 'fail',
      spfRecord ? `TXT: ${clip(spfRecord, 120)}${spfCount > 1 ? ` (warning: ${spfCount} SPF records found)` : ''}.` : 'No v=spf1 TXT record on the root domain.',
      spfRecord ? 'Your domain tells inboxes which servers may send your email.' : 'No SPF record — email you send can be spoofed by scammers and may not reach customers.',
      'sev-high'
    ),
    check(
      'SPF enforcement',
      spfHard ? 'pass' : spfRecord ? 'warn' : 'fail',
      spfHard ? 'SPF ends in ~all or -all (enforced).' : spfRecord ? 'SPF ends permissively (no ~all/-all).' : 'No SPF record.',
      spfHard ? 'Spoofed email claiming to be you gets rejected.' : 'Your SPF does not reject spoofed email — scammers can impersonate you.',
      'sev-normal'
    ),
    check(
      'DKIM signing',
      dkimFound ? 'pass' : 'warn',
      dkimFound
        ? 'DKIM public key found on a common selector.'
        : `No DKIM key found on common selectors (${DKIM_SELECTORS.join(', ')}). Custom selectors cannot be detected.`,
      dkimFound ? 'Your outgoing email is cryptographically signed.' : 'DKIM signing could not be found — email deliverability and anti-spoofing suffer.',
      'sev-normal'
    ),
    check(
      'DMARC policy',
      dmarcRecord ? 'pass' : 'fail',
      dmarcRecord ? `TXT: ${clip(dmarcRecord, 120)}.` : 'No _dmarc TXT record found.',
      dmarcRecord ? 'You have a DMARC policy telling inboxes what to do with fake email.' : 'No DMARC record — anyone can send email as your business and nothing tells the world what to do about it.',
      'sev-high'
    ),
    check(
      'DMARC enforcement',
      dmarcPolicy === 'reject' ? 'pass' : dmarcPolicy === 'quarantine' ? 'pass' : dmarcRecord ? 'warn' : 'fail',
      dmarcPolicy ? `Policy p=${dmarcPolicy}${/rua=/i.test(dmarcRecord) ? ', reports configured' : ', no reporting'}.` : 'No DMARC record.',
      dmarcPolicy === 'quarantine' || dmarcPolicy === 'reject'
        ? 'Fake email sent as you gets quarantined or rejected.'
        : 'Your DMARC is monitor-only (p=none) — spoofed email still lands in customer inboxes.',
      'sev-normal'
    ),
    check(
      'MTA-STS (mail transport security)',
      mtaStsRecord ? 'pass' : 'warn',
      mtaStsRecord ? `DNS TXT: ${clip(mtaStsRecord, 100)}.` : 'No _mta-sts TXT record found.',
      mtaStsRecord ? 'SMTP connections to your domain must use TLS.' : 'No MTA-STS — email to you can silently fall back to unencrypted transport.',
      'sev-normal'
    ),
    check(
      'MTA-STS policy file',
      dns.mtaStsPolicy ? 'pass' : 'warn',
      dns.mtaStsPolicy ? `https://mta-sts.<domain>/.well-known/mta-sts.txt served (${clip(dns.mtaStsPolicy.text.split('\n')[0] || '', 60)}…).` : 'Policy file not published or not reachable.',
      dns.mtaStsPolicy ? 'Your MTA-STS policy file is published correctly.' : 'The MTA-STS policy file is missing — the DNS record alone is not enough.',
      'sev-normal'
    )
  ];

  return category('sec', 'Security & trust signals', 'Transport hardening and email authentication (SPF, DKIM, DMARC, MTA-STS) that stop scammers impersonating you.', checks);
}

function mixedContentCount(html, finalUrl) {
  if (!/^https:/i.test(finalUrl)) return null;
  return (html.match(/(?:src|href)=["']http:\/\/(?!localhost)/gi) || []).length;
}

function buildConversionGroup(page) {
  const firstBodyChunk = page.html.slice(page.html.search(/<body/i), page.html.search(/<body/i) + Math.ceil(page.html.length * 0.3));
  const earlyCta = findCtaCount(firstBodyChunk) > 0;

  const checks = [
    check(
      'Contact / quote form',
      page.forms > 0 ? 'pass' : 'fail',
      `${page.forms} <form> element(s) detected.`,
      page.forms > 0 ? 'Visitors can request a quote directly on your site.' : 'No form on your homepage — visitors cannot ask for a quote without phoning.',
      'sev-high'
    ),
    check(
      'Tap-to-call links',
      page.telLinks > 0 ? 'pass' : 'fail',
      `${page.telLinks} tel: link(s) found.`,
      page.telLinks > 0 ? 'Customers can call you with one tap.' : 'No tap-to-call link — on a phone, your number must be copy-pasted. Most will not bother.',
      'sev-critical'
    ),
    check(
      'Primary call to action',
      page.ctas >= 2 ? 'pass' : page.ctas === 1 ? 'warn' : 'fail',
      `${page.ctas} CTA phrase(s) (quote/book/call/enquire) detected.`,
      page.ctas >= 2 ? 'Your page asks for the enquiry clearly.' : 'Your page barely asks for the business — visitors are never told what to do next.',
      'sev-high'
    ),
    check(
      'Above-the-fold CTA',
      earlyCta ? 'pass' : 'warn',
      earlyCta ? 'CTA wording appears in the first ~30% of the document.' : 'No CTA wording in the top section of the page.',
      earlyCta ? 'Your call to action is visible without scrolling.' : 'Visitors must scroll before you ask for the enquiry — many never will.',
      'sev-normal'
    ),
    check(
      'Email contact route',
      page.mailtoLinks > 0 ? 'pass' : 'warn',
      `${page.mailtoLinks} mailto: link(s) found.`,
      page.mailtoLinks > 0 ? 'Customers can email you in one tap.' : 'No email link — customers who hate phoning have one fewer route.',
      'sev-normal'
    ),
    check(
      'Visible phone number',
      page.phoneText || page.telLinks > 0 ? 'pass' : 'warn',
      page.phoneText ? 'UK phone pattern found in visible text.' : page.telLinks > 0 ? 'tel: link present (number inside link).' : 'No phone number detected.',
      page.phoneText || page.telLinks > 0 ? 'Your phone number is easy to find.' : 'No visible phone number — the fastest conversion route is missing.',
      'sev-normal'
    ),
    check(
      'Social proof',
      page.socialProof ? 'pass' : 'fail',
      page.socialProof ? 'Review/testimonial language detected.' : 'No review or testimonial signals detected.',
      page.socialProof ? 'Reviews or testimonials back up your claims.' : 'No reviews or testimonials — strangers have only your word to go on.',
      'sev-high'
    ),
    check(
      'Trust markers',
      page.trustMarkers ? 'pass' : 'warn',
      page.trustMarkers ? 'Insurance/accreditation language detected.' : 'No insurance/accreditation wording detected.',
      page.trustMarkers ? 'You mention insurance or accreditations.' : 'You never mention insurance, guarantees or accreditation — the exact things homeowners check.',
      'sev-normal'
    ),
    check(
      'Mobile viewport (one-handed use)',
      page.viewport ? 'pass' : 'fail',
      page.viewport ? 'Responsive viewport meta present.' : 'No viewport meta tag — page renders at desktop width on phones.',
      page.viewport ? 'Your page is built for phones first.' : 'Your page is not mobile-configured — it renders shrunken on phones, where most local searches happen.',
      'sev-critical'
    ),
    check(
      'Site navigation depth',
      page.internalLinks >= 6 ? 'pass' : 'warn',
      `${page.internalLinks} internal links reachable from the homepage.`,
      page.internalLinks >= 6 ? 'Your menu connects the site clearly.' : 'Thin navigation — visitors cannot reach your services or areas.',
      'sev-normal'
    )
  ];

  return category('conv', 'Conversion & lead capture', 'Whether a visitor on a phone, mid-emergency, can become a quote request.', checks);
}

/* ============================== Robots & crawlers ============================== */

function analyseCrawlers(robotsText, exists) {
  const result = {};
  for (const [key, crawler] of Object.entries(CRAWLERS)) {
    if (!exists) {
      result[key] = { status: 'warn', label: 'Robots file not found', purpose: crawler.purpose };
      continue;
    }
    const allowed = robotsAllows(robotsText, crawler.userAgent, '/');
    if (allowed === true) result[key] = { status: 'pass', label: 'Allowed', purpose: crawler.purpose };
    else if (allowed === false) result[key] = { status: 'fail', label: 'Blocked at /', purpose: crawler.purpose };
    else result[key] = { status: 'warn', label: 'No explicit rule', purpose: crawler.purpose };
  }
  return result;
}

function robotsAllows(text, userAgent, path) {
  const groups = parseRobots(text);
  if (!groups.length) return null;
  const matching = groups.filter(g => g.agents.some(a => a === '*' || a.toLowerCase() === userAgent.toLowerCase()));
  if (!matching.length) return null;
  let rules = [];
  matching.forEach(g => { rules = rules.concat(g.rules); });
  if (!rules.length) return true;
  let winner = null;
  for (const rule of rules) {
    if (!path.startsWith(rule.path)) continue;
    if (!winner || rule.path.length > winner.path.length || (rule.path.length === winner.path.length && rule.allow)) winner = rule;
  }
  return winner ? winner.allow : true;
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) { current = null; continue; }
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

/* ============================== Scoring outputs ============================== */

const SEV_ORDER = { 'sev-critical': 0, 'sev-high': 1, 'sev-normal': 2 };

function buildPriorities(groups) {
  const list = [];
  groups.forEach(g => {
    g.checks.forEach(c => {
      if (c.status === 'fail' || (c.status === 'warn' && c.sev === 'sev-critical')) {
        list.push({ title: c.name, status: c.status, plain: c.plain, detail: c.detail, group: g.name, sev: c.sev });
      } else if (c.status === 'warn' && c.sev === 'sev-high') {
        list.push({ title: c.name, status: c.status, plain: c.plain, detail: c.detail, group: g.name, sev: c.sev });
      }
    });
  });
  list.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || (a.status === 'fail' ? -1 : 1) - (b.status === 'fail' ? -1 : 1));
  return list.slice(0, 6);
}

function buildExecOverview(priorities, groups, counts) {
  const items = priorities.slice(0, 3).map(p => ({ title: p.title, body: p.plain }));
  const pct = Math.round((counts.pass / Math.max(1, counts.total)) * 100);
  return {
    headline: counts.fail > 8
      ? 'Your site is actively leaking visibility, speed and enquiries.'
      : counts.fail > 3
        ? 'A handful of fixable issues are holding your site back.'
        : 'Your site covers the basics — the gains are in the details.',
    summary: `We ran ${counts.total} checks: ${counts.pass} passed, ${counts.warn} need attention and ${counts.fail} failed. In plain English, here is what matters most.`,
    healthPct: pct,
    items
  };
}

function buildSimulatedPsi(page) {
  const htmlKB = page.html.length / 1024;
  const blockingJs = page.blockingHeadScripts.length;
  const blockingCss = page.headStylesheets;
  const extScripts = page.externalScripts.length;
  const inlineJsKB = page.inlineScriptBytes / 1024;
  const imgCount = page.imgTags.length;

  const fontsBlock = page.googleFonts && !page.fontSwaps && page.fontPreloads === 0;
  const fcp = round1(clamp(0.5 + htmlKB / 45 + blockingCss * 0.22 + blockingJs * 0.18 + (fontsBlock ? 0.25 : 0), 0.5, 8));
  const heroPenalty = imgCount > 1 ? 0.3 + (page.fetchPriorityImages === 0 ? 0.4 : 0) + (page.modernImages === 0 ? 0.35 : 0) : 0.15;
  const lcp = round1(clamp(fcp + heroPenalty + (page.preloads === 0 ? 0.15 : 0), 0.6, 10));
  const tbt = Math.round(clamp(extScripts * 65 + inlineJsKB * 8 + page.iframes * 90, 30, 4000));
  const unsized = imgCount ? (imgCount - page.sizedImages) / imgCount : 0;
  const cls = Math.round(clamp(0.02 + unsized * 0.28, 0, 0.6) * 100) / 100;

  const estWeightKB = Math.round(htmlKB + extScripts * 45 + page.stylesheetLinks.length * 30 + imgCount * 85);

  const band = (v, good, poor) => v <= good ? 'good' : v <= poor ? 'needs-work' : 'poor';
  const metricScore = (v, good, poor) => Math.round(clamp(100 - ((v - good) / (poor - good)) * 100 * 0.85 - (v > poor ? 15 : 0), 0, 100));

  const fcpScore = metricScore(fcp, 1.8, 3.0);
  const lcpScore = metricScore(lcp, 2.5, 4.0);
  const tbtScore = metricScore(tbt, 200, 600);
  const clsScore = metricScore(cls, 0.1, 0.25);

  const score = Math.round(fcpScore * 0.2 + lcpScore * 0.25 + tbtScore * 0.3 + clsScore * 0.25);

  return {
    simulated: true,
    fcp: { value: fcp, unit: 's', band: band(fcp, 1.8, 3.0) },
    lcp: { value: lcp, unit: 's', band: band(lcp, 2.5, 4.0) },
    tbt: { value: tbt, unit: 'ms', band: band(tbt, 200, 600) },
    cls: { value: cls, unit: '', band: band(cls, 0.1, 0.25) },
    score: clamp(score, 0, 100),
    estWeightKB,
    blocking: { scripts: blockingJs, css: blockingCss },
    thirdParties: page.thirdPartyDomains.size,
    images: imgCount
  };
}

function buildUpsellRoutes(groups, psi) {
  const byId = Object.fromEntries(groups.map(g => [g.id, g]));
  const failsIn = g => g.checks.filter(c => c.status === 'fail');
  const topReasons = (g, n) => failsIn(g).slice(0, n).map(c => c.plain);

  const geo = byId.geo;
  const geoFailNames = failsIn(geo).map(c => c.name);
  const aiBlocked = geo.checks.some(c => c.status === 'fail' && /OAI|Perplexity|Claude|Googlebot|GPTBot/i.test(c.name));
  const geoShow = geo.score < 60 || aiBlocked || geoFailNames.includes('LocalBusiness / Organization entity') || geoFailNames.includes('JSON-LD structured data');

  const seo = byId.seo;
  const perf = byId.perf;
  const technicalFailCount = failsIn(seo).length + failsIn(perf).length;
  const techShow = technicalFailCount >= 4 || psi.score < 55 || seo.score < 55;
  const authority = technicalFailCount >= 8 || psi.score < 40;

  const conv = byId.conv;
  const convShow = failsIn(conv).length >= 1 || psi.lcp.band !== 'good';

  return {
    geo: {
      show: geoShow,
      product: { name: 'The GEO AI Optimiser', price: '£497 one-off', href: '/#automation', blurb: 'We fix everything in the GEO & AI column: full LocalBusiness schema, llms.txt, AI crawler permissions and answer-ready structure — on your existing site.' },
      reasons: topReasons(geo, 2)
    },
    technical: {
      show: techShow,
      product: authority
        ? { name: 'The Authority Platform', price: '£4,997 + £79/mo', href: '/#packages', blurb: 'A five-page rebuild engineered for speed and local search authority — every technical failure in this report designed out from day one.' }
        : { name: 'The Quote Engine', price: '£2,497 + £49/mo', href: '/#packages', blurb: 'A fast, conversion-focused rebuild that clears the technical debt this audit found — schema, speed, structure and lead capture as standard.' },
      reasons: [...topReasons(perf, 1), ...topReasons(seo, 1)].filter(Boolean)
    },
    conversion: {
      show: convShow,
      products: [
        { name: 'The Lead Rescue', price: '£297 setup + £49/mo', href: '/#automation', blurb: 'Missed-call text back, quote follow-up and enquiry automation — every call and form gets an instant reply, so nothing goes cold.' },
        { name: 'The Cash Flow Chaser', price: '£297 setup + £29/mo', href: '/#automation', blurb: 'Automated deposit and invoice reminders that turn booked jobs into paid jobs without awkward phone calls.' }
      ],
      reasons: [...topReasons(conv, 2), ...(psi.lcp.band !== 'good' ? [`Your page takes an estimated ${psi.lcp.value}s to show its main content — on a phone, that delay costs enquiries.`] : [])].filter(Boolean)
    }
  };
}

/* ============================== Small utilities ============================== */

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
  while ((match = re.exec(html)) !== null) links.push({ href: match[1] });
  return links;
}

function parseJsonLd(html) {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const items = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    try { items.push(JSON.parse(match[1])); } catch { /* ignore invalid json */ }
  }
  return items;
}

function flattenSchemaTypes(obj) {
  const types = [];
  function recurse(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(recurse); return; }
    if (o['@type']) {
      if (Array.isArray(o['@type'])) o['@type'].forEach(t => types.push(String(t)));
      else types.push(String(o['@type']));
    }
    if (o['@graph'] && Array.isArray(o['@graph'])) o['@graph'].forEach(recurse);
    Object.values(o).forEach(v => { if (typeof v === 'object') recurse(v); });
  }
  recurse(obj);
  return types;
}

function jsonLdHasKey(obj, key) {
  let found = false;
  function recurse(o) {
    if (!o || typeof o !== 'object' || found) return;
    if (Array.isArray(o)) { o.forEach(recurse); return; }
    if (key in o && o[key]) { found = true; return; }
    Object.values(o).forEach(v => { if (typeof v === 'object') recurse(v); });
  }
  recurse(obj);
  return found;
}

function findCtaCount(html) {
  const matches = html.match(/\b(quote|book|contact|call us|get a quote|enquire|enquiry|request|schedule|estimate)\b/gi);
  return matches ? matches.length : 0;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tradeTermsFound(text) {
  return /\b(plumber|electrician|builder|roofer|remover|cleaner|landscaper|trade|carpenter|handyman|heating|removals)\b/i.test(text);
}

function safeAbsoluteUrl(urlStr, baseStr) {
  try { return new URL(urlStr, baseStr).toString(); } catch { return ''; }
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
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '…' : str;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
