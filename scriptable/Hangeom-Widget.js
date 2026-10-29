// 합격까지 · iPhone Scriptable 소형 위젯
// Scriptable 전용 코드입니다. 브라우저 DOM/localStorage를 사용하지 않습니다.

const SETTINGS = {
  dataURL: 'https://chancejeju.github.io/day/data/events.json',
  appURL: 'https://chancejeju.github.io/day/',
  background: '#1D2738',
  primaryText: '#FFFFFF',
  secondaryText: '#AFC5E7',
  refreshMinutes: 60,
  cacheFile: 'hangeom-dday-widget-cache-v1.json'
};

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), SETTINGS.cacheFile);

function isEvent(event) {
  return event && typeof event.id === 'string' &&
    typeof event.title === 'string' && event.title.trim().length > 0 &&
    event.kind === 'exam' &&
    typeof event.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(event.date) &&
    Number.isFinite(Date.parse(event.date + '+09:00'));
}

function validatePayload(payload) {
  return payload && payload.timezone === 'Asia/Seoul' && Array.isArray(payload.events) &&
    (payload.events.some(isEvent) || (Array.isArray(payload.projects) && payload.projects.length > 0));
}

async function loadData() {
  try {
    const request = new Request(SETTINGS.dataURL);
    request.timeoutInterval = 12;
    request.headers = { Accept: 'application/json' };
    const payload = await request.loadJSON();
    if (!validatePayload(payload)) throw new Error('Invalid schedule data');
    fm.writeString(cachePath, JSON.stringify(payload));
    return { payload, cached: false };
  } catch (error) {
    try {
      if (!fm.fileExists(cachePath)) throw error;
      const payload = JSON.parse(fm.readString(cachePath));
      if (!validatePayload(payload)) throw error;
      return { payload, cached: true };
    } catch (_) {
      return { payload: null, cached: false };
    }
  }
}

const KST_OFFSET = 9 * 60 * 60 * 1000;
const kstDay = value => Math.floor((value + KST_OFFSET) / 86400000);
const timestamp = event => Date.parse(event.date + '+09:00');

function effectiveDay(item) {
  const value = item.endDate || item.startDate;
  return value ? kstDay(Date.parse(value + 'T00:00+09:00')) : -Infinity;
}

function widgetEvent(project, item, resultInputNeeded = false) {
  return {
    id: item.id, projectId: project.id, title: item.name,
    date: (item.endDate || item.startDate) + 'T00:00',
    stage: project.currentStage || '', institution: project.institution || '',
    resultInputNeeded, needsReview: Boolean(item.needsReview || item.datePrecision === 'range-day')
  };
}

function scheduleForProject(project, now) {
  if (!project || project.status === 'ended') return null;
  const schedules = project.schedules || [];
  const today = kstDay(now);
  const by = predicate => schedules.find(predicate);
  const future = item => item?.active && item.startDate && effectiveDay(item) >= today;
  const writtenExam = by(item => item.type === 'exam') || by(item => /필기.*(시험|전형)/.test(item.name) && !/(공고|발표|결과)/.test(item.name));
  const writtenResult = by(item => /필기.*(합격|결과).*발표/.test(item.name));
  const documentResult = by(item => /서류.*(결과|합격).*발표/.test(item.name));
  const interview = by(item => item.type === 'interview' || /면접/.test(item.name));
  const finalResult = by(item => item.type === 'final' || /최종.*발표/.test(item.name));
  const results = project.results || {written:'unknown',document:'unknown',interview:'unknown'};

  if (results.written === 'unknown') {
    if (writtenExam && effectiveDay(writtenExam) >= today) return widgetEvent(project, writtenExam);
    if (writtenResult) return widgetEvent(project, writtenResult, effectiveDay(writtenResult) < today);
  }
  if (results.written === 'pass' && results.document === 'unknown') {
    const upcoming = schedules.filter(item => item.active && item.activationRule === 'written_pass' && item.startDate && effectiveDay(item) >= today).sort((a,b)=>effectiveDay(a)-effectiveDay(b));
    if (upcoming[0]) return widgetEvent(project, upcoming[0]);
    if (documentResult) return widgetEvent(project, documentResult, true);
  }
  if (results.document === 'pass' && results.interview === 'unknown') {
    if (future(interview)) return widgetEvent(project, interview);
    if (finalResult) return widgetEvent(project, finalResult, effectiveDay(finalResult) < today);
  }
  if (results.interview === 'pass' && future(finalResult)) return widgetEvent(project, finalResult);
  const fallback = schedules.filter(future).sort((a,b)=>effectiveDay(a)-effectiveDay(b))[0];
  return fallback ? widgetEvent(project, fallback) : null;
}

