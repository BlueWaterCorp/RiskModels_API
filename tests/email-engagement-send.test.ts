import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {engagementCopy,type EngagementAccount} from '../emails/engagement-content';
const mocks=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),getUserById:vi.fn(),send:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({from:mocks.from,rpc:mocks.rpc,auth:{admin:{getUserById:mocks.getUserById}}})}));
vi.mock('resend',()=>({Resend:class {emails={send:mocks.send};}}));
vi.mock('@/lib/resend-audit',()=>({withResendAuditBcc:(x:unknown)=>x}));
import {sendEngagement} from '../lib/email-engagement';
const now=Date.parse('2026-10-07T16:00:00Z');
const account:EngagementAccount={user_id:'account-id',email:'customer@example.org',full_name:'Alex',workflow:'python',agent_client:null,
 started_at:'2026-10-04T16:00:00Z',paused_at:null,pause_reason:null,last_contact_at:null,last_reply_at:null,excluded:false,has_active_key:true,account_status:'active',
 first_success_at:null,last_success_at:null,success_count:0,successful_days:0,last_error_at:null,last_error_status:null,paid_credits_usd:0,sent_kinds:[],has_pending_send:false};
let reads:EngagementAccount[];let prefs:Record<string,unknown>;let writes:{table:string;values:Record<string,unknown>;filters:unknown[][]}[];
let sentWriteError:boolean;
const send=()=>sendEngagement(account.user_id,'setup-help',engagementCopy(account,'setup-help').text);
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);vi.stubEnv('RESEND_API_KEY','test-only');vi.clearAllMocks();
 reads=[{...account},{...account,has_pending_send:true}];prefs={unsubscribe_token:'test-token',paused_at:null,last_reply_at:null};writes=[];sentWriteError=false;
 mocks.rpc.mockResolvedValue({data:'reservation-id',error:null});
 mocks.getUserById.mockResolvedValue({data:{user:{email:account.email,email_confirmed_at:'2026-10-01'}},error:null});
 mocks.send.mockResolvedValue({data:{id:'provider-id'},error:null});
 mocks.from.mockImplementation((table:string)=>{
  let values:Record<string,unknown>|undefined;const filters:unknown[][]=[];
  const result=()=>{
   if(values){writes.push({table,values,filters});return {error:sentWriteError&&values.status==='sent'?{message:'db offline'}:null};}
   return {data:table==='api_email_engagement_queue'?reads.shift():prefs,error:null};
  };
  const q={select:vi.fn(()=>q),eq:vi.fn((...args:unknown[])=>{filters.push(args);return q;}),update:vi.fn((v:Record<string,unknown>)=>{values=v;return q;}),single:vi.fn(async()=>result()),then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result()).then(resolve)};
  return q;
 });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe('reviewed engagement sends',()=>{
 it('sends the reviewed draft only to the verified auth address and records provider acceptance',async()=>{
  await expect(send()).resolves.toEqual({messageId:'provider-id'});
  expect(mocks.send).toHaveBeenCalledOnce();
  const [payload,options]=mocks.send.mock.calls[0];
  expect(payload.to).toBe(account.email);expect(payload.replyTo).toBe('conrad@bwmacro.com');
  expect(payload.text).toContain('Pause setup follow-ups: https://riskmodels.app/email-preferences?token=test-token');
  expect(options.idempotencyKey).toBe('engagement/reservation-id');
  expect(writes.some(w=>w.values.status==='sent'&&w.values.provider_message_id==='provider-id')).toBe(true);
 });
 it('rejects a stale or edited preview before reserving or sending',async()=>{
  await expect(sendEngagement(account.user_id,'setup-help','edited text')).rejects.toThrow('Draft changed');
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
 });
 it('refuses profile/auth email mismatches',async()=>{
  mocks.getUserById.mockResolvedValue({data:{user:{email:'different@example.org',email_confirmed_at:'2026-10-01'}}});
  await expect(send()).rejects.toThrow('Account email changed');expect(mocks.send).not.toHaveBeenCalled();
 });
 it('refuses unverified recipients',async()=>{
  mocks.getUserById.mockResolvedValue({data:{user:{email:account.email,email_confirmed_at:null}}});
  await expect(send()).rejects.toThrow('verified account email');expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('does not send a second click when another request owns the reservation',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:null});
  await expect(send()).rejects.toThrow('already pending');expect(mocks.send).not.toHaveBeenCalled();
 });
 it('cancels a no-use nudge when analysis succeeds after preview',async()=>{
  reads[1]={...account,first_success_at:new Date(now).toISOString(),last_success_at:new Date(now).toISOString(),success_count:1,successful_days:1,has_pending_send:true};
  await expect(send()).rejects.toThrow('activity changed before sending');expect(mocks.send).not.toHaveBeenCalled();
  expect(writes.some(w=>w.values.status==='cancelled')).toBe(true);
 });
 it('rechecks suppression after claiming the message',async()=>{
  prefs.paused_at=new Date(now).toISOString();
  await expect(send()).rejects.toThrow('paused');expect(mocks.send).not.toHaveBeenCalled();
  expect(writes.find(w=>w.values.status==='cancelled')?.filters).toContainEqual(['status','claimed']);
  expect(writes.some(w=>w.values.status==='failed')).toBe(false);
 });
 it('holds uncertain provider outcomes for operator review without retrying',async()=>{
  mocks.send.mockRejectedValue(new Error('connection lost'));
  await expect(send()).rejects.toThrow('connection lost');expect(mocks.send).toHaveBeenCalledOnce();
  expect(writes.find(w=>w.values.status==='failed')?.filters).toContainEqual(['status','claimed']);
 });
 it('holds delivery when acceptance succeeded but the record update fails',async()=>{
  sentWriteError=true;
  await expect(send()).rejects.toThrow('Email accepted; delivery record needs reconciliation');
  expect(mocks.send).toHaveBeenCalledOnce();expect(writes.some(w=>w.values.status==='failed')).toBe(true);
 });
});
