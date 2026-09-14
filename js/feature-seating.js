/* ============================================
   座位表
============================================ */
let dragState = { studentId: null, fromSeat: null };

function renderSeating() {
  rebuildSeatingGrid();
  renderSeatingPool();
  renderSavedLayouts();
}

function rebuildSeatingGrid() {
  const rows = parseInt(document.getElementById('seatRows').value) || 6;
  const cols = parseInt(document.getElementById('seatCols').value) || 5;
  
  // 初始化目前 layout 結構
  if (!state.currentLayout) {
    state.currentLayout = { rows, cols, grid: {} };
  } else {
    state.currentLayout.rows = rows;
    state.currentLayout.cols = cols;
  }
  
  const grid = document.getElementById('seatingGrid');
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  
  let html = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = r + '-' + c;
      const studentId = state.currentLayout.grid[key];
      const student = studentId ? getStudent(studentId) : null;
      
      if (student) {
        const icon = student.pet ? PetEngine.getIcon(student) : '❓';
        html += `
          <div class="seat occupied" data-seat="${key}" 
            draggable="true"
            ondragstart="onSeatDragStart(event, '${key}')"
            ondragover="onSeatDragOver(event)"
            ondrop="onSeatDrop(event, '${key}')"
            ondragleave="onSeatDragLeave(event)">
            <button class="seat-remove" onclick="removeFromSeat('${key}')">✕</button>
            <div class="seat-content">
              <div class="seat-icon">${icon}</div>
              <div class="seat-name">
                ${student.seatNumber
                  ? `<span class="seat-no">${escapeHtml(String(student.seatNumber))}</span>` : ''}
                ${escapeHtml(student.name)}
              </div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="seat" data-seat="${key}"
            ondragover="onSeatDragOver(event)"
            ondrop="onSeatDrop(event, '${key}')"
            ondragleave="onSeatDragLeave(event)">
            <span style="color: var(--ink-muted); font-size: 11px;">空位</span>
          </div>
        `;
      }
    }
  }
  grid.innerHTML = html;
  renderSeatingPool();
}

function renderSeatingPool() {
  const pool = document.getElementById('seatingPoolList');
  if (!state.currentLayout) return;
  
  const seated = new Set(Object.values(state.currentLayout.grid));
  // 依座號排序,老師要找某一號才不用一個一個看
  const unseated = state.students.filter(s => !seated.has(s.id)).sort(bySeatNumber);
  
  if (unseated.length === 0) {
    pool.innerHTML = '<div class="text-muted" style="font-size: 12px;">所有學生都已入座</div>';
    return;
  }
  
  pool.innerHTML = unseated.map(s => {
    const icon = s.pet ? PetEngine.getIcon(s) : '❓';
    return `
      <div class="seating-chip" 
        draggable="true"
        ondragstart="onPoolDragStart(event, '${s.id}')">
        <span class="seating-chip-icon">${icon}</span>
        ${s.seatNumber ? `<span class="seat-no">${escapeHtml(String(s.seatNumber))}</span>` : ''}
        <span>${escapeHtml(s.name)}</span>
      </div>
    `;
  }).join('');
}

function onPoolDragStart(e, studentId) {
  dragState = { studentId, fromSeat: null };
  e.target.classList.add('dragging');
}

function onSeatDragStart(e, seatKey) {
  const studentId = state.currentLayout.grid[seatKey];
  dragState = { studentId, fromSeat: seatKey };
  e.target.classList.add('dragging');
}

function onSeatDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function onSeatDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onSeatDrop(e, targetSeat) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  
  if (!dragState.studentId) return;
  
  const targetStudent = state.currentLayout.grid[targetSeat];
  
  // 從原座位移除
  if (dragState.fromSeat) {
    delete state.currentLayout.grid[dragState.fromSeat];
  }
  
  // 如果目標座位有人,把那個人放到拖曳源
  if (targetStudent && dragState.fromSeat) {
    state.currentLayout.grid[dragState.fromSeat] = targetStudent;
  }
  
  // 放到目標座位
  state.currentLayout.grid[targetSeat] = dragState.studentId;
  
  dragState = { studentId: null, fromSeat: null };
  rebuildSeatingGrid();
}

function removeFromSeat(seatKey) {
  delete state.currentLayout.grid[seatKey];
  rebuildSeatingGrid();
}

function randomFillSeating() {
  const rows = state.currentLayout.rows;
  const cols = state.currentLayout.cols;
  const totalSeats = rows * cols;
  
  if (totalSeats < state.students.length) {
    if (!confirm(`座位(${totalSeats})少於學生(${state.students.length}),只能填入前 ${totalSeats} 位。繼續?`)) return;
  }
  
  const shuffled = [...state.students].sort(() => Math.random() - 0.5);
  state.currentLayout.grid = {};
  
  let idx = 0;
  for (let r = 0; r < rows && idx < shuffled.length; r++) {
    for (let c = 0; c < cols && idx < shuffled.length; c++) {
      state.currentLayout.grid[r + '-' + c] = shuffled[idx].id;
      idx++;
    }
  }
  
  rebuildSeatingGrid();
  toast('已隨機填入 ' + idx + ' 位學生');
}

function clearSeating() {
  if (!confirm('清空所有座位?')) return;
  state.currentLayout.grid = {};
  rebuildSeatingGrid();
}

function saveSeatingLayout() {
  const name = document.getElementById('layoutName').value.trim();
  if (!name) {
    toast('請輸入座位表名稱');
    return;
  }
  
  const layout = {
    id: 'layout_' + Date.now(),
    name: name,
    rows: state.currentLayout.rows,
    cols: state.currentLayout.cols,
    grid: { ...state.currentLayout.grid },
    createdAt: Date.now()
  };
  
  state.seatingLayouts.push(layout);
  save();
  document.getElementById('layoutName').value = '';
  renderSavedLayouts();
  toast('已儲存座位表「' + name + '」');
}

function renderSavedLayouts() {
  const container = document.getElementById('savedLayouts');
  if (state.seatingLayouts.length === 0) {
    container.innerHTML = '<div style="font-size: 12px; color: var(--ink-muted);">尚無已儲存的座位表</div>';
    return;
  }
  
  container.innerHTML = '<div style="width:100%; font-size: 12px; color: var(--ink-muted); margin-bottom: 6px;">已儲存的座位表</div>' +
    state.seatingLayouts.map(l => `
      <div class="layout-chip" onclick="loadSeatingLayout('${l.id}')">
        <span>${l.name}</span>
        <button class="layout-chip-delete" onclick="event.stopPropagation(); deleteSeatingLayout('${l.id}')">✕</button>
      </div>
    `).join('');
}

function loadSeatingLayout(id) {
  const layout = state.seatingLayouts.find(l => l.id === id);
  if (!layout) return;
  
  state.currentLayout = {
    rows: layout.rows,
    cols: layout.cols,
    grid: { ...layout.grid }
  };
  
  document.getElementById('seatRows').value = layout.rows;
  document.getElementById('seatCols').value = layout.cols;
  
  rebuildSeatingGrid();
  toast('已載入「' + layout.name + '」');
}

function deleteSeatingLayout(id) {
  if (!confirm('確定刪除此座位表?')) return;
  state.seatingLayouts = state.seatingLayouts.filter(l => l.id !== id);
  save();
  renderSavedLayouts();
}