function selectExam(payload, now) {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const ids = Array.isArray(payload.projectPriority) ? payload.projectPriority : [];
  const order = [...ids.filter((id,index) => ids.indexOf(id) === index && projects.some(project => project.id === id)), ...projects.map(project => project.id).filter(id => !ids.includes(id))];
  for (const id of order) {
    const selected = scheduleForProject(projects.find(project => project.id === id), now);
    if (selected) return selected;
  }
  const today = kstDay(now);
  const exams = payload.events.filter(isEvent).sort((a, b) => timestamp(a) - timestamp(b));
  return exams.find(event => kstDay(timestamp(event)) >= today) || exams[exams.length - 1] || null;
}

function statusFor(event, now) {
  if (event.resultInputNeeded) return '결과 입력';
  if (event.needsReview) return '확인 필요';
  const difference = kstDay(timestamp(event)) - kstDay(now);
  if (difference > 0) return 'D-' + difference;
  if (difference === 0) return 'D-DAY';
  return '종료';
}

function displayDate(event) {
  return event.date.slice(0, 10).replace(/-/g, '.');
}

function addText(container, value, size, color, weight, lines = 1) {
  const line = container.addText(value);
  line.font = weight === 'bold' ? Font.boldSystemFont(size) : Font.systemFont(size);
  line.textColor = new Color(color);
  line.lineLimit = lines;
  line.minimumScaleFactor = 0.62;
  return line;
}

function emptyWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(SETTINGS.background);
  widget.setPadding(16, 16, 16, 16);
  widget.url = SETTINGS.appURL;
  addText(widget, 'NEXT EXAM', 11, SETTINGS.secondaryText, 'bold');
  widget.addSpacer();
  addText(widget, '일정 없음', 25, SETTINGS.primaryText, 'bold');
  widget.addSpacer(7);
  addText(widget, '네트워크 연결 후\n다시 확인해 주세요', 11, SETTINGS.secondaryText, 'regular', 2);
  return widget;
}

function examWidget(event, now, cached) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(SETTINGS.background);
  widget.setPadding(15, 16, 14, 16);
  widget.url = SETTINGS.appURL;

  const heading = event.institution || 'NEXT EXAM';
  addText(widget, cached ? `${heading} · 저장됨` : heading, 10, SETTINGS.secondaryText, 'bold');
  widget.addSpacer(7);
  addText(widget, statusFor(event, now), 40, SETTINGS.primaryText, 'bold');
  widget.addSpacer();
  addText(widget, event.title, 12, SETTINGS.secondaryText, 'bold', 2);
  widget.addSpacer(4);
  addText(widget, displayDate(event), 11, SETTINGS.secondaryText, 'regular');
  return widget;
}

const result = await loadData();
const now = Date.now();
const exam = result.payload ? selectExam(result.payload, now) : null;
const widget = exam ? examWidget(exam, now, result.cached) : emptyWidget();

// 실제 갱신 시점은 Scriptable이 아닌 iOS가 결정합니다.
const nextKstMidnight = (kstDay(now) + 1) * 86400000 - KST_OFFSET;
const hourlyRefresh = now + SETTINGS.refreshMinutes * 60 * 1000;
widget.refreshAfterDate = new Date(Math.min(hourlyRefresh, nextKstMidnight + 60000));

Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentSmall();
Script.complete();
