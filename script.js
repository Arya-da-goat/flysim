(() => {
'use strict';

const RAW = 'https://cdn.jsdelivr.net/gh/snedea/flybrain@main/';
const META_URL = RAW + 'data/neuron_meta.json';
const BIN_URL = RAW + 'data/connectome.bin.gz';
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtTime = n => { const s=Math.floor(n); return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); };

let renderer, scene, camera, habitat, fly, wingL, wingR, flyGlow, keyLight, lightMarker;
let foods=[], threats=[], worker=null, meta=null, groupIndices=[], groupSignals=new Float32Array(63), groupCounts=new Float32Array(63);
let brainReady=false, paused=false, elapsed=0, lastStim=0, lastLog=0, touchUntil=0, lastTickFired=0;
let theta=.72, phi=1.05, radius=13, dragging=false, lastX=0, lastY=0;
const state={x:-1.2,z:1.0,y:1.8,heading:0,energy:82,food:0,age:0,light:.82,danger:.42,behavior:'INITIALIZING BRAIN',foodSignal:0,dangerSignal:0,lightSignal:0,centralSignal:0,motorSignal:0};
const materials={};

function setLoading(text,pct){$('loadText').textContent=text;if(pct!==undefined)$('loadBar').style.width=pct+'%';}
function log(message){const el=document.createElement('div');el.className='log-entry';const time=document.createElement('time');time.textContent=fmtTime(state.age);const span=document.createElement('span');span.textContent=message;el.append(time,span);$('log').prepend(el);while($('log').children.length>8)$('log').lastChild.remove();}
function setBrainStatus(text,ready=false){$('brainStatus').textContent=text;$('sourceStatus').textContent=ready?'FLYWIRE CONNECTOME ACTIVE':'CONNECTOME LOADING';$('statusDot').style.background=ready?'#83f2c0':'#ffb36f';document.querySelector('.brain-status').classList.toggle('ready',ready);}

function init3D(){
  const host=$('scene');scene=new THREE.Scene();scene.background=new THREE.Color(0x090e1b);scene.fog=new THREE.FogExp2(0x090e1b,.035);
  camera=new THREE.PerspectiveCamera(48,1,.1,100);renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0x9db9ff,0x111526,1.45));
  keyLight=new THREE.PointLight(0xffe2a0,70,30,2);keyLight.position.set(4,7,-3);scene.add(keyLight);
  const fill=new THREE.PointLight(0x4c7eff,22,25,2);fill.position.set(-5,3,4);scene.add(fill);
  habitat=new THREE.Group();scene.add(habitat);
  const floor=new THREE.Mesh(new THREE.CylinderGeometry(7,7,.25,64),new THREE.MeshStandardMaterial({color:0x10182a,roughness:.72,metalness:.2}));floor.position.y=-.45;habitat.add(floor);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(6.95,.025,8,100),new THREE.MeshBasicMaterial({color:0x4e6d9d,transparent:true,opacity:.5}));ring.rotation.x=Math.PI/2;ring.position.y=-.3;habitat.add(ring);
  const grid=new THREE.GridHelper(14,28,0x355078,0x1b2945);grid.position.y=-.3;habitat.add(grid);
  const shell=new THREE.Mesh(new THREE.SphereGeometry(7.2,32,24),new THREE.MeshBasicMaterial({color:0x4a7cb4,wireframe:true,transparent:true,opacity:.045}));shell.position.y=2.3;habitat.add(shell);
  const dustGeo=new THREE.BufferGeometry(),count=350,pos=new Float32Array(count*3);for(let i=0;i<count;i++){pos[i*3]=(Math.random()-.5)*13;pos[i*3+1]=Math.random()*6;pos[i*3+2]=(Math.random()-.5)*13;}dustGeo.setAttribute('position',new THREE.BufferAttribute(pos,3));const dust=new THREE.Points(dustGeo,new THREE.PointsMaterial({color:0x789bd0,size:.025,transparent:true,opacity:.58}));dust.name='dust';habitat.add(dust);
  fly=makeFly();habitat.add(fly);
  lightMarker=new THREE.Group();lightMarker.position.set(4.5,5.4,-3.5);habitat.add(lightMarker);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.23,20,16),new THREE.MeshBasicMaterial({color:0xffe7a3}));lightMarker.add(bulb);
  const bulbGlow=new THREE.PointLight(0xffe7a3,2.8,5);lightMarker.add(bulbGlow);
  const halo=new THREE.Mesh(new THREE.TorusGeometry(.42,.012,6,48),new THREE.MeshBasicMaterial({color:0xffe7a3,transparent:true,opacity:.8}));lightMarker.add(halo);
  for(let i=0;i<7;i++){const a=Math.random()*Math.PI*2,r=2+Math.random()*3.5;addFood(Math.cos(a)*r,Math.sin(a)*r);}
  addThreat(3.6,-1.5);addThreat(-3.5,2.7);
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/Math.max(1,h);camera.updateProjectionMatrix();};window.addEventListener('resize',resize);resize();updateCamera();
  renderer.domElement.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener('pointermove',e=>{if(!dragging)return;theta-=(e.clientX-lastX)*.008;phi=clamp(phi+(e.clientY-lastY)*.006,.2,1.45);lastX=e.clientX;lastY=e.clientY;updateCamera();});
  renderer.domElement.addEventListener('pointerup',e=>{if(dragging&&Math.hypot(e.clientX-lastX,e.clientY-lastY)<5){const rect=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);if(ray.intersectObject(fly,true).length){touchUntil=performance.now()+1500;log('Touch stimulus sent to mechanosensory neurons.');$('touchRead').textContent='STIMULATED';}}dragging=false;});
  renderer.domElement.addEventListener('pointercancel',()=>dragging=false);
  renderer.domElement.addEventListener('wheel',e=>{radius=clamp(radius+e.deltaY*.012,8,20);updateCamera();},{passive:true});
}
function updateCamera(){if(!camera)return;camera.position.set(radius*Math.sin(phi)*Math.sin(theta),radius*Math.cos(phi)+1.2,radius*Math.sin(phi)*Math.cos(theta));camera.lookAt(0,1.8,0);}

