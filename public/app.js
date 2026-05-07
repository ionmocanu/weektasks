const DAYS = [
  { key: 'monday',    short: 'Mon', full: 'Monday' },
  { key: 'tuesday',   short: 'Tue', full: 'Tuesday' },
  { key: 'wednesday', short: 'Wed', full: 'Wednesday' },
  { key: 'thursday',  short: 'Thu', full: 'Thursday' },
  { key: 'friday',    short: 'Fri', full: 'Friday' },
  { key: 'saturday',  short: 'Sat', full: 'Saturday' },
  { key: 'sunday',    short: 'Sun', full: 'Sunday' },
];

let allTasks = [];
let activeDay = null;

const $ = (sel) => document.querySelector(sel);
const tabsEl = $('#dayTabs');
const titleEl = $('#dayTitle');
const counterEl = $('#dayCounter');
const listEl = $('#taskList');
const emptyEl = $('#emptyState');
const clearBtn = $('#clearDoneBtn');
const todayPill = $('#todayPill');
const fab = $('#fab');

// Sheet elements
const sheet = $('#sheet');
const sheetBackdrop = $('#sheetBackdrop');
const sheetTitle = $('#sheetTitle');
const sheetInput = $('#sheetInput');
const dayPickerEl = $('#dayPicker');
const repeatToggle = $('#repeatToggle');
const cancelBtn = $('#cancelBtn');
const saveBtn = $('#saveBtn');
const deleteBtn = $('#deleteBtn');

let editingTaskId = null;       // null when creating new
let pickedDays = new Set();

// ----- Date helpers -----
function todayKey() {
  const d = new Date().getDay();
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d];
}

function todayDate() {
  return new Date();
}

// ISO 8601 week number — week starts Monday
function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// completionKey = "YYYY-Www-day", uniquely identifies one day in one week
function completionKeyFor(dayKey, refDate = todayDate()) {
  // Find the date of this dayKey in the week containing refDate
  const refDayIdx = (refDate.getDay() + 6) % 7; // Mon=0
  const targetIdx = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].indexOf(dayKey);
  const diff = targetIdx - refDayIdx;
  const target = new Date(refDate);
  target.setDate(refDate.getDate() + diff);
  return `${isoWeekKey(target)}-${dayKey}`;
}

function isPastDay(dayKey, refDate = todayDate()) {
  const refDayIdx = (refDate.getDay() + 6) % 7; // Mon=0
  const targetIdx = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].indexOf(dayKey);
  return targetIdx < refDayIdx;
}

// ----- API -----
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error('API error');
  return r.json();
}

async function loadAll() {
  const data = await api('GET', '/api/tasks');
  allTasks = data.tasks || [];
  renderTabs();
  render();
}

// ----- Selection / display logic -----

// All tasks scheduled for a given day in the current week
function tasksForDay(dayKey) {
  return allTasks.filter(t => t.days.includes(dayKey));
}

// Is a given task done for a given day in the current week?
function isDoneOn(task, dayKey) {
  return !!task.completions[completionKeyFor(dayKey)];
}

// Overdue tasks to bubble up to today: tasks scheduled for a *past* day
// of the current week, that aren't done for that day.
// Only relevant when viewing today.
function overdueForToday() {
  const today = todayKey();
  const result = [];
  for (const dayKey of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) {
    if (!isPastDay(dayKey)) continue;
    for (const t of tasksForDay(dayKey)) {
      if (!isDoneOn(t, dayKey)) {
        result.push({ task: t, fromDay: dayKey });
      }
    }
  }
  return result;
}

function dayHasOverdue(dayKey) {
  // Used for the today tab only — no point marking past tabs
  if (dayKey !== todayKey()) return false;
  return overdueForToday().length > 0;
}

function dayHasPendingTasks(dayKey) {
  return tasksForDay(dayKey).some(t => !isDoneOn(t, dayKey));
}

