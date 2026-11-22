import { describe,it,expect,vi } from 'vitest';
import { render } from '@react-email/render';
import { createElement } from 'react';
import { KeyIssuedEmail } from '../emails/setup-key-issued';
import { nextEngagement,setupExample,engagementCopy,failureReview,parseWorkflow,parseAgentClient,type EngagementAccount } from '../emails/engagement-content';
import { authorized } from '../lib/engagement-auth';
import { NextRequest } from 'next/server';
const now=Date.parse('2026-10-07T16:00:00Z');
const ago=(days:number)=>new Date(now-days*86400000).toISOString();
const base:EngagementAccount={user_id:'test',email:'customer@example.org',full_name:'Alex Investor',workflow:'python',agent_client:null,
 started_at:ago(3),paused_at:null,pause_reason:null,last_contact_at:null,last_reply_at:null,excluded:false,has_active_key:true,
 account_status:'active',first_success_at:null,last_success_at:null,success_count:0,successful_days:0,last_error_at:null,last_error_status:null,
 paid_credits_usd:0,sent_kinds:[],has_pending_send:false};
describe('account-level activation decisions',()=>{
 it('waits 48h after the first key, then offers setup help',()=>{
  expect(nextEngagement({...base,started_at:ago(1)},now)).toBeNull();
  expect(nextEngagement(base,now)).toBe('setup-help');
 });
 it('uses a distinct reconnect message for older accounts',()=>expect(nextEngagement({...base,started_at:ago(50)},now)).toBe('reconnect'));
 it('never calls a successful analysis unused, even when it was free or through MCP',()=>{
  expect(nextEngagement({...base,first_success_at:ago(1),last_success_at:ago(1),success_count:1,successful_days:1},now)).toBeNull();
 });
 it('offers the second example only after the first nudge and at least 3 days',()=>{
  expect(nextEngagement({...base,started_at:ago(5),sent_kinds:['setup-help'],last_contact_at:ago(2)},now)).toBeNull();
  expect(nextEngagement({...base,started_at:ago(5),sent_kinds:['setup-help'],last_contact_at:ago(3)},now)).toBe('setup-example');
 });
 it('stops after two unanswered messages across different branches',()=>expect(nextEngagement({...base,sent_kinds:['error-help','setup-help']},now)).toBeNull());
 for(const patch of [{paused_at:ago(1)},{last_reply_at:ago(1)},{excluded:true},{has_active_key:false},{account_status:'suspended'},{has_pending_send:true},{email:null}]){
  it(`suppresses ${JSON.stringify(patch)}`,()=>expect(nextEngagement({...base,...patch},now)).toBeNull());
 }
 it('prioritizes a recent unresolved error and stops doing so after success',()=>{
  expect(nextEngagement({...base,last_error_at:ago(0.1)},now)).toBe('error-help');
  expect(nextEngagement({...base,last_error_at:ago(1),first_success_at:ago(0.1),last_success_at:ago(0.1),successful_days:1},now)).toBeNull();
 });
 it('distinguishes one-time and repeat use',()=>{
  expect(nextEngagement({...base,started_at:ago(12),first_success_at:ago(9),last_success_at:ago(9),successful_days:1},now)).toBe('return-help');
  expect(nextEngagement({...base,first_success_at:ago(2),last_success_at:ago(0.1),successful_days:2},now)).toBe('workflow-help');
 });
 it('rejects unknown setup choices',()=>{expect(parseWorkflow('admin')).toBeNull();expect(parseAgentClient('malicious')).toBeNull();});
 it('generates one working path with no accidental patch markers',()=>{
  expect(setupExample('python').code).toContain('RiskModelsClient.from_env()');
  expect(setupExample('rest').code).not.toContain('\n+');
  expect(setupExample('agent','claude').instruction).toContain('https://riskmodels.app/api/mcp/sse');
 });
 it('does not invent a name from an email address',()=>expect(engagementCopy({...base,full_name:null},'setup-help').text).toMatch(/^Hi there,/));
 it('quotes a stored 404 and does not call it an outage',()=>{
  const account={...base,last_error_at:ago(0.1),last_error_status:'404',last_error_capability:'decompose-position',last_error_path:'/api/decompose',last_error_tickers:'XYZ',last_error_message:'Symbol not found'};
  expect(failureReview(account)?.guidance).toMatch(/not an outage/);
  expect(engagementCopy(account,'error-help').text).toContain('decompose-position for XYZ');
  expect(engagementCopy(account,'error-help').text).toContain('Symbol not found');
  expect(engagementCopy(account,'error-help').text).not.toContain('on our side');
 });
 it('says a 5xx is ours and refuses to invent a ticker for an unstored 404',()=>{
  expect(engagementCopy({...base,last_error_status:'502',last_error_capability:'decompose-position',last_error_message:'upstream timeout'},'error-help').text).toContain('on our side');
  const bare=failureReview({...base,last_error_status:'404',last_error_capability:'decompose-position'});
  expect(bare?.guidance).toMatch(/Do not guess the ticker/);
  expect(bare?.customer).toContain('I do not have the ticker');
  expect(engagementCopy({...base,last_error_status:'404',last_error_capability:'decompose-position'},'error-help').text).not.toMatch(/[A-Z]{2,5} returned/);
 });
});
describe('key email',()=>{
 const props={firstName:'Alex',keyName:'Research',keyPrefix:'rm_agent_',createdDateFormatted:'October 7',expiresAtFormatted:'October 7, 2027',termsUrl:'https://riskmodels.net/terms/api'};
 it('shows only the selected setup',async()=>{
  const html=await render(createElement(KeyIssuedEmail,{...props,workflow:'python'}));
  expect(html).toContain('RiskModelsClient.from_env()');expect(html).not.toContain('custom connector');expect(html).not.toContain('curl --fail');
 });
 it('a second key sends a confirmation without restarting onboarding',async()=>{
  const html=await render(createElement(KeyIssuedEmail,{...props,workflow:'python',isFirstKey:false}));
  expect(html).toContain('new RiskModels API key');expect(html).not.toContain('RiskModelsClient');expect(html).not.toContain('What are you hoping');
 });
 it('escapes account-controlled text',async()=>{
  const html=await render(createElement(KeyIssuedEmail,{...props,firstName:'<script>alert(1)</script>'}));
  expect(html).not.toContain('<script>');
 });
});
describe('engagement operator authorization',()=>{
 it('fails closed on absent or incorrect credentials',()=>{
  vi.stubEnv('CRON_SECRET','test-secret');
  for(const header of [undefined,'Bearer wrong','Bearer test-secret-long'])expect(authorized(new NextRequest('https://riskmodels.app/api/admin/engagement',{headers:header?{authorization:header}:{}}))).toBe(false);
  expect(authorized(new NextRequest('https://riskmodels.app/api/admin/engagement',{headers:{authorization:'Bearer test-secret'}}))).toBe(true);
  vi.stubEnv('CRON_SECRET','');expect(authorized(new NextRequest('https://riskmodels.app/api/admin/engagement',{headers:{authorization:'Bearer '}}))).toBe(false);
  vi.unstubAllEnvs();
 });
});