function makeFly(){
  const g=new THREE.Group();
  const dark=new THREE.MeshStandardMaterial({color:0x382b3b,roughness:.4,metalness:.12}),body=new THREE.MeshStandardMaterial({color:0x5a3445,roughness:.38,metalness:.15}),abd=new THREE.MeshStandardMaterial({color:0x9a5260,roughness:.45,metalness:.08}),eyeMat=new THREE.MeshStandardMaterial({color:0xd84268,emissive:0x5b0d2a,emissiveIntensity:1.3,roughness:.2}),wingMat=new THREE.MeshPhysicalMaterial({color:0x9bdff2,transparent:true,opacity:.38,roughness:.22,side:THREE.DoubleSide});
  const head=new THREE.Mesh(new THREE.SphereGeometry(.23,24,18),dark);head.position.set(0,.05,.48);g.add(head);
  const thorax=new THREE.Mesh(new THREE.SphereGeometry(.3,24,18),body);thorax.scale.set(1,.9,1.12);g.add(thorax);
  const abdomen=new THREE.Mesh(new THREE.SphereGeometry(.28,24,18),abd);abd.scale.set(.78,.78,1.75);abd.position.set(0,-.02,-.49);g.add(abd);
  for(const side of [-1,1]){
    const eye=new THREE.Mesh(new THREE.SphereGeometry(.13,20,16),eyeMat);eye.position.set(side*.19,.11,.53);eye.scale.set(1,1.05,.85);g.add(eye);
    const wing=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),wingMat);wing.scale.set(.21,.045,.57);wing.position.set(side*.19,.27,-.02);wing.rotation.z=side*.22;wing.rotation.x=side*.17;wing.name=side<0?'wingL':'wingR';g.add(wing);if(side<0)wingL=wing;else wingR=wing;
    for(let j=0;j<3;j++){const z=.25-j*.28,x=side*.16;const l1=new THREE.Mesh(new THREE.CylinderGeometry(.018,.012,.32,6),dark);l1.position.set(x+side*.12,-.22,z);l1.rotation.z=side*.8;g.add(l1);const l2=new THREE.Mesh(new THREE.CylinderGeometry(.012,.009,.27,6),dark);l2.position.set(x+side*.24,-.36,z+.08);l2.rotation.z=-side*.45;g.add(l2);}
    const ant=new THREE.Mesh(new THREE.CylinderGeometry(.009,.014,.22,6),dark);ant.position.set(side*.07,.29,.62);ant.rotation.x=.45;ant.rotation.z=side*.24;g.add(ant);
  }
  flyGlow=new THREE.PointLight(0x65e5f2,1.5,2.4);flyGlow.position.set(0,.15,0);g.add(flyGlow);
  const aura=new THREE.Mesh(new THREE.SphereGeometry(.65,24,16),new THREE.MeshBasicMaterial({color:0x65e5f2,wireframe:true,transparent:true,opacity:.12}));aura.name='aura';aura.position.y=.05;g.add(aura);return g;
}
function addFood(x,z){const g=new THREE.Group();g.position.set(x,.15+Math.random()*.5,z);habitat.add(g);const core=new THREE.Mesh(new THREE.IcosahedronGeometry(.16,1),new THREE.MeshStandardMaterial({color:0x83f2c0,emissive:0x1c8e70,emissiveIntensity:1.5,roughness:.25}));g.add(core);const halo=new THREE.Mesh(new THREE.TorusGeometry(.28,.012,6,32),new THREE.MeshBasicMaterial({color:0x83f2c0,transparent:true,opacity:.8}));halo.rotation.x=Math.PI/2;g.add(halo);g.add(new THREE.PointLight(0x57ffbf,1.5,2.4));foods.push({group:g,alive:true,phase:Math.random()*6});}
function addThreat(x,z){const g=new THREE.Group();g.position.set(x,.2,z);habitat.add(g);g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(.28,1),new THREE.MeshStandardMaterial({color:0xff648b,emissive:0x9b173e,emissiveIntensity:1.6,roughness:.25})));const ring=new THREE.Mesh(new THREE.TorusGeometry(.58,.025,8,40),new THREE.MeshBasicMaterial({color:0xff648b,transparent:true,opacity:.75}));ring.rotation.x=Math.PI/2;g.add(ring);const zone=new THREE.Mesh(new THREE.CircleGeometry(1.05,40),new THREE.MeshBasicMaterial({color:0xff416b,transparent:true,opacity:.07,side:THREE.DoubleSide}));zone.rotation.x=-Math.PI/2;zone.position.y=-.12;g.add(zone);g.add(new THREE.PointLight(0xff315f,2,3));threats.push({group:g,phase:Math.random()*6});}
function nearest(list){let best=null,dist=Infinity;for(const v of list){if(v.alive===false)continue;const d=Math.hypot(v.group.position.x-state.x,v.group.position.z-state.z);if(d<dist){dist=d;best=v;}}return{item:best,dist};}

