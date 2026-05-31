const crypto = require('crypto');
const MODELS = {
  deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', key: process.env.DEEPSEEK_API_KEY || '', model: 'deepseek-chat' },
};
const DB = global.__DB || (global.__DB = { users: [], tokens: [] });
function genKey() { return 'sk-' + crypto.randomBytes(24).toString('hex'); }
function genCode() { return 'CHINA-' + crypto.randomBytes(4).toString('hex').toUpperCase(); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const p = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  const m = req.method;
  const u = () => { const a = req.headers.authorization; return a ? DB.users.find(x => x.api_key === a.replace('Bearer ', '')) : null; };

  try {
    // 首页
    if (m === 'GET' && p === '/') {
      return res.json({ name: 'China AI Gateway', status: 'running', models_ready: Object.keys(MODELS).filter(k => MODELS[k].key).length });
    }
    // 模型列表
    if (m === 'GET' && p === '/models') {
      return res.json({ models: Object.keys(MODELS).filter(k => MODELS[k].key).map(k => ({ id: k, name: MODELS[k].model })) });
    }
    // 注册
    if (m === 'POST' && p === '/register') {
      const key = genKey(); DB.users.push({ id: crypto.randomUUID(), api_key: key, balance: 1000, spent: 0 }); return res.json({ api_key: key, balance: 1000 });
    }
    // 余额
    if (m === 'GET' && p === '/balance') {
      const x = u(); if (!x) return res.status(401).json({ error: 'Invalid API key' }); return res.json({ balance: x.balance, spent: x.spent });
    }
    // 兑换
    if (m === 'POST' && p === '/redeem') {
      const x = u(); if (!x) return res.status(401).json({ error: 'Invalid API key' });
      const { code } = req.body || {}; if (!code) return res.status(400).json({ error: 'Missing code' });
      const t = DB.tokens.find(t => t.code === code && !t.used); if (!t) return res.status(400).json({ error: 'Invalid code' });
      t.used = true; x.balance += t.value; return res.json({ ok: true, added: t.value, balance: x.balance });
    }
    // 管理创建码
    if (m === 'POST' && p === '/generate') {
      if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
      const { count = 1, value = 1000 } = req.body || {};
      const codes = []; for (let i = 0; i < count; i++) { const c = genCode(); DB.tokens.push({ id: crypto.randomUUID(), value, code: c, used: false }); codes.push({ code: c, value }); }
      return res.json({ count, codes });
    }
    // 聊天
    if (m === 'POST' && p === '/chat') {
      const x = u(); if (!x) return res.status(401).json({ error: 'Invalid API key' });
      const { model = 'deepseek', messages } = req.body || {}; if (!messages) return res.status(400).json({ error: 'messages required' });
      const key = Object.keys(MODELS).find(k => model.startsWith(k)); if (!key || !MODELS[key].key) return res.status(400).json({ error: 'Model unavailable' });
      const pt = Math.ceil(messages.map(m => m.content || '').join(' ').length / 4);
      const est = Math.ceil((pt / 1000) * 0.02);
      if (x.balance < est) return res.status(402).json({ error: 'Insufficient balance', balance: x.balance, need: est });
      const r = await fetch(MODELS[key].url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MODELS[key].key}` }, body: JSON.stringify({ model: MODELS[key].model, messages }) });
      const d = await r.json(); if (!r.ok) return res.status(r.status).json(d);
      const cost = Math.ceil((pt / 1000) * 0.02 + ((d.usage?.completion_tokens || 0) / 1000) * 0.02);
      x.balance -= cost; x.spent += cost; d._balance = { remaining: x.balance, spent: x.spent };
      return res.json(d);
    }
    // webhook
    if (m === 'POST' && p === '/webhook') {
      const total = req.body?.data?.attributes?.total || 0; const amt = Math.max(Math.round(total * 100), 1000);
      const c = genCode(); DB.tokens.push({ id: crypto.randomUUID(), value: amt, code: c, used: false });
      const email = req.body?.data?.attributes?.user_email; if (email) { const x = DB.users.find(u => u.email === email); if (x) { x.balance += amt; DB.tokens.find(t => t.code === c).used = true; } }
      return res.json({ ok: true });
    }
    return res.status(404).json({ error: `Not found: ${p}` });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
