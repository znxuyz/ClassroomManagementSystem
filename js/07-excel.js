/* ============================================
   Excel 匯入 - 使用 SheetJS (xlsx.js)
   需在 index.html 引入 SheetJS CDN
============================================ */

const ExcelImport = {
  
  // 觸發檔案選擇對話框
  pickFile(callback) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          if (typeof XLSX === 'undefined') {
            toast('Excel 套件未載入,請檢查網路連線');
            return;
          }
          const data = new Uint8Array(ev.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          // 取第一個工作表
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
          callback(rows, file.name);
        } catch (err) {
          console.error(err);
          toast('讀取 Excel 失敗:' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  },
  
  // 解析學生名單 Excel
  // 期待格式:標題列 + 座號 / 姓名 / 守護獸(選填)
  parseStudentRows(rows) {
    if (!rows || rows.length < 2) {
      return { error: '檔案內容為空或缺少資料列' };
    }
    
    // 找出標題列(允許多種寫法)
    const header = rows[0].map(c => String(c || '').trim());
    const seatCol = header.findIndex(h => h.includes('座號') || /^(no|number|#)$/i.test(h));
    const nameCol = header.findIndex(h => h.includes('姓名') || h.includes('學生') || /^name$/i.test(h));
    const petCol = header.findIndex(h => h.includes('守護獸') || h.includes('寵物'));
    const emailCol = header.findIndex(h =>
      h.includes('信箱') || h.includes('帳號') || h.includes('電子郵件') || /e-?mail/i.test(h));

    if (nameCol < 0) {
      return { error: '找不到「姓名」欄位。請確認首列包含「姓名」字樣' };
    }
    
    const validPets = PET_SPECIES.map(p => p.name);
    const petNameToId = {};
    PET_SPECIES.forEach(p => { petNameToId[p.name] = p.id; });
    
    const results = [];
    const errors = [];
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row[nameCol] || '').trim();
      if (!name) continue; // 空列跳過
      
      const seat = seatCol >= 0 ? String(row[seatCol] || '').trim() : '';
      const petName = petCol >= 0 ? String(row[petCol] || '').trim() : '';
      
      const entry = { name, seatNumber: seat };

      if (emailCol >= 0) {
        const email = String(row[emailCol] || '').trim().toLowerCase();
        if (email) {
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            entry.email = email;
          } else {
            errors.push(`第 ${i + 1} 列「${name}」的信箱「${email}」格式不正確,將略過`);
          }
        }
      }

      if (petName) {
        if (petNameToId[petName]) {
          entry.pet = petNameToId[petName];
        } else {
          errors.push(`第 ${i + 1} 列「${name}」的守護獸「${petName}」無法識別,將略過`);
        }
      }
      results.push(entry);
    }
    
    return { students: results, warnings: errors };
  }
};

/* ============================================
   套用匯入學生 - 處理覆蓋/追加邏輯
============================================ */

function importStudentsFromExcel() {
  ExcelImport.pickFile((rows, filename) => {
    const result = ExcelImport.parseStudentRows(rows);
    if (result.error) {
      toast(result.error);
      return;
    }
    
    if (result.warnings && result.warnings.length > 0) {
      console.warn(result.warnings.join('\n'));
    }
    
    const imported = result.students;
    if (imported.length === 0) {
      toast('檔案中沒有任何學生資料');
      return;
    }
    
    // 詢問處理方式
    const mode = state.students.length > 0 ?
      confirm(`找到 ${imported.length} 位學生(來自 ${filename})。\n\n按「確定」= 完全覆蓋現有名單\n按「取消」= 合併追加(現有學生保留資料)`)
      : true;
    
    if (mode) {
      // 完全覆蓋
      state.students = imported.map((s, i) => {
        const stu = createStudent(s.name, i);
        if (s.seatNumber) stu.seatNumber = s.seatNumber;
        if (s.pet) stu.pet = s.pet;
        if (s.email) stu.email = s.email;
        return stu;
      });
    } else {
      // 合併追加:依姓名保留現有
      const existing = new Map(state.students.map(s => [s.name, s]));
      let added = 0;
      imported.forEach((s, i) => {
        const exists = existing.get(s.name);
        if (exists) {
          // 更新座號、信箱與寵物(若 Excel 有指定)
          if (s.seatNumber) exists.seatNumber = s.seatNumber;
          if (s.email) exists.email = s.email;
          if (s.pet && !exists.pet) exists.pet = s.pet;
        } else {
          const stu = createStudent(s.name, Date.now() + i);
          if (s.seatNumber) stu.seatNumber = s.seatNumber;
          if (s.email) stu.email = s.email;
          if (s.pet) stu.pet = s.pet;
          state.students.push(stu);
          added++;
        }
      });
      toast('合併完成,新增 ' + added + ' 位學生');
    }
    
    // 依座號排序
    state.students.sort((a, b) => {
      const aN = parseInt(a.seatNumber) || 9999;
      const bN = parseInt(b.seatNumber) || 9999;
      return aN - bN;
    });
    
    save();
    
    // 如果在 setup 階段,直接進入主介面
    if (!state.className) {
      const cn = document.getElementById('setupClassName')?.value.trim() || '我的班級';
      const tn = document.getElementById('setupTeacherName')?.value.trim() || '老師';
      state.className = cn;
      state.teacherName = tn;
      state.rules = state.rules.length > 0 ? state.rules : [...DEFAULT_RULES];
      save();
      showApp();
    } else {
      renderAll();
    }
    
    toast(`✦ 已匯入 ${imported.length} 位學生`);

    // 雲端模式:同步 email 索引,學生才能用 Google 帳號登入對到自己
    syncRosterAfterImport();

    if (result.warnings && result.warnings.length > 0) {
      setTimeout(() => {
        alert('注意事項:\n\n' + result.warnings.join('\n'));
      }, 1500);
    }
  });
}

