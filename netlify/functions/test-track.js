exports.handler = async (event, context) => {
  const fetch = (await import('node-fetch')).default || globalThis.fetch;
  try {
    const res = await fetch("https://api.track.dog/v1/track/track_details?tracking_number=AU0000004862452", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    const text = await res.text();
    return { statusCode: 200, body: text };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