// Real FlyBrain simulation boot: actual FlyWire connectome binary + original LIF worker.
async function initBrain(){
  setBrainStatus('FETCHING CONNECTOME');
  try{
    setLoading('Downloading neuron metadata…',8);
    const mr=await fetch(META_URL);if(!mr.ok)throw new Error('Metadata download failed: '+mr.status);meta=await mr.json();
    $('neuronCount').textContent=Number(meta.neuron_count).toLocaleString();$('edgeCount').textContent=(meta.edge_count/1e6).toFixed(2)+'M';
    setLoading('Downloading original connectome (~12 MB)…',14);
    const response=await fetch(BIN_URL);if(!response.ok)throw new Error('Connectome download failed: '+response.status);
    const total=Number(response.headers.get('content-length'))||0;let buffer;
    if(response.body&&response.body.getReader){const reader=response.body.getReader(),chunks=[];let loaded=0;while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);loaded+=value.byteLength;setLoading('Downloading original connectome… '+(loaded/1048576).toFixed(1)+' MB',14+(total?Math.min(64,loaded/total*64):0));}const all=new Uint8Array(loaded);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}buffer=all.buffer;}else buffer=await response.arrayBuffer();
    setLoading('Starting original leaky integrate-and-fire worker…',82);
    worker=new Worker('./js/brain-worker-loader.js');
    worker.onerror=e=>{console.error(e);setBrainStatus('WORKER ERROR');log('Brain worker error. Check network access and try refreshing.');};
    worker.onmessage=onBrainMessage;
    worker.postMessage({type:'init',buffer},[buffer]);
  }catch(err){console.error(err);setBrainStatus('CONNECTOME LOAD FAILED');setLoading('Could not load the original brain data. Check your internet connection and reload.',100);$('loadText').textContent='Load failed: '+err.message;log('Connectome loading failed: '+err.message);$('sourceStatus').textContent='LOAD FAILED';}
}
function onBrainMessage(e){
  const d=e.data;
  if(d.type==='ready'){
    groupIndices=Array.from({length:meta.group_count},()=>[]);
    const ids=d.groupId instanceof Uint16Array?d.groupId:new Uint16Array(d.groupId);
    for(let i=0;i<ids.length;i++)if(groupIndices[ids[i]])groupIndices[ids[i]].push(i);
    // Keep a bounded sample of neurons per sensory/central group for input stimulation.
    groupIndices=groupIndices.map(arr=>{if(arr.length<=120)return arr;const result=[];for(let i=0;i<120;i++)result.push(arr[Math.floor(i*arr.length/120)]);return result;});
    brainReady=true;setBrainStatus('ORIGINAL BRAIN ACTIVE',true);setLoading('Connectome ready — entering habitat…',100);log('Original FlyWire connectome loaded in the LIF worker.');log('Sensory input channels connected.');worker.postMessage({type:'start'});setTimeout(()=>{$('loading').classList.add('done');setTimeout(()=>$('loading').remove(),650);},350);
  }else if(d.type==='tick'){
    const counts=d.groupSpikeCounts?new Float32Array(d.groupSpikeCounts):new Float32Array(meta.group_count);
    for(let i=0;i<groupSignals.length;i++){const size=Math.max(1,meta.group_sizes[i]||1);const raw=counts[i]||0;const norm=clamp(raw/Math.max(2,Math.sqrt(size)*.65),0,1);groupSignals[i]=groupSignals[i]*.58+norm*.42;groupCounts[i]=raw;}
    lastTickFired=d.firedNeurons||0;
  }else if(d.type==='stats'){
    if(d.firedNeurons!==undefined)lastTickFired=d.firedNeurons;
  }else if(d.type==='error'){console.error(d.message);setBrainStatus('BRAIN ERROR');log('Worker reported: '+d.message);}
}
function sendStimuli(now){
  if(!brainReady||now-lastStim<220)return;lastStim=now;
  const channels=[];
  function add(groupId,intensity){if(intensity<=.005||!groupIndices[groupId])return;for(const idx of groupIndices[groupId])channels.push([idx,intensity]);}
  // Mild tonic activity in navigation/central groups; sensory inputs are still driven by the actual environment.
  add(25,.15);add(26,.15);add(27,.15);
  add(0,.15*state.light);add(2,.12*state.light);add(5,.12*state.light);
  const f=nearest(foods),d=nearest(threats);
  const foodOdor=f.item?clamp((6-f.dist)/6,0,1):0;
  const dangerOdor=d.item?clamp((4.8-d.dist)/4.8,0,1)*state.danger:0;
  add(6,.15*foodOdor);add(7,.15*dangerOdor);
  if(now<touchUntil){add(10,.3);add(11,.22);}
  // Taste signal is delivered when the fly is close enough to eat.
  if(f.item&&f.dist<.62)add(32,.22);
  add(14,.12*Math.max(0,(.5-state.light)));add(15,.12*Math.max(0,(state.light-.7)));
  const indices=new Uint32Array(channels.length),intensities=new Float32Array(channels.length);
  for(let i=0;i<channels.length;i++){indices[i]=channels[i][0];intensities[i]=channels[i][1];}
  worker.postMessage({type:'setStimulusState',indices,intensities});
}

