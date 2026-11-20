import { z } from 'zod';
import { defineTool } from '@deepseek-ai/dsh-tools';

export const inject = ['sessionProjections','tools'];
const key = 'dimensionalArchiveV2';
const reportTool = 'dimensional_archive_report';
const label = z.string().trim().min(1).max(100);
const percent = z.number().min(0).max(100);
const excerpt = z.string().trim().min(1).max(120);
const parts = ['left','right','core','wall','neck'];
const repeatedKinds = ['thrust','clench'];
const kinds = ['touch','press','stroke','relax','peak','release','afterglow',...repeatedKinds];
const reaction = z.object({
  part:z.enum(parts), kind:z.enum(kinds), intensity:percent,
  durationMs:z.number().int().min(200).max(60000), moisture:percent.optional(),
  cycles:z.number().int().min(1).max(16).optional()
}).strict().refine(value => value.cycles === undefined || repeatedKinds.includes(value.kind),
  {message:'只有抽送和夹紧可以记录次数',path:['cycles']});
const fields = {
  role:label, action:label, amount:z.number().nonnegative().optional(),
  capacity:z.number().positive().optional(), rate:z.number().nonnegative().optional(),
  desire:percent.optional(), sensitivity:percent.optional(), core:percent.optional(),
  conduit:label.optional(), contour:label.optional(), satisfiedAt:z.number().int().nonnegative().optional(),
  reaction:reaction.optional(), quote:excerpt.optional(), bodyLine:excerpt.optional(),
  sfx:z.string().trim().min(1).max(12).regex(/^[^\r\n]+$/u).optional()
};
const snapshot = z.object(fields).strict().refine(s => s.amount == null || s.capacity == null || s.amount <= s.capacity,
  '储量不能超过容量');
const log = z.object({seq:z.number(), at:z.number(), type:z.string(), label:z.string()});
const origin = z.object({seq:z.number(), at:z.number(), source:z.string(),
  quoteSeq:z.number().optional(), bodyLineSeq:z.number().optional(), sfxSeq:z.number().optional()});
const schema = z.object({turns:z.number(), messages:z.number(), completed:z.number(), failures:z.number(),
  recent:z.array(log), status:snapshot.nullable(), origin:origin.nullable()});