/* ============================================
   同步名冊索引到雲端
   ────────────────────────────────────────────
   學生用 Google 登入時,系統靠這份索引把 email 對到
   班級與學生編號。沒有 email 的學生不會被寫入,
   代表他暫時只能由老師在後台操作。
============================================ */

async function syncRosterAfterImport() {
  if (!isCloudMode()) return;

  const withEmail = state.students.filter(s => s.email);
  const without = state.students.length - withEmail.length;

  try {
    await flushCloudSave();   // 先確保 blob 是最新的
    // 就算沒有人有信箱也要同步 —— 它會把舊的索引清掉。
    // 早退的話索引會留著指向已經不存在的學生,學生登入後找不到自己,
    // 畫面壞掉卻又說不出哪裡錯,比乾脆地說「還沒被加入班級」更難查。
    await Cloud.syncRosterIndex(state.classId, state.className, state.students);

    if (withEmail.length === 0) {
      toast('名單沒有信箱欄位,學生將無法自行登入');
      return;
    }
    toast(`✦ ${withEmail.length} 位學生已可用 Google 登入` +
          (without > 0 ? `(${without} 位缺信箱)` : ''));
  } catch (e) {
    console.error('[Cloud] 名冊同步失敗:', e);
    toast('名冊同步失敗:' + e.message);
  }
}

/* ============================================
   下載範本提示 - 引導老師取得範本
============================================ */

function showImportTemplateHint() {
  alert(
    '學生資料 Excel 範本格式\n' +
    '────────────────\n\n' +
    '需要的欄位(首列為標題):\n' +
    '  座號 | 姓名 | Google信箱 | 守護獸(選填)\n\n' +
    '說明:\n' +
    '• 「姓名」為必填欄位\n' +
    '• 「座號」會用於排序\n' +
    '• 「Google信箱」是學生自行登入的依據,\n' +
    '   請填縣市帳號,例如 s1234@ms.school.edu.tw\n' +
    '   欄位標題寫「信箱」「帳號」「Email」都可以\n' +
    '• 「守護獸」可填台灣特有種名稱:\n' +
    '   台灣黑熊、石虎、櫻花鉤吻鮭、帝雉、\n' +
    '   台灣藍鵲、穿山甲、山羌、台灣獼猴\n\n' +
    '專案資料夾中有「學生資料範本.xlsx」可直接編輯使用。'
  );
}

/* ============================================
   題庫 Excel 匯入
   ────────────────────────────────────────────
   領地戰與一般測驗共用同一份解析,只是欄位用到的不同:
     題目 | 選項A | 選項B | 選項C | 選項D | 正確答案 | 難度 | 題型

   · 正確答案:填 A/B/C/D,或 1/2/3/4;是非題填 O/X
   · 難度:簡單/普通/困難(只有領地戰會用到)
   · 題型:選擇/是非/簡答(只有一般測驗會用到,留空當選擇題)
============================================ */

