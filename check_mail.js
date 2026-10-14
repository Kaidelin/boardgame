const https = require('https');

const GIST_ID = process.env.GIST_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;

if (!GIST_ID || !GH_TOKEN) {
  console.log("GIST 설정이 없습니다.");
  process.exit(0);
}

// 깃허브 Gist에서 최신 달력 데이터 불러오기
https.get(`https://api.github.com/gists/${GIST_ID}`, {
  headers: { 'Authorization': `Bearer ${GH_TOKEN}`, 'User-Agent': 'NodeJS' }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', async () => {
    try {
      const gist = JSON.parse(data);
      const content = gist.files['boardgame_calendar.json'].content;
      const db = JSON.parse(content);

      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const todayKey = `${y}-${m}-${d}`; // 오늘 날짜 (예: 2026-10-15)

      const dayData = db.schedule && db.schedule[todayKey];
      if (!dayData) {
        console.log("오늘 날짜의 모임 일정이 없습니다.");
        return;
      }

      const dowNames = ['일','월','화','수','목','금','토'];
      const dow = dowNames[now.getDay()];

      // 점심 / 저녁 각각 4인 이상 성사되었고 아직 당일 안내를 안 보낸 경우 발송
      await processSlot(todayKey, 'lunch', '☀️ 점심시간', dayData.lunch, dayData, y, m, d, dow);
      await processSlot(todayKey, 'dinner', '🌙 저녁시간', dayData.dinner, dayData, y, m, d, dow);

      // 수정된 데이터(발송 완료 기록) 다시 Gist에 저장
      await updateGist(db);

    } catch (e) {
      console.error("데이터 처리 중 오류:", e);
    }
  });
}).on('error', e => console.error(e));

async function processSlot(dateKey, type, label, attendees, dayData, y, m, d, dow) {
  if (!attendees || attendees.length < 4) return;
  
  const notifyField = `daily_notified_${type}`;
  if (dayData[notifyField]) {
    console.log(`${dateKey} ${type}은 이미 오늘 안내 메일이 발송되었습니다.`);
    return;
  }

  const emails = attendees.map(name => db.emails && db.emails[name]).filter(Boolean);
  if (emails.length === 0) {
    console.log(`${dateKey} ${type} 참석자 중 등록된 이메일이 없습니다.`);
    dayData[notifyField] = true; // 대상이 없어도 처리 완료로 마킹
    return;
  }

  const fullDateLabel = `${y}년 ${m}월 ${d}일(${dow}) ${label}`;
  const success = await sendEmailJS({
    to_email: emails.join(', '),
    date_label: fullDateLabel,
    member_count: String(attendees.length),
    members_list: attendees.join(', '),
    calendar_url: `https://${process.env.GH_USER}.github.io/${process.env.GH_REPO}/`
  });

  if (success) {
    dayData[notifyField] = true;
    console.log(`✅ [${dateKey} ${type}] 당일 안내 메일 발송 성공 (${attendees.length}명)`);
  }
}

function sendEmailJS(params) {
  return new Promise((resolve) => {
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      console.log("EmailJS 설정이 누락되어 메일을 발송할 수 없습니다.");
      return resolve(false);
    }

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
    }, (res) => {
      resolve(res.statusCode === 200);
    });

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
    }, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.write(postData);
    req.end();
  });
}
