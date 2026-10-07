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
assert.throws(() => clean({ ...base, title: '' }), /tiêu đề/);
assert.throws(() => clean({ ...base, sections: [{ text: '', questions: [] }] }), /nội dung/);
assert.throws(() => clean({ ...base, sections: [{ text: 'Text', questions: [{ type: 'essay', prompt: 'Explain' }] }] }), /task type/);

let requestedUrl = '';
let importHtml = '<html><title>Reading · Urban Gardens</title><main><h2>Passage 1</h2><p>' + 'Passage text about urban gardens and community food access. '.repeat(5) + '</p><p>1. Choose the correct letter about the garden?</p><p>A. North side</p><p>B. South side</p><h2>Answer Key</h2><p>1. A</p></main><audio src="do-not-fetch.mp3"></audio></html>';
const gasContext = { console, UrlFetchApp: { fetch(url, opts) {
  requestedUrl = url;
  return { getResponseCode: () => 200, getHeaders: () => ({ 'Content-Length': '120' }),
    getContentText: () => importHtml };
} }, vmfbIeltsVerifiedUser: token => token ? { success:true, user:{role:'teacher'} } : {success:false, error:'missing token'} };
vm.runInNewContext(fs.readFileSync('gas/Code.gs', 'utf8'), gasContext, { filename: 'Code.gs' });
const imported = gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com/reading/urban-gardens', idToken:'valid' });
assert.equal(imported.success, true);
assert.equal(requestedUrl, 'https://ieltstrainingonline.com/reading/urban-gardens');
assert.equal(imported.data.sections[0].questions.length, 1);
assert.equal(imported.data.sections[0].questions[0].type, 'multiple-choice');
assert.deepEqual(Array.from(imported.data.sections[0].questions[0].options), ['North side', 'South side']);
assert.deepEqual(Array.from(imported.data.sections[0].questions[0].answers), ['A']);
assert.match(imported.data.warning, /Chờ kiểm tra/);
importHtml = '<html><title>Listening Test</title><main><h2>Section 1</h2><p>' + 'Audio transcript about a museum and visitor services. '.repeat(5) + '</p><p>1. Complete the sentence: The museum opens at ___.</p></main></html>';
const listening = gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com/listening/museum', idToken:'valid' });
assert.equal(listening.data.skill, 'listening');
assert.equal(listening.data.sections[0].questions[0].type, 'sentence-completion');
assert.equal(gasContext.ieltsImportUrl({ url: 'http://ieltstrainingonline.com/reading', idToken:'valid' }).success, false);
assert.equal(gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com@evil.example/reading', idToken:'valid' }).success, false);
assert.equal(gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com.evil.example/reading', idToken:'valid' }).success, false);
assert.equal(gasContext.ieltsImportUrl({ url: 'https://ieltstrainingonline.com/audio.mp3', idToken:'valid' }).success, false);
console.log('IELTS content and URL import checks passed.');
