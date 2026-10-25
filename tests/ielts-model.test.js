'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const appContext = { window: {}, console, crypto: {}, TextEncoder, Date, Promise, setTimeout, clearTimeout };
vm.runInNewContext(fs.readFileSync('vm-fbdata.js', 'utf8'), appContext, { filename: 'vm-fbdata.js' });
const clean = appContext.window.FB._helpers.cleanIeltsContent;
const base = { title: 'Urban farming', skill: 'reading', sections: [{ title: 'Passage 1', text: 'A useful passage.', questions: [{ type: 'short-answer', prompt: 'Where?', answers: ['North', 'the north'] }] }] };
const item = clean(base);
assert.equal(item.title, 'Urban farming');
assert.deepEqual(Array.from(item.taskTypes), ['short-answer']);
assert.deepEqual(Array.from(item.sections[0].questions[0].answers), ['North', 'the north']);
const publicItem = appContext.window.FB._helpers.publicIelts(item);
assert.equal('answers' in publicItem.sections[0].questions[0], false);
assert.equal('answers' in item.sections[0].questions[0], true);

const listeningModel = clean({ title:'Museum tour', skill:'listening', sections:[
  { title:'Part 1', text:'Audio notes', script:'Good morning, visitors.', questions:[{ type:'matching', prompt:'Match the visitor.', options:['A','B'], answers:['A'] }] },
  { title:'Part 2', text:'Audio notes', script:'Turn left at the hall.', questions:[{ type:'plan-map-diagram-labelling', prompt:'Where is the entrance?', answers:['north'] }] },
  { title:'Part 3', text:'Audio notes', script:'The research group meets weekly.', questions:[{ type:'form-note-table-flow-chart-summary-completion', prompt:'How often?', answers:['weekly'] }] },
  { title:'Part 4', text:'Audio notes', script:'The lecture begins at nine.', questions:[{ type:'sentence-completion', prompt:'The lecture begins at ___', answers:['nine'] }] }
] });
assert.equal(listeningModel.sections.length, 4, 'Listening supports four parts');
assert.equal(listeningModel.sections[0].script, 'Good morning, visitors.');
const publicListening = appContext.window.FB._helpers.publicIelts(listeningModel);
assert.equal('script' in publicListening.sections[0], false, 'published scripts stay hidden before a student submits');
assert.equal(listeningModel.sections[1].questions[0].type, 'plan-map-diagram-labelling');
assert.equal(clean({ ...base, skill: 'video' }).skill, 'reading');
assert.throws(() => clean({ ...base, title: '' }), /Enter a title/);
assert.throws(() => clean({ ...base, sections: [{ text: '', questions: [] }] }), /needs text, a script or questions/);
assert.throws(() => clean({ ...base, sections: [{ text: 'Text', questions: [{ type: 'essay', prompt: 'Explain' }] }] }), /task type/);

let requestedUrl = '';
const passage = 'Passage text about urban gardens and community food access. '.repeat(5);
let importHtml = '<html><title>Reading · Urban Gardens</title><body><div class="entry-content"><h1>Urban Gardens</h1><h3>READING PASSAGE 1</h3><p>' + passage + '</p><h3>Questions 1-1</h3><p>Choose the correct letter, A or B.</p><p>1 Which side has the garden?</p><p>A North side</p><p>B South side</p><h2>Answer</h2><h5>Passage 1</h5><p>1 A</p></div><audio src="do-not-fetch.mp3"></audio></body></html>';
const cache = {};
const gasContext = { console, UrlFetchApp: { fetch(url, opts) {
  requestedUrl = url;
  return { getResponseCode: () => 200, getHeaders: () => ({ 'Content-Length': '120' }),
    getContentText: () => importHtml };
} }, CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
  vmfbIeltsVerifiedUser: token => token ? { success:true, uid:'t1', user:{role:'teacher'} } : {success:false, error:'missing token'} };
vm.runInNewContext(fs.readFileSync('gas/Code.gs', 'utf8'), gasContext, { filename: 'Code.gs' });
const imported = gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com/reading/urban-gardens', idToken:'valid' });
assert.equal(imported.success, true);
assert.equal(requestedUrl, 'https://ieltstrainingonline.com/reading/urban-gardens');
const sec = imported.data.sections[0];
assert.equal(imported.data.skill, 'reading');
assert.equal(sec.part, '1');
assert.ok(sec.text.includes('urban gardens'), 'passage text kept');
assert.ok(sec.questionsText.includes('1 Which side has the garden?') && sec.questionsText.includes('B South side'), 'question group kept with its options');
assert.equal(sec.answersText, '1 A');
assert.equal(sec.audio, undefined, 'reading pages never carry audio');
assert.match(imported.data.warning, /Compare every passage/);
assert.doesNotMatch(imported.data.warning, /No answer key/);

importHtml = '<html><title>Listening Test</title><body><div class="entry-content"><h3>PART 1</h3><h3>Questions 1-1</h3><p>Complete the sentence below.</p><p>1 The museum opens at ____.</p></div></body></html>';
const listening = gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com/listening/museum', idToken:'valid' });
assert.equal(listening.data.skill, 'listening');
assert.ok(listening.data.sections[0].questionsText.includes('The museum opens at'));
assert.match(listening.data.warning, /No answer key/);
assert.equal(gasContext.ieltsGuessTaskType_('Complete the sentences below', 'reading'), 'sentence-completion');

assert.equal(gasContext.ieltsImportUrl({ url: 'http://ieltstrainingonline.com/reading', idToken:'valid' }).success, false);
assert.equal(gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com@evil.example/reading', idToken:'valid' }).success, false);
assert.equal(gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com.evil.example/reading', idToken:'valid' }).success, false);
assert.equal(gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com/audio.mp3', idToken:'valid' }).success, false);
console.log('IELTS content and URL import checks passed.');
