exports.handler = async (event, context) => {
  const trackingNumber = event.queryStringParameters.trackingNumber || '';
  if (!trackingNumber) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Missing trackingNumber' })
    };
  }

  // Use the native global fetch (available in Node 18+)
  try {
    const url = `https://api.track.dog/v1/track/track_details?tracking_number=${encodeURIComponent(trackingNumber)}`;
    console.log("Fetching track.dog:", url);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://track.dog/'
      }
    });
    
    if (!res.ok) {
      console.log("Track.dog API error:", res.status);
      return {
        statusCode: res.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Track API rejected' })
      };
    }
    
    const data = await res.json();
    
    // Analyze Track.dog's payload
    // Track.dog standard response shape contains events
    let analyzedStatus = 'No Movement';
    
    if (data && data.data && data.data.status) {
      // Map track.dog internal code -> our status
      const trackDogStatus = (data.data.status || '').toLowerCase();
      if (trackDogStatus === 'delivered' || trackDogStatus === 'success') {
          analyzedStatus = 'Delivered';
      } else if (trackDogStatus === 'in_transit' || trackDogStatus === 'transit' || trackDogStatus === 'pickup' || trackDogStatus === 'active') {
          analyzedStatus = 'In Transit';
      } else if (trackDogStatus === 'notfound' || trackDogStatus === 'pending') {
          analyzedStatus = 'No Movement';
      }
      
      // Secondary check: look at events if status isn't clear
      if (analyzedStatus === 'No Movement' && data.data.events && data.data.events.length > 0) {
         // Has events, so it physically left
         const latestEvent = data.data.events[0].description ? data.data.events[0].description.toLowerCase() : '';
         if (latestEvent.includes('receive') && data.data.events.length === 1) {
            analyzedStatus = 'No Movement'; // electronic info received
         } else if (latestEvent.includes('deliver')) {
            analyzedStatus = 'Delivered';
         } else {
            analyzedStatus = 'In Transit';
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
