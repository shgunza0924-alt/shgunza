// js/csv.js
// Builds and downloads the combined CSV export (visits + reservations).

import { csvEscape, getDateKey } from "./utils.js";
import { getVisits } from "./visit.js";
import { getReservations } from "./reservation.js";
import { notify } from "./notification.js";

const csvDownloadBtn = document.getElementById("csv-download-btn");

function downloadCSV() {
  const visits = getVisits();
  const reservations = getReservations();

  if (visits.length === 0 && reservations.length === 0) {
    notify("다운로드할 데이터가 없습니다.");
    return;
  }

  const headers = ["구분", "일시/시간", "시설/활동", "이름", "나이", "성별"];

  const visitRows = [];
  visits.forEach((v) => {
    (v.activities || []).forEach((activity) => {
      visitRows.push(["방문등록", v.timestamp, activity, v.name, v.age, v.gender]);
    });
  });

  const reservationRows = [];
  reservations.forEach((r) => {
    const dateKey = r.dateKey || getDateKey(new Date(r.createdAt || Date.now()));
    const [y, m, d] = dateKey.split("-");
    const fullTimeDisplay = `${y}. ${Number(m)}. ${Number(d)}. ${r.timeSlot}`;

    (r.members || []).forEach((mb) => {
      reservationRows.push(["시설예약", fullTimeDisplay, r.facility, mb.name, mb.age, mb.gender]);
    });
  });

  const allRows = [...visitRows, ...reservationRows];
  const csvContent =
    "\uFEFF" +
    [headers, ...allRows].map((row) => row.map(csvEscape).join(",")).join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const today = new Date();
  link.setAttribute(
    "download",
    `군자청소년문화센터_통합실적_${today.toISOString().split("T")[0]}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  notify("CSV 파일이 생성되었습니다.");
}

export function initCSV() {
  csvDownloadBtn.addEventListener("click", downloadCSV);
}