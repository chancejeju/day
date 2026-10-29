'use strict';

const PROJECTS_KEY = 'hangeom-dday-v2';
const RESULT_VALUES = ['unknown', 'pass', 'fail'];
const RULE_VALUES = ['always', 'written_pass', 'document_pass', 'interview_pass'];
const PRIORITY_VALUES = ['target', 'next', 'deadline', 'record'];
const TYPE_VALUES = ['application', 'notice', 'exam', 'documents', 'personality', 'interview', 'final', 'other'];

const esc2 = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const projectFingerprint = project => `${project.institution}|${project.title}|${project.noticeDate || ''}`.toLowerCase().replace(/\s+/g, '');
const validDate = value => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);

function validSchedule(item) {
  return item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim() &&
    validDate(item.startDate || '') && validDate(item.endDate || '') && TYPE_VALUES.includes(item.type) &&
    RULE_VALUES.includes(item.activationRule) && PRIORITY_VALUES.includes(item.priority);
}

function validProject(project) {
  return project && typeof project.id === 'string' && typeof project.institution === 'string' &&
    typeof project.title === 'string' && project.results &&
    RESULT_VALUES.includes(project.results.written) && RESULT_VALUES.includes(project.results.document) &&
    RESULT_VALUES.includes(project.results.interview) && Array.isArray(project.schedules) && project.schedules.every(validSchedule);
}

function initialState() {
  return {
    version: 2,
    migratedAt: new Date().toISOString(),
    generalEvents: structuredClone(events),
    projects: [],
    projectPriority: [],
    widgetPreference: { mode: 'auto', currentProjectId: null, currentEventId: null, resultInputNeeded: false },
    publishedSeeded: false
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 2 || !Array.isArray(parsed.generalEvents) || !parsed.generalEvents.every(valid) ||
        !Array.isArray(parsed.projects) || !parsed.projects.every(validProject)) throw new Error('invalid v2');
    return parsed;
  } catch (error) {
    const fallback = initialState();
    fallback.migrationError = String(error.message || error);
    return fallback;
  }
}

let recruitmentState = loadState();
if (!recruitmentState.priorityMigrationV1) {
  recruitmentState.projects.forEach(project => project.schedules.forEach(schedule => {
    if (schedule.activationRule === 'written_pass' && ['interview','final'].includes(schedule.type)) schedule.activationRule = 'document_pass';
  }));
  recruitmentState.priorityMigrationV1 = true;
}
if (!Array.isArray(recruitmentState.projectPriority)) recruitmentState.projectPriority = [];
events = structuredClone(recruitmentState.generalEvents);
hasLocalData = true;
render();

function ruleSatisfied(project, rule) {
  if (rule === 'always') return true;
  if (rule === 'written_pass') return project.results.written === 'pass';
  if (rule === 'document_pass') return project.results.written === 'pass' && project.results.document === 'pass';
  return project.results.written === 'pass' && project.results.document === 'pass' && project.results.interview === 'pass';
}

function recalculateProject(project) {
  const failed = Object.values(project.results).includes('fail');
  project.schedules.forEach(schedule => {
    schedule.active = !failed && ruleSatisfied(project, schedule.activationRule);
  });
  if (project.results.written === 'fail' || project.results.document === 'fail' || project.results.interview === 'fail') {
    project.status = 'ended'; project.currentStage = '전형 종료';
  } else if (project.results.written === 'unknown') {
    project.status = 'active'; project.currentStage = '필기전형';
  } else if (project.results.document === 'unknown') {
    project.status = 'active'; project.currentStage = '서류·인성검사';
  } else if (project.results.interview === 'unknown') {
    project.status = 'active'; project.currentStage = '면접전형';
  } else {
    project.status = 'passed'; project.currentStage = '최종 합격';
  }
  return project;
}

