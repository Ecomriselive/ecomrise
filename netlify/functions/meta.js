// Meta Marketing API Proxy — Netlify Function
// READ-ONLY: Only uses ads_read and read_insights permissions
// NO write/manage permissions are requested or used

const META_API_VERSION = 'v22.0';
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' };
  }

  // Get credentials from request headers
  const accessToken = event.headers['x-meta-token'];
  const adAccountId = event.headers['x-meta-account'];

  if (!accessToken) {
    return respond(401, { error: 'not_connected', message: 'No Meta access token provided.' });
  }

  const action = event.queryStringParameters?.action || 'test';

  try {
    switch (action) {

      // ─── TEST: verify token and get ad accounts ───
      case 'test': {
        const url = `${META_BASE}/me?fields=id,name&access_token=${accessToken}`;
        const userData = await metaFetch(url);

        // Also fetch ad accounts the user has access to
        const acctUrl = `${META_BASE}/me/adaccounts?fields=id,name,account_id,account_status,currency,timezone_name&access_token=${accessToken}`;
        const acctData = await metaFetch(acctUrl);

        return respond(200, {
          connected: true,
          user: userData.name || userData.id,
          adAccounts: (acctData.data || []).map(a => ({
            id: a.id,
            account_id: a.account_id,
            name: a.name,
            status: a.account_status,
            currency: a.currency,
            timezone: a.timezone_name
          }))
        });
      }

      // ─── INSIGHTS: ad account level insights ───
      case 'insights': {
        if (!adAccountId) return respond(400, { error: 'No ad account ID provided.' });

        const since = event.queryStringParameters?.since || thirtyDaysAgo();
        const until = event.queryStringParameters?.until || todayStr();
        const level = event.queryStringParameters?.level || 'account';

        const fields = [
          'campaign_name', 'adset_name', 'ad_name',
          'spend', 'impressions', 'clicks', 'cpc', 'cpm', 'ctr',
          'reach', 'frequency',
          'actions', 'action_values', 'cost_per_action_type',
          'conversions', 'conversion_values'
        ].join(',');

        const url = `${META_BASE}/${adAccountId}/insights?fields=${fields}&time_range={"since":"${since}","until":"${until}"}&level=${level}&time_increment=1&limit=500&access_token=${accessToken}`;
        const data = await metaFetch(url);

        return respond(200, { insights: data.data || [], paging: data.paging || null });
      }

      // ─── CAMPAIGNS: list campaigns with status ───
      case 'campaigns': {
        if (!adAccountId) return respond(400, { error: 'No ad account ID provided.' });

        const since = event.queryStringParameters?.since || thirtyDaysAgo();
        const until = event.queryStringParameters?.until || todayStr();

        // Get campaigns
        const campUrl = `${META_BASE}/${adAccountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time&limit=100&access_token=${accessToken}`;
        const campData = await metaFetch(campUrl);

        // Get campaign-level insights
        const insightFields = 'campaign_id,campaign_name,spend,impressions,clicks,cpc,cpm,ctr,reach,actions,action_values,cost_per_action_type';
        const insUrl = `${META_BASE}/${adAccountId}/insights?fields=${insightFields}&time_range={"since":"${since}","until":"${until}"}&level=campaign&limit=500&access_token=${accessToken}`;
        const insData = await metaFetch(insUrl);

        // Merge insights into campaigns
        const insightMap = {};
        (insData.data || []).forEach(i => { insightMap[i.campaign_id] = i; });

        const campaigns = (campData.data || []).map(c => {
          const ins = insightMap[c.id] || {};
          const purchases = getActionValue(ins.actions, 'omni_purchase') || getActionValue(ins.actions, 'purchase') || 0;
          const purchaseValue = getActionValue(ins.action_values, 'omni_purchase') || getActionValue(ins.action_values, 'purchase') || 0;
          const spend = parseFloat(ins.spend || 0);

          return {
            id: c.id,
            name: c.name,
            status: c.status,
            objective: c.objective,
            spend: round2(spend),
            impressions: parseInt(ins.impressions || 0),
            clicks: parseInt(ins.clicks || 0),
            cpc: round2(parseFloat(ins.cpc || 0)),
            cpm: round2(parseFloat(ins.cpm || 0)),
            ctr: round2(parseFloat(ins.ctr || 0)),
            reach: parseInt(ins.reach || 0),
            purchases: parseInt(purchases),
            revenue: round2(parseFloat(purchaseValue)),
            roas: spend > 0 ? round2(parseFloat(purchaseValue) / spend) : 0,
            costPerPurchase: purchases > 0 ? round2(spend / parseInt(purchases)) : 0
          };
        });

        return respond(200, { campaigns });
      }

      // ─── STATS: aggregated account-level stats ───
      case 'stats': {
        if (!adAccountId) return respond(400, { error: 'No ad account ID provided.' });

        const since = event.queryStringParameters?.since || thirtyDaysAgo();
        const until = event.queryStringParameters?.until || todayStr();

        // Account-level totals
        const totalFields = 'spend,impressions,clicks,cpc,cpm,ctr,reach,frequency,actions,action_values,cost_per_action_type';
        const totalUrl = `${META_BASE}/${adAccountId}/insights?fields=${totalFields}&time_range={"since":"${since}","until":"${until}"}&limit=1&access_token=${accessToken}`;
        const totalData = await metaFetch(totalUrl);
        const t = (totalData.data || [])[0] || {};

        // Daily breakdown
        const dailyUrl = `${META_BASE}/${adAccountId}/insights?fields=spend,impressions,clicks,actions,action_values&time_range={"since":"${since}","until":"${until}"}&time_increment=1&limit=500&access_token=${accessToken}`;
        const dailyData = await metaFetch(dailyUrl);

        const totalSpend = parseFloat(t.spend || 0);
        const totalPurchases = getActionValue(t.actions, 'omni_purchase') || getActionValue(t.actions, 'purchase') || 0;
        const totalRevenue = getActionValue(t.action_values, 'omni_purchase') || getActionValue(t.action_values, 'purchase') || 0;
        const totalClicks = parseInt(t.clicks || 0);
        const totalImpressions = parseInt(t.impressions || 0);

        const dailyArray = (dailyData.data || []).map(d => ({
          date: d.date_start,
          spend: round2(parseFloat(d.spend || 0)),
          impressions: parseInt(d.impressions || 0),
          clicks: parseInt(d.clicks || 0),
          purchases: parseInt(getActionValue(d.actions, 'omni_purchase') || getActionValue(d.actions, 'purchase') || 0),
          revenue: round2(parseFloat(getActionValue(d.action_values, 'omni_purchase') || getActionValue(d.action_values, 'purchase') || 0))
        }));

        return respond(200, {
          totalSpend: round2(totalSpend),
          totalImpressions,
          totalClicks,
          totalReach: parseInt(t.reach || 0),
          frequency: round2(parseFloat(t.frequency || 0)),
          avgCPC: round2(parseFloat(t.cpc || 0)),
          avgCPM: round2(parseFloat(t.cpm || 0)),
          avgCTR: round2(parseFloat(t.ctr || 0)),
          totalPurchases: parseInt(totalPurchases),
          totalRevenue: round2(parseFloat(totalRevenue)),
          roas: totalSpend > 0 ? round2(parseFloat(totalRevenue) / totalSpend) : 0,
          costPerPurchase: parseInt(totalPurchases) > 0 ? round2(totalSpend / parseInt(totalPurchases)) : 0,
          dailyData: dailyArray,
          dateRange: { since, until }
        });
      }

      default:
        return respond(400, { error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('Meta API error:', err);
    return respond(500, { error: 'api_error', message: 'Meta API request failed: ' + err.message });
  }
};

// ===== HELPERS =====

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Meta-Token, X-Meta-Account',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };
}

function respond(statusCode, body) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

async function metaFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    let errMsg = `Meta API ${res.status}`;
    try {
      const errData = JSON.parse(text);
      errMsg = errData.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }
  return res.json();
}

function getActionValue(actions, actionType) {
  if (!actions || !Array.isArray(actions)) return 0;
  const action = actions.find(a => a.action_type === actionType);
  return action ? action.value : 0;
}

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().substring(0, 10);
}

function todayStr() { return new Date().toISOString().substring(0, 10); }

function round2(n) { return Math.round(n * 100) / 100; }