function updateMovement(dt,t){
  const f=nearest(foods),d=nearest(threats);
  const odor=f.item?clamp((6-f.dist)/6,0,1):0;
  const danger=d.item?clamp((4.8-d.dist)/4.8,0,1)*state.danger:0;
  const vision=clamp(groupSignals[0]*.55+groupSignals[2]*.25+groupSignals[5]*.5,0,1);
  const foodBrain=clamp(groupSignals[6]*.42+groupSignals[23]*.45+groupSignals[19]*.28+groupSignals[29]*.25,0,1);
  const dangerBrain=clamp(groupSignals[7]*.5+groupSignals[21]*.25+groupSignals[35]*.2,0,1);
  const central=clamp(groupSignals[25]*.35+groupSignals[26]*.3+groupSignals[27]*.35,0,1);
  const motor=clamp(groupSignals[35]*.55+groupSignals[47]*.2+groupSignals[57]*.25,0,1);
  state.foodSignal=foodBrain;state.dangerSignal=dangerBrain;state.lightSignal=vision;state.centralSignal=central;state.motorSignal=motor;

  let target=state.heading;
  // A readout maps available neural activity to a body motor command. Since this
  // connectome subset has incomplete VNC motor groups, the final motor mapping is virtual.
  const turnNoise=(Math.sin(t*.73)+Math.cos(t*.39)*.7)*(0.12+central*.25);
  target+=turnNoise+(groupSignals[28]-.08)*dt*1.8;
  const foodDrive=clamp(foodBrain*.72+odor*.2,0,1);
  const escapeDrive=clamp(dangerBrain*.62+danger*.25,0,1);
  const lightDrive=clamp(vision*.6+state.light*.12,0,1);
  if(f.item&&foodDrive>.08){const desired=Math.atan2(f.item.group.position.x-state.x,f.item.group.position.z-state.z);const diff=Math.atan2(Math.sin(desired-target),Math.cos(desired-target));target+=diff*foodDrive*.65;}
  if(d.item&&escapeDrive>.06){const away=Math.atan2(state.x-d.item.group.position.x,state.z-d.item.group.position.z);const diff=Math.atan2(Math.sin(away-target),Math.cos(away-target));target+=diff*escapeDrive*.85;}
  const lx=lightMarker.position.x-state.x,lz=lightMarker.position.z-state.z;
  if(lightDrive>.12){const desired=Math.atan2(lx,lz),diff=Math.atan2(Math.sin(desired-target),Math.cos(desired-target));target+=diff*lightDrive*.14;}
  const diff=Math.atan2(Math.sin(target-state.heading),Math.cos(target-state.heading));state.heading+=clamp(diff,-dt*(.8+central*1.8),dt*(.8+central*1.8));
  const speed=.35+central*.38+motor*.28+foodDrive*.22+escapeDrive*.2;
  state.x+=Math.sin(state.heading)*speed*dt;state.z+=Math.cos(state.heading)*speed*dt;
  const r=Math.hypot(state.x,state.z);if(r>5.8){const desired=Math.atan2(-state.x,-state.z),a=Math.atan2(Math.sin(desired-state.heading),Math.cos(desired-state.heading));state.heading+=a*.12;state.x*=5.8/r;state.z*=5.8/r;}
  state.y=1.65+Math.sin(t*3.2)*.18+Math.sin(t*1.17)*.1;
  state.energy=clamp(state.energy-(.08+speed*.035)*dt,0,100);
  if(f.item&&f.dist<.48){habitat.remove(f.item.group);f.item.alive=false;state.food++;state.energy=clamp(state.energy+24,0,100);log('Food collected; sweet-taste sensory input delivered.');}
  if(state.energy<1){state.energy=20;log('Energy low — virtual recovery mode.');}
  state.behavior=escapeDrive>.2?'THREAT RESPONSE':foodDrive>.18?'FOOD ODOR RESPONSE':lightDrive>.35?'PHOTORECEPTOR ACTIVE':'EXPLORING';
}

