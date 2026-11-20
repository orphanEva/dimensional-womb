function mountPanel(element, initial) {
  const root = element.shadowRoot || element.attachShadow({mode:'open'});
  root.innerHTML = '<style>' + panelStyle + '</style>' + panelMarkup;
  const $ = selector => root.querySelector(selector);
  const set = (selector, text) => { $(selector).textContent = text; };
  const el = (tag,content,cls) => {
    const node=document.createElement(tag);
    if(content != null) node.textContent=content;
    if(cls) node.className=cls;
    return node;
  };
  const parts = {left:'左侧导管',right:'右侧导管',core:'次元核心',wall:'腔壁',neck:'宫颈'};
  // Focus on an actual ridge of tissue within each region of the front-facing image.
  const focus = {left:[.16,.24],right:[.84,.24],core:[.495,.31],wall:[.414,.51],neck:[.492,.708]};
  const detail = $('#detail');
  const soundWord = $('#soundWord');
  const detailCanvas = detail.querySelector('canvas');
  const detailCaption = detail.querySelector('figcaption');
  const detailContext = detailCanvas.getContext('2d');
  function magnify(frame, reaction, displacement) {
    soundWord.hidden = !reaction || !soundWord.textContent;
    if (!soundWord.hidden) {
      soundWord.style.transform = 'rotate(-9deg) scale(' + (1 + .12*Math.abs(displacement)) + ')';
    }
    detail.hidden = !reaction || !detailContext;
    if (detail.hidden) return;
    const [x,y] = focus[reaction.part];
    const width = frame.width * .212;
    const height = width * detailCanvas.height / detailCanvas.width;
    detailContext.clearRect(0,0,detailCanvas.width,detailCanvas.height);
    detailContext.drawImage(frame,frame.width*x-width/2,frame.height*y-height/2,width,height,0,0,detailCanvas.width,detailCanvas.height);
    const label = parts[reaction.part] + (reaction.moisture == null ? '' : ' · 湿润 ' + reaction.moisture + '%');
    if (detailCaption.textContent !== label) detailCaption.textContent = label;
  }
  const scene = createScene($('#hologram'), organTexture, magnify);
  const excerpt = $('#sceneExcerpt');
  let excerptTimer;
  function showExcerpt(status, source) {
    clearTimeout(excerptTimer);
    const line = source?.bodyLineSeq != null ? status.bodyLine : '';
    const quote = source?.quoteSeq != null ? status.quote : '';
    excerpt.hidden = !line && !quote;
    $('#bodyLine').hidden = !line;
    $('#utterance').hidden = !quote;
    set('#bodyLine', line || '');
    set('#utterance', quote || '');
    excerpt.removeAttribute('data-live');
    if (excerpt.hidden) { set('#excerptSource',''); return; }
    const sameText = source.bodyLineSeq === source.quoteSeq;
    const citation = line && quote && !sameText
      ? '描写 #' + source.bodyLineSeq + ' · 台词 #' + source.quoteSeq
      : '原文 #' + (line ? source.bodyLineSeq : source.quoteSeq);
    set('#excerptSource', status.role + ' · ' + citation);
    const now = Date.now();
    const remaining = source.at + (status.reaction?.durationMs || 6000) - now;
    if (remaining > 0 && source.at <= now) {
      excerpt.setAttribute('data-live','');
      excerptTimer = setTimeout(() => excerpt.removeAttribute('data-live'),remaining);
    }
  }
  const actions = {touch:'轻触',press:'按压',stroke:'抚过',thrust:'抽送',clench:'夹紧',relax:'舒展',peak:'临界',release:'释放',afterglow:'余韵'};
  for(const button of root.querySelectorAll('nav button')) button.onclick=()=>{
    for(const item of root.querySelectorAll('nav button')) {
      const selected=item===button;
      $('#'+item.dataset.tab).hidden=!selected;
      if(selected)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
    }
  };
  function bar(id, value) {
    $(id).hidden=value==null;
    $(id+' b').style.width=(value??0)+'%';
  }
  function pair(label,value) {
    const row=el('div',null,'zone');row.append(el('span',label),el('span',value,'state-value'));return row;
  }
  function entries(target, rows, empty) {
    $(target).replaceChildren(...(rows.length ? rows.map(r=>{
      const entry=el('div',null,'entry');
      const block=el('div');block.append(el('p',r.label),el('small',r.type+' · #'+r.seq));
      entry.append(block,el('time',new Date(r.at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})));
      return entry;
    }) : [el('p',empty,'empty')]));
  }
  function render({connection,title,view,running,sessionId}) {
    const v=view?.status || {};
    const absent='未接入';
    const show=(x,unit='')=>x==null?absent:String(x)+unit;
    const pct=v.amount!=null&&v.capacity>0?Math.round(100*v.amount/v.capacity):null;
    set('#session',title || connection); set('#role',v.role || '等待角色快照');
    $('#action').hidden = !v.action;
    set('#action',v.action || '');
    const src=view?.origin;
    const verifiedSound = src?.sfxSeq != null ? v.sfx : '';
    if (soundWord.textContent !== (verifiedSound || '')) soundWord.textContent = verifiedSound || '';
    if (!verifiedSound || !v.reaction) soundWord.hidden = true;
    soundWord.title = verifiedSound ? '原文 #' + src.sfxSeq : '';
    set('#origin',src?'来源 · '+src.source+' · #'+src.seq+' · '+new Date(src.at).toLocaleString('zh-CN'):
      (view?'本会话尚无角色状态回报':connection));
    scene.update(v,src,sessionId);
    showExcerpt(v,src);
    const reaction = v.reaction;
    $('#lastReaction').hidden = !reaction;
    const cycles = reaction?.cycles;
    set('.reaction-name', reaction ? parts[reaction.part] + ' · ' + actions[reaction.kind] +
      (cycles == null ? '' : ' · ' + cycles + ' 次') : '');
    set('.reaction-detail', reaction ? '强度 ' + reaction.intensity + '% · ' + (reaction.durationMs/1000) + ' 秒' : '');
    const modules=[['能量导管',show(v.conduit)],['次元核心',show(v.core,'%')],['储存层',show(pct,'%')],['腔体轮廓',show(v.contour)]];
    $('#modules').replaceChildren(...modules.map(([label,value])=>{const m=el('div',null,'module');m.append(el('b',label),el('span',value));return m;}));
    set('#amount',show(v.amount));set('#capacity',v.capacity==null?'':' / '+v.capacity);set('#pct',pct==null?'':pct+'%');bar('#storageTrack',pct);
    $('#absorption').replaceChildren(pair('吸收速率',show(v.rate,' 格/时')));
    set('#core',show(v.core,'%'));bar('#coreTrack',v.core);
    set('#desire',show(v.desire,'%'));bar('#desireTrack',v.desire);
    $('#signals').replaceChildren(pair('腔体敏感度',show(v.sensitivity,'%')),pair('上次满足',v.satisfiedAt==null?absent:new Date(v.satisfiedAt).toLocaleString('zh-CN')));
    $('#moisture').hidden = reaction?.moisture == null;
    set('#moisture .state-value',reaction?.moisture == null ? '' : parts[reaction.part] + ' · ' + reaction.moisture + '%');
    const metrics=[['回合数',view?.turns],['用户消息',view?.messages],['工具结束 / 失败',view?view.completed+' / '+view.failures:null],['会话状态',running==null?null:running?'运行中':'空闲']];
    $('#metrics').replaceChildren(...metrics.map(([label,value])=>{const cell=el('div',null,'metric');cell.append(el('span',label),el('strong',value??'—'));return cell;}));
    const rows=view?.recent||[];
    entries('#recent',rows.slice(0,3),view?'暂无会话事件':connection);
    entries('#entries',rows,view?'暂无会话事件':connection);
  }
  render(initial);
  return {render, destroy() { clearTimeout(excerptTimer); scene.destroy(); root.replaceChildren(); }};
}