function persistProjectsState() {
  recruitmentState.generalEvents = structuredClone(events);
  recruitmentState.projects.forEach(recalculateProject);
  normalizeProjectPriority();
  const focus = selectProjectFocus();
  recruitmentState.widgetPreference = {
    mode: 'auto',
    currentProjectId: focus?.project.id || null,
    currentEventId: focus?.schedule.id || null,
    resultInputNeeded: Boolean(focus?.resultInputNeeded)
  };
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(recruitmentState));
  } catch (_) {
    $('status').textContent = '채용 프로젝트 저장 공간에 접근할 수 없습니다. 전체 백업을 저장해 주세요.';
  }
  renderProjects();
  renderRecruitmentHero();
}
window.persistProjectsState = persistProjectsState;

function kstDay2(dateString) {
  if (!dateString) return null;
  return Math.floor((Date.parse(`${dateString}T00:00:00+09:00`) + 32400000) / 86400000);
}

function scheduleDday(schedule, now = Date.now(), resultInputNeeded = false) {
  if (resultInputNeeded) return '결과 입력 필요';
  if (!schedule.startDate || schedule.needsReview || schedule.datePrecision === 'range-day') return '확인 필요';
  const today = Math.floor((now + 32400000) / 86400000);
  const diff = scheduleEffectiveDay(schedule) - today;
  return diff === 0 ? 'D-DAY' : diff > 0 ? `D−${diff}` : `D+${Math.abs(diff)}`;
}

function scheduleEffectiveDay(schedule) {
  return kstDay2(schedule.endDate || schedule.startDate);
}

function normalizeProjectPriority() {
  const ids = new Set(recruitmentState.projects.map(project => project.id));
  recruitmentState.projectPriority = recruitmentState.projectPriority.filter((id, index, list) => ids.has(id) && list.indexOf(id) === index);
  recruitmentState.projects.forEach(project => {
    if (!recruitmentState.projectPriority.includes(project.id)) recruitmentState.projectPriority.push(project.id);
  });
  return recruitmentState.projectPriority;
}

function moveProjectPriority(projectId, direction) {
  normalizeProjectPriority();
  const from = recruitmentState.projectPriority.indexOf(projectId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= recruitmentState.projectPriority.length) return false;
  [recruitmentState.projectPriority[from], recruitmentState.projectPriority[to]] = [recruitmentState.projectPriority[to], recruitmentState.projectPriority[from]];
  return true;
}

function scheduleBy(project, predicate) {
  return project.schedules.find(predicate) || null;
}

function selectProjectSchedule(project, now = Date.now()) {
  if (!project || project.status === 'ended') return null;
  const today = Math.floor((now + 32400000) / 86400000);
  const futureOrToday = schedule => schedule?.active && schedule.startDate && scheduleEffectiveDay(schedule) >= today;
  const writtenExam = scheduleBy(project, item => item.type === 'exam') || scheduleBy(project, item => /필기.*(시험|전형)/.test(item.name) && !/(공고|발표|결과)/.test(item.name));
  const writtenResult = scheduleBy(project, item => /필기.*(합격|결과).*발표/.test(item.name));
  const documentResult = scheduleBy(project, item => /서류.*(결과|합격).*발표/.test(item.name));
  const interview = scheduleBy(project, item => item.type === 'interview' || /면접/.test(item.name));
  const finalResult = scheduleBy(project, item => item.type === 'final' || /최종.*발표/.test(item.name));

  if (project.results.written === 'unknown') {
    if (writtenExam && scheduleEffectiveDay(writtenExam) >= today) return { schedule: writtenExam, resultInputNeeded: false };
    if (writtenResult) return { schedule: writtenResult, resultInputNeeded: scheduleEffectiveDay(writtenResult) < today };
  }
  if (project.results.written === 'pass' && project.results.document === 'unknown') {
    const stageItems = project.schedules.filter(item => item.active && item.activationRule === 'written_pass' && item.startDate);
    const upcoming = stageItems.filter(futureOrToday).sort((a,b) => scheduleEffectiveDay(a) - scheduleEffectiveDay(b));
    if (upcoming.length) return { schedule: upcoming[0], resultInputNeeded: false };
    if (documentResult) return { schedule: documentResult, resultInputNeeded: true };
  }
  if (project.results.document === 'pass' && project.results.interview === 'unknown') {
    if (interview && scheduleEffectiveDay(interview) >= today) return { schedule: interview, resultInputNeeded: false };
    if (finalResult) return { schedule: finalResult, resultInputNeeded: scheduleEffectiveDay(finalResult) < today };
  }
  if (project.results.interview === 'pass' && futureOrToday(finalResult)) return { schedule: finalResult, resultInputNeeded: false };

  const fallback = project.schedules.filter(futureOrToday).sort((a,b) => scheduleEffectiveDay(a) - scheduleEffectiveDay(b))[0];
  return fallback ? { schedule: fallback, resultInputNeeded: false } : null;
}