const QuestionImport = {

  /* 欄位標題允許多種寫法,老師不必記得一模一樣 */
  findCol(header, patterns) {
    return header.findIndex(h => patterns.some(p =>
      typeof p === 'string' ? h.includes(p) : p.test(h)));
  },

  parse(rows) {
    if (!rows || rows.length < 2) return { error: '檔案是空的,或只有標題列' };

    const header = rows[0].map(c => String(c || '').trim());
    const col = {
      text:   this.findCol(header, ['題目', '題幹', /question/i]),
      answer: this.findCol(header, ['正確答案', '答案', /answer/i]),
      diff:   this.findCol(header, ['難度', /difficulty/i]),
      type:   this.findCol(header, ['題型', '類型', /type/i])
    };

    // 選項欄位:選項A~D 或 選項1~4,兩種寫法都收
    const optCols = [];
    for (let i = 0; i < 4; i++) {
      const letter = 'ABCD'[i];
      let idx = this.findCol(header, [`選項${letter}`, `選項${i + 1}`, `${letter}選項`]);
      if (idx < 0) idx = header.findIndex(h => h === letter || h === String(i + 1));
      optCols.push(idx);
    }

    if (col.text < 0) return { error: '找不到「題目」欄位,請確認第一列有「題目」兩個字' };
    if (col.answer < 0) return { error: '找不到「正確答案」欄位' };

    // 中英文都收,老師從別處複製過來的表格也能直接用
    const DIFF_MAP = { '簡單': 'easy', '容易': 'easy', '易': 'easy', 'easy': 'easy',
                       '普通': 'medium', '中等': 'medium', '中': 'medium', 'medium': 'medium',
                       '困難': 'hard', '難': 'hard', '高': 'hard', 'hard': 'hard' };
    const TYPE_MAP = { '選擇': 'choice', '選擇題': 'choice', 'choice': 'choice',
                       '是非': 'truefalse', '是非題': 'truefalse', 'truefalse': 'truefalse',
                       '簡答': 'short', '簡答題': 'short', '填空': 'short', 'short': 'short' };

    const questions = [];
    const warnings = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const text = String(row[col.text] || '').trim();
      if (!text) continue;                       // 空列跳過

      const line = i + 1;
      const rawAnswer = String(row[col.answer] || '').trim();
      const type = TYPE_MAP[String(row[col.type] || '').trim().toLowerCase()] || 'choice';
      const difficulty = DIFF_MAP[String(row[col.diff] || '').trim().toLowerCase()] || 'medium';

      const options = optCols.map(c => c >= 0 ? String(row[c] || '').trim() : '');

      if (type === 'truefalse') {
        const yes = /^(o|○|v|✓|對|是|正確|true|t|y)$/i.test(rawAnswer);
        const no  = /^(x|✕|×|錯|否|錯誤|false|f|n)$/i.test(rawAnswer);
        if (!yes && !no) {
          warnings.push(`第 ${line} 列:是非題的答案「${rawAnswer}」無法判讀,請填 O 或 X`);
          continue;
        }
        questions.push({ text, type, difficulty, options: [], answer: yes });
        continue;
      }

      if (type === 'short') {
        if (!rawAnswer) { warnings.push(`第 ${line} 列:簡答題沒有填答案`); continue; }
        questions.push({ text, type, difficulty, options: [], answer: rawAnswer });
        continue;
      }

      // 選擇題
      const filled = options.filter(Boolean).length;
      if (filled < 2) {
        warnings.push(`第 ${line} 列「${text.slice(0, 12)}」至少要有兩個選項`);
        continue;
      }

      let idx = -1;
      const m = rawAnswer.toUpperCase().match(/^[ABCD]$/);
      if (m) idx = 'ABCD'.indexOf(m[0]);
      else if (/^[1-4]$/.test(rawAnswer)) idx = parseInt(rawAnswer) - 1;
      else {
        // 也接受直接把答案內容寫進去
        idx = options.findIndex(o => o && o === rawAnswer);
      }

      if (idx < 0 || !options[idx]) {
        warnings.push(`第 ${line} 列:答案「${rawAnswer}」對不到任何選項,請填 A~D`);
        continue;
      }

      questions.push({ text, type: 'choice', difficulty, options, answer: idx });
    }

    return { questions, warnings };
  },

  /* 產生範本檔。用 SheetJS 直接在瀏覽器產生,不必另外放檔案在 repo */
  downloadTemplate(kind) {
    if (typeof XLSX === 'undefined') { toast('Excel 套件未載入'); return; }

    const isWar = kind === 'territory';
    const header = isWar
      ? ['題目', '選項A', '選項B', '選項C', '選項D', '正確答案', '難度']
      : ['題目', '選項A', '選項B', '選項C', '選項D', '正確答案', '題型'];

    const sample = isWar ? [
      ['台灣最高的山是哪一座?', '玉山', '雪山', '大霸尖山', '合歡山', 'A', '簡單'],
      ['9 × 7 = ?', '54', '63', '72', '56', 'B', '普通'],
      ['光合作用主要在植物的哪個部位進行?', '根', '莖', '葉', '花', 'C', '困難']
    ] : [
      ['台灣最高的山是哪一座?', '玉山', '雪山', '大霸尖山', '合歡山', 'A', '選擇'],
      ['地球是圓的。', '', '', '', '', 'O', '是非'],
      ['台灣的首都是哪裡?', '', '', '', '', '台北', '簡答']
    ];

    const notes = [
      ['填寫說明'],
      [''],
      ['【題目】必填。'],
      ['【選項A~D】選擇題填,是非題與簡答題可留空。至少要有兩個選項。'],
      ['【正確答案】選擇題填 A/B/C/D 或 1/2/3/4;是非題填 O 或 X;簡答題直接填答案文字。'],
      isWar
        ? ['【難度】填 簡單 / 普通 / 困難。決定答對可得幾佔領分(1 / 2 / 3),留空當作普通。']
        : ['【題型】填 選擇 / 是非 / 簡答,留空當作選擇題。'],
      [''],
      ['空白列會自動略過,可以直接在下面繼續加題目。']
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([header, ...sample]);
    ws['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
                   { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, '題庫');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), '填寫說明');

    XLSX.writeFile(wb, isWar ? '領地戰題庫範本.xlsx' : '測驗題庫範本.xlsx');
  }
};

