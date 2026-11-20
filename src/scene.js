// Coordinates are relative to the registered front-facing illustration.
function createScene(container, textureURL, onFrame) {
  const size = 680;
  const regions = {
    left: {x:.17,y:.28,rx:.22,ry:.18,lean:-1},
    right:{x:.83,y:.28,rx:.22,ry:.18,lean:1},
    core: {x:.50,y:.31,rx:.16,ry:.19,lean:0},
    wall: {x:.50,y:.52,rx:.24,ry:.32,lean:0},
    neck: {x:.50,y:.76,rx:.12,ry:.20,lean:0}
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label','当前角色的腔体成像');
  const g = canvas.getContext('2d');
  container.classList.add('bio-scene');
  if (!g) {
    const fallback = new Image();
    fallback.alt = '腔体结构示意图';
    fallback.src = textureURL;
    container.replaceChildren(fallback);
    return {update(){}, destroy(){container.replaceChildren();}};
  }
  container.replaceChildren(canvas);
  const texture = document.createElement('canvas');
  texture.width = texture.height = size;
  const image = new Image();
  const parts = new Map();
  function makeLayer() {
    const node=document.createElement('canvas');
    node.width=node.height=size;
    return node.getContext('2d');
  }
  const surface=makeLayer(), paint=makeLayer();
  const blush=makeLayer(), pearl=makeLayer();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const glow = document.createElement('canvas');
  glow.width = glow.height = 96;
  const brush = glow.getContext('2d');
  const halo = brush.createRadialGradient(48,48,0,48,48,48);
  halo.addColorStop(0,'rgba(255,214,239,.98)');
  halo.addColorStop(.16,'rgba(252,144,203,.85)');
  halo.addColorStop(.47,'rgba(236,70,166,.4)');
  halo.addColorStop(1,'rgba(217,49,146,0)');
  brush.fillStyle = halo;
  brush.fillRect(0,0,96,96);
  let ready = false, disposed = false, inView = true, frame = 0, wake = 0, previousFrame = -Infinity;
  let record = {}, timestamp = null, sequence, session;
  let warp;

  // Map every destination texel back to one material point. The displacement
  // smoothly reaches zero at the edge of each region, including at overlaps.
  function createWarp() {
    const node=document.createElement('canvas');
    node.width=node.height=size;
    const gl=node.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false});
    if (!gl?.createShader) return null;
    const program=gl.createProgram();
    function compile(type,source) {
      const shader=gl.createShader(type);
      gl.shaderSource(shader,source);gl.compileShader(shader);
      gl.attachShader(program,shader);gl.deleteShader(shader);
    }
    compile(gl.VERTEX_SHADER,`
      attribute vec2 pos;
      varying vec2 uv;
      void main() {
        uv=vec2(.5+.5*pos.x,.5-.5*pos.y);
        gl_Position=vec4(pos,0.,1.);
      }`);
    compile(gl.FRAGMENT_SHADER,`
      #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
      #else
        precision mediump float;
      #endif
      varying vec2 uv;
      uniform sampler2D image;
      uniform vec4 region[3];
      uniform vec4 motion[3];
      uniform vec2 action[3];
      void main() {
        vec2 point=uv;
        for (int i=0;i<3;i++) {
          if (action[i].x==0.) continue;
          vec2 delta=point-region[i].xy;
          float reach=length(delta/region[i].zw);
          float f=action[i].x*(1.-smoothstep(.22,1.,reach));
          delta-=motion[i].xy*f;
          float angle=action[i].y*f;
          float c=cos(angle),s=sin(angle);
          delta=vec2(c*delta.x+s*delta.y,-s*delta.x+c*delta.y);
          point=region[i].xy+delta/(1.+motion[i].zw*f);
        }
        gl_FragColor=texture2D(image,point);
      }`);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
      gl.deleteProgram(program);return null;
    }
    gl.useProgram(program);
    const vertices=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,vertices);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'pos');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    const pixels=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,pixels);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    const shape=gl.getUniformLocation(program,'region[0]'),pressure=gl.getUniformLocation(program,'action[0]');
    const movement=gl.getUniformLocation(program,'motion[0]');
    const geometry=new Float32Array(12),actions=new Float32Array(6),poses=new Float32Array(12);
    return {
      draw(changes) {
        if (gl.isContextLost()) return false;
        actions.fill(0);
        for (let i=0;i<changes.length;i++) {
          const [name,level,mode]=changes[changes.length-1-i],r=regions[name],pose=deformation(r,mode);
          geometry.set([r.x,r.y,r.rx,r.ry],4*i);
          actions.set([level,pose.turn],2*i);
          poses.set([pose.dx,pose.dy,pose.sx,pose.sy],4*i);
        }
        gl.uniform4fv(shape,geometry);gl.uniform2fv(pressure,actions);gl.uniform4fv(movement,poses);
        gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,surface.canvas);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        g.drawImage(node,0,0);
        return true;
      },
      dispose() {
        gl.deleteTexture(pixels);gl.deleteBuffer(vertices);gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    };
  }

  // The plate is registered on black. Key only connected exterior ink so the
  // dark, enclosed folds keep their printed contours against pale paper.
  function keyExterior(imageData) {
    const {data,width,height}=imageData;
    const count=width*height, seen=new Uint8Array(count), queue=new Int32Array(count);
    let read=0, write=0;
    function visit(pixel) {
      if (seen[pixel]) return;
      seen[pixel]=1;
      const i=pixel*4, value=Math.max(data[i],data[i+1],data[i+2]);
      if (value>=38) return;
      data[i+3]=255*fade((value-8)/30);
      queue[write++]=pixel;
    }
    for (let x=0;x<width;x++) {visit(x);visit(count-width+x);}
    for (let y=0;y<height;y++) {visit(y*width);visit((y+1)*width-1);}
    while (read<write) {
      const p=queue[read++], x=p%width;
      if (x>0) visit(p-1);
      if (x+1<width) visit(p+1);
      if (p>=width) visit(p-width);
      if (p+width<count) visit(p+width);
    }
  }
  function prepareMaterial() {
    const base=texture.getContext('2d'), plate=base.getImageData(0,0,size,size);
    keyExterior(plate);
    base.putImageData(plate,0,0);
    const texels=plate.data;
    const warm=blush.createImageData(size,size), glossy=pearl.createImageData(size,size);
    for(let i=0;i<texels.length;i+=4) {
      const red=texels[i], green=texels[i+1], blue=texels[i+2];
      const value=Math.max(red,green,blue);
      if(value<13) continue;
      const coverage=(texels[i+3]/255)*Math.min(1,(value-13)/57);
      warm.data[i]=red*.88+value*.17;
      warm.data[i+1]=green*.77+red*.07;
      warm.data[i+2]=blue*.83+red*.12;
      warm.data[i+3]=coverage*255;
      // Retain fine ripples from the source rather than adding random glints.
      const j=Math.max(0,i-4*(size+1));
      const slope=Math.max(0,(value-Math.max(texels[j],texels[j+1],texels[j+2]))/60);
      const reflectivity=Math.min(1, .08+.76*(value/255)**1.2+.38*slope);
      glossy.data[i]=250; glossy.data[i+1]=171+62*green/255;
      glossy.data[i+2]=213+34*blue/255; glossy.data[i+3]=coverage*reflectivity*255;
    }
    blush.putImageData(warm,0,0); pearl.putImageData(glossy,0,0);
  }
  // Warp already-lit material so reflection and blush move with the wall.
  function preparePart(r) {
    const patch = document.createElement('canvas');
    const w = patch.width = Math.ceil(2*r.rx*size);
    const h = patch.height = Math.ceil(2*r.ry*size);
    const c = patch.getContext('2d');
    c.translate(w/2,h/2); c.scale(w/2,h/2);
    const mask = c.createRadialGradient(0,0,.42,0,0,1);
    mask.addColorStop(0,'#fff'); mask.addColorStop(.36,'rgba(255,255,255,.91)');
    mask.addColorStop(1,'rgba(255,255,255,0)');
    c.fillStyle = mask; c.fillRect(-1,-1,2,2);
    const tile=document.createElement('canvas'); tile.width=w;tile.height=h;
    return {mask:patch,tile,ctx:tile.getContext('2d')};
  }
  function deformation(r,mode) {
    if (mode==='thrust') return {dx:-r.lean*.046,dy:-.067,turn:r.lean*.042,sx:-.046,sy:.105};
    if (mode==='clench') return {dx:-r.lean*.035,dy:-.004,turn:0,sx:-.245,sy:-.080};
    return {dx:-r.lean*.013,dy:-.034,turn:r.lean*.155,sx:-.165,sy:.103};
  }
  function deform(name,force,mode) {
    if (Math.abs(force)<.0005) return;
    const r=regions[name], {mask,tile,ctx}=parts.get(name);
    ctx.globalCompositeOperation='source-over';
    ctx.clearRect(0,0,tile.width,tile.height);
    ctx.drawImage(surface.canvas,tile.width/2-r.x*size,tile.height/2-r.y*size);
    ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);
    g.save();
    const pose=deformation(r,mode);
    g.translate((r.x+pose.dx*force)*size,(r.y+pose.dy*force)*size);
    g.rotate(pose.turn*force);
    g.scale(1+pose.sx*force,1+pose.sy*force);
    g.drawImage(tile,-tile.width/2,-tile.height/2);
    g.restore();
  }
  function fade(x) {
    const y=Math.max(0,Math.min(1,x));
    return y*y*(3-2*y);
  }
  function shapeAt(kind,p) {
    // A displaced peak always tapers back into the underlying reported contour.
    const envelope=Math.sin(Math.PI*p);
    switch(kind) {
      case 'touch': return Math.sin(3*Math.PI*p)*Math.exp(-2.2*p);
      case 'press': return fade(p/.35)*(1-fade((p-.64)/.36))*(1+.05*Math.sin(2*Math.PI*p));
      case 'stroke': return envelope*(.5+.5*Math.sin(2*Math.PI*p));
      case 'relax': return -.8*envelope;
      case 'thrust': return fade(p/.31)*(1-fade((p-.47)/.53));
      case 'clench': return fade(p/.21)*(1-fade((p-.34)/.66));
      case 'peak': return Math.min(1,p/.28,(1-p)/.13);
      case 'release': {
        const first=fade(p/.13)*(1-fade((p-.16)/.15));
        const second=fade((p-.35)/.15)*(1-fade((p-.51)/.16));
        const opening=fade((p-.51)/.27)*(1-fade((p-.80)/.20));
        return first+.61*second-.82*opening;
      }
      case 'afterglow': return .94*fade(p/.085)*(1-fade((p-.12)/.28))
        +.40*fade((p-.55)/.13)*(1-fade((p-.7)/.30));
      default:return 0;
    }
  }
  function partEcho(name) {
    if (name==='left' || name==='right') return 'core';
    return name==='wall' ? 'neck' : 'wall';
  }
  function actionPhase(r,progress,frozen) {
    if (r.kind!=='thrust' && r.kind!=='clench') return progress;
    if (frozen) return .34;
    const cycles=Number.isInteger(r.cycles)?Math.max(1,Math.min(16,r.cycles)):1;
    return (progress*cycles)%1;
  }
  const paths={
    left: [[.085,.34],[.105,.13],[.235,.14],[.365,.205]],
    right:[[.915,.34],[.895,.13],[.765,.14],[.635,.205]],
    core: [[.436,.246],[.425,.29],[.469,.348],[.50,.384]],
    wall: [[.371,.339],[.393,.447],[.425,.646],[.465,.695]],
    neck: [[.434,.607],[.44,.692],[.49,.72],[.50,.819]]
  };
  function strokePoint(part,p) {
    const [a,b,c,d]=paths[part],v=1-p;
    const point=axis=>v**3*a[axis]+3*v*v*p*b[axis]+3*v*p*p*c[axis]+p**3*d[axis];
    return {x:point(0),y:point(1)};
  }
  function dab(x,y,w,h,opacity,angle=0) {
    if(opacity<=.001) return;
    paint.save();paint.globalAlpha=Math.min(1,opacity);
    paint.translate(x*size,y*size);paint.rotate(angle);
    paint.drawImage(glow,-w*size/2,-h*size/2,w*size,h*size);paint.restore();
  }
  function clearPaint() {
    paint.globalCompositeOperation='source-over';
    paint.clearRect(0,0,size,size);
  }
  function layMaterial(map,mode) {
    paint.globalCompositeOperation='source-in';
    paint.drawImage(map.canvas,0,0);
    surface.globalCompositeOperation=mode;
    surface.drawImage(paint.canvas,0,0);
    surface.globalCompositeOperation='source-over';
  }
  function lightSurface(r,progress,level) {
    const region=regions[r.part];
    const p=r.kind==='stroke'?progress:.48;
    const tip=strokePoint(r.part,p);
    const wet=Number.isFinite(r.moisture)?Math.max(0, Math.min(1,r.moisture/100)):0;
    const envelope=fade(progress/.11)*(1-fade((progress-.64)/.36));
    const blushAmount=(r.kind==='afterglow' ? .72 : 1)*level*envelope;
    clearPaint();
    dab(region.x,region.y,region.rx*3.1,region.ry*3.1,blushAmount*.85);
    dab(tip.x,tip.y,.29,.36,blushAmount);
    if(r.kind==='stroke') {
      for(let i=1;i<=5;i++) {
        const q=p-.035*i;
        if(q<0) break;
        const trail=strokePoint(r.part,q);
        dab(trail.x,trail.y,.15,.09,blushAmount*(1-i/7));
      }
    }
    layMaterial(blush,'source-over');
    if(wet<=0) return;
    // Narrow streaks follow actual surface tangents. The pearlescent map
    // limits reflection to the ridges lit in the source, without visible discs.
    clearPaint();
    const film=wet*envelope*(.5+.5*level);
    const sweep=r.kind==='stroke'?p:(.19+.60*fade(progress));
    for(let i=0;i<4;i++) {
      const q=Math.max(0,Math.min(.995,sweep-.080*i));
      const a=strokePoint(r.part,q), b=strokePoint(r.part,Math.min(1,q+.018));
      const angle=Math.atan2(b.y-a.y,b.x-a.x);
      const strength=film*(1-i*.20);
      dab(a.x,a.y,.13,.032,strength*.85,angle);
      dab(a.x,a.y,.081,.011,strength,angle);
    }
    layMaterial(pearl,'screen');
  }
  function conduitPoint(side,u) {
    const part=side<0?'left':'right';
    if (u<=.66) return strokePoint(part,u/.66);
    const q=(u-.66)/.34, v=1-q;
    return {x:.5+side*(.135*v*v+.15*v*q),y:.205*v*v+.398*q*v+.31*q*q};
  }
  function flowDots(direction,cycles,strength) {
    for (const side of [-1,1]) {
      for (let i=0;i<3;i++) {
        const step=(cycles+i/3)%1;
        const u=direction===1?step:1-step;
        const a=conduitPoint(side,u),b=conduitPoint(side,Math.min(1,u+.015));
        const angle=Math.atan2(b.y-a.y,b.x-a.x);
        const opacity=strength*Math.sin(step*Math.PI);
        dab(a.x,a.y,.082,.036,opacity,angle);
        dab(a.x,a.y,.037,.012,opacity,angle);
      }
    }
  }
  function render(now) {
    const s=record;
    const energy=Number.isFinite(s.core)?Math.min(1,Math.max(0,s.core/100)):0;
    const flow=({'流入':1,'流向核心':1,'流出':-1,'向外释放':-1})[s.conduit] || 0;
    const contour=({'紧缩':.47,'收拢':.28,'收缩':.38,'舒张':-.22})[s.contour] || 0;
    const r=s.reaction;
    const age=timestamp==null ? Infinity : now-timestamp;
    const active=r && r.intensity>0 && Object.hasOwn(regions,r.part) && age>=0 && age<r.durationMs;
    const p=active ? Math.min(1,age/r.durationMs) : 0;
    const level=active ? r.intensity/100 : 0;
    const frozen=reduced.matches;
    const progress = frozen ? .35 : p;
    const t=frozen?0:(now%3600000)/1000;
    surface.globalCompositeOperation='source-over';surface.clearRect(0,0,size,size);
    surface.drawImage(texture,0,0);
    if (active) lightSurface(r,progress,level);
    clearPaint();
    dab(.5,.31,.13+.12*energy,.15+.13*energy,energy*(.76+.12*Math.cos(t*(1.3+energy))));
    let direction=flow, strength=.72, cycles=t*.58;
    if (active) {
      const localEnvelope=Math.sin(Math.PI*progress);
      if (r.kind==='peak') dab(.5,.31,.37,.42,level*shapeAt('peak',progress)*.96);
      if (r.kind==='release') {
        direction=-1;strength=level*localEnvelope;cycles=progress*2;
        dab(.5,.31,.31+.20*progress,.33+.20*progress,level*localEnvelope*(1-progress));
      }
    }
    if (direction) flowDots(direction,cycles,strength);
    if (energy || direction || (active && r.kind==='peak')) layMaterial(pearl,'screen');
    g.globalCompositeOperation='source-over';g.clearRect(0,0,size,size);
    const changes=[];
    if (contour) changes.push(['wall',contour]);
    let displacement=0;
    if (active) {
      const phase=actionPhase(r,progress,frozen);
      if (phase>.21) changes.push([partEcho(r.part),.43*level*shapeAt(r.kind,(phase-.21)/.79),r.kind]);
      displacement=shapeAt(r.kind,phase)*level;
      changes.push([r.part,displacement,r.kind]);
    }
    if (changes.length && warp===undefined) warp=createWarp();
    if (!changes.length || !warp?.draw(changes)) {
      g.drawImage(surface.canvas,0,0);
      for (const [name,force,mode] of changes) deform(name,force,mode);
    }
    onFrame?.(canvas,active ? r : null,displacement);
    // No permanent render loop for a still or disconnected panel.
    return !frozen && Boolean(active || energy || flow);
  }
  function cancel() { cancelAnimationFrame(frame); frame=0; clearTimeout(wake); wake=0; }
  function visible() { return ready && !disposed && inView && !document.hidden; }
  function draw(ms) {
    frame=0;
    if (!visible()) return;
    if (ms-previousFrame<1000/30) {frame=requestAnimationFrame(draw);return;}
    previousFrame=ms;
    const now=Date.now(), animate=render(now);
    if (animate) {frame=requestAnimationFrame(draw);return;}
    if (record.reaction && timestamp!=null) {
      const edge=now<timestamp?timestamp:timestamp+record.reaction.durationMs;
      if (edge>now) wake=setTimeout(refresh, Math.min(edge-now+1,2147483647));
    }
  }
  function refresh() {
    cancel(); previousFrame=-Infinity;
    if (visible()) draw(performance.now());
  }
  const observer = new IntersectionObserver(entries=>{
    inView=entries[entries.length-1].isIntersecting; refresh();
  });
  observer.observe(container);
  document.addEventListener('visibilitychange',refresh);
  reduced.addEventListener('change',refresh);
  image.onload=()=>{
    if (disposed) return;
    texture.getContext('2d').drawImage(image,0,0,size,size);
    prepareMaterial();
    for (const [name,r] of Object.entries(regions)) parts.set(name,preparePart(r));
    ready=true;refresh();
  };
  image.src=textureURL;
  return {
    update(status,origin,sessionId) {
      if (record===status && timestamp===origin?.at && sequence===origin?.seq && session===sessionId) return;
      record=origin && status ? status : {};
      timestamp=Number.isFinite(origin?.at)?origin.at:null;
      sequence=origin?.seq;session=sessionId;
      refresh();
    },
    destroy() {
      disposed=true;cancel();observer.disconnect();image.onload=null;
      warp?.dispose();
      reduced.removeEventListener('change',refresh);
      document.removeEventListener('visibilitychange',refresh);
      container.replaceChildren();parts.clear();
    }
  };
}