function selectProjectFocus(now = Date.now()) {
  normalizeProjectPriority();
  for (const id of recruitmentState.projectPriority) {
    const project = recruitmentState.projects.find(item => item.id === id);
    if (!project || project.status === 'ended') continue;
    const selected = selectProjectSchedule(project, now);
    if (selected) return { project, ...selected };
  }
  return null;
}

function resultSelect(project, stage, label) {
  const value = project.results[stage];
  return `<label class="result-control">${label}<select data-result="${stage}" data-project="${esc2(project.id)}"><option value="unknown" ${value==='unknown'?'selected':''}>미확인</option><option value="pass" ${value==='pass'?'selected':''}>합격</option><option value="fail" ${value==='fail'?'selected':''}>불합격</option></select></label>`;
}

function setProjectResult(projectId, stage, result) {
  const project = recruitmentState.projects.find(item => item.id === projectId);
  if (!project || !RESULT_VALUES.includes(result) || !['written','document','interview'].includes(stage)) return false;
  project.results[stage] = result;
  recalculateProject(project);
  return true;
}

function scheduleDateText(item) {
  if (!item.startDate) return '날짜 확인 필요';
  const range = item.endDate && item.endDate !== item.startDate ? `${item.startDate} ~ ${item.endDate}` : item.startDate;
  return `${range}${item.endTime ? ` ${item.endTime} 마감` : ''}${item.datePrecision === 'range-day' ? ' 중 1일' : ''}`;
}

