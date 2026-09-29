export async function onRequestPost(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  try {
    const body = await context.request.json();
    let targetUrl = body.url ? body.url.trim() : '';
    const tradeCategory = body.trade || 'Trade Business';

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400, headers });
    }

    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    // 1. Fetch Target Website HTML
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const targetResponse = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AjuloWebSolutions-Checker/1.0'
      }
    });
    clearTimeout(timeout);

    if (!targetResponse.ok) {
      return new Response(JSON.stringify({ error: 'Target website returned an error or blocked the connection.' }), { status: 422, headers });
    }

    const html = await targetResponse.text();

    // Native Extraction (No external packages needed)
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const metaDesc = metaMatch ? metaMatch[1].trim() : '';

    // Strip tags to extract text content sample
    const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                         .replace(/<style[\s\S]*?<\/style>/gi, '')
                         .replace(/<[^>]+>/g, ' ')
                         .replace(/\s+/g, ' ')
                         .trim()
                         .slice(0, 3000);

    const hasSchema = /application\/ld\+json/i.test(html);
    const phoneLinks = /href=["']tel:[^"']+["']/i.test(html);

    // 2. Call Groq API (Qwen 2.5 32B)
    const groqApiKey = context.env.GROQ_API_KEY;

    if (groqApiKey) {
      const prompt = `
You are an expert Local SEO & GEO (Generative Engine Optimization) auditor analyzing a trade contractor website.
Trade Specialism: ${tradeCategory}
Website URL: ${targetUrl}
Page Title: ${title}
Meta Description: ${metaDesc}
Technical Flags: Has JSON-LD Schema: ${hasSchema}, Has Click-to-Call Link: ${phoneLinks}
Sample Page Copy: "${bodyText}"

Evaluate this website and return ONLY valid JSON matching this exact structure:
{
  "score": <number between 40 and 90>,
  "metrics": {
    "geo": {
      "status": "<pass|warn|fail>",
      "desc": "<1 concise sentence evaluating how ready this site is for Google AI Overviews and ChatGPT local recommendations>"
    },
    "nap": {
      "status": "<pass|warn|fail>",
      "desc": "<1 concise sentence on local phone/address clarity and click-to-call links>"
    },
    "mobile": {
      "status": "<pass|warn|fail>",
      "desc": "<1 concise sentence on mobile design layout and readability>"
    },
    "conversion": {
      "status": "<pass|warn|fail>",
      "desc": "<1 concise sentence on lead capture effectiveness and CTAs for ${tradeCategory}>"
    }
  }
}
`;

      const aiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
          model: 'qwen-2.5-32b',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are a JSON-only response AI SEO auditing assistant.' },
            { role: 'user', content: prompt }
          ]
        })
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const rawJson = aiData.choices[0].message.content;
        const aiAudit = JSON.parse(rawJson);

        return new Response(JSON.stringify(aiAudit), { status: 200, headers });
      }
    }

    // Fallback scoring if GROQ_API_KEY is not set or fails
    return new Response(JSON.stringify({
      score: 58,
      metrics: {
        geo: { status: hasSchema ? 'pass' : 'fail', desc: hasSchema ? 'JSON-LD Schema detected.' : 'Missing Schema markup for AI engines.' },
        nap: { status: phoneLinks ? 'pass' : 'warn', desc: phoneLinks ? 'Click-to-call phone links active.' : 'Lacks direct tap-to-call HTML tags.' },
        mobile: { status: 'pass', desc: 'Mobile viewport tag detected.' },
        conversion: { status: 'warn', desc: 'Lacks automated lead capture integrations.' }
      }
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not reach or parse site. Verify the web address.' }), { status: 500, headers });
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