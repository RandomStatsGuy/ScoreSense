/* Native SVG scene study. No product preferences or network writes. */
const root = document.documentElement;
const option = document.body.dataset.option || 'a';
const themes = [
  ['none','Classic','#162133,#18734e'],
  ['cozy','Cozy den','#563859,#c7815f'],
  ['snow','Snowfall','#294579,#57b8d1'],
  ['leaves','Autumn','#633147,#ce854c'],
  ['footballs','Footballs','#333f32,#9b6c45'],
];
const state = { theme:'cozy', mode:'dark', falling:true, companions:true, reactions:true };
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const systemDark = matchMedia('(prefers-color-scheme: dark)');
let settleTimer;
let sceneConfig = [];
let drag = null;
const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
const svg = (content,attrs='') => `<svg viewBox="0 0 420 270" aria-hidden="true" ${attrs}>${content}</svg>`;
const stroke = 'stroke="#66515c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const eyes = (x,y) => `<g class="companion-pupil"><ellipse cx="${x-11}" cy="${y}" rx="3" ry="4" fill="#4a4038"/><ellipse cx="${x+11}" cy="${y}" rx="3" ry="4" fill="#4a4038"/><circle cx="${x-10}" cy="${y-1}" r="1" fill="#fff"/><circle cx="${x+12}" cy="${y-1}" r="1" fill="#fff"/></g>`;
const cheek = (x,y) => `<ellipse cx="${x-20}" cy="${y}" rx="6" ry="3" fill="#eaa5ac" opacity=".6"/><ellipse cx="${x+20}" cy="${y}" rx="6" ry="3" fill="#eaa5ac" opacity=".6"/>`;
const ball = (x,y,size=1) => `<g transform="translate(${x} ${y}) scale(${size})"><ellipse rx="22" ry="14" fill="#b9794f" stroke="#714935" stroke-width="1.8"/><path d="M-14-11Q-6 0-14 11M14-11Q6 0 14 11" stroke="#f9e8d4" stroke-width="3" fill="none"/><path d="M-7 0H7M-4-4V4M0-4V4M4-4V4" stroke="#fff4dc" stroke-width="1.7" stroke-linecap="round"/></g>`;
const yarn = (x,y,size=1,color='#c98dab') => `<g transform="translate(${x} ${y}) scale(${size})"><circle r="15" fill="${color}" stroke="#855c7b" stroke-width="1.4"/><path d="M-12-7Q-4 5 12 7M-13 0Q-4 11 7 13M-9-12Q1-3 14 0M-3-14Q-12 2-4 14M6-13Q-3 3 2 14M12-8Q4 3 9 11" fill="none" stroke="#f5d4e2" stroke-width="1.3"/><path d="M12 10Q26 16 25 5" fill="none" stroke="${color}" stroke-width="2.5"/></g>`;
const acorn = (x,y,size=1) => `<g transform="translate(${x} ${y}) scale(${size})"><path d="M-12-4Q-12 15 0 19Q12 15 12-4Z" fill="#d4a575" stroke="#876243" stroke-width="1.5"/><path d="M-15-4Q-13-17 0-16Q13-17 15-4Z" fill="#906650" stroke="#654937" stroke-width="1.5"/><path d="M1-16Q-2-24 4-24" fill="none" stroke="#654937" stroke-width="3" stroke-linecap="round"/><path d="M-9-9L-4-5M-2-12L3-8M7-10L11-6" stroke="#b08b67" stroke-width="1.5"/></g>`;
const leaf = (x,y,scale=1,color='#d68a59') => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0-20L5-9L16-15L12-4L23 0L11 7L12 18L2 12L0 25L-2 12L-12 18L-11 7L-23 0L-12-4L-16-15L-5-9Z" fill="${color}"/><path d="M0 24V-14M0 6L12 0M0 0L-10-6" fill="none" stroke="#91573f" stroke-width="1.5"/></g>`;
const mouse = (x,y,size=1) => `<g transform="translate(${x} ${y}) scale(${size})"><path d="M-9 6Q-21 10-17-3" fill="none" stroke="#b786ac" stroke-width="2"/><ellipse rx="12" ry="8" fill="#d8b8d0" stroke="#896a84" stroke-width="1.2"/><ellipse cx="3" cy="-7" rx="5" ry="5" fill="#e6cbdc" stroke="#896a84" stroke-width="1.2"/><circle cx="8" cy="-1" r="1.5" fill="#66515c"/><circle cx="13" cy="2" r="2" fill="#c890a2"/></g>`;
const cat = (id,x,y,mirror=false) => `<g data-buddy="${id}" transform="translate(${x} ${y}) scale(${mirror?'-.85':'.85'} .85)">
  <path d="M28 92C6 92 2 74 14 66C20 62 28 64 30 72" fill="none" stroke="#9d8194" stroke-width="13" stroke-linecap="round"/>
  <path d="M24 101C16 74 34 52 66 50L118 52C140 54 152 68 150 82C148 94 138 102 122 102L44 102C34 102 27 102 24 101Z" fill="#efe6d8" ${stroke}/>
  <path d="M34 99C28 78 40 60 62 55C48 66 42 82 44 101Z" fill="#aa91a3" opacity=".35"/>
  <g class="companion-head"><path d="M104 38L110 16L124 32ZM136 32L152 20L152 42Z" fill="#9d8194" ${stroke}/><path d="M109 34L112 23L119 33ZM143 33L149 26L148 36Z" fill="#d9a3a3"/>
  <ellipse cx="128" cy="56" rx="30" ry="26" fill="#efe6d8" ${stroke}/><path d="M100 48C104 34 152 34 156 48C158 42 154 30 146 28L110 28C102 30 98 42 100 48Z" fill="#9d8194"/>
  <g class="sleep-eyes"><path d="M112 56Q117 60 122 56M134 56Q139 60 144 56" fill="none" stroke="#4a4038" stroke-width="2.6" stroke-linecap="round"/></g>
  <g class="awake-eyes" style="display:none"><ellipse cx="117" cy="56" rx="6" ry="6.5" fill="#eef6ff"/><ellipse cx="139" cy="56" rx="6" ry="6.5" fill="#eef6ff"/><g class="companion-pupil"><circle cx="117" cy="56.5" r="3.4" fill="#3c6ea5"/><circle cx="139" cy="56.5" r="3.4" fill="#3c6ea5"/><circle cx="118.2" cy="55.2" r="1.1" fill="#fff"/><circle cx="140.2" cy="55.2" r="1.1" fill="#fff"/></g></g>
  <path d="M124 64L128 60L132 64L128 67Z" fill="#d98d8d"/><path d="M128 67Q128 72 122 73M128 67Q128 72 134 73M108 62L88 58M108 68L88 70M147 62L166 58M147 68L166 70" fill="none" stroke="#66515c" stroke-width="1.2" stroke-linecap="round"/>
  </g><path d="M96 102Q98 92 108 92Q118 92 119 102Z" fill="#d9c9c6" ${stroke}/><path class="companion-paw" d="M120 102Q121 90 132 89Q143 89 144 102Z" fill="#d9c9c6" ${stroke}/><path d="M131 98V101M137 98V101" stroke="#a48a94" stroke-width="1"/>
</g>`;
const cushion = (x,y,w) => `<rect x="${x}" y="${y}" width="${w}" height="15" rx="7" fill="#b591aa" ${stroke}/><path d="M${x+8} ${y+7}H${x+w-8}" stroke="#e3cbd6" stroke-width="1.3"/>`;
const ground = (color='#b48b78') => `<ellipse class="scene-ground" cx="210" cy="250" rx="202" ry="15" fill="${color}" opacity=".4"/>`;
const tree = (x) => `<rect x="${x+69}" y="211" width="25" height="39" rx="4" fill="#c8a585" ${stroke}/><path d="M${x+72} 218H${x+91}M${x+72} 224H${x+91}M${x+72} 230H${x+91}M${x+72} 236H${x+91}" stroke="#997662" stroke-width="1.5"/><rect x="${x+43}" y="245" width="76" height="12" rx="6" fill="#b48b78" ${stroke}/>${cushion(x,200,175)}`;
const toy = (id,x,y,kind,anchor=null) => `${anchor?`<path id="cord-${id}" d="M${anchor.x} ${anchor.y}L${x} ${y}" fill="none" stroke="#aa839c" stroke-width="2"/>`:''}<g id="toy-${id}" transform="translate(${x} ${y})">${kind==='yarn'?yarn(0,0,.68):kind==='mouse'?mouse(0,0,.9):kind==='snowball'?'<circle r="16" fill="#f5fbff" stroke="#b9d6e5" stroke-width="1.5"/><path d="M-8 3Q-3 10 8 5" stroke="#d3e8f2" stroke-width="2" fill="none"/>':kind==='acorn'?acorn(0,0,.75):ball(0,0,.85)}</g>`;
function cozyScene() {
  const shared = option==='b';
  sceneConfig = shared ? [{id:'left',x:204,y:166,kind:'mouse',anchor:{x:210,y:106},buddy:'left'},{id:'right',x:238,y:169,kind:'yarn',anchor:{x:232,y:107},buddy:'right'}] : [{id:'left',x:171,y:181,kind:'yarn',anchor:{x:165,y:143},buddy:'left'},{id:'right',x:249,y:181,kind:'mouse',anchor:{x:255,y:143},buddy:'right'}];
  return ground()+ (shared ? `<rect x="63" y="226" width="20" height="29" rx="5" fill="#b48b78" ${stroke}/><rect x="336" y="226" width="20" height="29" rx="5" fill="#b48b78" ${stroke}/><rect x="42" y="207" width="335" height="22" rx="8" fill="#c4a184" ${stroke}/>${cushion(40,194,340)}<path d="M211 195V105Q222 98 232 107" stroke="#a58272" stroke-width="5" fill="none"/>${cat('left',50,108)}${cat('right',370,108,true)}` : `${tree(5)}${tree(240)}<path d="M165 201V143M255 201V143" stroke="#a58272" stroke-width="5"/>${cat('left',13,114)}${cat('right',407,114,true)}`) + yarn(205,246,.65,'#dfb181')+ mouse(306,250,.75)+sceneConfig.map(c=>toy(c.id,c.x,c.y,c.kind,c.anchor)).join('');
}
const snowman = (id,x,y,s=1,hat='#496c93') => `<g data-buddy="${id}" transform="translate(${x} ${y}) scale(${s})"><path d="M-35 25L-62 9M-54 14L-56 4M35 25L62 9" fill="none" stroke="#9a735d" stroke-width="4" stroke-linecap="round"/><g class="companion-arm"><path d="M59 13L68 4" stroke="#9a735d" stroke-width="4" stroke-linecap="round"/><path d="M64 2Q72-4 78 2L77 13Q72 18 66 12Z" fill="#d28dab" ${stroke}/></g><ellipse cy="39" rx="46" ry="48" fill="#eaf5fc" stroke="#b5d5e5" stroke-width="2"/><ellipse cx="-9" cy="35" rx="22" ry="31" fill="#fff" opacity=".35"/><circle cy="31" r="3.2" fill="#64829b"/><circle cy="47" r="3.2" fill="#64829b"/><circle cy="63" r="3.2" fill="#64829b"/><g class="companion-head"><circle cy="-22" r="34" fill="#f5fbff" stroke="#b5d5e5" stroke-width="2"/><path d="M-24-48Q-16-87 7-73Q27-66 28-45Z" fill="${hat}" ${stroke}/><path d="M-30-45Q0-35 32-45" stroke="#a8cad9" stroke-width="9" stroke-linecap="round"/><circle cx="1" cy="-78" r="10" fill="#ecedf5"/>${eyes(0,-21)}${cheek(0,-11)}<path d="M0-15L21-11L0-6Z" fill="#eaa16c" stroke="#bd8056" stroke-width="1"/><path d="M-9-1Q0 7 10-1" fill="none" ${stroke}/></g><path d="M-30 5Q0 18 33 5" stroke="#d28dab" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M16 9L16 35L29 37L31 8" fill="#d28dab" ${stroke}/><path d="M18 25H28M18 31H28" stroke="#f1becf" stroke-width="2"/></g>`;
function snowScene() {
  sceneConfig=[{id:'snow',x:265,y:231,kind:'snowball',buddy:'snow'}];
  return `<path d="M4 247Q70 219 146 245Q251 221 417 246V267H4Z" fill="#cce3f1"/><path d="M0 253Q91 231 170 253Q311 232 420 251V270H0Z" fill="#eaf5fc"/>${snowman('snow',option==='a'?135:154,156,1)}${option==='b'?snowman('snow-small',306,187,.7,'#9480a4'):''}<path d="M58 247Q82 229 107 248" fill="#f5fbff"/><ellipse cx="266" cy="248" rx="23" ry="4" fill="#a3cadf" opacity=".5"/>${toy('snow',265,231,'snowball')}`;
}
const stump = (x,y,w=90) => `<g transform="translate(${x} ${y})"><path d="M-${w/2} 0L-${w/2-5} 60Q0 72 ${w/2-5} 60L${w/2} 0" fill="#a67359" ${stroke}/><path d="M-28 10L-25 55M-8 15L-5 61M12 14L14 62M30 9L28 54" stroke="#86543f" stroke-width="3" stroke-linecap="round"/><ellipse rx="${w/2}" ry="13" fill="#d3ac81" ${stroke}/><ellipse rx="${w/3}" ry="8" fill="none" stroke="#b88f68" stroke-width="2"/></g>`;
const squirrel = () => `<g data-buddy="autumn" transform="translate(155 161)"><path d="M-30 39C-112 51-118-54-64-70C-34-76-18-50-32-27C-49-46-82-32-66-1C-55 14-37 11-28 5" fill="#bd8562" ${stroke}/><path d="M-38 30C-88 31-96-46-64-51" stroke="#e2b78e" stroke-width="12" fill="none" stroke-linecap="round"/><ellipse cy="26" rx="33" ry="42" fill="#c59269" ${stroke}/><ellipse cy="31" rx="22" ry="29" fill="#f4d5aa"/><g class="companion-head"><path d="M-28-22L-26-50Q-9-44-9-23M9-23Q9-45 26-49L28-21" fill="#c59269" ${stroke}/><path d="M-22-29L-21-41L-14-28M15-28L21-40L23-29" fill="#dcb3a6"/><ellipse cy="-10" rx="33" ry="29" fill="#c59269" ${stroke}/><path d="M-31-3Q0-11 31-3Q25 24 0 22Q-25 22-31-3" fill="#f4d5aa"/>${eyes(0,-11)}${cheek(0,1)}<path d="M-4-1Q0-5 4-1L0 4Z" fill="#66515c"/><path d="M0 4V8M-7 7Q0 14 7 7" fill="none" ${stroke}/></g><path class="companion-paw" d="M24 13Q44 22 30 32Q17 27 17 22" fill="#c59269" ${stroke}/><ellipse cx="-21" cy="61" rx="17" ry="8" fill="#bd8562" ${stroke}/><ellipse cx="20" cy="61" rx="17" ry="8" fill="#bd8562" ${stroke}/></g>`;
const fox = () => `<g data-buddy="autumn" transform="translate(183 167)"><path d="M-25 55Q-94 79-117 40Q-110 2-77 23Q-93 54-33 29" fill="#d99465" ${stroke}/><path d="M-116 40Q-112 11-89 21Q-87 37-102 51" fill="#f8e5c6"/><ellipse cy="29" rx="39" ry="43" fill="#d99465" ${stroke}/><ellipse cy="33" rx="23" ry="33" fill="#f8e5c6"/><g class="companion-head"><path d="M-39-12L-43-59L-8-34L8-34L43-59L39-12" fill="#d99465" ${stroke}/><path d="M-32-30L-35-47L-18-32M18-32L35-47L32-30" fill="#d1a09c"/><path d="M-41-18Q0-47 41-18Q39 16 0 25Q-39 16-41-18" fill="#d99465" ${stroke}/><path d="M-40-5Q-17-15 0 10Q17-15 40-5Q32 17 0 25Q-32 17-40-5" fill="#f8e5c6"/>${eyes(0,-15)}${cheek(0,1)}<path d="M-6 7Q0 3 6 7L0 13Z" fill="#66515c"/><path d="M-8 17Q0 23 8 17" fill="none" ${stroke}/></g><path class="companion-paw" d="M25 26Q45 21 44 34Q36 42 22 37" fill="#d99465" ${stroke}/><ellipse cx="-22" cy="67" rx="16" ry="7" fill="#8f6654"/><ellipse cx="21" cy="67" rx="16" ry="7" fill="#8f6654"/></g>`;
function autumnScene() {
  sceneConfig=[{id:'autumn',x:285,y:235,kind:'acorn',buddy:'autumn'}];
  return ground('#c59366')+(option==='a'?`${stump(154,224,92)}${squirrel()}`:`${stump(320,193,70)}${fox()}<ellipse cx="328" cy="178" rx="28" ry="25" fill="#dfa66b" ${stroke}/><path d="M322 156Q328 166 325 198M333 156Q338 166 335 198" fill="none" stroke="#bb8357" stroke-width="2"/><path d="M328 155V143" stroke="#80694e" stroke-width="5" stroke-linecap="round"/>`)+leaf(59,250,.5)+leaf(337,250,.65,'#d3a75f')+leaf(359,256,.4,'#b16f59')+toy('autumn',285,235,'acorn');
}
const helmet = () => `<path d="M-38-16Q-39-60 0-61Q40-60 38-16L28-15Q27-43 0-42Q-27-43-28-15Z" fill="#739a82" ${stroke}/><path d="M-7-59L-7-43M7-59L7-43" stroke="#e5ead6" stroke-width="5"/><path d="M-37-18H-26M26-18H37" stroke="#d1decb" stroke-width="7" stroke-linecap="round"/>`;
const footballBuddy = () => `<g data-buddy="football" transform="translate(138 167)"><path class="companion-arm" d="M35 16Q61 1 63 22Q62 35 49 35" fill="#c49676" ${stroke}/><path d="M-35 16Q-61 1-63 22Q-62 35-49 35" fill="#c49676" ${stroke}/><path d="M-24 62L-30 77M24 62L30 77" stroke="#ad8265" stroke-width="9" stroke-linecap="round"/><ellipse cx="-30" cy="77" rx="17" ry="8" fill="#f7e5c5" ${stroke}/><ellipse cx="30" cy="77" rx="17" ry="8" fill="#f7e5c5" ${stroke}/><path d="M0-51C-67-25-66 48 0 68C66 48 67-25 0-51Z" fill="#bd8662" ${stroke}/><path d="M-32-29Q-53 6-30 50M32-29Q53 6 30 50" stroke="#f6e4c7" stroke-width="5" fill="none"/><g class="companion-head">${helmet()}${eyes(0,-7)}${cheek(0,5)}<path d="M-7 13Q0 21 7 13" fill="none" ${stroke}/></g><path d="M0 28V49M-8 31H8M-8 38H8M-8 45H8" stroke="#f7e9d5" stroke-width="2.5" stroke-linecap="round"/></g>`;
const puppy = () => `<g data-buddy="football" transform="translate(176 174)"><path d="M31 43Q85 61 88 30" fill="none" stroke="#c39a70" stroke-width="13" stroke-linecap="round"/><ellipse cy="28" rx="39" ry="41" fill="#d7b082" ${stroke}/><ellipse cy="35" rx="24" ry="28" fill="#f6dec0"/><g class="companion-head"><ellipse cy="-13" rx="40" ry="35" fill="#d7b082" ${stroke}/><path d="M-29-38Q-55-36-49 1Q-34 15-24-9M29-38Q55-36 49 1Q34 15 24-9" fill="#b98b64" ${stroke}/>${helmet()}${eyes(0,-12)}<ellipse cy="6" rx="20" ry="15" fill="#f6dec0"/>${cheek(0,5)}<path d="M-7 1Q0-3 7 1Q7 8 0 9Q-7 8-7 1" fill="#66515c"/><path d="M0 9V14M-8 14Q0 20 8 14" fill="none" ${stroke}/><path d="M0 18Q2 32 10 27L10 18" fill="#dda1a6"/></g><path class="companion-paw" d="M26 29Q47 19 51 31Q44 43 25 43" fill="#d7b082" ${stroke}/><ellipse cx="-24" cy="65" rx="16" ry="8" fill="#f6dec0" ${stroke}/><ellipse cx="24" cy="65" rx="16" ry="8" fill="#f6dec0" ${stroke}/></g>`;
function footballScene() {
  sceneConfig=[{id:'football',x:290,y:234,kind:'football',buddy:'football'}];
  return `<path d="M4 247Q210 222 417 247V270H4Z" fill="#82997b" opacity=".75"/><path d="M57 255H363M82 249V263M336 249V263" stroke="#dbe1c6" stroke-width="2" opacity=".8"/>${option==='a'?footballBuddy():puppy()}<path d="M338 198V244M377 198V244" stroke="#a78469" stroke-width="6"/><rect x="326" y="193" width="64" height="12" rx="6" fill="#c7a784" ${stroke}/>${ball(359,180,.65)}${toy('football',290,234,'football')}`;
}
const sceneNames = option==='a' ? {cozy:'Cat-tree corners',snow:'Snowbank friend',leaves:'Acorn lookout',footballs:'Practice buddy'} : {cozy:'Cat-nap bench',snow:'Snowman family',leaves:'Little autumn den',footballs:'Sideline puppy'};
const instructions = {cozy:'Move a hanging toy to wake its cat.',snow:'Roll the snowball to get a mitten wave.',leaves:'Move the acorn to catch a curious eye.',footballs:'Move the practice ball for a little cheer.'};
const descriptions = {falling:['Falling decorations','Yarn & toys, snow, leaves, or footballs.'],companions:['Companions','Cute friends and their little habitats.'],reactions:['Playful reactions','Only when you move their toy.']};
document.getElementById('appearance-content').innerHTML = `
  <div><h2>Appearance</h2><p>Choose your colors and how much company to keep.</p></div>
  <fieldset><legend>Color mode</legend><div class="mode-options">${['system','light','dark'].map(m=>`<label class="mode-choice"><input type="radio" name="mode" value="${m}" ${m===state.mode?'checked':''}><span>${m[0].toUpperCase()+m.slice(1)}</span></label>`).join('')}</div></fieldset>
  <fieldset><legend>Theme</legend><div class="theme-options">${themes.map(([id,name,colors])=>`<label class="theme-choice"><input type="radio" name="theme" value="${id}" ${id===state.theme?'checked':''}><span><i class="swatch" style="--swatch:linear-gradient(105deg,${colors.replace(',',', ')} 65%)" aria-hidden="true"></i><strong>${name}</strong></span></label>`).join('')}</div></fieldset>
  <section class="scene-preview" aria-label="Appearance preview"><div class="scene-caption"><strong id="scene-title"></strong><span>Preview</span></div><div id="scene-stage" class="scene-stage"></div><div class="scene-hint"><p id="scene-instruction"></p></div></section>
  <fieldset><legend>Make it yours</legend><div class="switches">${Object.entries(descriptions).map(([id,[name,description]])=>`<label class="switch-row"><span><strong>${name}</strong><small>${description}</small></span><span class="switch-control"><input id="${id}" type="checkbox" role="switch" aria-label="${name}" checked><span class="switch-track" aria-hidden="true"></span></span></label>`).join('')}</div></fieldset>
  <p id="layer-status" role="status"></p>
  <details class="appearance-details"><summary>About motion</summary><p>Reduced motion keeps the scene still. Reactions use only the small toy areas, with arrow keys or Enter as well as touch.</p></details>`;
