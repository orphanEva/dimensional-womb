const React = require('react');
return {
  inject:['slots','sessions','uiSession'],
  apply(ctx) {
    function Panel() {
      const ref=React.useRef(null);
      React.useEffect(()=>{
        const panel=mountPanel(ref.current,{connection:'正在读取 DSH'});
        const current=ctx.uiSession.adapter.current;
        let binding, stopBinding=()=>{};
        let last=[];
        function display(frame) {
          const signature=[frame.sessionId,frame.connection,frame.title,frame.view,frame.running];
          if(signature.every((v,i)=>v===last[i]) && last.length) return;
          last=signature;panel.render(frame);
        }
        function sync() {
          const id=current.getSnapshot().key;
          const next=id ? ctx.sessions.binding(id) : null;
          if(next!==binding) {
            stopBinding();binding=next;stopBinding=()=>{};
            if(next) {
              const projection=next.session.projections.faceOf('dimensionalArchiveV2');
              const clean=[next.session.subscribe(sync),projection.subscribe(sync)];
              stopBinding=()=>clean.forEach(stop=>stop());
            }
          }
          if(!binding) {display({connection:'DSH 已连接 · 等待选中会话'});return;}
          const life=binding.session.getSnapshot();
          if(life.removed || life.openState==='error') {display({connection:'会话不可用'});return;}
          const title=ctx.sessions.list.getSnapshot().byId[id]?.displayTitle || id;
          const view=binding.session.projections.faceOf('dimensionalArchiveV2').getSnapshot();
          display({sessionId:id, connection:view?'DSH 已连接':'等待 DSH 会话投影', title, view, running:life.openState==='open'?life.running:null});
        }
        const clean=[current.subscribe(sync),ctx.sessions.list.subscribe(sync)];
        sync();
        return ()=>{clean.forEach(stop=>stop());stopBinding();panel.destroy();};
      },[]);
      return React.createElement('div',{ref,style:{height:'100%',width:'100%',minWidth:0}});
    }
    const id='dimensional-archive';
    ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:id},Panel));
    ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id,label:()=>'次元子宫',order:35},()=>React.createElement('span',{'aria-hidden':true},'✧')));
  }
};
