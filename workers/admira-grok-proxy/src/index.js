const DEFAULT_ALLOWED_ORIGINS = [
  'https://csilvasantin.github.io',
  'http://localhost:9124',
  'http://127.0.0.1:9124',
];

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .concat(DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = getAllowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(request, env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(request, env),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (error) {
    return {};
  }
}

function normalizePrompt(body) {
  const prompt = String(body.prompt || body.message || body.text || '').trim();
  const context = String(body.context || '').trim();
  if (!context) return prompt;
  return `${prompt}\n\nContexto del juego:\n${context}`;
}

async function askGrok(request, env) {
  if (!env.XAI_API_KEY) {
    return jsonResponse(request, env, 500, {
      ok: false,
      error: 'missing_secret',
      message: 'XAI_API_KEY no está configurada en Cloudflare Worker.',
    });
  }

  const body = await readJson(request);
  const prompt = normalizePrompt(body);
  if (!prompt) {
    return jsonResponse(request, env, 400, {
      ok: false,
      error: 'empty_prompt',
      message: 'Falta prompt.',
    });
  }

  const model = String(body.model || env.XAI_MODEL || 'grok-4-latest');
  const baseUrl = String(env.XAI_BASE_URL || 'https://api.x.ai/v1').replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Eres AdmiraXPBot dentro de Admira XP. Responde breve, claro y útil para un juego de simulación de tienda.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7,
      max_tokens: Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 900,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return jsonResponse(request, env, response.status, {
      ok: false,
      error: data.error || 'xai_error',
      message: data.error && data.error.message ? data.error.message : `xAI HTTP ${response.status}`,
    });
  }

  const text = data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '').trim()
    : '';

  return jsonResponse(request, env, 200, {
    ok: true,
    text,
    model: data.model || model,
    usage: data.usage || null,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse(request, env, 200, {
        ok: true,
        service: 'admira-grok-proxy',
        model: env.XAI_MODEL || 'grok-4-latest',
        configured: !!env.XAI_API_KEY,
      });
    }

    if (url.pathname === '/grok/ask' && request.method === 'POST') {
      return askGrok(request, env);
    }

    return jsonResponse(request, env, 404, {
      ok: false,
      error: 'not_found',
      message: 'Endpoint no encontrado.',
    });
  },
};
