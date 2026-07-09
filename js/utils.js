// js/utils.js
// Pure helper functions used across modules. No DOM access here.

// ===== 날짜키 유틸 (YYYY-MM-DD) =====
export function getDateKey(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// CSV escape
export function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// 예약 시간 슬롯 생성 (점심시간 12:00~13:00 제외)
const END_HOUR = 19;
const END_MIN = 0; // 18:40-19:00이 마지막 타임이 되도록 19:00으로 종료 시간 수정

export function generateTimeSlots() {
  const slots = [];
  let current = new Date();
  current.setHours(9, 0, 0, 0);
  const endThreshold = new Date();
  endThreshold.setHours(END_HOUR, END_MIN, 0, 0);

  while (current < endThreshold) {
    const hour = current.getHours();

    // 점심시간(12시) 제외 로직
    if (hour !== 12) {
      const start = current.toTimeString().substring(0, 5);
      const next = new Date(current.getTime() + 20 * 60000);
      const end = next.toTimeString().substring(0, 5);
      slots.push(`${start}~${end}`);
    }

    // 다음 슬롯으로 이동 (20분 단위)
    current = new Date(current.getTime() + 20 * 60000);
  }
  return slots;
}

export function getAmSlots(timeSlots) {
  return timeSlots.filter((s) => parseInt(s.split(":")[0]) < 12);
}

export function getPmSlots(timeSlots) {
  return timeSlots.filter((s) => parseInt(s.split(":")[0]) >= 13);
}

// 예약 폼 유효성 검사
export function isResFormValid(resData, resMembers) {
  const hasTime = !!resData.timeSlot;
  const allMembersFilled = resMembers.every(
    (m) => m.name.trim() !== "" && String(m.age).trim() !== ""
  );
  return hasTime && allMembersFilled;
}

// 상단 날짜 표시 (TODAY YYYY.M.D.요일)
export function getFixedDateDisplay(today) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `TODAY ${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.${days[today.getDay()]}`;
}