// ----- Rendering -----
function renderTabs() {
  const today = todayKey();
  tabsEl.innerHTML = '';
  DAYS.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'day-tab';
    if (d.key === activeDay) btn.classList.add('is-active');
    if (d.key === today) btn.classList.add('is-today');
    if (dayHasPendingTasks(d.key)) btn.classList.add('has-tasks');
    if (dayHasOverdue(d.key)) btn.classList.add('has-overdue');
    btn.innerHTML = `
      <span class="dt-day">${d.short}</span>
      <span class="dt-mark">${d.key === today ? 'today' : ''}</span>
      <span class="dt-dot"></span>
    `;
    btn.addEventListener('click', () => {
      activeDay = d.key;
      renderTabs();
      render();
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    tabsEl.appendChild(btn);
  });
  todayPill.textContent = DAYS.find(d => d.key === today).full;
}

function render() {
  const day = DAYS.find(d => d.key === activeDay);
  titleEl.textContent = day.full;

  const dayTasks = tasksForDay(activeDay);
  const overdue = activeDay === todayKey() ? overdueForToday() : [];

  const remaining = dayTasks.filter(t => !isDoneOn(t, activeDay)).length;
  const totalNote = dayTasks.length === 0
    ? (overdue.length > 0 ? `${overdue.length} overdue` : '0 tasks')
    : `${remaining} of ${dayTasks.length} left${overdue.length ? ` · ${overdue.length} overdue` : ''}`;
  counterEl.textContent = totalNote;

  listEl.innerHTML = '';

  // Overdue first
  if (overdue.length > 0) {
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `Overdue · ${overdue.length}`;
    listEl.appendChild(label);
    overdue.forEach(({ task, fromDay }) => {
      listEl.appendChild(taskNode(task, fromDay, true));
    });
  }

  // Today's (or selected day's) tasks
  dayTasks.forEach(t => listEl.appendChild(taskNode(t, activeDay, false)));

  emptyEl.hidden = !(dayTasks.length === 0 && overdue.length === 0);

  // Show "clear completed" only if there are completed non-recurring tasks for this day
  const hasCompletedNonRecurring = dayTasks.some(t => !t.repeat && isDoneOn(t, activeDay));
  clearBtn.hidden = !hasCompletedNonRecurring;
}

