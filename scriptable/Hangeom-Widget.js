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

function projectCandidates(payload) {
  if (!Array.isArray(payload.projects)) return [];
  return payload.projects.flatMap(project => project.status === 'ended' ? [] : (project.schedules || [])
    .filter(item => item.active && item.startDate && !item.needsReview && item.datePrecision !== 'range-day')
    .map(item => ({
      id: item.id,
      projectId: project.id,
      title: item.name,
      date: item.startDate + 'T00:00',
      priority: item.priority,
      stage: project.currentStage || '',
      institution: project.institution || ''
    })));
}

function selectExam(payload, now) {
  const projectItems = projectCandidates(payload);
  const manual = payload.widgetPreference;
  if (manual?.mode === 'manual') {
    const selected = projectItems.find(item => item.projectId === manual.projectId && item.id === manual.eventId);
    if (selected) return selected;
  }
  const today = kstDay(now);
  const futureProjectItems = projectItems.filter(item => kstDay(timestamp(item)) >= today);
  if (futureProjectItems.length) {
    const rank = item => item.stage.includes('서류') ? ({deadline:0,next:1,target:2,record:3})[item.priority] ?? 4 : ({target:0,deadline:1,next:2,record:3})[item.priority] ?? 4;
    futureProjectItems.sort((a, b) => rank(a) - rank(b) || timestamp(a) - timestamp(b));
    return futureProjectItems[0];
  }
  const exams = payload.events.filter(isEvent).sort((a, b) => timestamp(a) - timestamp(b));
  return exams.find(event => kstDay(timestamp(event)) >= today) || exams[exams.length - 1] || null;
}

function statusFor(event, now) {
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

  addText(widget, cached ? 'NEXT EXAM · 저장됨' : 'NEXT EXAM', 10, SETTINGS.secondaryText, 'bold');
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