const stage = document.getElementById('scene-stage');
function fallingField() {
  if (!state.falling || state.theme==='none') return '';
  return `<div class="particle-field" aria-hidden="true">${Array.from({length:10},(_,i)=>{
    const content = state.theme==='cozy' ? (i%2?mouse(0,0,1.1):yarn(0,0,.9)) : state.theme==='snow' ? '<g stroke="#b1d8e9" stroke-width="2.5" stroke-linecap="round"><path d="M0-17V17M-15-8L15 8M-15 8L15-8M-5-13L0-8L5-13M-5 13L0 8L5 13"/></g>' : state.theme==='leaves'?leaf(0,0,.85,i%2?'#d3a75f':'#d68a59'):ball(0,0,.8);
    return `<span class="falling-bit" style="--x:${6+i*9}%;--size:${i%3===0?22:15}px;--duration:${14+i%4*3}s;--delay:-${i*2.7}s;--static-y:${16+i%4*21}%"><svg viewBox="-25 -25 50 50">${content}</svg></span>`;
  }).join('')}</div>`;
}
function updateMode() { root.dataset.mode=state.mode==='system'?(systemDark.matches?'dark':'light'):state.mode; }
function render() {
  clearTimeout(settleTimer); drag=null; stage.dataset.playing='false'; root.dataset.theme=state.theme; updateMode(); sceneConfig=[];
  const hasCompanions = state.companions && state.theme!=='none';
  const canReact = hasCompanions && state.reactions && !reduced.matches;
  const scene = hasCompanions ? ({cozy:cozyScene,snow:snowScene,leaves:autumnScene,footballs:footballScene}[state.theme])() : '';
  document.body.classList.toggle('still',reduced.matches);
  stage.innerHTML = fallingField()+svg(scene)+(!scene&&!state.falling?'<div class="scene-empty">Just your colors.</div>':'');
  document.getElementById('scene-title').textContent=sceneNames[state.theme] || 'Classic';
  document.getElementById('scene-instruction').textContent=state.theme==='none'?'The original ScoreSense palette.':canReact?`${instructions[state.theme]} Drag, use arrow keys, or press Enter.`:hasCompanions?'A quiet little scene. No reactions.':state.falling?'Only subtle falling decorations.':'The same palette across the app.';
  document.getElementById('reactions').disabled = !hasCompanions || reduced.matches;
  ['falling','companions'].forEach(id=>document.getElementById(id).disabled=state.theme==='none');
  document.getElementById('layer-status').textContent = reduced.matches?'Reduced motion is on. Your scene stays still.':state.theme==='none'?'Classic colors.':`${state.falling?'Falling decorations':'No falling decorations'} · ${hasCompanions?'Companions':'No companions'}${hasCompanions?canReact?' · Reactions on':' · Reactions off':''}`;
  if(canReact) sceneConfig.forEach(c=>{
    const button=document.createElement('button'); button.className='scene-interaction'; button.dataset.toy=c.id; button.type='button';
    button.setAttribute('aria-label',`${c.kind==='yarn'||c.kind==='mouse'?'Hanging cat toy':c.kind==='acorn'?'Acorn':c.kind==='snowball'?'Snowball':'Practice football'} · drag, arrow keys, or Enter`);
    stage.append(button); positionButton(c);
    button.addEventListener('pointerdown',e=>{ e.preventDefault(); button.setPointerCapture(e.pointerId); drag={c,pointer:e.pointerId}; });
    button.addEventListener('pointermove',e=>{ if(!drag||drag.c!==c) return; const bounds=stage.querySelector('svg:not(.particle-field svg)').getBoundingClientRect(); moveToy(c,(e.clientX-bounds.left)/bounds.width*420,(e.clientY-bounds.top)/bounds.height*270); });
    const release=()=>{if(drag?.c===c){drag=null;restSoon();}};
    button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
    button.addEventListener('keydown',e=>{ if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key))return; e.preventDefault(); const x=c.currentX??c.x,y=c.currentY??c.y;moveToy(c,x+(e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:e.key==='Enter'||e.key===' '?-8:0),y+(e.key==='ArrowUp'?-8:e.key==='ArrowDown'?8:0));restSoon(); });
  });
}
function positionButton(c) {
  const box = stage.querySelector('svg:not(.particle-field svg)').getBoundingClientRect(), container=stage.getBoundingClientRect();
  const button=stage.querySelector(`[data-toy="${c.id}"]`);if(!button)return;
  button.style.left=`${box.left-container.left+(c.currentX??c.x)/420*box.width}px`;
  button.style.top=`${box.top-container.top+(c.currentY??c.y)/270*box.height}px`;
}
function moveToy(c,x,y) {
  clearTimeout(settleTimer);
  if(c.anchor) { const dx=x-c.anchor.x,dy=y-c.anchor.y,angle=clamp(Math.atan2(dx,Math.max(10,dy)),-.65,.65),length=Math.hypot(c.x-c.anchor.x,c.y-c.anchor.y); x=c.anchor.x+Math.sin(angle)*length;y=c.anchor.y+Math.cos(angle)*length; }
  else {x=clamp(x,c.x-45,c.x+45);y=clamp(y,c.y-12,c.y+7);}
  c.currentX=x;c.currentY=y;
  stage.querySelector(`#toy-${c.id}`).setAttribute('transform',`translate(${x} ${y})`);
  const cord=stage.querySelector(`#cord-${c.id}`);if(cord)cord.setAttribute('d',`M${c.anchor.x} ${c.anchor.y}L${x} ${y}`);
  positionButton(c);stage.dataset.playing='true';
  const buddy=stage.querySelector(`[data-buddy="${c.buddy}"]`);
  stage.querySelectorAll('[data-buddy]').forEach(b=>b.classList.toggle('playing',b===buddy));
  if(buddy){buddy.querySelectorAll('.companion-pupil').forEach(p=>p.style.transform=`translate(${clamp((x-c.x)/12,-2.5,2.5)}px,${clamp((y-c.y)/10,-1.5,1.5)}px)`);buddy.querySelectorAll('.awake-eyes').forEach(e=>e.style.display='');buddy.querySelectorAll('.sleep-eyes').forEach(e=>e.style.display='none');}
}
function restSoon(){settleTimer=setTimeout(()=>{stage.dataset.playing='false';stage.querySelectorAll('.playing').forEach(e=>e.classList.remove('playing'));stage.querySelectorAll('.awake-eyes').forEach(e=>e.style.display='none');stage.querySelectorAll('.sleep-eyes').forEach(e=>e.style.display='');stage.querySelectorAll('.companion-pupil').forEach(e=>e.style.transform='');sceneConfig.forEach(c=>{delete c.currentX;delete c.currentY;stage.querySelector(`#toy-${c.id}`)?.setAttribute('transform',`translate(${c.x} ${c.y})`);stage.querySelector(`#cord-${c.id}`)?.setAttribute('d',`M${c.anchor?.x} ${c.anchor?.y}L${c.x} ${c.y}`);positionButton(c);});},1100);}
document.addEventListener('change',e=>{const input=e.target;if(input.name==='theme'){state.theme=input.value;render();}else if(input.name==='mode'){state.mode=input.value;updateMode();}else if(Object.hasOwn(descriptions,input.id)){state[input.id]=input.checked;render();}});
reduced.addEventListener('change',render);systemDark.addEventListener('change',updateMode);
new ResizeObserver(()=>sceneConfig.forEach(positionButton)).observe(stage);
render();
