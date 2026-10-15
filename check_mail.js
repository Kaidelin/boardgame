const https = require('https');

const GIST_ID = process.env.GIST_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;

if (!GIST_ID || !GH_TOKEN) process.exit(0);

https.get(`https://api.github.com/gists/${GIST_ID}`, {
  headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'User-Agent': 'NodeJS' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', async () => {
    try {
      const gist = JSON.parse(data);
      const db = JSON.parse(gist.files['boardgame_calendar.json'].content);

      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const todayKey = `${y}-${m}-${d}`;

      const dayData = db.schedule && db.schedule[todayKey];
      if (!dayData) return;

      const dowNames = ['일','월','화','수','목','금','토'];
      const dow = dowNames[now.getDay()];

      await processSlot(todayKey, 'lunch', '☀️ 점심시간', dayData.lunch, dayData, y, m, d, dow, db);
      await processSlot(todayKey, 'dinner', '🌙 저녁시간', dayData.dinner, dayData, y, m, d, dow, db);

      await updateGist(db);
    } catch (e) {
      console.error(e);
    }
  });
});

async function processSlot(dateKey, type, label, attendees, dayData, y, m, d, dow, db) {
  if (!attendees || attendees.length < 4) return;
  const notifyKey = `daily_notified_${type}`;
  if (dayData[notifyKey]) return;

  const emails = attendees.map(name => db.emails && db.emails[name]).filter(Boolean);
  if (emails.length === 0) {
    dayData[notifyKey] = true;
    return;
  }

  const success = await sendEmailJS({
    to_email: emails.join(', '),
    date_label: `${y}년 ${m}월 ${d}일(${dow}) ${label}`,
    member_count: String(attendees.length),
    members_list: attendees.join(', '),
    calendar_url: `https://${process.env.GH_USER}.github.io/${process.env.GH_REPO}/`
  });

  if (success) dayData[notifyKey] = true;
}

function sendEmailJS(params) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: params
    });

    const req = https.request({
      hostname: 'api.emailjs.com',
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => resolve(res.statusCode === 200));

    req.on('error', () => resolve(false));
    req.write(postData);
    req.end();
  });
}

function updateGist(db) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      files: { 'boardgame_calendar.json': { content: JSON.stringify(db, null, 2) } }
    });

    const req = https.request({
      hostname: 'api.github.com',
      path: `/gists/${GIST_ID}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'NodeJS',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => resolve(res.statusCode === 200));

    req.on('error', () => resolve(false));
    req.write(postData);
    req.end();
  });
}
