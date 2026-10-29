import * as pdfjsLib from './vendor/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
const $ = id => document.getElementById(id);
const esc2 = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

const TYPE_OPTIONS = [['application','원서접수'],['notice','공고·발표'],['exam','필기·시험'],['documents','서류제출'],['personality','인성검사·서류전형'],['interview','면접'],['final','최종발표'],['other','기타']];
const RULE_OPTIONS = [['always','처음부터 활성'],['written_pass','필기 합격 후'],['document_pass','서류 합격 후'],['interview_pass','면접 합격 후']];
const PRIORITY_OPTIONS = [['target','대표 목표'],['next','다음 일정'],['deadline','마감 일정'],['record','기록']];

const definitions = [
  {key:'application', name:'원서접수', pattern:/원서\s*접수/, type:'application', rule:'always', priority:'next', splitApplication:true},
  {key:'written_notice', name:'필기시험 장소 공고', pattern:/필기.{0,12}(?:장소|일시|전형).{0,12}(?:공고|안내)|필기전형\s*공고/, type:'notice', rule:'always', priority:'next'},
  {key:'written_exam', name:'필기시험', pattern:/필기\s*(?:시험|전형)/, exclude:/공고|안내|합격|결과|서류/, type:'exam', rule:'always', priority:'target'},
  {key:'written_result', name:'필기 합격자 발표', pattern:/필기.{0,15}(?:합격자|결과).{0,10}발표|필기\s*합격자\s*발표/, type:'notice', rule:'always', priority:'next'},
  {key:'documents', name:'필기 합격자 서류제출', pattern:/(?:필기\s*합격자.{0,12})?서류\s*제출/, type:'documents', rule:'written_pass', priority:'deadline'},
  {key:'personality', name:'온라인 인성검사 및 서류전형', pattern:/(?:온라인\s*)?인성\s*검사|인성검사.{0,15}서류전형/, type:'personality', rule:'written_pass', priority:'next'},
  {key:'document_result', name:'서류전형 결과 발표', pattern:/서류\s*전형.{0,15}(?:결과|합격자).{0,10}발표|서류전형\s*결과\s*발표/, type:'notice', rule:'written_pass', priority:'next'},
  {key:'interview', name:'면접전형', pattern:/면접\s*(?:시험|전형)?/, exclude:/결과|합격|발표/, type:'interview', rule:'written_pass', priority:'target'},
  {key:'final_result', name:'최종 합격자 발표', pattern:/최종.{0,10}(?:합격자|결과).{0,10}발표/, type:'final', rule:'written_pass', priority:'next'}
];

function pad(value) { return String(value).padStart(2, '0'); }

function parseDateRange(text, defaultYear) {
  const normalized = text.replace(/[년월일]/g, match => ({년:'.',월:'.',일:''})[match]).replace(/[～~–—]/g, '~');
  const match = normalized.match(/(?:(20\d{2})[.\/-]\s*)?(\d{1,2})[.\/-]\s*(\d{1,2})(?:\s*~\s*(?:(20\d{2})[.\/-]\s*)?(?:(\d{1,2})[.\/-]\s*)?(\d{1,2}))?(?:[^\d]{0,10}(\d{1,2})\s*(?::|시)\s*(\d{2})?)?/);
  if (!match) return null;
  const startYear = Number(match[1] || defaultYear);
  const startMonth = Number(match[2]); const startDay = Number(match[3]);
  if (!startYear || startMonth > 12 || startDay > 31) return null;
  const endYear = Number(match[4] || startYear); const endMonth = Number(match[5] || startMonth); const endDay = Number(match[6] || startDay);
  const date = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
  return {
    startDate: date(startYear, startMonth, startDay),
    endDate: date(endYear, endMonth, endDay),
    endTime: match[7] ? `${pad(match[7])}:${pad(match[8] || 0)}` : '',
    datePrecision: /중\s*1일|중\s*하루/.test(text) ? 'range-day' : 'exact'
  };
}