function updateUI(){
  $('energyVal').textContent=Math.round(state.energy)+'%';$('energyBar').style.width=state.energy+'%';$('ageVal').textContent=fmtTime(state.age);$('foodVal').textContent=state.food;$('firingVal').textContent=Number(lastTickFired).toLocaleString();
  $('lightRead').textContent=groupSignals[0].toFixed(2);$('foodRead').textContent=groupSignals[6].toFixed(2);$('dangerRead').textContent=groupSignals[7].toFixed(2);$('touchRead').textContent=performance.now()<touchUntil?'STIMULATED':'READY';
  $('lightLabel').textContent=Math.round(state.light*100)+'%';$('threatLabel').textContent=Math.round(state.danger*100)+'%';$('behaviorText').textContent=state.behavior;$('coordText').textContent=`X ${state.x.toFixed(1)} · Y ${state.y.toFixed(1)} · Z ${state.z.toFixed(1)}`;
  const signals=[groupSignals[0]*.6+groupSignals[2]*.4,groupSignals[6],groupSignals[7],groupSignals[25]*.35+groupSignals[26]*.3+groupSignals[27]*.35,groupSignals[35]*.65+groupSignals[47]*.35];
  const ids=['vision','olfFood','olfDanger','central','motor'];ids.forEach((id,i)=>{$(id+'Signal').style.width=clamp(signals[i]*100,0,100)+'%';$(id+'Val').textContent=Math.round(clamp(signals[i]*100,0,100));});
  const total=clamp((lastTickFired/Math.max(1,meta?.neuron_count||139255))*100*30,0,100);$('neuralPercent').textContent=brainReady?Math.round(total)+'%':'LOADING';$('neuralBar').style.width=total+'%';
}
$('lightSlider').addEventListener('input',e=>{state.light=+e.target.value/100;keyLight.intensity=state.light*82;lightMarker.scale.setScalar(.75+state.light*.5);});
$('threatSlider').addEventListener('input',e=>state.danger=+e.target.value/100);
$('foodBtn').onclick=()=>{const a=Math.random()*Math.PI*2,r=2+Math.random()*3.2;addFood(Math.cos(a)*r,Math.sin(a)*r);log('Food source added; odor receptor input will depend on distance.');};
$('threatBtn').onclick=()=>{const a=Math.random()*Math.PI*2,r=2.5+Math.random()*2.5;addThreat(Math.cos(a)*r,Math.sin(a)*r);log('Threat source added; danger-odor stimulation enabled.');};
$('touchBtn').onclick=()=>{touchUntil=performance.now()+1500;log('Touch stimulus sent to MECH_BRISTLE / MECH_JO groups.');};
$('clearLog').onclick=()=>{$('log').replaceChildren();log('Event log cleared.');};
$('pauseBtn').onclick=()=>{paused=!paused;$('pauseBtn').innerHTML=paused?'▶ <span>Resume</span>':'Ⅱ <span>Pause</span>';if(paused)log('3D habitat paused. Neural worker remains active so connectome activity is preserved.');else log('Habitat resumed.');};
$('resetBtn').onclick=()=>{state.x=-1.2;state.z=1;state.y=1.8;state.heading=0;state.energy=82;state.food=0;state.age=0;foods.splice(0).forEach(f=>habitat.remove(f.group));threats.splice(0).forEach(d=>habitat.remove(d.group));for(let i=0;i<7;i++){const a=Math.random()*Math.PI*2,r=2+Math.random()*3.5;addFood(Math.cos(a)*r,Math.sin(a)*r);}addThreat(3.6,-1.5);addThreat(-3.5,2.7);if(worker&&brainReady)worker.postMessage({type:'reset'});groupSignals.fill(0);log('Habitat reset; connectome worker reset.');};
$('cameraBtn').onclick=()=>{theta=.72;phi=1.05;radius=13;updateCamera();};

