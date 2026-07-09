// js/admin.js
// Renders the admin dashboard: summary stats and the recent-visits table.

import { getVisits, onVisitsChange } from "./visit.js";
import { getReservations, onReservationsChange } from "./reservation.js";
import { setOnAdminEnter } from "./ui.js";

const statVisitsEl = document.getElementById("stat-visits");
const statReservationsEl = document.getElementById("stat-reservations");
const statYouthcutEl = document.getElementById("stat-youthcut");
const statArEl = document.getElementById("stat-ar");
const tbodyEl = document.getElementById("admin-visits-tbody");

function renderStats() {
  const visits = getVisits();
  const reservations = getReservations();

  statVisitsEl.textContent = visits.length;
  statReservationsEl.textContent = reservations.length;
  statYouthcutEl.textContent = visits.filter((v) =>
    v.activities?.includes("유스네컷")
  ).length;
  statArEl.textContent = reservations.filter(
    (r) => r.facility === "AR 스포츠"
  ).length;
}

function renderVisitsTable() {
  const visits = getVisits();
  tbodyEl.innerHTML = "";

  if (visits.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="4" class="table-empty">등록된 방문 내역이 없습니다.</td>`;
    tbodyEl.appendChild(emptyRow);
    return;
  }

  visits.forEach((v) => {
    const row = document.createElement("tr");

    const timeTd = document.createElement("td");
    timeTd.className = "td-time";
    timeTd.textContent = v.timestamp;

    const nameTd = document.createElement("td");
    nameTd.className = "td-name";
    nameTd.textContent = v.name;

    const ageTd = document.createElement("td");
    ageTd.className = "td-age";
    ageTd.textContent = `${v.age}세`;

    const activitiesTd = document.createElement("td");
    const tagsWrap = document.createElement("div");
    tagsWrap.className = "activity-tags";
    (v.activities || []).forEach((a) => {
      const tag = document.createElement("span");
      tag.className = "activity-tag";
      tag.textContent = a;
      tagsWrap.appendChild(tag);
    });
    activitiesTd.appendChild(tagsWrap);

    row.appendChild(timeTd);
    row.appendChild(nameTd);
    row.appendChild(ageTd);
    row.appendChild(activitiesTd);

    tbodyEl.appendChild(row);
  });
}

function renderAdmin() {
  renderStats();
  renderVisitsTable();
}

export function initAdmin() {
  onVisitsChange(renderAdmin);
  onReservationsChange(renderAdmin);
  setOnAdminEnter(renderAdmin);
}