function findContext(lines, definition) {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (definition.pattern.test(line) && !(definition.exclude && definition.exclude.test(line))) {
      return [line, lines[index + 1], lines[index + 2], lines[index - 1]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

function guessInstitution(lines) {
  const full = lines.join(' ');
  const known = full.match(/([가-힣A-Za-z0-9·()]{2,40}(?:신용보증재단|재단|공사|공단|진흥원|개발원|연구원))/);
  return known ? known[1].replace(/^(?:재단법인|사단법인)\s*/, '') : '';
}

function guessTitle(lines) {
  const line = lines.find(value => /채용/.test(value) && /공고|신입|직원/.test(value));
  return line ? line.slice(0, 120) : '';
}

function makeSchedule(definition, parsed, evidence, overrides = {}) {
  return {
    id:'', selected:Boolean(parsed), name:definition.name, startDate:parsed?.startDate || '', endDate:parsed?.endDate || '',
    endTime:parsed?.endTime || '', type:definition.type, activationRule:definition.rule, priority:definition.priority,
    active:false, needsReview:!parsed || parsed.datePrecision === 'range-day', datePrecision:parsed?.datePrecision || 'unknown',
    evidence:evidence || '일정 근거를 찾지 못했습니다.', ...overrides
  };
}

function analyzeText(text, sourceFile = '') {
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const yearMatch = text.match(/20\d{2}/); const defaultYear = yearMatch ? Number(yearMatch[0]) : null;
  const schedules = [];
  definitions.forEach(definition => {
    const evidence = findContext(lines, definition);
    const parsed = evidence ? parseDateRange(evidence, defaultYear) : null;
    if (definition.splitApplication && parsed) {
      schedules.push(makeSchedule(definition, {...parsed, endDate:parsed.startDate, endTime:''}, evidence, {name:'원서접수 시작', priority:'next'}));
      schedules.push(makeSchedule(definition, {startDate:parsed.endDate, endDate:parsed.endDate, endTime:parsed.endTime, datePrecision:parsed.datePrecision}, evidence, {name:'원서접수 마감', priority:'deadline'}));
    } else schedules.push(makeSchedule(definition, parsed, evidence));
  });
  const noticeContext = lines.find(line => /공고일/.test(line)) || '';
  const noticeParsed = noticeContext ? parseDateRange(noticeContext, defaultYear) : null;
  return { institution:guessInstitution(lines), title:guessTitle(lines), noticeDate:noticeParsed?.startDate || '', sourceFile, sourceType:'pdf', schedules, extractedTextLength:text.length };
}

async function extractText(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjsLib.getDocument({data}).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber); const content = await page.getTextContent();
    let line = ''; let previousY = null; const lines = [];
    content.items.forEach(item => {
      const y = item.transform?.[5] ?? previousY;
      if (previousY !== null && Math.abs(y - previousY) > 2 && line.trim()) { lines.push(line.trim()); line = ''; }
      line += `${line ? ' ' : ''}${item.str}`; previousY = y;
      if (item.hasEOL && line.trim()) { lines.push(line.trim()); line = ''; previousY = null; }
    });
    if (line.trim()) lines.push(line.trim()); pages.push(lines.join('\n'));
  }
  return pages.join('\n');
}

function options(values, selected) { return values.map(([value,label]) => `<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join(''); }

function renderReview(draft) {
  $('pdfInstitution').value = draft.institution;
  $('pdfTitle').value = draft.title;
  $('pdfNoticeDate').value = draft.noticeDate;
  $('pdfStatus').textContent = `${draft.sourceFile} · 텍스트 ${draft.extractedTextLength.toLocaleString()}자 추출 · 등록 전 모든 날짜를 확인하세요.`;
  $('pdfReviewRows').innerHTML = draft.schedules.map((item,index) => `<fieldset class="review-row" data-review-index="${index}"><legend><label class="check"><input type="checkbox" data-field="selected" ${item.selected?'checked':''}> 일정 등록</label></legend><label>일정명<input data-field="name" value="${esc2(item.name)}" maxlength="100"></label><div class="review-dates"><label>시작일<input data-field="startDate" type="date" value="${item.startDate}"></label><label>종료일<input data-field="endDate" type="date" value="${item.endDate}"></label><label>마감시간<input data-field="endTime" type="time" value="${item.endTime}"></label></div><div class="review-options"><label>유형<select data-field="type">${options(TYPE_OPTIONS,item.type)}</select></label><label>활성화 조건<select data-field="activationRule">${options(RULE_OPTIONS,item.activationRule)}</select></label><label>D-day 역할<select data-field="priority">${options(PRIORITY_OPTIONS,item.priority)}</select></label></div><label class="check"><input data-field="needsReview" type="checkbox" ${item.needsReview?'checked':''}> 확인 필요</label><p class="evidence"><strong>추출 근거</strong> ${esc2(item.evidence)}</p></fieldset>`).join('');
  $('pdfReview').showModal();
}

let currentDraft = null;
$('pdfUpload').onclick = () => $('pdfFile').click();
$('pdfFile').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { alert('PDF 파일을 선택해 주세요.'); return; }
  $('pdfUpload').disabled = true; $('pdfUpload').textContent = 'PDF 텍스트 추출 중…';
  try {
    const text = await extractText(file);
    if (text.replace(/\s/g,'').length < 80) {
      alert('텍스트를 충분히 추출하지 못했습니다. 스캔 PDF일 수 있습니다. 프로젝트와 일정을 직접 입력해 주세요.');
      openProjectEditor();
    } else { currentDraft = analyzeText(text, file.name); renderReview(currentDraft); }
  } catch (error) {
    console.error(error); alert('PDF를 읽지 못했습니다. 암호화·손상·스캔 여부를 확인하고 직접 입력해 주세요.'); openProjectEditor();
  } finally { $('pdfUpload').disabled = false; $('pdfUpload').textContent = '채용공고 PDF 등록'; event.target.value = ''; }
};

$('pdfReviewForm').onsubmit = event => {
  event.preventDefault(); if (!currentDraft) return;
  const schedules = [...document.querySelectorAll('[data-review-index]')].map(row => {
    const source = currentDraft.schedules[Number(row.dataset.reviewIndex)];
    const field = name => row.querySelector(`[data-field="${name}"]`);
    return {...source, selected:field('selected').checked, name:field('name').value.trim(), startDate:field('startDate').value, endDate:field('endDate').value, endTime:field('endTime').value, type:field('type').value, activationRule:field('activationRule').value, priority:field('priority').value, needsReview:field('needsReview').checked};
  }).filter(item => item.selected);
  if (!schedules.length) { alert('등록할 일정을 하나 이상 선택해 주세요.'); return; }
  const missing = schedules.filter(item => !item.startDate);
  if (missing.length && !confirm(`날짜가 없는 일정 ${missing.length}개를 “확인 필요” 상태로 함께 등록할까요?`)) return;
  schedules.forEach(item => { if (!item.startDate) item.needsReview = true; delete item.selected; });
  const saved = registerProjectDraft({...currentDraft, institution:$('pdfInstitution').value, title:$('pdfTitle').value, noticeDate:$('pdfNoticeDate').value, schedules});
  if (saved) { $('pdfReview').close(); currentDraft = null; }
};

window.pdfRecruitment = { analyzeText, parseDateRange };
