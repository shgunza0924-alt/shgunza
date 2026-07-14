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

export const AGE_OPTIONS = [
  { value: "9", label: "초등 (9~13세)" },
  { value: "14", label: "중등 (14~16세)" },
  { value: "17", label: "고등 (17~19세)" },
  { value: "20", label: "청년 (20~24세)" },
  { value: "25", label: "청년 (25~39세)" },
  { value: "40", label: "성인 (40세 이상)" },
  { value: "0", label: "유아 (8세 미만)" },
];

export function isValidKoreanName(name) {
  return /^[가-힣]{2,}$/.test(String(name || "").trim());
}

export function getKoreanNameError(name) {
  const value = String(name || "").trim();
  if (!value) return "이름을 입력해주세요.";
  if (/[A-Za-z]/.test(value)) return "이름은 한글만 입력할 수 있습니다.";
  if (/[^가-힣]/.test(value)) return "이름에는 완성된 한글 글자만 사용할 수 있습니다.";
  if (value.length < 2) return "이름은 두 글자 이상 입력해주세요.";
  return "";
}

export function createAgeSelect(value = "", className = "") {
  const select = document.createElement("select");
  select.className = `age-select ${className}`.trim();
  select.setAttribute("aria-label", "나이 선택");
  select.innerHTML = '<option value="" disabled>나이 선택</option>';
  AGE_OPTIONS.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  });
  select.value = String(value);
  if (!select.value) select.selectedIndex = 0;
  return select;
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
    (m) => isValidKoreanName(m.name) && String(m.age).trim() !== ""
  );
  return hasTime && allMembersFilled;
}

// 상단 날짜 표시 (TODAY YYYY.M.D.요일)
export function getFixedDateDisplay(today) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `TODAY ${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.${days[today.getDay()]}`;
}
