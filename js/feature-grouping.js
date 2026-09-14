/* ============================================
   分組 - 隨機 / 平均積分 / 階段混搭 / 手動
============================================ */

function setGroupMode(mode) {
  state.groupMode = mode;
  document.querySelectorAll('.group-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const param = document.getElementById('groupParam');
  if (!param) return;
  if (mode === 'byCount') {
    param.value = 6;
    param.title = '要分成幾組';
  } else {
    param.value = 4;
    param.title = '每組要幾人';
  }
}

function renderGroupingControls() {
  if (state.currentGroups.length > 0) {
    const algo = document.getElementById('groupAlgo')?.value;
    if (algo === 'manual') {
      renderManualGrouping();
    } else {
      renderGroups(state.currentGroups);
    }
  }
  renderSavedGroupSets();
}

function generateGroups() {
  if (state.students.length === 0) {
    toast('沒有學生可分組');
    return;
  }
  
  const param = parseInt(document.getElementById('groupParam').value) || 6;
  const algo = document.getElementById('groupAlgo').value;
  const mode = state.groupMode;
  
  let groupCount;
  if (mode === 'byCount') {
    groupCount = param;
  } else {
    groupCount = Math.ceil(state.students.length / param);
  }
  
  if (groupCount < 1) groupCount = 1;
  if (groupCount > state.students.length) groupCount = state.students.length;
  
  // 手動模式:建立空組讓老師拖曳分配
  if (algo === 'manual') {
    state.currentGroups = Array.from({ length: groupCount }, () => []);
    renderManualGrouping();
    toast('已建立 ' + groupCount + ' 個空組,將學生拖曳或下拉指派到組別');
    return;
  }
  
  let groups = Array.from({ length: groupCount }, () => []);
  let pool = [...state.students];
  
  if (algo === 'random') {
    pool.sort(() => Math.random() - 0.5);
  } else if (algo === 'balanced') {
    pool.sort((a, b) => b.totalPoints - a.totalPoints);
  } else if (algo === 'stage-mixed') {
    pool.sort((a, b) => {
      const sa = a.pet ? PetEngine.getStage(a.totalPoints) : -1;
      const sb = b.pet ? PetEngine.getStage(b.totalPoints) : -1;
      return sb - sa;
    });
  }
  
  // 蛇形分配
  let direction = 1;
  let groupIdx = 0;
  pool.forEach(s => {
    groups[groupIdx].push(s.id);
    groupIdx += direction;
    if (groupIdx >= groupCount) {
      groupIdx = groupCount - 1;
      direction = -1;
    } else if (groupIdx < 0) {
      groupIdx = 0;
      direction = 1;
    }
  });
  
  state.currentGroups = groups;
  save();                      // 存起來,學生端的小組排行榜才看得到
  renderGroups(groups);
  toast('已產生 ' + groupCount + ' 個分組');
}

function renderGroups(groups) {
  const container = document.getElementById('groupsDisplay');
  if (!container) return;
  
  if (groups.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">⌗</div>
        <div>點上方「產生分組」開始</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = groups.map((groupIds, i) => {
    const members = groupIds.map(id => getStudent(id)).filter(Boolean);
    const totalPoints = members.reduce((s, m) => s + m.totalPoints, 0);
    return `
      <div class="group-card">
        <div class="group-card-title">
          <span>第 ${i + 1} 組</span>
          <span style="font-size: 12px; color: var(--gold);">${totalPoints} 分</span>
        </div>
        <div class="group-card-meta">${members.length} 位成員</div>
        <div class="group-members">
          ${members.map(m => {
            const icon = m.pet ? PetEngine.getIcon(m) : '❓';
            return `
              <div class="group-member">
                <div class="group-member-icon">${icon}</div>
                <div class="group-member-name">
                  ${m.seatNumber ? `<span class="seat-no">${escapeHtml(String(m.seatNumber))}</span>` : ''}
                  ${escapeHtml(m.name)}
                </div>
                <div class="group-member-points">${m.totalPoints} 分</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

/* ============================================
   手動分組 - 拖曳與下拉指派
============================================ */

let manualDragState = { studentId: null, fromGroup: null };

function renderManualGrouping() {
  const container = document.getElementById('groupsDisplay');
  if (!container) return;
  
  const assigned = new Set();
  state.currentGroups.forEach(g => g.forEach(id => assigned.add(id)));
  const unassigned = state.students.filter(s => !assigned.has(s.id));
  
  let html = '';
  
  state.currentGroups.forEach((groupIds, i) => {
    const members = groupIds.map(id => getStudent(id)).filter(Boolean);
    const totalPoints = members.reduce((s, m) => s + m.totalPoints, 0);
    
    html += `
      <div class="group-card manual-group" 
        ondragover="onManualGroupDragOver(event)"
        ondrop="onManualGroupDrop(event, ${i})"
        ondragleave="onManualGroupDragLeave(event)">
        <div class="group-card-title">
          <span>第 ${i + 1} 組</span>
          <span style="font-size: 12px; color: var(--gold);">${totalPoints} 分</span>
        </div>
        <div class="group-card-meta">${members.length} 位 · 可拖曳新增/移除</div>
        <div class="group-members">
          ${members.length === 0 ? '<div style="text-align:center; color: var(--ink-muted); padding: 16px 10px; font-size: 12px; border: 1px dashed var(--paper-shadow); border-radius: 6px;">空組 · 拖曳學生到此處</div>' : 
          members.map(m => {
            const icon = m.pet ? PetEngine.getIcon(m) : '❓';
            return `
              <div class="group-member" 
                draggable="true"
                ondragstart="onManualMemberDragStart(event, '${m.id}', ${i})"
                style="cursor: grab;">
                <div class="group-member-icon">${icon}</div>
                <div class="group-member-name">
                  ${m.seatNumber ? `<span class="seat-no">${escapeHtml(String(m.seatNumber))}</span>` : ''}
                  ${escapeHtml(m.name)}
                </div>
                <button onclick="removeFromManualGroup('${m.id}', ${i})" 
                  style="background:none;border:none;color:var(--sick);cursor:pointer;font-size:14px;padding:2px 6px;" title="移出此組">✕</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });
  
  // 未分組學生池
  html += `
    <div class="group-card manual-pool"
      ondragover="onManualGroupDragOver(event)"
      ondrop="onManualPoolDrop(event)"
      ondragleave="onManualGroupDragLeave(event)"
      style="border-top-color: var(--ink-muted); background: var(--paper);">
      <div class="group-card-title">
        <span>未分組池</span>
        <span style="font-size: 12px; color: var(--ink-muted);">${unassigned.length} 位</span>
      </div>
      <div class="group-card-meta">點下拉選單或拖曳指派</div>
      <div class="group-members">
        ${unassigned.length === 0 ? '<div style="text-align:center; color: var(--healthy); padding: 16px; font-size: 13px;">✓ 全班已分組完畢</div>' :
        unassigned.map(m => {
          const icon = m.pet ? PetEngine.getIcon(m) : '❓';
          return `
            <div class="group-member"
              draggable="true"
              ondragstart="onManualMemberDragStart(event, '${m.id}', null)"
              style="cursor: grab;">
              <div class="group-member-icon">${icon}</div>
              <div class="group-member-name">${m.name}</div>
              <select onchange="assignToManualGroup('${m.id}', this.value); this.value='';" 
                style="font-size:11px; padding:3px 6px; background: var(--paper-warm); border: 1px solid var(--paper-shadow); border-radius:4px;">
                <option value="">指派...</option>
                ${state.currentGroups.map((_, i) => `<option value="${i}">第 ${i + 1} 組</option>`).join('')}
              </select>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
  
  container.innerHTML = html;
}

function onManualMemberDragStart(e, studentId, fromGroup) {
  manualDragState = { studentId, fromGroup };
  e.stopPropagation();
}

function onManualGroupDragOver(e) {
  e.preventDefault();
  e.currentTarget.style.background = 'rgba(212, 164, 70, 0.15)';
}

function onManualGroupDragLeave(e) {
  e.currentTarget.style.background = '';
}

function onManualGroupDrop(e, targetGroup) {
  e.preventDefault();
  e.currentTarget.style.background = '';
  if (!manualDragState.studentId) return;
  
  if (manualDragState.fromGroup !== null) {
    state.currentGroups[manualDragState.fromGroup] = 
      state.currentGroups[manualDragState.fromGroup].filter(id => id !== manualDragState.studentId);
  }
  if (!state.currentGroups[targetGroup].includes(manualDragState.studentId)) {
    state.currentGroups[targetGroup].push(manualDragState.studentId);
  }
  
  manualDragState = { studentId: null, fromGroup: null };
  renderManualGrouping();
}

function onManualPoolDrop(e) {
  e.preventDefault();
  e.currentTarget.style.background = '';
  if (!manualDragState.studentId) return;
  
  if (manualDragState.fromGroup !== null) {
    state.currentGroups[manualDragState.fromGroup] = 
      state.currentGroups[manualDragState.fromGroup].filter(id => id !== manualDragState.studentId);
  }
  manualDragState = { studentId: null, fromGroup: null };
  renderManualGrouping();
}

function assignToManualGroup(studentId, groupIdx) {
  const idx = parseInt(groupIdx);
  if (isNaN(idx)) return;
  if (!state.currentGroups[idx].includes(studentId)) {
    state.currentGroups[idx].push(studentId);
  }
  renderManualGrouping();
}

function removeFromManualGroup(studentId, fromGroup) {
  state.currentGroups[fromGroup] = state.currentGroups[fromGroup].filter(id => id !== studentId);
  renderManualGrouping();
}

/* ============================================
   分組儲存
============================================ */

function saveGroupSet() {
  if (state.currentGroups.length === 0) {
    toast('請先產生分組');
    return;
  }
  const name = document.getElementById('groupSetName').value.trim();
  if (!name) {
    toast('請輸入分組名稱');
    return;
  }
  
  state.groupSets.push({
    id: 'gs_' + Date.now(),
    name: name,
    groups: state.currentGroups.map(g => [...g]),
    createdAt: Date.now()
  });
  
  save();
  document.getElementById('groupSetName').value = '';
  renderSavedGroupSets();
  toast('已儲存「' + name + '」');
}

function renderSavedGroupSets() {
  const container = document.getElementById('savedGroupsContainer');
  if (!container) return;
  if (state.groupSets.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  container.innerHTML = `
    <div class="panel-card" style="margin-top: 20px;">
      <div class="panel-title">已儲存的分組</div>
      <div class="saved-groups" style="padding: 0; border: none; margin: 0;">
        ${state.groupSets.slice().reverse().map(gs => `
          <div class="layout-chip" onclick="loadGroupSet('${gs.id}')">
            <span>${gs.name}</span>
            <span style="color: var(--ink-muted); font-size: 11px;">(${gs.groups.length} 組)</span>
            <button class="layout-chip-delete" onclick="event.stopPropagation(); deleteGroupSet('${gs.id}')">✕</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function loadGroupSet(id) {
  const gs = state.groupSets.find(g => g.id === id);
  if (!gs) return;
  state.currentGroups = gs.groups.map(g => [...g]);
  save();
  renderGroups(state.currentGroups);
  toast('已載入「' + gs.name + '」');
}

function deleteGroupSet(id) {
  if (!confirm('確定刪除此分組?')) return;
  state.groupSets = state.groupSets.filter(g => g.id !== id);
  save();
  renderSavedGroupSets();
}
