// Shopify Admin API Proxy — Netlify Function
// Supports new 2026 Client Credential Grant (client_id + client_secret → access_token)
// Also supports direct access_token for legacy apps

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // Get credentials from request headers (frontend sends them)
  const store = event.headers['x-shopify-store'] || process.env.SHOPIFY_STORE;
  let token = event.headers['x-shopify-token'] || process.env.SHOPIFY_ACCESS_TOKEN;
  const clientId = event.headers['x-shopify-client-id'];
  const clientSecret = event.headers['x-shopify-client-secret'];

  if (!store) {
    return respond(401, { error: 'not_connected', message: 'No store URL provided.' });
  }

  // If client_id + client_secret provided, exchange for access_token via Client Credential Grant
  if (clientId && clientSecret && !token) {
    try {
      const tokenRes = await fetch(`https://${store}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials'
        })
      });
      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        return respond(401, { error: 'auth_failed', message: 'Failed to get access token. Check your Client ID and Secret. ' + errText });
      }
      const tokenData = await tokenRes.json();
      token = tokenData.access_token;
      if (!token) {
        return respond(401, { error: 'auth_failed', message: 'No access token returned by Shopify.' });
      }
    } catch (err) {
      return respond(500, { error: 'auth_error', message: 'Token exchange failed: ' + err.message });
    }
  }

  if (!token) {
    return respond(401, { error: 'not_connected', message: 'No access token or Client ID/Secret provided.' });
  }

  const action = event.queryStringParameters?.action || 'orders';
  const baseUrl = `https://${store}/admin/api/2024-01`;

  try {
    switch (action) {

      // ─── TEST: verify connection works ───
      case 'test': {
        const url = `${baseUrl}/shop.json`;
        const data = await shopifyFetch(url, token);
        // Return the access token so frontend can cache it
        return respond(200, { connected: true, shop: data.shop?.name || store, access_token: token });
      }

      // ─── ORDERS: recent orders with full details ───
      case 'orders': {
        const limit = event.queryStringParameters?.limit || 50;
        const sinceDate = event.queryStringParameters?.since || thirtyDaysAgo();
        const url = `${baseUrl}/orders.json?status=any&limit=${limit}&created_at_min=${sinceDate}T00:00:00Z&order=created_at+desc`;
        const data = await shopifyFetch(url, token);
        
        const orders = (data.orders || []).map(o => ({
          id: o.id,
          name: o.name,
          customer: o.customer ? `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim() : 'Guest',
          email: o.customer?.email || '',
          total: parseFloat(o.total_price || 0),
          subtotal: parseFloat(o.subtotal_price || 0),
          currency: o.currency,
          financial_status: o.financial_status,
          fulfillment_status: o.fulfillment_status || 'unfulfilled',
          created_at: o.created_at,
          line_items: (o.line_items || []).map(li => ({
            title: li.title,
            quantity: li.quantity,
            price: parseFloat(li.price || 0)
          })),
          shipping_country: o.shipping_address?.country || '',
          refunds: (o.refunds || []).length
        }));

        return respond(200, { orders, count: orders.length });
      }

      // ─── STATS: aggregated metrics for a date range ───
      case 'stats': {
        const since = event.queryStringParameters?.since || thirtyDaysAgo();
        const until = event.queryStringParameters?.until || todayStr();
        
        let allOrders = [];
        let url = `${baseUrl}/orders.json?status=any&limit=250&created_at_min=${since}T00:00:00Z&created_at_max=${until}T23:59:59Z&order=created_at+desc`;
        
        while (url) {
          const res = await shopifyFetchRaw(url, token);
          const data = await res.json();
          allOrders = allOrders.concat(data.orders || []);
          const linkHeader = res.headers.get('link');
          url = getNextPageUrl(linkHeader);
        }

        const totalRevenue = allOrders.reduce((s, o) => s + parseFloat(o.total_price || 0), 0);
        const totalOrders = allOrders.length;
        const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        
        const paidOrders = allOrders.filter(o => o.financial_status === 'paid' || o.financial_status === 'partially_refunded');
        const refundedOrders = allOrders.filter(o => o.financial_status === 'refunded');
        const partiallyRefunded = allOrders.filter(o => o.financial_status === 'partially_refunded');
        const fulfilledOrders = allOrders.filter(o => o.fulfillment_status === 'fulfilled');
        const unfulfilledOrders = allOrders.filter(o => !o.fulfillment_status || o.fulfillment_status === 'unfulfilled' || o.fulfillment_status === null);
        const cancelledOrders = allOrders.filter(o => o.cancelled_at);

        const productMap = {};
        allOrders.forEach(o => {
          (o.line_items || []).forEach(li => {
            const key = li.title || 'Unknown';
            if (!productMap[key]) productMap[key] = { title: key, units: 0, revenue: 0 };
            productMap[key].units += li.quantity;
            productMap[key].revenue += parseFloat(li.price || 0) * li.quantity;
          });
        });
        const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

        const countryMap = {};
        allOrders.forEach(o => {
          const country = o.shipping_address?.country || o.billing_address?.country || 'Unknown';
          if (!countryMap[country]) countryMap[country] = { country, orders: 0, revenue: 0 };
          countryMap[country].orders++;
          countryMap[country].revenue += parseFloat(o.total_price || 0);
        });
        const topCountries = Object.values(countryMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

        const dailyMap = {};
        allOrders.forEach(o => {
          const day = o.created_at.substring(0, 10);
          if (!dailyMap[day]) dailyMap[day] = { date: day, revenue: 0, orders: 0 };
          dailyMap[day].revenue += parseFloat(o.total_price || 0);
          dailyMap[day].orders++;
        });
        const dailyData = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

        const customerEmails = {};
        allOrders.forEach(o => {
          const email = o.customer?.email || o.email || '';
          if (email) {
            if (!customerEmails[email]) customerEmails[email] = 0;
            customerEmails[email]++;
          }
        });
        const totalCustomers = Object.keys(customerEmails).length;
        const returningCustomers = Object.values(customerEmails).filter(c => c > 1).length;
        const newCustomers = totalCustomers - returningCustomers;

        const completedPurchase = allOrders.filter(o => o.financial_status !== 'voided' && !o.cancelled_at).length;
        const abandoned = totalOrders - completedPurchase;

        return respond(200, {
          totalRevenue: round2(totalRevenue),
          totalOrders,
          aov: round2(aov),
          refundCount: refundedOrders.length,
          partialRefundCount: partiallyRefunded.length,
          refundRate: totalOrders > 0 ? round2((refundedOrders.length / totalOrders) * 100) : 0,
          paidCount: paidOrders.length,
          fulfilledCount: fulfilledOrders.length,
          unfulfilledCount: unfulfilledOrders.length,
          cancelledCount: cancelledOrders.length,
          fulfillmentRate: totalOrders > 0 ? round2((fulfilledOrders.length / totalOrders) * 100) : 0,
          topProducts,
          topCountries,
          dailyData,
          newCustomers,
          returningCustomers,
          totalCustomers,
          reachedCheckout: totalOrders,
          completedPurchase,
          abandoned,
          checkoutConversion: totalOrders > 0 ? round2((completedPurchase / totalOrders) * 100) : 0,
          dateRange: { since, until }
        });
      }

      default:
        return respond(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Shopify API error:', err);
    return respond(500, { error: 'api_error', message: 'Shopify API request failed: ' + err.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Shopify-Store, X-Shopify-Token, X-Shopify-Client-Id, X-Shopify-Client-Secret',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

async function shopifyFetch(url, token) {
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  return res.json();
}

async function shopifyFetchRaw(url, token) {
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  return res;
}

function getNextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const matches = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return matches ? matches[1] : null;
}

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().substring(0, 10);
}

function todayStr() { return new Date().toISOString().substring(0, 10); }

function round2(n) { return Math.round(n * 100) / 100; }