function renderProjects() {
  recruitmentState.projects.forEach(recalculateProject);
  normalizeProjectPriority();
  $('projectCount').textContent = recruitmentState.projects.length;
  const focus = selectProjectFocus();
  const focusBox = $('projectFocus');
  if (focus) {
    focusBox.hidden = false;
    const deadline = focus.project.schedules.filter(item => item.active && item.priority === 'deadline' && scheduleEffectiveDay(item) >= Math.floor((Date.now()+32400000)/86400000)).sort((a,b)=>scheduleEffectiveDay(a)-scheduleEffectiveDay(b))[0];
    focusBox.innerHTML = `<span>1순위 프로젝트 · 단계별 자동 전환</span><strong>${esc2(focus.project.institution)} ${esc2(focus.schedule.name)} ${esc2(scheduleDday(focus.schedule, Date.now(), focus.resultInputNeeded))}</strong>${deadline ? `<small class="focus-deadline">가까운 마감 · ${esc2(deadline.name)} ${esc2(scheduleDateText(deadline))}</small>` : ''}`;
  } else {
    focusBox.hidden = true; focusBox.innerHTML = '';
  }
  $('priorityManager').innerHTML = recruitmentState.projectPriority.map((id,index) => {
    const project = recruitmentState.projects.find(item => item.id === id); if (!project) return '';
    return `<div class="priority-item"><span class="priority-rank">${index+1}순위</span><div class="priority-name"><strong>${esc2(project.institution)}</strong><small>${esc2(project.title)}</small></div><div class="priority-actions"><button class="move-up" data-action="priority-up" data-id="${esc2(id)}" ${index===0?'disabled':''}>위로</button><button class="move-down" data-action="priority-down" data-id="${esc2(id)}" ${index===recruitmentState.projectPriority.length-1?'disabled':''}>아래로</button></div></div>`;
  }).join('') || '<p class="priority-empty">등록된 채용 프로젝트가 없습니다.</p>';
  $('projects').innerHTML = recruitmentState.projectPriority.map((id,index) => recruitmentState.projects.find(item=>item.id===id)).filter(Boolean).map((project,index) => `<article class="project-card" data-project-card="${esc2(project.id)}">
    <div class="project-card-head"><div><span class="project-stage">${esc2(project.currentStage)}</span><span class="project-rank">${index+1}순위</span><h3>${esc2(project.institution)}</h3><p>${esc2(project.title)}</p></div><div class="project-card-actions"><button data-action="edit-project" data-id="${esc2(project.id)}">수정</button><button data-action="delete-project" data-id="${esc2(project.id)}">삭제</button></div></div>
    <p class="project-notice">${esc2(project.notice || '예정 일정은 변경될 수 있습니다.')}</p>
    <div class="results">${resultSelect(project,'written','필기')}${resultSelect(project,'document','서류')}${resultSelect(project,'interview','면접')}</div>
    <div class="project-schedules">${project.schedules.map(item => `<div class="project-schedule ${item.active?'is-active':'is-waiting'}"><div><span class="schedule-state">${item.active?'활성':'조건부 대기'} · ${esc2(item.priority)}</span><strong>${esc2(item.name)}</strong><small>${esc2(scheduleDateText(item))}${item.needsReview?' · 확인 필요':''}</small></div><span class="schedule-dday">${item.active?esc2(scheduleDday(item)):'대기'}</span><div class="schedule-actions"><button data-action="edit-schedule" data-project="${esc2(project.id)}" data-id="${esc2(item.id)}">수정</button><button data-action="delete-schedule" data-project="${esc2(project.id)}" data-id="${esc2(item.id)}">삭제</button></div></div>`).join('') || '<p class="muted">등록된 일정이 없습니다.</p>'}</div>
    <button data-action="add-schedule" data-project="${esc2(project.id)}">＋ 프로젝트 일정 추가</button>
  </article>`).join('') || '<div class="empty-project"><p>등록된 채용 프로젝트가 없습니다.</p><small>채용공고 PDF를 검토하거나 직접 프로젝트를 추가하세요.</small></div>';
}

function renderRecruitmentHero() {
  const focus = selectProjectFocus();
  if (!focus) return;
  const value = scheduleDday(focus.schedule, Date.now(), focus.resultInputNeeded);
  $('hero').innerHTML = `<p class="eyebrow">채용 1순위 · ${esc2(focus.project.currentStage)}</p><h2>${esc2(value)}</h2><strong>${esc2(focus.project.institution)} · ${esc2(focus.schedule.name)}</strong><p>${esc2(scheduleDateText(focus.schedule))}</p>`;
}

function openProjectEditor(project = null) {
  $('projectForm').reset();
  $('projectId').value = project?.id || '';
  $('institution').value = project?.institution || '';
  $('recruitmentTitle').value = project?.title || '';
  $('noticeDate').value = project?.noticeDate || '';
  $('projectFormTitle').textContent = project ? '채용 프로젝트 수정' : '채용 프로젝트 등록';
  $('projectEditor').showModal();
}
window.openProjectEditor = openProjectEditor;

function openScheduleEditor(projectId, item = null) {
  $('scheduleForm').reset();
  $('scheduleProjectId').value = projectId;
  $('scheduleId').value = item?.id || '';
  $('scheduleName').value = item?.name || '';
  $('scheduleStart').value = item?.startDate || '';
  $('scheduleEnd').value = item?.endDate || '';
  $('scheduleEndTime').value = item?.endTime || '';
  $('scheduleType').value = item?.type || 'other';
  $('scheduleRule').value = item?.activationRule || 'always';
  $('schedulePriority').value = item?.priority || 'next';
  $('scheduleNeedsReview').checked = item?.needsReview || false;
  $('scheduleFormTitle').textContent = item ? '프로젝트 일정 수정' : '프로젝트 일정 추가';
  $('scheduleEditor').showModal();
}

