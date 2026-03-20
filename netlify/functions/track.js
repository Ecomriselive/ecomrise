// Advanced Package Tracking Function via Parcelsapp HTML Parser
// Provides 100% Free tracking for UBI Smart Parcel, Australia Post, etc.

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      },
      body: ''
    };
  }

  const { trackingNumber } = event.queryStringParameters || {};

  if (!trackingNumber) {
    return respond(400, { error: 'No tracking number provided' });
  }

  try {
    const url = `https://parcelsapp.com/en/tracking/${trackingNumber}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'max-age=0'
      }
    });

    if (!response.ok) {
      throw new Error(`Upstream error: ${response.status}`);
    }

    const html = await response.text();
    
    // Look for the JSON payload ParcelsApp uses to render the page
    const dataRegex = /window\.trackingData\s*=\s*(\{.*?\});/s;
    const match = html.match(dataRegex);
    
    let events = [];
    if (match && match[1]) {
        try {
            const trackingData = JSON.parse(match[1]);
            // If the data has events, extract their text
            if (trackingData && trackingData.events && Array.isArray(trackingData.events)) {
                // Their events usually have text or statuses
                events = trackingData.events.map(e => e.status || e.text || e.description || '').filter(Boolean);
            }
        } catch (e) {
            console.error('Failed to parse injected JSON', e);
        }
    }

    // Fallback: Parse HTML lists if JSON extraction failed or was empty
    if (events.length === 0) {
        const liRegex = /<li[^>]*>(.*?)<\/li>/gis;
        let matchLi;
        while ((matchLi = liRegex.exec(html)) !== null) {
            let liHtml = matchLi[1];
            let cleanText = liHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            // Basic heuristic for tracking events
            if (cleanText.length > 5 && (/\d{2}:\d{2}/.test(cleanText) || /202|203/.test(cleanText) || cleanText.includes('Info') || cleanText.includes('Transit') || cleanText.includes('Delivered'))) {
                events.push(cleanText);
            }
        }
    }

    // Now analyze the events using the requested logic
    const analyzed = analyzeEventsAI(events);

    return respond(200, {
      trackingNumber,
      status: analyzed.status,
      eventCount: events.length,
      latestEvent: events[0] || 'None'
    });

  } catch (err) {
    console.error(`Tracking error for ${trackingNumber}:`, err);
    return respond(500, { error: err.message, trackingNumber, status: 'Unknown' });
  }
};

// --- Status Analysis Engine ---
function analyzeEventsAI(events) {
    if (!events || events.length === 0) {
        return { status: 'No Movement' }; // Fallback
    }

    // Combine all events into a single lowercase string
    const latestEvent = events[0].toLowerCase();
    const allEvents = events.join(' ').toLowerCase();

    // 1. Check for Delivered (Highest Priority)
    if (latestEvent.includes('delivered') || latestEvent.includes('successful delivery')) {
        return { status: 'Delivered' };
    }
    if (allEvents.includes('delivered')) {
       return { status: 'Delivered' };
    }

    // 2. Check for In Transit (Movement)
    // The user's example: "Item Despatched To Transshipment Hub", "Processed At Origin Hub", "Received Shipment"
    const transitKeywords = ['transit', 'departed', 'arrived', 'processed', 'shipped', 'onboard', 'on its way', 'despatched', 'customs', 'airport', 'received shipment', 'facility', 'courier'];
    if (transitKeywords.some(keyword => allEvents.includes(keyword))) {
        return { status: 'In Transit' };
    }

    // 3. Check for No Movement (Information Received Only)
    // The user's example: "Shipping Information Received"
    if (allEvents.includes('information received') || allEvents.includes('data received') || allEvents.includes('electronic information')) {
        return { status: 'No Movement' };
    }

    // 4. Default if we have events but don't match exactly
    return { status: 'In Transit' };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}