function taskNode(task, dayKey, isOverdue) {
  const li = document.createElement('li');
  li.className = 'task';
  if (isOverdue) li.classList.add('is-overdue');
  if (isDoneOn(task, dayKey)) li.classList.add('is-done');
  li.dataset.id = task.id;
  li.dataset.dayKey = dayKey;

  // Checkbox
  const cb = document.createElement('button');
  cb.className = 'checkbox';
  cb.setAttribute('aria-label', 'Toggle done');
  cb.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l4 4L19 7" stroke="#0e1016" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  cb.addEventListener('click', () => toggleDone(task, dayKey));

  // Body
  const body = document.createElement('div');
  body.className = 'task-body';

  const text = document.createElement('div');
  text.className = 'task-text';
  text.textContent = task.text;
  body.appendChild(text);

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  if (task.repeat) {
    const rep = document.createElement('span');
    rep.className = 'task-badge repeat';
    rep.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 014-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/></svg>weekly`;
    meta.appendChild(rep);
  }

  if (task.days.length > 1 && !isOverdue) {
    const ds = document.createElement('span');
    ds.className = 'task-badge';
    ds.textContent = task.days.map(d => d.slice(0, 3)).join(' · ');
    meta.appendChild(ds);
  }

  if (isOverdue) {
    const ot = document.createElement('span');
    ot.className = 'task-badge';
    ot.style.color = 'var(--danger)';
    ot.textContent = `from ${dayKey}`;
    meta.appendChild(ot);
  }

  if (meta.children.length > 0) body.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'task-actions';
  const edit = document.createElement('button');
  edit.className = 'icon-btn edit';
  edit.setAttribute('aria-label', 'Edit task');
  edit.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  edit.addEventListener('click', (e) => { e.stopPropagation(); openEditSheet(task); });
  actions.appendChild(edit);

  li.append(cb, body, actions);
  return li;
}

// ----- Actions -----
async function toggleDone(task, dayKey) {
  const key = completionKeyFor(dayKey);
  const newDone = !task.completions[key];

  const li = listEl.querySelector(`[data-id="${task.id}"][data-day-key="${dayKey}"]`);
  if (newDone && li) {
    li.classList.add('is-done');
    await new Promise(r => setTimeout(r, 280));
    li.classList.add('removing');
    await new Promise(r => setTimeout(r, 200));
  }

  await api('PATCH', '/api/tasks', { id: task.id, completionKey: key, done: newDone });
  if (newDone) task.completions[key] = true;
  else delete task.completions[key];

  renderTabs();
  render();
}

clearBtn.addEventListener('click', async () => {
  const key = completionKeyFor(activeDay);
  await api('POST', '/api/clear-done', { completionKey: key });
  // Reload — clear-done deletes one-shot tasks
  await loadAll();
});

// ----- Sheet (add / edit) -----
function openAddSheet() {
  editingTaskId = null;
  sheetTitle.textContent = 'New task';
  sheetInput.value = '';
  pickedDays = new Set([activeDay]);
  repeatToggle.checked = false;
  deleteBtn.hidden = true;
  renderDayPicker();
  showSheet();
  setTimeout(() => sheetInput.focus(), 250);
}

function openEditSheet(task) {
  editingTaskId = task.id;
  sheetTitle.textContent = 'Edit task';
  sheetInput.value = task.text;
  pickedDays = new Set(task.days);
  repeatToggle.checked = !!task.repeat;
  deleteBtn.hidden = false;
  renderDayPicker();
  showSheet();
}

function renderDayPicker() {
  dayPickerEl.innerHTML = '';
  DAYS.forEach(d => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'day-chip';
    if (pickedDays.has(d.key)) chip.classList.add('selected');
    chip.textContent = d.short;
    chip.addEventListener('click', () => {
      if (pickedDays.has(d.key)) pickedDays.delete(d.key);
      else pickedDays.add(d.key);
      renderDayPicker();
    });
    dayPickerEl.appendChild(chip);
  });
}

function showSheet() {
  sheet.hidden = false;
  sheetBackdrop.hidden = false;
  document.body.classList.add('sheet-open');
}
function hideSheet() {
  sheet.hidden = true;
  sheetBackdrop.hidden = true;
  document.body.classList.remove('sheet-open');
}

fab.addEventListener('click', openAddSheet);
cancelBtn.addEventListener('click', hideSheet);
sheetBackdrop.addEventListener('click', hideSheet);

saveBtn.addEventListener('click', async () => {
  const text = sheetInput.value.trim();
  if (!text) { sheetInput.focus(); return; }
  if (pickedDays.size === 0) {
    alert('Pick at least one day.');
    return;
  }
  const days = DAYS.map(d => d.key).filter(k => pickedDays.has(k));
  const repeat = repeatToggle.checked;

  if (editingTaskId) {
    const updated = await api('PATCH', '/api/tasks', { id: editingTaskId, text, days, repeat });
    const idx = allTasks.findIndex(t => t.id === editingTaskId);
    if (idx >= 0) allTasks[idx] = updated;
  } else {
    const newTask = await api('POST', '/api/tasks', { text, days, repeat });
    allTasks.push(newTask);
  }
  hideSheet();
  renderTabs();
  render();
});

deleteBtn.addEventListener('click', async () => {
  if (!editingTaskId) return;
  if (!confirm('Delete this task?')) return;
  await api('DELETE', '/api/tasks', { id: editingTaskId });
  allTasks = allTasks.filter(t => t.id !== editingTaskId);
  hideSheet();
  renderTabs();
  render();
});

sheetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
});

// ----- Swipe between days -----
let touchStartX = null, touchStartY = null;
const dayView = document.querySelector('.day-view');
dayView.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

dayView.addEventListener('touchend', (e) => {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    const idx = DAYS.findIndex(d => d.key === activeDay);
    if (dx < 0 && idx < DAYS.length - 1) activeDay = DAYS[idx + 1].key;
    else if (dx > 0 && idx > 0) activeDay = DAYS[idx - 1].key;
    renderTabs();
    render();
  }
  touchStartX = null;
});

// ----- Init -----
// Always start on today
activeDay = todayKey();
loadAll().catch(err => {
  console.error(err);
  document.body.innerHTML = '<p style="padding:40px;text-align:center">Could not load tasks. Please reload.</p>';
});