function registerProjectDraft(draft) {
  const project = recalculateProject({
    id: draft.id || uid('project'),
    fingerprint: '', institution: draft.institution.trim(), title: draft.title.trim(),
    noticeDate: draft.noticeDate || '', sourceFile: draft.sourceFile || '', sourceType: draft.sourceType || 'manual',
    notice: '공고문의 예정 일정은 추후 변경될 수 있습니다.', createdAt: draft.createdAt || new Date().toISOString(),
    results: draft.results || { written:'unknown', document:'unknown', interview:'unknown' },
    status: 'active', currentStage: '필기전형', schedules: draft.schedules.map(item => ({...item, id:item.id || uid('schedule')}))
  });
  project.fingerprint = projectFingerprint(project);
  const duplicate = recruitmentState.projects.find(item => item.fingerprint === project.fingerprint && item.id !== project.id);
  if (duplicate) {
    if (!confirm('같은 기관·채용명·공고일의 프로젝트가 있습니다. 기존 프로젝트를 새 추출 결과로 교체할까요? 기존 합격 상태는 유지됩니다.')) return false;
    project.id = duplicate.id; project.results = duplicate.results; project.createdAt = duplicate.createdAt;
    recruitmentState.projects = recruitmentState.projects.map(item => item.id === duplicate.id ? recalculateProject(project) : item);
  } else {
    recruitmentState.projects.push(project);
    recruitmentState.projectPriority.push(project.id);
  }
  persistProjectsState();
  return true;
}
window.registerProjectDraft = registerProjectDraft;

$('addProject').onclick = () => openProjectEditor();
$('projectForm').onsubmit = event => {
  event.preventDefault();
  const id = $('projectId').value;
  const existing = recruitmentState.projects.find(item => item.id === id);
  if (existing) {
    existing.institution = $('institution').value.trim(); existing.title = $('recruitmentTitle').value.trim(); existing.noticeDate = $('noticeDate').value;
    existing.fingerprint = projectFingerprint(existing); persistProjectsState();
  } else registerProjectDraft({ institution:$('institution').value, title:$('recruitmentTitle').value, noticeDate:$('noticeDate').value, schedules:[] });
  $('projectEditor').close();
};

$('scheduleForm').onsubmit = event => {
  event.preventDefault();
  const project = recruitmentState.projects.find(item => item.id === $('scheduleProjectId').value);
  if (!project) return;
  const item = { id:$('scheduleId').value || uid('schedule'), name:$('scheduleName').value.trim(), startDate:$('scheduleStart').value, endDate:$('scheduleEnd').value, endTime:$('scheduleEndTime').value, type:$('scheduleType').value, activationRule:$('scheduleRule').value, priority:$('schedulePriority').value, needsReview:$('scheduleNeedsReview').checked, datePrecision:'exact', evidence:'수동 입력', active:false };
  const index = project.schedules.findIndex(value => value.id === item.id);
  if (index >= 0) project.schedules[index] = item; else project.schedules.push(item);
  persistProjectsState(); $('scheduleEditor').close();
};

$('projects').onchange = event => {
  const select = event.target.closest('select[data-result]'); if (!select) return;
  if (setProjectResult(select.dataset.project, select.dataset.result, select.value)) persistProjectsState();
};

$('projects').onclick = event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const action = button.dataset.action;
  const project = recruitmentState.projects.find(item => item.id === (button.dataset.project || button.dataset.id));
  if (action === 'edit-project') openProjectEditor(project);
  if (action === 'delete-project' && project && confirm(`“${project.institution} · ${project.title}” 프로젝트를 삭제할까요? 일반 일정은 삭제되지 않습니다.`)) { recruitmentState.projects = recruitmentState.projects.filter(item => item.id !== project.id); recruitmentState.projectPriority = recruitmentState.projectPriority.filter(id => id !== project.id); persistProjectsState(); }
  if (action === 'add-schedule' && project) openScheduleEditor(project.id);
  if (['edit-schedule','delete-schedule'].includes(action)) {
    const owner = recruitmentState.projects.find(item => item.id === button.dataset.project);
    const item = owner?.schedules.find(value => value.id === button.dataset.id); if (!owner || !item) return;
    if (action === 'edit-schedule') openScheduleEditor(owner.id, item);
    if (action === 'delete-schedule' && confirm(`“${item.name}” 일정을 삭제할까요?`)) { owner.schedules = owner.schedules.filter(value => value.id !== item.id); persistProjectsState(); }
  }
};