// The bounded comparison window is host-only. Clear it on either Turn boundary.
const stateSchema = z.object({
  view:schema, turn:z.number().nullable(), reportCalls:z.array(z.string()),
  texts:z.array(z.object({seq:z.number(), text:z.string()}))
});
function publicTexts(content) {
  if(!Array.isArray(content)) return [];
  return content.filter(block=>block?.type === 'text' && typeof block.text === 'string' && block.text.length);
}
const projection = {
  key, stateVersion:4, stateSchema,
  init:() => ({turn:null,texts:[],reportCalls:[],
    view:{turns:0,messages:0,completed:0,failures:0,recent:[],status:null,origin:null}}),
  apply(previous,event) {
    const {type,data,seq,time} = event;
    const last = previous.view.recent[0];
    if(last && seq <= last.seq) return previous;
    let {turn,texts,reportCalls} = previous;
    const next = {...previous.view};
    let title;
    switch(type) {
      case 'turn/start': turn = data.turn; texts = []; reportCalls = []; next.turns++; title = '回合开始'; break;
      case 'turn/end': turn = null; texts = []; reportCalls = []; title = '回合结束'; break;
      case 'user/message':
        if(data.source?.kind !== 'user') return previous;
        next.messages++; title = '用户消息已接收'; break;
      case 'assistant/message': {
        title = data.interrupted ? '回复已中断' : '回复已记录';
        if(data.turn === turn && event.surfaceOp === 'append' && !data.interrupted) {
          const added = publicTexts(data.message.content).slice(-4).map(block=>({seq,text:block.text.slice(-2048)}));
          if(added.length) texts = [...texts,...added].slice(-4);
        }
        break;
      }
      case 'tool/call':
        title = '调用工具 · ' + data.name;
        if(data.name === reportTool && data.turn === turn) reportCalls = [...reportCalls,data.callId];
        break;
      case 'tool/result':
      case 'tool/ptc-dispatch': {
        const nested = type === 'tool/ptc-dispatch';
        const failed = nested ? data.isError : data.message.isError;
        const builtin = nested ? data.name === reportTool : reportCalls.includes(data.message.toolCallId);
        if(!nested && builtin) reportCalls = reportCalls.filter(id=>id !== data.message.toolCallId);
        next.completed++;
        if(failed) next.failures++;
        title = (nested ? data.name : '工具') + (failed ? ' · 执行失败' : ' · 执行完成');
        const packet = data.meta?.dimensionalArchive;
        if(!failed && packet?.version === 1) {
          const parsed = snapshot.safeParse(packet.status);
          if(parsed.success) {
            next.status = parsed.data;
            next.origin = {seq,at:time,source:builtin ? reportTool : nested ? data.name : (label.safeParse(packet.source).success ? packet.source : type)};
            if(next.status.quote || next.status.bodyLine || next.status.sfx) {
              const evidence = builtin
                ? (turn !== null && (nested || data.turn === turn) ? texts : [])
                : publicTexts(nested ? data.content : data.message.content).map(block=>({seq,text:block.text}));
              for(const [field,sourceField] of [['quote','quoteSeq'],['bodyLine','bodyLineSeq'],['sfx','sfxSeq']]) {
                const line = next.status[field];
                if(line === undefined) continue;
                const proof = evidence.findLast(block=>block.text.includes(line));
                if(proof) next.origin[sourceField] = proof.seq;
                else delete next.status[field];
              }
            }
            title = parsed.data.role + ' · ' + parsed.data.action;
          }
        }
        break;
      }
      default:return previous;
    }
    next.recent = [{seq,at:time,type,label:title},...previous.view.recent.slice(0,49)];
    return {turn,texts,reportCalls,view:next};
  },
  wire:{viewSchema:schema,view:state=>state.view,summary:false}
};
export async function apply(ctx) {
  await ctx.sessionProjections.register(projection);
  const parameters = {};
  const specs = {role:['string','当前角色名'],action:['string','已发生的剧情操作'],amount:['number','当前储量（格）'],
    capacity:['number','容量（格）'],rate:['number','每小时吸收量'],desire:['number','欲望值（0 至 100）'],
    sensitivity:['number','敏感度（0 至 100）'],core:['number','核心能量百分比'],conduit:['string','导管状态'],
    contour:['string','腔体轮廓状态'],satisfiedAt:['number','上次满足的真实时间，Unix 毫秒'],
    sfx:['string','可选。逐字摘录同一剧情动作正文中已经写出的拟声词，单行最多 12 个字符。有对应局部反应时可用作漫画音效字。'],
    quote:['string','可选。逐字摘录同一事件中当前角色已说出的原话，最多 120 字符。仅能核对本回合助手已提交的正文。说话者不明或找不到原文时省略。'],
    bodyLine:['string','可选。从本回合助手已提交的正文逐字摘录一小段描写当前角色身体感受或生理反应的叙述，最多 120 字符。选取与本次操作直接相关的具体感受或动作，缺少相应原文时省略。']};
  for(const [name,[type,description]] of Object.entries(specs)) {
    parameters[name] = {type,description};
    if(name==='role'||name==='action') parameters[name].required = true;
  }
  parameters.reaction = {type:'object',additionalProperties:false,
    description:'仅在本次已发生的剧情操作有明确局部反应记录时提供，包括部位、动作、强度和整段动作的总时长。缺少其中任何项就省略。peak 是临界，release 是明确释放，afterglow 是余韵。',
    properties:{
      part:{type:'string',required:true,enum:parts,description:'left / right 为左右导管，其余为核心、内壁或颈部'},
      kind:{type:'string',required:true,enum:kinds,description:'thrust 表示抽送，clench 表示夹紧。按已发生的动作选择。'},
      intensity:{type:'number',required:true,description:'已知强度，0 至 100'},
      durationMs:{type:'integer',required:true,description:'事件记录的时长，200 至 60000 毫秒'},
      moisture:{type:'number',description:'本次局部反应明确记录的湿润度，0 至 100。有具体数值时填写，只有文字感受时省略。'},
      cycles:{type:'integer',description:'仅用于 thrust 和 clench。填写已发生的剧情中明确记录的次数，范围为 1 至 16。省略时展示单次。'}
    }};
  ctx.tools.register(defineTool({
    name:reportTool,
    description:'当 DSH 角色扮演剧情操作已经确定角色状态时，报告操作后的完整已知快照。有对应正文时可摘录角色的一句台词和一段具体身体感受。抽送、夹紧及其次数只取自已发生的剧情。逐字保留剧情中已经写出的细节，省略未知值。普通聊天、写代码和工具使用无需调用。',
    parameters,
    execute:async args=>JSON.stringify(snapshot.parse(args)),
    output:{schema:{type:'string'},render:()=>[{type:'text',text:'角色状态快照已记录'}],
      presentationMeta:(_args,value)=>({dimensionalArchive:{version:1,source:reportTool,status:JSON.parse(value)}})}
  }));
}