/* ---------- 領地戰題庫 ---------- */

function importTerritoryQuestionsFromExcel() {
  ExcelImport.pickFile((rows, filename) => {
    const result = QuestionImport.parse(rows);
    if (result.error) { toast(result.error); return; }
    if (result.questions.length === 0) {
      toast('沒有讀到任何有效題目');
      if (result.warnings.length) alert('問題如下:\n\n' + result.warnings.join('\n'));
      return;
    }

    const replace = state.territoryQuestions.length > 0 &&
      confirm(`讀到 ${result.questions.length} 題(來自 ${filename})。\n\n` +
              `按「確定」= 取代現有的 ${state.territoryQuestions.length} 題\n` +
              `按「取消」= 附加在現有題庫後面`);

    const imported = result.questions.map((q, i) => ({
      id: 'tq_' + Date.now() + '_' + i,
      text: q.text,
      options: q.options,
      answer: q.answer,
      difficulty: q.difficulty,
      createdAt: Date.now()
    }));

    state.territoryQuestions = replace
      ? imported
      : imported.concat(state.territoryQuestions);

    save();
    renderTerritoryQuestions();
    publishTerritoryQuestions();
    toast(`✦ 已匯入 ${imported.length} 題`);

    if (result.warnings.length) {
      setTimeout(() => alert(`有 ${result.warnings.length} 列被略過:\n\n` +
        result.warnings.slice(0, 20).join('\n')), 800);
    }
  });
}

/* ---------- 一般測驗題庫 ---------- */

function importQuizQuestionsFromExcel(quizId) {
  const quiz = getQuiz(quizId);
  if (!quiz) return;

  ExcelImport.pickFile((rows, filename) => {
    const result = QuestionImport.parse(rows);
    if (result.error) { toast(result.error); return; }
    if (result.questions.length === 0) {
      toast('沒有讀到任何有效題目');
      if (result.warnings.length) alert('問題如下:\n\n' + result.warnings.join('\n'));
      return;
    }

    result.questions.forEach((q, i) => {
      quiz.questions.push({
        id: 'q_' + Date.now() + '_' + i,
        type: q.type,
        text: q.text,
        // 選擇題固定四個欄位,編輯畫面才不會少格
        options: q.type === 'choice'
          ? [q.options[0] || '', q.options[1] || '', q.options[2] || '', q.options[3] || '']
          : ['', '', '', ''],
        answer: q.answer
      });
    });

    save();
    renderQuizList();
    toast(`✦ 已加入 ${result.questions.length} 題到「${quiz.title}」`);

    if (result.warnings.length) {
      setTimeout(() => alert(`有 ${result.warnings.length} 列被略過:\n\n` +
        result.warnings.slice(0, 20).join('\n')), 800);
    }
  });
}
