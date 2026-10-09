#!/usr/bin/env node
/** Verify every displayed followup with the real local intent classifier. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {CARD_FOLLOWUPS, cardFollowups} from '../src/lib/voice/card-presentation.ts';
import {buildBriefCard, VOICE_COVERAGE_FALLBACK} from '../src/lib/voice/card-builders.ts';
import {classifyScriptedQuestion} from '../src/lib/voice/intents.ts';
import {OpenAiCompatibleAdapter} from '../services/voice-orchestrator/src/llm/zhipu.ts';
const baseUrl=process.env.VOICE_LLM_BASE_URL || 'http://127.0.0.1:1234/v1';
assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(baseUrl).hostname));
const adapter=new OpenAiCompatibleAdapter({baseUrl,apiKey:process.env.VOICE_LLM_API_KEY || 'local-placeholder',model:process.env.VOICE_LLM_MODEL || '',reasoningEffort:'none'});
const questions=[...new Set([...Object.values(CARD_FOLLOWUPS).flat(),...cardFollowups(buildBriefCard('小川',[VOICE_COVERAGE_FALLBACK]))])];
const results=[];
for(const question of questions){
  const expected=classifyScriptedQuestion(question);assert.notEqual(expected,'unanswerable');
  const at=performance.now();const actual=await adapter.classify(question,AbortSignal.timeout(15000));
  results.push({question,expected,actual,ms:Math.round(performance.now()-at),ok:actual===expected});
  console.log(`${actual===expected?'PASS':'FAIL'} ${question} → ${actual}`);
}
const report={testedAt:new Date().toISOString(),endpoint:'local',results,passed:results.filter(r=>r.ok).length,total:results.length};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');
assert.equal(report.passed,report.total,'A displayed followup classified outside its supported intent');
