// Claude API Proxy — Netlify Function
// Bypasses CORS by relaying frontend requests to the Anthropic API securely

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: ''
    };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method Not Allowed' });
  }

  // Get API key from custom header or Netlify environment variable
  const apiKey = event.headers['x-anthropic-key'] || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return respond(401, { error: 'Missing API Key', message: 'No Anthropic API key provided in headers or environment variables.' });
  }

  try {
    const payload = JSON.parse(event.body);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: payload.model || 'claude-3-5-sonnet-latest',
        max_tokens: payload.max_tokens || 1000,
        system: payload.system || '',
        messages: payload.messages || []
      })
    });

    const data = await res.json();

    if (!res.ok) {
      return respond(res.status, data);
    }

    return respond(200, data);

  } catch (err) {
    console.error('Claude proxy error:', err);
    return respond(500, { error: 'Server Error', message: err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-anthropic-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body)
  };
}
