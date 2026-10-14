const https = require('https');
const nodemailer = require('nodemailer');

const GIST_ID = process.env.GIST_ID;
const GH_TOKEN = process.env.GH_TOKEN;

// 회사 사내 SMTP 설정 (GitHub Secrets에서 가져옴)
const SMTP_HOST = process.env.SMTP_HOST;       // 예: smtp.company.com
const SMTP_PORT = process.env.SMTP_PORT || 465; // 보통 SSL은 465, TLS는 587
const SMTP_USER = process.env.SMTP_USER;       // 발송용 사내 계정 이메일
const SMTP_PASS = process.env.SMTP_PASS;       // 발송용 계정 비밀번호

if (!GIST_ID || !GH_TOKEN) {
  console.log("GIST 설정이 없습니다.");
  process.exit(0);
}

// 사내 SMTP 전송 설정
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465, // 465포트면 true, 587이면 false
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

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
      await processSlot(todayKey, 'lunch', '☀️ 점심시간', dayData.lunch, dayData, y, m, d, dow, db);
      await processSlot(todayKey, 'dinner', '🌙 저녁시간', dayData.dinner, dayData, y, m, d, dow, db);

      // 수정된 데이터(발송 완료 기록) 다시 Gist에 저장
      await updateGist(db);

    } catch (e) {
      console.error("데이터 처리 중 오류:", e);
    }
  });
}).on('error', e => console.error(e));

async function processSlot(dateKey, type, label, attendees, dayData, y, m, d, dow, db) {
  if (!attendees || attendees.length < 4) return;
  
  const notifyField = `daily_notified_${type}`;
  if (dayData[notifyField]) {
    console.log(`${dateKey} ${type}은 이미 오늘 안내 메일이 발송되었습니다.`);
    return;
  }

  const emails = attendees.map(name => db.emails && db.emails[name]).filter(Boolean);
  if (emails.length === 0) {
    console.log(`${dateKey} ${type} 참석자 중 등록된 이메일이 없습니다.`);
    dayData[notifyField] = true;
    return;
  }

  const fullDateLabel = `${y}년 ${m}월 ${d}일(${dow}) ${label}`;
  const calendarUrl = `https://${process.env.GH_USER}.github.io/${process.env.GH_REPO}/`;

  const mailOptions = {
    from: `"보드게임 동아리" <${SMTP_USER}>`,
    to: emails.join(', '),
    subject: `[🎲 보드게임 성사] ${fullDateLabel} 모임이 확정되었습니다! (${attendees.length}명)`,
    text: `안녕하세요! 오늘 예정된 보드게임 모임이 4인 이상 모여 성사되었습니다.\n\n` +
          `■ 일시: ${fullDateLabel}\n` +
          `■ 참석 인원 (${attendees.length}명): ${attendees.join(', ')}\n\n` +
          `일정에 변동이 생기면 아래 동아리 달력에서 수정해 주세요.\n` +
          `👉 달력 바로가기: ${calendarUrl}`
  };

  try {
    await transporter.sendMail(mailOptions);
    dayData[notifyField] = true;
    console.log(`✅ [${dateKey} ${type}] 사내 메일 발송 성공 (${emails.length명}명에게 전송)`);
  } catch (err) {
    console.error(`❌ [${dateKey} ${type}] 메일 발송 실패:`, err);
  }
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
