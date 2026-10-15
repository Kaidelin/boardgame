const GIST_ID = process.env.GIST_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const GH_USER = process.env.GH_USER || 'Kaidelin';
const GH_REPO = process.env.GH_REPO || 'boardgame';

async function main() {
  console.log("🚀 [1/4] 보드게임 당일 안내 메일 스크립트 시작");

  if (!GIST_ID || !GH_TOKEN) {
    console.error("❌ 오류: GIST_ID 또는 GH_TOKEN 시크릿이 비어 있습니다.");
    process.exit(1);
  }

  // 1. Gist에서 달력 데이터 불러오기
  const gistRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'NodeJS-Boardgame-Bot'
    }
  });

  if (!gistRes.ok) {
    console.error(`❌ Gist 불러오기 실패 (HTTP ${gistRes.status}):`, await gistRes.text());
    process.exit(1);
  }

  const gistData = await gistRes.json();
  if (!gistData.files || !gistData.files['boardgame_calendar.json']) {
    console.error("❌ 오류: Gist 안에 boardgame_calendar.json 파일이 없습니다.");
    process.exit(1);
  }

  const db = JSON.parse(gistData.files['boardgame_calendar.json'].content);

  // 2. 한국 시간(KST, UTC+9) 기준 오늘 날짜 계산
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = kstNow.getUTCFullYear();
  const m = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kstNow.getUTCDate()).padStart(2, '0');
  const todayKey = `${y}-${m}-${d}`;
  const dowNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dow = dowNames[kstNow.getUTCDay()];

  console.log(`📅 [2/4] 오늘 날짜(KST): ${todayKey} (${dow}요일)`);

  const dayData = db.schedule && db.schedule[todayKey];
  if (!dayData) {
    console.log("ℹ️ 오늘 날짜에 등록된 참석 데이터가 없습니다. 작업을 종료합니다.");
    process.exit(0);
  }

  const lunchList = dayData.lunch || [];
  const dinnerList = dayData.dinner || [];
  console.log(`👥 오늘 참석 현황 - 점심: ${lunchList.length}명 (${lunchList.join(', ') || '없음'}) / 저녁: ${dinnerList.length}명 (${dinnerList.join(', ') || '없음'})`);

  let isUpdated = false;

  // 3. 점심 / 저녁 4인 이상 성사 여부 확인 및 메일 발송
  const lunchSent = await processSlot(todayKey, 'lunch', '☀️ 점심시간', lunchList, dayData, y, m, d, dow, db);
  const dinnerSent = await processSlot(todayKey, 'dinner', '🌙 저녁시간', dinnerList, dayData, y, m, d, dow, db);

  if (lunchSent || dinnerSent) {
    isUpdated = true;
  }

  // 4. 발송 이력이 추가된 경우 Gist 업데이트
  if (isUpdated) {
    console.log("💾 [4/4] 발송 완료 기록을 Gist에 저장합니다...");
    const updateRes = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'NodeJS-Boardgame-Bot'
      },
      body: JSON.stringify({
        files: {
          'boardgame_calendar.json': {
            content: JSON.stringify(db, null, 2)
          }
        }
      })
    });
    console.log(updateRes.ok ? "✅ Gist 저장 완료!" : `⚠️ Gist 저장 실패: ${updateRes.status}`);
  } else {
    console.log("ℹ️ [4/4] 새로 발송된 메일이 없어 Gist 업데이트를 건너뜁니다.");
  }

  console.log("🎉 모든 작업이 정상적으로 끝났습니다.");
  process.exit(0);
}

async function processSlot(dateKey, type, label, attendees, dayData, y, m, d, dow, db) {
  if (!attendees || attendees.length < 4) {
    console.log(`⏭️ [${label}] 인원 미달(${attendees ? attendees.length : 0}/4명)로 발송 대상이 아닙니다.`);
    return false;
  }

  const notifyKey = `daily_notified_${type}`;
  if (dayData[notifyKey]) {
    console.log(`⏭️ [${label}] 이미 오늘 아침 안내 메일이 발송되었습니다.`);
    return false;
  }

  const emails = attendees.map(name => db.emails && db.emails[name]).filter(Boolean);
  if (emails.length === 0) {
    console.log(`⚠️ [${label}] 4인 이상 성사되었으나, 참석자 중 이메일을 등록한 사람이 없습니다.`);
    dayData[notifyKey] = true;
    return true;
  }

  console.log(`📧 [3/4] [${label}] 메일 발송 시도 중... 수신자: ${emails.join(', ')}`);

  const calendarUrl = `https://${GH_USER}.github.io/${GH_REPO}/`;
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': `https://${GH_USER}.github.io`,
      'Referer': calendarUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        to_email: emails.join(', '),
        date_label: `${y}년 ${m}월 ${d}일(${dow}) ${label}`,
        member_count: String(attendees.length),
        members_list: attendees.join(', '),
        calendar_url: calendarUrl
      }
    })
  });

  const resText = await res.text();
  if (res.ok) {
    console.log(`✅ [${label}] 메일 발송 성공! (${resText})`);
    dayData[notifyKey] = true;
    return true;
  } else {
    console.error(`❌ [${label}] EmailJS 발송 실패 (HTTP ${res.status}): ${resText}`);
    return false;
  }
}

main().catch(err => {
  console.error("❌ 예기치 못한 에러 발생:", err);
  process.exit(1);
});
