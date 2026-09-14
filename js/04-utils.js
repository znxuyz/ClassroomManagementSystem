/* ============================================
   提示訊息
============================================ */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* 依座號排序。沒填座號的排最後。
   座號是字串(可能是 "07"),要轉成數字比,不然 10 會排在 2 前面。 */
function bySeatNumber(a, b) {
  const na = parseInt(a.seatNumber, 10);
  const nb = parseInt(b.seatNumber, 10);
  return (isNaN(na) ? Infinity : na) - (isNaN(nb) ? Infinity : nb);
}
