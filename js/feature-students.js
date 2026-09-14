/* ============================================
   學生列表 - 左側欄學生顯示
============================================ */

function renderStudentList() {
  const list = document.getElementById('studentList');
  const count = document.getElementById('sidebarCount');
  
  if (!list || !count) return;
  
  count.textContent = state.students.length + ' 位';
  
  list.innerHTML = state.students.map(student => {
    const stage = student.pet ? PetEngine.getStage(student.totalPoints) : 0;
    const health = PetEngine.getHealth(student);
    const icon = student.pet ? PetEngine.getIcon(student) : '❓';
    const isSelected = student.id === state.selectedStudentId;
    const seatLabel = student.seatNumber
      ? `<span class="seat-no">${escapeHtml(String(student.seatNumber))}</span> ` : '';
    
    return `
      <li class="student-item ${isSelected ? 'selected' : ''}" onclick="selectStudent('${student.id}')">
        <div class="student-avatar stage-${stage} health-${health}">
          ${icon}
        </div>
        <div class="student-info">
          <div class="student-name">${seatLabel}${student.name}</div>
          <div class="student-meta">
            <span class="student-points">${student.currentPoints} 分</span>
            <span>·</span>
            <span>${student.pet ? STAGE_NAMES[stage] : '未選寵物'}</span>
          </div>
        </div>
      </li>
    `;
  }).join('');
}
