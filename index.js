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
  const getUser = () => { const a = req.headers.authorization; return a ? DB.users.find(x => x.api_key === a.replace('Bearer ', '')) : null; };  
  
  try {  
    // 首页  
    if (m === 'GET' && p === '/') {  
      return res.json({  
        name: 'China AI Gateway', status: 'running',  
        models_available: Object.keys(MODELS).filter(k => MODELS[k].key),  
        buy_tokens: process.env.LEMON_SQUEEZY_URL || 'Ask admin',  
        free_trial: 'Register to get $0.10 free (~5 queries)',  
        docs: { openai_compatible: { url: 'https://v13-gray.vercel.app/v1/chat/completions', auth: 'Bearer YOUR_KEY', model: 'deepseek' },  
          register: 'POST /register', balance: 'GET /balance', redeem: 'POST /redeem' },  
      });  
    }  
  
    // OpenAI 兼容 + /chat  
    if (m === 'POST' && (p === '/v1/chat/completions' || p === '/chat')) {  
      const u = getUser();  
      if (!u) return res.status(401).json({ error: 'Invalid API key. Register: POST /register' });  
      const { model = 'deepseek', messages } = req.body || {};  
      if (!messages) return res.status(400).json({ error: 'messages required' });  
      const key = Object.keys(MODELS).find(k => model.startsWith(k));  
      if (!key || !MODELS[key].key) return res.status(400).json({ error: 'Model unavailable' });  
      const pt = Math.ceil(messages.map(m => m.content || '').join(' ').length / 4);  
      const est = Math.ceil((pt / 1000) * 0.02);  
      if (u.balance < est) return res.status(402).json({ error: 'Insufficient balance', balance: u.balance, need: est, buy: process.env.LEMON_SQUEEZY_URL });  
      const r = await fetch(MODELS[key].url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MODELS[key].key}` }, body: JSON.stringify({ model: MODELS[key].model, messages }) });  
      const d = await r.json(); if (!r.ok) return res.status(r.status).json(d);  
      const cost = Math.ceil((pt / 1000) * 0.02 + ((d.usage?.completion_tokens || 0) / 1000) * 0.02);  
      u.balance -= cost; u.spent += cost; d._balance = { remaining: u.balance, spent: u.spent };  
      return res.json(d);  
    }  
  
    // 注册（送 $0.1 试用）  
    if (m === 'POST' && p === '/register') {  
      const key = genKey();  
      DB.users.push({ id: crypto.randomUUID(), api_key: key, balance: 10, spent: 0, email: req.body?.email || null, created_at: new Date().toISOString() });  
      return res.json({ api_key: key, balance: 10, note: '$0.10 free trial. Buy more: ' + (process.env.LEMON_SQUEEZY_URL || 'Ask admin'), chat_endpoint: 'https://v13-gray.vercel.app/v1/chat/completions' });  
    }  
  
    // 余额  
    if (m === 'GET' && p === '/balance') { const u = getUser(); if (!u) return res.status(401).json({ error: 'Invalid API key' }); return res.json({ balance: u.balance, spent: u.spent }); }  
  
    // 兑换码  
    if (m === 'POST' && p === '/redeem') {  
      const u = getUser(); if (!u) return res.status(401).json({ error: 'Invalid API key' });  
      const { code } = req.body || {}; if (!code) return res.status(400).json({ error: 'Missing code' });  
      const t = DB.tokens.find(t => t.code === code && !t.used); if (!t) return res.status(400).json({ error: 'Invalid code' });  
      t.used = true; u.balance += t.value; return res.json({ ok: true, added: t.value, balance: u.balance });  
    }  
  
    // 管理员：生成码  
    if (m === 'POST' && p === '/generate') {  
      if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });  
      const { count = 1, value = 5000 } = req.body || {};  
      const codes = []; for (let i = 0; i < count; i++) { const c = genCode(); DB.tokens.push({ id: crypto.randomUUID(), value, code: c, used: false }); codes.push({ code: c, value }); }  
      return res.json({ count, codes });  
    }  
  
    // Webhook  
    if (m === 'POST' && p === '/webhook') {  
      const attrs = req.body?.data?.attributes || {};  
      const email = attrs.user_email;  
      const total = attrs.total || 0;  
      const value = Math.max(Math.round(total * 1000), 1000);  
      const code = genCode(); DB.tokens.push({ id: crypto.randomUUID(), value, code, used: false });  
      if (email) { const u = DB.users.find(x => x.email === email); if (u) { u.balance += value; const t = DB.tokens.find(x => x.code === code); if (t) t.used = true; } }  
      return res.json({ ok: true });  
    }  
  
    return res.status(404).json({ error: `Not found: ${p}` });  
  } catch (e) { return res.status(500).json({ error: e.message }); }  
};  