const neuralCanvas=$('neuralCanvas'),ctx=neuralCanvas.getContext('2d');let nodes=[];
function resizeNeural(){const r=neuralCanvas.getBoundingClientRect();neuralCanvas.width=Math.max(1,Math.floor(r.width*devicePixelRatio));neuralCanvas.height=Math.max(1,Math.floor(r.height*devicePixelRatio));ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);nodes=Array.from({length:36},()=>({x:Math.random()*r.width,y:Math.random()*r.height,p:Math.random()*6}));}
function drawNeural(t){const w=neuralCanvas.clientWidth,h=neuralCanvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],d=Math.hypot(a.x-b.x,a.y-b.y);if(d<45){ctx.strokeStyle=`rgba(101,229,242,${.05+groupSignals[(i+j)%groupSignals.length]*.22})`;ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}}nodes.forEach((n,i)=>{const p=(Math.sin(t*3+n.p)+1)/2,s=groupSignals[i%groupSignals.length];ctx.beginPath();ctx.arc(n.x,n.y,1+p*2,0,Math.PI*2);ctx.fillStyle=s>.12?`rgba(101,229,242,${.3+p*.6})`:`rgba(155,140,255,${.2+p*.4})`;ctx.fill();});}
resizeNeural();window.addEventListener('resize',resizeNeural);