$('priorityManager').onclick = event => {
  const button = event.target.closest('button[data-action]'); if (!button) return;
  const direction = button.dataset.action === 'priority-up' ? -1 : button.dataset.action === 'priority-down' ? 1 : 0;
  if (direction && moveProjectPriority(button.dataset.id, direction)) persistProjectsState();
};
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());

function publicPayload() {
  const focus = selectProjectFocus();
  recruitmentState.widgetPreference = {mode:'auto',currentProjectId:focus?.project.id||null,currentEventId:focus?.schedule.id||null,resultInputNeeded:Boolean(focus?.resultInputNeeded)};
  return { version:2, timezone:'Asia/Seoul', updatedAt:new Date().toISOString(), events:structuredClone(events), projects:structuredClone(recruitmentState.projects), projectPriority:structuredClone(normalizeProjectPriority()), widgetPreference:structuredClone(recruitmentState.widgetPreference) };
}

$('exportWidgetData').onclick = () => download(JSON.stringify(publicPayload(), null, 2), 'application/json', 'events.json');

$('backup').onclick = () => download(JSON.stringify({...recruitmentState, generalEvents:structuredClone(events)}, null, 2), 'application/json', '합격까지-전체백업.json');
$('restore').onclick = () => $('file').click();
$('file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5000000) throw new Error('too large');
    const parsed = JSON.parse(await file.text());
    if (Array.isArray(parsed) && parsed.every(valid)) {
      if (confirm('이 파일은 이전 버전 일반 일정 백업입니다. 일반 일정만 복원할까요?')) { events = parsed; persistProjectsState(); render(); }
    } else if (parsed?.version === 2 && Array.isArray(parsed.generalEvents) && parsed.generalEvents.every(valid) && Array.isArray(parsed.projects) && parsed.projects.every(validProject)) {
      if (confirm(`일반 일정 ${parsed.generalEvents.length}개와 채용 프로젝트 ${parsed.projects.length}개로 현재 데이터를 교체할까요?`)) { recruitmentState = parsed; if (!Array.isArray(recruitmentState.projectPriority)) recruitmentState.projectPriority=[]; events = structuredClone(parsed.generalEvents); persistProjectsState(); render(); }
    } else throw new Error('invalid backup');
  } catch (_) { alert('올바른 합격까지 백업 파일이 아닙니다.'); }
  event.target.value = '';
};

async function seedPublishedProjects() {
  if (recruitmentState.publishedSeeded) return;
  try {
    const response = await fetch('./data/events.json', {cache:'no-store'}); const payload = await response.json();
    if (Array.isArray(payload.projects)) payload.projects.filter(validProject).forEach(project => {
      if (!recruitmentState.projects.some(item => item.fingerprint === project.fingerprint)) { recruitmentState.projects.push(project); recruitmentState.projectPriority.push(project.id); }
    });
    if (Array.isArray(payload.projectPriority)) {
      const publishedOrder = payload.projectPriority.filter(id => recruitmentState.projects.some(project => project.id === id));
      recruitmentState.projectPriority = [...publishedOrder, ...recruitmentState.projectPriority.filter(id => !publishedOrder.includes(id))];
    }
  } catch (_) {}
  recruitmentState.publishedSeeded = true; persistProjectsState();
}

const renderGeneralApp = render;
render = function () { renderGeneralApp(); renderRecruitmentHero(); };
renderProjects();
renderRecruitmentHero();
seedPublishedProjects();
window.recruitmentApp = { getState:() => structuredClone(recruitmentState), recalculateProject, selectProjectFocus, selectProjectSchedule, scheduleDday, publicPayload, moveProjectPriority, setProjectResult, persistProjectsState };
