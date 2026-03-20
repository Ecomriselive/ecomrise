exports.handler = async (event, context) => {
  const trackingNumber = event.queryStringParameters.trackingNumber || '';
  if (!trackingNumber) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing trackingNumber' })
    };
  }

  const apiKey = process.env.SEVENTEEN_TRACK_KEY;
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ status: 'No API Key', message: 'API Key Required' })
    };
  }

  try {
    const fetch = (await import('node-fetch')).default || globalThis.fetch;
    
    // First, register the tracking number with 17Track
    await fetch('https://api.17track.net/track/v2.2.4/register', {
      method: 'POST',
      headers: {
        '17token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ "number": trackingNumber }])
    });

    // Then, fetch the tracking info
    const res = await fetch('https://api.17track.net/track/v2.2.4/gettrackinfo', {
      method: 'POST',
      headers: {
        '17token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ "number": trackingNumber }])
    });
    
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: '17Track API rejected', status: 'No Movement' })
      };
    }
    
    const data = await res.json();
    let analyzedStatus = 'No Movement';

    // 17track response status logic
    if (data && data.data && data.data.accepted && data.data.accepted.length > 0) {
      const trackData = data.data.accepted[0].track;
      if (trackData) {
        const statusCode = trackData.b || trackData.e; // 17track status code
        if (statusCode === 40) {
            analyzedStatus = 'Delivered';
        } else if (statusCode === 20 || statusCode === 30) {
            analyzedStatus = 'In Transit';
        } else if (statusCode === 10) {
            analyzedStatus = 'No Movement'; // Not found
        } else {
            // Check events
            if (trackData.z1 && trackData.z1.length > 0) {
                const latestEvent = trackData.z1[0].z || '';
                if (latestEvent.toLowerCase().includes('deliver')) {
                  analyzedStatus = 'Delivered';
                } else {
                   analyzedStatus = 'In Transit';
                }
            }
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trackingNumber, status: analyzedStatus, rawData: data })
    };

  } catch (err) {
    console.error('Fatal fetch error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message, status: 'No Movement' })
    };
  }
};
