/* Visit/reservation CSV parsing and visit backup helpers. No Firebase writes live here. */
(function (global) {
  "use strict";

  function parseCsv(text) {
    var source = String(text || "").replace(/^\uFEFF/, "");
    var rows = [], row = [], field = "", quoted = false;
    for (var i = 0; i < source.length; i++) {
      var char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (char !== "\r") field += char;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (item) { return item.some(function (cell) { return String(cell).trim(); }); });
  }

  function csvCell(value) {
    var text = String(value == null ? "" : value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function dateString(value) {
    if (!value) return "";
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  function normalizeActivity(value) {
    var name = String(value || "").trim();
    return name === "인생네컷" ? "유스네컷" : name;
  }

  function normalizeFacility(value) {
    var name = String(value || "").trim().replace(/\s+/g, " ");
    if (name === "AR 스포츠") return "AR 스포츠";
    if (name === "노래방 1실" || name === "노래방1") return "노래방1";
    if (name === "노래방 2실" || name === "노래방2") return "노래방2";
    return "";
  }

  function reservationSlotKey(record) {
    return [
      String(record && record.dateKey || "").trim(),
      String(record && record.timeSlot || "").trim(),
      normalizeFacility(record && record.facility)
    ].join("::");
  }

  function reservationFingerprint(record) {
    var members = Array.isArray(record && record.members) ? record.members : [];
    var memberKeys = members.map(function (member) {
      return JSON.stringify([
        String(member && member.name || "").trim(),
        String(member && member.age != null ? member.age : "").trim(),
        String(member && member.gender || "").trim()
      ]);
    }).sort();
    return reservationSlotKey(record) + "::" + memberKeys.join("|");
  }

  function stableHash(value) {
    var text = String(value || ""), first = 2166136261, second = 2654435761;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 1597334677);
    }
    return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0");
  }

  function reservationImportId(record, occurrence) {
    return "csv-reservation-" + stableHash(reservationFingerprint(record) + "::" + Number(occurrence || 0));
  }

  function parseKoreanDateTime(value) {
    var text = String(value || "").trim();
    var match = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2}):(\d{2})$/.exec(text);
    if (!match) return "";
    var hour = Number(match[5]);
    if (match[4] === "오후" && hour < 12) hour += 12;
    if (match[4] === "오전" && hour === 12) hour = 0;
    var utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 9, Number(match[6]), Number(match[7]));
    return new Date(utc).toISOString();
  }

  function fingerprint(record) {
    return [
      String(record.timestamp || record.createdAt || "").replace(/\s+/g, ""),
      String(record.name || "").trim(),
      String(record.age == null ? "" : record.age).trim(),
      String(record.gender || "").trim(),
      (record.activities || []).map(normalizeActivity).sort().join("|")
    ].join("::");
  }

  function parseLegacy(rows, header) {
    var index = {};
    header.forEach(function (name, i) { index[String(name).trim()] = i; });
    var required = ["구분", "일시/시간", "시설/활동", "이름", "나이", "성별"];
    if (required.some(function (name) { return index[name] == null; })) throw new Error("지원하지 않는 CSV 형식입니다.");
    var groups = new Map(), invalidRows = 0, visitRows = 0, ignoredReservationRows = 0;
    rows.forEach(function (row) {
      var kind = String(row[index["구분"]] || "").trim();
      if (kind === "시설예약") { ignoredReservationRows++; return; }
      if (kind !== "방문등록") { invalidRows++; return; }
      visitRows++;
      var timestamp = String(row[index["일시/시간"]] || "").trim();
      var activity = normalizeActivity(row[index["시설/활동"]]);
      var name = String(row[index["이름"]] || "").trim();
      var age = String(row[index["나이"]] || "").trim();
      var gender = String(row[index["성별"]] || "").trim();
      if (!timestamp || !activity || !name || !age || !gender) { invalidRows++; return; }
      var key = JSON.stringify([timestamp, name, age, gender]);
      if (!groups.has(key)) groups.set(key, { timestamp: timestamp, createdAt: parseKoreanDateTime(timestamp), name: name, age: age, gender: gender, activities: [] });
      var record = groups.get(key);
      if (record.activities.indexOf(activity) < 0) record.activities.push(activity);
    });
    return { records: Array.from(groups.values()), visitRows: visitRows, ignoredReservationRows: ignoredReservationRows, invalidRows: invalidRows };
  }

  function parseBackup(rows, header) {
    var index = {};
    header.forEach(function (name, i) { index[String(name).trim()] = i; });
    var records = [], invalidRows = 0;
    rows.forEach(function (row) {
      try {
        var activities = JSON.parse(String(row[index.activities] || "[]"));
        var record = {
          id: String(row[index.recordId] || "").trim(),
          createdAt: String(row[index.createdAt] || "").trim(),
          timestamp: String(row[index.timestamp] || "").trim(),
          name: String(row[index.name] || "").trim(),
          age: String(row[index.age] || "").trim(),
          gender: String(row[index.gender] || "").trim(),
          activities: Array.isArray(activities) ? activities.map(normalizeActivity).filter(Boolean) : []
        };
        if (!record.name || !record.age || !record.gender || !record.activities.length) throw new Error("invalid");
        records.push(record);
      } catch (error) { invalidRows++; }
    });
    return { records: records, visitRows: rows.length, ignoredReservationRows: 0, invalidRows: invalidRows };
  }

  function parseVisitFile(text) {
    var table = parseCsv(text);
    if (table.length < 2) throw new Error("CSV에 복구할 방문 기록이 없습니다.");
    var header = table[0].map(function (cell) { return String(cell).replace(/^\uFEFF/, "").trim(); });
    var rows = table.slice(1);
    var isBackup = header.indexOf("backupVersion") >= 0 && header.indexOf("recordId") >= 0 && header.indexOf("activities") >= 0;
    var result = isBackup ? parseBackup(rows, header) : parseLegacy(rows, header);
    result.sourceRows = rows.length;
    result.format = isBackup ? "backup-v2" : "integrated-report";
    result.records.forEach(function (record) { record.activities.sort(); });
    return result;
  }

  function parseReservationDateTime(value) {
    var text = String(value || "").trim();
    var match = /^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d)~([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
    if (!match) return null;
    var year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    var startHour = Number(match[4]), startMinute = Number(match[5]);
    var endHour = Number(match[6]), endMinute = Number(match[7]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) return null;
    return {
      dateKey: match[1] + "-" + match[2] + "-" + match[3],
      timeSlot: match[4] + ":" + match[5] + "~" + match[6] + ":" + match[7],
      createdAt: new Date(Date.UTC(year, month - 1, day, startHour - 9, startMinute)).toISOString()
    };
  }

  function parseReservationFile(text) {
    var table = parseCsv(text);
    if (table.length < 2) throw new Error("CSV에 가져올 시설예약 기록이 없습니다.");
    var expectedHeader = ["구분", "일시/시간", "시설/활동", "이름", "나이", "성별"];
    var header = table[0].map(function (cell) { return String(cell).replace(/^\uFEFF/, "").trim(); });
    if (header.length !== expectedHeader.length || expectedHeader.some(function (name, index) { return header[index] !== name; })) {
      throw new Error("지원하지 않는 CSV 형식입니다.");
    }

    var rows = table.slice(1), currentRun = null, records = [], seenFingerprints = new Set();
    var reservationRows = 0, ignoredVisitRows = 0, invalidRows = 0, repairedRows = 0;
    var candidateReservations = 0, repeatedMemberRows = 0, repeatedMemberReservations = 0;
    var duplicateReservationFingerprints = 0, overCapacityReservations = 0;

    function finalizeRun() {
      if (!currentRun) return;
      candidateReservations++;
      if (currentRun.hasRepeatedMembers) repeatedMemberReservations++;
      delete currentRun.memberKeys;
      delete currentRun.hasRepeatedMembers;
      if (currentRun.members.length > 10) overCapacityReservations++;
      var fingerprint = reservationFingerprint(currentRun);
      if (seenFingerprints.has(fingerprint)) duplicateReservationFingerprints++;
      else seenFingerprints.add(fingerprint);
      records.push(currentRun);
      currentRun = null;
    }

    rows.forEach(function (row) {
      var kind = String(row[0] || "").trim();
      if (kind === "방문등록") { finalizeRun(); ignoredVisitRows++; return; }
      if (kind !== "시설예약") { finalizeRun(); invalidRows++; return; }
      reservationRows++;
      if (row.length < expectedHeader.length) { finalizeRun(); invalidRows++; return; }

      var parsedDate = parseReservationDateTime(row[1]);
      var facility = normalizeFacility(row[2]);
      var name = row.slice(3, -2).map(function (part) { return String(part).trim(); }).join(",").trim();
      var age = String(row[row.length - 2] || "").trim();
      var gender = String(row[row.length - 1] || "").trim();
      if (!parsedDate || !facility || !name || !age || (gender !== "남성" && gender !== "여성")) { finalizeRun(); invalidRows++; return; }
      if (row.length > expectedHeader.length) repairedRows++;

      var slotKey = reservationSlotKey({ dateKey: parsedDate.dateKey, timeSlot: parsedDate.timeSlot, facility: facility });
      if (!currentRun || currentRun.slotKey !== slotKey) {
        finalizeRun();
        currentRun = {
          facility: facility,
          timeSlot: parsedDate.timeSlot,
          dateKey: parsedDate.dateKey,
          members: [],
          createdAt: parsedDate.createdAt,
          slotKey: slotKey,
          memberKeys: new Set(),
          hasRepeatedMembers: false
        };
      }
      var memberKey = JSON.stringify([name, age, gender]);
      if (currentRun.memberKeys.has(memberKey)) { repeatedMemberRows++; currentRun.hasRepeatedMembers = true; }
      currentRun.memberKeys.add(memberKey);
      currentRun.members.push({ name: name, age: age, gender: gender });
    });
    finalizeRun();
    records.forEach(function (record) { delete record.slotKey; });
    return {
      records: records,
      sourceRows: rows.length,
      reservationRows: reservationRows,
      ignoredVisitRows: ignoredVisitRows,
      invalidRows: invalidRows,
      repairedRows: repairedRows,
      candidateReservations: candidateReservations,
      repeatedMemberRows: repeatedMemberRows,
      repeatedMemberReservations: repeatedMemberReservations,
      duplicateReservationFingerprints: duplicateReservationFingerprints,
      overCapacityReservations: overCapacityReservations,
      format: "integrated-report"
    };
  }

  function createBackupCsv(records) {
    var lines = [["backupVersion", "recordId", "createdAt", "timestamp", "name", "age", "gender", "activities"]];
    (records || []).forEach(function (record) {
      lines.push(["2", record.id || "", dateString(record.createdAt), record.timestamp || "", record.name || "", record.age == null ? "" : record.age, record.gender || "", JSON.stringify((record.activities || []).map(normalizeActivity))]);
    });
    return "\uFEFF" + lines.map(function (line) { return line.map(csvCell).join(","); }).join("\n");
  }

  global.VisitImportTools = {
    parseVisitFile: parseVisitFile,
    parseReservationFile: parseReservationFile,
    createBackupCsv: createBackupCsv,
    fingerprint: fingerprint,
    normalizeActivity: normalizeActivity,
    normalizeFacility: normalizeFacility,
    reservationSlotKey: reservationSlotKey,
    reservationFingerprint: reservationFingerprint,
    reservationImportId: reservationImportId
  };
}(window));