let prev=performance.now(),t=0;
function animate(now){
  requestAnimationFrame(animate);const dt=Math.min(.05,(now-prev)/1000||0);prev=now;t+=dt;
  if(!paused){elapsed+=dt;state.age+=dt;if(brainReady){sendStimuli(now);updateMovement(dt,t);}foods.forEach(f=>{f.group.rotation.y+=dt*.55;f.group.position.y+=Math.sin(t*1.8+f.phase)*dt*.08;});threats.forEach(d=>{d.group.rotation.y+=dt*.7;d.group.position.y=.2+Math.sin(t*2+d.phase)*.12;});}
  if(fly){fly.position.set(state.x,state.y,state.z);fly.rotation.y=state.heading;fly.rotation.z=Math.sin(t*5)*.06;fly.rotation.x=Math.sin(t*2.4)*.04;if(wingL){wingL.rotation.z=-.22+Math.sin(t*32)*.6;wingL.rotation.x=Math.sin(t*32)*.22;}if(wingR){wingR.rotation.z=.22-Math.sin(t*32)*.6;wingR.rotation.x=-Math.sin(t*32)*.22;}const aura=fly.getObjectByName('aura');if(aura)aura.scale.setScalar(1+Math.sin(t*3)*.04);if(flyGlow)flyGlow.intensity=1+state.foodSignal*2+state.dangerSignal;}
  if(habitat){const dust=habitat.getObjectByName('dust');if(dust)dust.rotation.y=t*.008;}
  drawNeural(t);updateUI();if(renderer&&scene&&camera)renderer.render(scene,camera);
}
init3D();
requestAnimationFrame(animate);
initBrain();
})();