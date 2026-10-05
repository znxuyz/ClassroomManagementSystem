/* ============================================
   點名 / 出席管理
============================================ */
function getTodayDate() {
  const d = new Date();
  return d.getFullYear() + '-' + 
         String(d.getMonth() + 1).padStart(2, '0') + '-' + 
         String(d.getDate()).padStart(2, '0');
}

function formatChineseDate(dateStr) {
  const d = new Date(dateStr);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + weekdays[d.getDay()];
}

function renderAttendance() {
  if (!state.currentAttendanceDate) {
    state.currentAttendanceDate = getTodayDate();
  }
  const date = state.currentAttendanceDate;
  
  document.getElementById('attendanceDate').textContent = formatChineseDate(date);
  document.getElementById('attendanceDatePicker').value = date;
  
  const dayData = state.attendance[date] || {};
  
  // 渲染統計
  let present = 0, absent = 0, late = 0;
  state.students.forEach(s => {
    const status = dayData[s.id];
    if (status === 'present') present++;
    else if (status === 'absent') absent++;
    else if (status === 'late') late++;
  });
  const unmarked = state.students.length - present - absent - late;
  
  document.getElementById('attendanceSummary').innerHTML = `
    <div class="summary-item">
      <div class="summary-item-value summary-present">${present}</div>
      <div class="summary-item-label">出席</div>
    </div>
    <div class="summary-item">
      <div class="summary-item-value summary-absent">${absent}</div>
      <div class="summary-item-label">缺席</div>
    </div>
    <div class="summary-item">
      <div class="summary-item-value summary-late">${late}</div>
      <div class="summary-item-label">遲到</div>
    </div>
    <div class="summary-item">
      <div class="summary-item-value" style="color: var(--ink-muted);">${unmarked}</div>
      <div class="summary-item-label">未點</div>
    </div>
  `;
  
  // 渲染學生列表
  const grid = document.getElementById('attendanceGrid');
  grid.innerHTML = state.students.map(s => {
    const status = dayData[s.id] || '';
    const icon = s.pet ? PetEngine.getIcon(s) : '❓';
    return `
      <div class="attendance-row status-${status}">
        <div class="student-avatar" style="width:36px;height:36px;font-size:18px;">${icon}</div>
        <div class="attendance-row-name">
          ${s.seatNumber ? `<span class="seat-no">${escapeHtml(String(s.seatNumber))}</span>` : ''}
          ${escapeHtml(s.name)}
        </div>
        <div class="status-btns">
          <button class="status-btn btn-present ${status === 'present' ? 'active' : ''}" 
            onclick="setAttendance('${s.id}', 'present')" title="出席">✓</button>
          <button class="status-btn btn-late ${status === 'late' ? 'active' : ''}" 
            onclick="setAttendance('${s.id}', 'late')" title="遲到">↻</button>
          <button class="status-btn btn-absent ${status === 'absent' ? 'active' : ''}" 
            onclick="setAttendance('${s.id}', 'absent')" title="缺席">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function setAttendance(studentId, status) {
  const date = state.currentAttendanceDate;
  if (!state.attendance[date]) state.attendance[date] = {};
  
  // 如果再次點擊相同狀態,則取消
  if (state.attendance[date][studentId] === status) {
    delete state.attendance[date][studentId];
  } else {
    state.attendance[date][studentId] = status;
  }
  
  save();
  renderAttendance();
}

function bulkAttendance(status) {
  const date = state.currentAttendanceDate;
  if (!state.attendance[date]) state.attendance[date] = {};
  
  if (status === 'absent') {
    // 清空(實際上是把這個動作當「清空」)
    delete state.attendance[date];
  } else {
    state.students.forEach(s => {
      state.attendance[date][s.id] = status;
    });
  }
  
  save();
  renderAttendance();
  toast(status === 'present' ? '全班標記為出席' : '已清空今日點名');
}

function awardAttendancePoints() {
  const date = state.currentAttendanceDate;
  const dayData = state.attendance[date] || {};
  const presentIds = Object.keys(dayData).filter(id => dayData[id] === 'present');
  
  if (presentIds.length === 0) {
    toast('沒有人標記為出席');
    return;
  }
  
  /* 一律走共用的發分函式。
     這裡本來是自己改欄位,而且寫了 currentPoints = totalPoints ——
     等於把學生在商店花掉的點數全部還給他:花了 90 點的學生只要被記一次
     出席,可用積分就跳回累積經驗的數字。 */
  presentIds.forEach(id => {
    applyPointsToStudent(id, 1, '出席分(' + date + ')');
  });
  
  save();
  renderAttendance();
  toast('已為 ' + presentIds.length + ' 位出席同學各加 1 分');
}

function changeAttendanceDate() {
  const newDate = document.getElementById('attendanceDatePicker').value;
  if (newDate) {
    state.currentAttendanceDate = newDate;
    renderAttendance();
  }
}
