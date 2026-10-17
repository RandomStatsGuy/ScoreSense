/* Interactive Appearance & Color Scheme Study
   Bolder theme palettes + Marshawn #24 Skittles & Henny showcase on Option B. */
const root = document.documentElement;
const option = document.body.dataset.option || "a";

const BASE_THEMES = [
  {
    id: "none",
    name: "Classic",
    sub: "Cobalt · editorial",
    darkBg: "#0d1626",
    darkText: "#f0f5fc",
    lightBg: "#ffffff",
    lightText: "#122033",
    accentDark: "#4d88ff",
    accentLight: "#156e47",
    badge: "",
  },
  {
    id: "footballs",
    name: "Footballs",
    sub: "Marshawn #24 · gold",
    darkBg: "#261e16",
    darkText: "#fdf3e3",
    lightBg: "#fff9ef",
    lightText: "#2b1f13",
    accentDark: "#e5a93c",
    accentLight: "#1f6637",
    badge: "",
  },
  {
    id: "cozy",
    name: "Cozy den",
    sub: "Cats · velvet rose",
    darkBg: "#2c2038",
    darkText: "#fdf2eb",
    lightBg: "#fff9f5",
    lightText: "#332030",
    accentDark: "#f29bb4",
    accentLight: "#8f3958",
    badge: "",
  },
  {
    id: "snow",
    name: "Snowfall",
    sub: "Snowman · frost cyan",
    darkBg: "#132d4c",
    darkText: "#f0faff",
    lightBg: "#f7fdff",
    lightText: "#0f2f40",
    accentDark: "#67d4fc",
    accentLight: "#0e6380",
    badge: "",
  },
  {
    id: "leaves",
    name: "Autumn",
    sub: "Squirrel · copper",
    darkBg: "#361e24",
    darkText: "#fff2e0",
    lightBg: "#fff8eb",
    lightText: "#3b2019",
    accentDark: "#f49d52",
    accentLight: "#9e3d16",
    badge: "",
  },
];

const NEW_THEMES = [
  {
    id: "kickoff",
    name: "Prime time",
    sub: "Turf · electric emerald",
    darkBg: "#102622",
    darkText: "#ecfaf6",
    lightBg: "#f7fcf9",
    lightText: "#0d2922",
    accentDark: "#3ee0b0",
    accentLight: "#0f6952",
    badge: "New",
  },
  {
    id: "redzone",
    name: "Red zone",
    sub: "Crimson · sideline",
    darkBg: "#2b171d",
    darkText: "#fdf0f1",
    lightBg: "#fff9f9",
    lightText: "#331419",
    accentDark: "#ff858f",
    accentLight: "#992938",
    badge: "New",
  },
  {
    id: "press",
    name: "Press box",
    sub: "Newsprint · brass",
    darkBg: "#222029",
    darkText: "#f7f3eb",
    lightBg: "#fffdf7",
    lightText: "#262118",
    accentDark: "#ebc06d",
    accentLight: "#7d5312",
    badge: "New",
  },
];

const themes = option === "a" ? BASE_THEMES : [...BASE_THEMES, ...NEW_THEMES];

const state = {
  theme: option === "b" ? "footballs" : option === "c" ? "kickoff" : "cozy",
  mode: "dark",
  falling: true,
  companions: true,
  reactions: true,
  intensity: "standard",
  pile: true,
  wash: true,
};

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const systemDark = matchMedia("(prefers-color-scheme: dark)");
let settleTimer;
let sceneConfig = [];
let drag = null;
let physicsFrame = 0;
let physicsTime = 0;
const movingToys = new Map();
const GRAVITY = 460;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const svg = (content) => `<svg class="companion-svg" viewBox="0 0 420 270" aria-hidden="true">${content}</svg>`;
const stroke = 'stroke="#66515c" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

const eyes = (x, y) => `<g class="companion-eyes"><ellipse cx="${x - 11}" cy="${y}" rx="4.5" ry="5.5" fill="#f7f2e8"/><ellipse cx="${x + 11}" cy="${y}" rx="4.5" ry="5.5" fill="#f7f2e8"/><g class="companion-pupil" data-gaze-x="${x}" data-gaze-y="${y}"><ellipse cx="${x - 11}" cy="${y}" rx="2.7" ry="3.6" fill="#4a4038"/><ellipse cx="${x + 11}" cy="${y}" rx="2.7" ry="3.6" fill="#4a4038"/><circle cx="${x - 10}" cy="${y - 1}" r="1" fill="#fff"/><circle cx="${x + 12}" cy="${y - 1}" r="1" fill="#fff"/></g></g>`;
const cheek = (x, y) => `<ellipse cx="${x - 20}" cy="${y}" rx="6" ry="3" fill="#eaa5ac" opacity=".6"/><ellipse cx="${x + 20}" cy="${y}" rx="6" ry="3" fill="#eaa5ac" opacity=".6"/>`;
const ball = (x, y, size = 1) => `<g transform="translate(${x} ${y}) scale(${size})"><ellipse rx="22" ry="14" fill="#b9794f" stroke="#714935" stroke-width="1.8"/><path d="M-14-11Q-6 0-14 11M14-11Q6 0 14 11" stroke="#f9e8d4" stroke-width="3" fill="none"/><path d="M-7 0H7M-4-4V4M0-4V4M4-4V4" stroke="#fff4dc" stroke-width="1.7" stroke-linecap="round"/></g>`;
const yarn = (x, y, size = 1, color = "#c98dab") => `<g transform="translate(${x} ${y}) scale(${size})"><circle r="15" fill="${color}" stroke="#855c7b" stroke-width="1.4"/><path d="M-12-7Q-4 5 12 7M-13 0Q-4 11 7 13M-9-12Q1-3 14 0M-3-14Q-12 2-4 14M6-13Q-3 3 2 14M12-8Q4 3 9 11" fill="none" stroke="#f5d4e2" stroke-width="1.3"/><path d="M12 10Q26 16 25 5" fill="none" stroke="${color}" stroke-width="2.5"/></g>`;
const acorn = (x, y, size = 1) => `<g transform="translate(${x} ${y}) scale(${size})"><path d="M-12-4Q-12 15 0 19Q12 15 12-4Z" fill="#d4a575" stroke="#876243" stroke-width="1.5"/><path d="M-15-4Q-13-17 0-16Q13-17 15-4Z" fill="#906650" stroke="#654937" stroke-width="1.5"/><path d="M1-16Q-2-24 4-24" fill="none" stroke="#654937" stroke-width="3" stroke-linecap="round"/><path d="M-9-9L-4-5M-2-12L3-8M7-10L11-6" stroke="#b08b67" stroke-width="1.5"/></g>`;
const leaf = (x, y, scale = 1, color = "#d68a59") => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0-20L5-9L16-15L12-4L23 0L11 7L12 18L2 12L0 25L-2 12L-12 18L-11 7L-23 0L-12-4L-16-15L-5-9Z" fill="${color}"/><path d="M0 24V-14M0 6L12 0M0 0L-10-6" fill="none" stroke="#91573f" stroke-width="1.5"/></g>`;
const mouse = (x, y, size = 1) => `<g transform="translate(${x} ${y}) scale(${size})"><path d="M-9 6Q-21 10-17-3" fill="none" stroke="#b786ac" stroke-width="2"/><ellipse rx="12" ry="8" fill="#d8b8d0" stroke="#896a84" stroke-width="1.2"/><ellipse cx="3" cy="-7" rx="5" ry="5" fill="#e6cbdc" stroke="#896a84" stroke-width="1.2"/><circle cx="8" cy="-1" r="1.5" fill="#66515c"/><circle cx="13" cy="2" r="2" fill="#c890a2"/></g>`;
const skittles = (x, y) => `<g transform="translate(${x} ${y})"><ellipse cx="-9" cy="3" rx="8" ry="6" fill="#da7184" stroke="#a75368"/><ellipse cx="6" cy="7" rx="8" ry="6" fill="#e7be69" stroke="#ba9655"/><ellipse cx="1" cy="-6" rx="8" ry="6" fill="#a59aca" stroke="#7c6c9d"/><ellipse cx="13" cy="-1" rx="7" ry="6" fill="#88b497" stroke="#619376"/><path d="M-11 2Q-7 0-9 4Q-12 6-8 5M4 6Q8 4 6 8Q3 10 7 9M-1-7Q3-9 1-5Q-2-3 2-4M11-2Q15-4 13 0Q10 2 14 1" stroke="#fff7e6" stroke-width="1.1" fill="none" stroke-linecap="round"/></g>`;
const henny = (x, y) => `<g data-scene-prop="henny" transform="translate(${x} ${y})"><title>Henny bottle</title><path d="M-6-36H6V-26Q15-22 15-14V-4Q15 0 10 0H-10Q-15 0-15-4V-14Q-15-22-6-26Z" fill="#8d592f" stroke="#5f4937" stroke-width="1.5"/><path d="M-11-20Q-5-24-5-29V-34" fill="none" stroke="#d9bd78" stroke-width="2" opacity=".5"/><rect x="-6.5" y="-40" width="13" height="9" rx="2" fill="#3e4240" stroke="#5f4937" stroke-width="1"/><path d="M-6-32H6" stroke="#bda268" stroke-width="2"/><rect x="-11" y="-19" width="22" height="14" rx="3" fill="#eee0b7" stroke="#c6aa6f" stroke-width="1"/><text x="0" y="-8" text-anchor="middle" font-family="Georgia,serif" font-size="12" fill="#65503b">H</text><path d="M-10-3H10" stroke="#c39858" stroke-width="1.4" opacity=".65"/></g>`;
const penaltyFlag = (x, y) => `<g transform="translate(${x} ${y})"><path d="M-10 8L2-14L14 4Q4 12-10 8Z" fill="#facc15" stroke="#a16207" stroke-width="1.5"/><circle cx="-8" cy="8" r="6" fill="#eab308" stroke="#a16207" stroke-width="1.5"/></g>`;
const pressPass = (x, y) => `<g transform="translate(${x} ${y})"><rect x="-13" y="-16" width="26" height="32" rx="4" fill="#f7f3eb" stroke="#7e778f" stroke-width="1.5"/><rect x="-9" y="-10" width="18" height="7" rx="2" fill="#d99b4e"/><path d="M-8 3H8M-8 8H4" stroke="#6b6052" stroke-width="2" stroke-linecap="round"/></g>`;

const cat = (id, x, y, mirror = false) => `<g data-buddy="${id}" transform="translate(${x} ${y}) scale(${mirror ? "-.85" : ".85"} .85)">
  <path d="M28 92C6 92 2 74 14 66C20 62 28 64 30 72" fill="none" stroke="#9d8194" stroke-width="13" stroke-linecap="round"/>
  <path d="M24 101C16 74 34 52 66 50L118 52C140 54 152 68 150 82C148 94 138 102 122 102L44 102C34 102 27 102 24 101Z" fill="#efe6d8" ${stroke}/>
  <path d="M34 99C28 78 40 60 62 55C48 66 42 82 44 101Z" fill="#aa91a3" opacity=".35"/>
  <g class="companion-head"><path d="M104 38L110 16L124 32ZM136 32L152 20L152 42Z" fill="#9d8194" ${stroke}/><path d="M109 34L112 23L119 33ZM143 33L149 26L148 36Z" fill="#d9a3a3"/>
  <ellipse cx="128" cy="56" rx="30" ry="26" fill="#efe6d8" ${stroke}/><path d="M100 48C104 34 152 34 156 48C158 42 154 30 146 28L110 28C102 30 98 42 100 48Z" fill="#9d8194"/>
  <g class="sleep-eyes"><path d="M112 56Q117 60 122 56M134 56Q139 60 144 56" fill="none" stroke="#4a4038" stroke-width="2.6" stroke-linecap="round"/></g>
  <g class="awake-eyes" style="display:none"><ellipse cx="117" cy="56" rx="6" ry="6.5" fill="#eef6ff"/><ellipse cx="139" cy="56" rx="6" ry="6.5" fill="#eef6ff"/><g class="companion-pupil" data-gaze-x="128" data-gaze-y="56.5" data-gaze-range-x="2.1" data-gaze-range-y="1.3"><circle cx="117" cy="56.5" r="3.4" fill="#3c6ea5"/><circle cx="139" cy="56.5" r="3.4" fill="#3c6ea5"/><circle cx="118.2" cy="55.2" r="1.1" fill="#fff"/><circle cx="140.2" cy="55.2" r="1.1" fill="#fff"/></g></g>
  <path d="M124 64L128 60L132 64L128 67Z" fill="#d98d8d"/><path d="M128 67Q128 72 122 73M128 67Q128 72 134 73M108 62L88 58M108 68L88 70M147 62L166 58M147 68L166 70" fill="none" stroke="#66515c" stroke-width="1.2" stroke-linecap="round"/>
  </g><path d="M96 102Q98 92 108 92Q118 92 119 102Z" fill="#d9c9c6" ${stroke}/><path class="companion-paw" d="M120 102Q121 90 132 89Q143 89 144 102Z" fill="#d9c9c6" ${stroke}/><path d="M131 98V101M137 98V101" stroke="#a48a94" stroke-width="1"/>
</g>`;

const cushion = (x, y, w) => `<rect x="${x}" y="${y}" width="${w}" height="15" rx="7" fill="#b591aa" ${stroke}/><path d="M${x + 8} ${y + 7}H${x + w - 8}" stroke="#e3cbd6" stroke-width="1.3"/>`;
const ground = (color = "#b48b78") => (state.pile ? `<ellipse class="scene-ground" cx="210" cy="250" rx="202" ry="15" fill="${color}" opacity=".45"/>` : "");
const tree = (x) => `<rect x="${x + 69}" y="211" width="25" height="39" rx="4" fill="#c8a585" ${stroke}/><path d="M${x + 72} 218H${x + 91}M${x + 72} 224H${x + 91}M${x + 72} 230H${x + 91}M${x + 72} 236H${x + 91}" stroke="#997662" stroke-width="1.5"/><rect x="${x + 43}" y="245" width="76" height="12" rx="6" fill="#b48b78" ${stroke}/>${cushion(x, 200, 175)}`;

const toy = (id, x, y, kind, anchor = null) =>
  `${anchor ? `<path id="cord-${id}" d="M${anchor.x} ${anchor.y}L${x} ${y}" fill="none" stroke="#aa839c" stroke-width="2"/>` : ""}<g id="toy-${id}" transform="translate(${x} ${y})">${
    kind === "yarn"
      ? yarn(0, 0, 0.68)
      : kind === "mouse"
        ? mouse(0, 0, 0.9)
        : kind === "snowball"
          ? '<circle r="16" fill="#f5fbff" stroke="#b9d6e5" stroke-width="1.5"/><path d="M-8 3Q-3 10 8 5" stroke="#d3e8f2" stroke-width="2" fill="none"/>'
          : kind === "acorn"
            ? acorn(0, 0, 0.75)
            : kind === "skittles"
              ? skittles(0, 0)
              : kind === "flag"
                ? penaltyFlag(0, 0)
                : kind === "presspass"
                  ? pressPass(0, 0)
                  : ball(0, 0, 0.85)
  }</g>`;

function cozyScene() {
  sceneConfig = [
    { id: "left", x: 171, y: 181, kind: "yarn", anchor: { x: 165, y: 143 }, buddy: "left" },
    { id: "right", x: 249, y: 181, kind: "mouse", anchor: { x: 255, y: 143 }, buddy: "right" },
  ];
  return (
    ground() +
    `${tree(5)}${tree(240)}<path d="M165 201V143M255 201V143" stroke="#a58272" stroke-width="5"/>${cat("left", 13, 114)}${cat("right", 407, 114, true)}` +
    sceneConfig.map((c) => toy(c.id, c.x, c.y, c.kind, c.anchor)).join("")
  );
}

const snowman = (id, x, y, s = 1, hat = "#496c93") => `<g data-buddy="${id}" transform="translate(${x} ${y}) scale(${s})"><path d="M-35 25L-62 9M-54 14L-56 4M35 25L62 9" fill="none" stroke="#9a735d" stroke-width="4" stroke-linecap="round"/><g class="companion-arm"><path d="M59 13L68 4" stroke="#9a735d" stroke-width="4" stroke-linecap="round"/><path d="M64 2Q72-4 78 2L77 13Q72 18 66 12Z" fill="#d28dab" ${stroke}/></g><ellipse cy="39" rx="46" ry="48" fill="#eaf5fc" stroke="#b5d5e5" stroke-width="2"/><ellipse cx="-9" cy="35" rx="22" ry="31" fill="#fff" opacity=".35"/><circle cy="31" r="3.2" fill="#64829b"/><circle cy="47" r="3.2" fill="#64829b"/><circle cy="63" r="3.2" fill="#64829b"/><g class="companion-head"><circle cy="-22" r="34" fill="#f5fbff" stroke="#b5d5e5" stroke-width="2"/><path d="M-24-48Q-16-87 7-73Q27-66 28-45Z" fill="${hat}" ${stroke}/><path d="M-30-45Q0-35 32-45" stroke="#a8cad9" stroke-width="9" stroke-linecap="round"/><circle cx="1" cy="-78" r="10" fill="#ecedf5"/>${eyes(0, -21)}${cheek(0, -11)}<path d="M0-15L21-11L0-6Z" fill="#eaa16c" stroke="#bd8056" stroke-width="1"/><path d="M-9-1Q0 7 10-1" fill="none" ${stroke}/></g><path d="M-30 5Q0 18 33 5" stroke="#d28dab" stroke-width="11" fill="none" stroke-linecap="round"/><path d="M16 9L16 35L29 37L31 8" fill="#d28dab" ${stroke}/><path d="M18 25H28M18 31H28" stroke="#f1becf" stroke-width="2"/></g>`;

function snowScene() {
  sceneConfig = [{ id: "snow", x: 265, y: 231, kind: "snowball", buddy: "snow" }];
  const snowGround = state.pile
    ? `<path class="scene-ground" d="M4 247Q70 219 146 245Q251 221 417 246V267H4Z" fill="#cce3f1"/><path class="scene-ground" d="M0 253Q91 231 170 253Q311 232 420 251V270H0Z" fill="#eaf5fc"/>`
    : "";
  return `${snowGround}${snowman("snow", 135, 156, 1)}<path d="M58 247Q82 229 107 248" fill="#f5fbff"/><ellipse cx="266" cy="248" rx="23" ry="4" fill="#a3cadf" opacity=".5"/>${toy("snow", 265, 231, "snowball")}`;
}

const stump = (x, y, w = 90) => `<g transform="translate(${x} ${y}) scale(1 .65)"><path d="M-${w / 2} 0L-${w / 2 - 5} 60Q0 72 ${w / 2 - 5} 60L${w / 2} 0" fill="#a67359" ${stroke}/><path d="M-28 10L-25 55M-8 15L-5 61M12 14L14 62M30 9L28 54" stroke="#86543f" stroke-width="3" stroke-linecap="round"/><ellipse rx="${w / 2}" ry="13" fill="#d3ac81" ${stroke}/><ellipse rx="${w / 3}" ry="8" fill="none" stroke="#b88f68" stroke-width="2"/></g>`;
const squirrel = () => `<g data-buddy="autumn" transform="translate(155 161)"><path d="M-30 39C-112 51-118-54-64-70C-34-76-18-50-32-27C-49-46-82-32-66-1C-55 14-37 11-28 5" fill="#bd8562" ${stroke}/><path d="M-38 30C-88 31-96-46-64-51" stroke="#e2b78e" stroke-width="12" fill="none" stroke-linecap="round"/><ellipse cy="26" rx="33" ry="42" fill="#c59269" ${stroke}/><ellipse cy="31" rx="22" ry="29" fill="#f4d5aa"/><g class="companion-head"><path d="M-28-22L-26-50Q-9-44-9-23M9-23Q9-45 26-49L28-21" fill="#c59269" ${stroke}/><path d="M-22-29L-21-41L-14-28M15-28L21-40L23-29" fill="#dcb3a6"/><ellipse cy="-10" rx="33" ry="29" fill="#c59269" ${stroke}/><path d="M-31-3Q0-11 31-3Q25 24 0 22Q-25 22-31-3" fill="#f4d5aa"/>${eyes(0, -11)}${cheek(0, 1)}<path d="M-4-1Q0-5 4-1L0 4Z" fill="#66515c"/><path d="M0 4V8M-7 7Q0 14 7 7" fill="none" ${stroke}/></g><path class="companion-paw" d="M24 13Q44 22 30 32Q17 27 17 22" fill="#c59269" ${stroke}/><ellipse cx="-21" cy="61" rx="17" ry="8" fill="#bd8562" ${stroke}/><ellipse cx="20" cy="61" rx="17" ry="8" fill="#bd8562" ${stroke}/></g>`;

function autumnScene() {
  sceneConfig = [{ id: "autumn", x: 285, y: 235, kind: "acorn", buddy: "autumn" }];
  return ground("#c59366") + `${stump(154, 224, 92)}${squirrel()}` + leaf(59, 250, 0.5) + leaf(337, 250, 0.65, "#d3a75f") + leaf(359, 256, 0.4, "#b16f59") + toy("autumn", 285, 235, "acorn");
}

const marshawn = (x) => `<g data-buddy="football" transform="translate(${x} 164)">
  <path d="M-32 8Q-53 9-52 35L-39 38Q-40 22-28 23" fill="#9b684e" ${stroke}/><g class="companion-arm snack-hand"><path d="M30 9Q44 10 46 26L58 22Q68 16 71 24Q70 34 59 35L38 40Q29 30 25 22" fill="#9b684e" ${stroke}/><path d="M60 22L65 16" stroke="#9b684e" stroke-width="6" stroke-linecap="round"/></g>
  <path d="M-28 49L-25 75M28 49L25 75" stroke="#263c47" stroke-width="18" stroke-linecap="round"/><path d="M-27 60L-26 68M27 60L26 68" stroke="#b9cba2" stroke-width="4"/>
  <path d="M-34 73Q-44 72-45 83H-13V75M34 73Q44 72 45 83H13V75" fill="#e5e5d3" ${stroke}/>
  <path d="M-33 2L-42 16L-27 24L-28 55Q0 66 28 55L27 24L42 16L33 2Q0-10-33 2" fill="#365862" ${stroke}/><path d="M-38 13L-29 17M29 17L38 13" stroke="#abc986" stroke-width="5"/><path d="M-25 49Q0 55 25 49" stroke="#abc986" stroke-width="4" fill="none"/><path d="M-9 5L0 13L9 5" fill="none" stroke="#b5c5c5" stroke-width="3"/>
  <text x="0" y="40" fill="#e9eddf" stroke="#abc986" stroke-width=".6" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="23">24</text>
  <g class="companion-head">
  <path d="M-29-38Q-41-20-35 2L-40 37M-23-37Q-39-10-29 11L-31 44M-17-36Q-31-8-23 17L-24 41M28-39Q42-21 35-1L37 26M22-38Q35-11 29 10L29 34" stroke="#302c30" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M-30-29Q-39-14-34 1L-38 34M-24-26Q-34-6-28 10L-29 40M25-27Q35-14 32 3L34 23" stroke="#51464b" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <ellipse cx="-32" cy="-20" rx="5" ry="8" fill="#9c674d"/><ellipse cx="32" cy="-20" rx="5" ry="8" fill="#9c674d"/>
  <path d="M-30-41Q-24-61 1-59Q24-59 30-42L31-18Q29 5 16 13Q0 21-17 12Q-31 1-32-19Z" fill="#a46e51" ${stroke}/>
  <path d="M-28-40Q-32-68-7-72Q25-74 31-43Z" fill="#46505a" ${stroke}/><path d="M-31-43Q0-52 32-44L33-33Q0-40-32-31Z" fill="#b2b7ba" ${stroke}/>
  <path d="M-25-42L-25-33M-18-44L-18-35M-11-46L-11-36M-4-47L-4-37M3-47L3-37M10-46L10-36M17-45L17-35M24-43L24-33" stroke="#89959b" stroke-width="1.4"/>
  <path d="M-19-29Q-13-32-6-29M6-29Q13-32 19-29" stroke="#48352f" stroke-width="2.8" fill="none" stroke-linecap="round"/>${eyes(0, -23)}
  <path d="M-4-20L-7-10Q-2-5 7-10" fill="#a97155" stroke="#83523d" stroke-width="1.4" stroke-linecap="round"/><path d="M-21-12Q-20-5-15-3M21-12Q20-5 15-3" stroke="#bb8364" stroke-width="1.2" fill="none"/>
  <path d="M-23-5Q-23 15 0 18Q22 15 24-5Q17 0 12-2L7-5Q0-8-7-5L-12-2Q-18 1-23-5" fill="#443235"/>
  <path d="M-18 5L-15 9M-10 10L-8 13M0 12V15M10 10L8 13M18 5L15 9" stroke="#655055" stroke-width="1.3" stroke-linecap="round"/>
  <path class="snack-smile" d="M-11-1Q0 7 11-1" fill="none" stroke="#e8b99d" stroke-width="2.3" stroke-linecap="round"/>
  <g class="snack-grin"><path d="M-15-3Q0 19 15-3Q0 2-15-3" fill="#f9ead7" stroke="#734b38" stroke-width="1"/><path d="M-10 1H10" stroke="#d9baa1" stroke-width="1"/><path d="M-9-1H-5V5H-9ZM3-1H7V5H3Z" fill="#d3ad61"/></g><circle cx="-33" cy="-14" r="1.8" fill="#eee4c7"/></g>
</g>`;

function footballScene() {
  const x = 138;
  sceneConfig = [{ id: "football", x: x + 103, y: 235, kind: "skittles", buddy: "football", hand: { x: x + 60, y: 190 } }];
  const turfGround = state.pile
    ? `<path class="scene-ground" d="M4 247Q210 222 417 247V270H4Z" fill="#82997b" opacity=".75"/><path d="M57 255H363M82 249V263M336 249V263" stroke="#dbe1c6" stroke-width="2" opacity=".8"/>`
    : "";
  return `${turfGround}${marshawn(x)}<path d="M338 198V244M377 198V244" stroke="#a78469" stroke-width="6"/><rect x="326" y="193" width="64" height="12" rx="6" fill="#c7a784" ${stroke}/>${henny(359, 193)}${toy("football", x + 103, 235, "skittles")}`;
}

/* ---- New Companion Scenes ---- */
function kickoffScene() {
  sceneConfig = [{ id: "kickoff", x: 274, y: 228, kind: "flag", buddy: "kickoff" }];
  const turf = state.pile
    ? `<path class="scene-ground" d="M4 247Q210 225 417 247V270H4Z" fill="#2e6b59" opacity=".68"/><path d="M70 255H350M140 248L132 264M280 248L288 264" stroke="#e2f1ea" stroke-width="2" opacity=".75"/>`
    : "";
  const pylonBuddy = `<g data-buddy="kickoff" transform="translate(148 168)">
    <path d="M-26 78L-14-36H14L26 78Z" fill="#fb923c" stroke="#9a3412" stroke-width="2"/>
    <rect x="-30" y="72" width="60" height="10" rx="4" fill="#1e293b"/>
    <path d="M-18 14H18M-21 38H21" stroke="#fff7ed" stroke-width="5" opacity=".85"/>
    <g class="companion-head">${eyes(0, -8)}${cheek(0, 3)}<path d="M-7 6Q0 13 7 6" fill="none" stroke="#431407" stroke-width="2.2" stroke-linecap="round"/></g>
    <g class="companion-arm"><path d="M20 12L44-4" stroke="#9a3412" stroke-width="4" stroke-linecap="round"/><circle cx="46" cy="-5" r="5" fill="#facc15"/></g>
  </g>`;
  return `${turf}${pylonBuddy}${toy("kickoff", 274, 228, "flag")}`;
}

function redzoneScene() {
  sceneConfig = [{ id: "redzone", x: 276, y: 230, kind: "ball", buddy: "redzone" }];
  const endzone = state.pile
    ? `<path class="scene-ground" d="M4 247Q210 225 417 247V270H4Z" fill="#7a2835" opacity=".65"/><path d="M62 255H358" stroke="#fde8ea" stroke-width="2" opacity=".75"/>`
    : "";
  const chainBuddy = `<g data-buddy="redzone" transform="translate(148 166)">
    <rect x="-5" y="-42" width="10" height="118" rx="4" fill="#e2e8f0" stroke="#475569" stroke-width="1.5"/>
    <polygon points="0,-54 34,-24 0,6 -34,-24" fill="#f97316" stroke="#9a3412" stroke-width="2"/>
    <circle cy="-24" r="22" fill="#fb923c"/>
    <g class="companion-head">${eyes(0, -26)}${cheek(0, -16)}<path d="M-7 -12Q0 -5 7 -12" fill="none" stroke="#431407" stroke-width="2.2" stroke-linecap="round"/></g>
    <g class="companion-arm"><path d="M22 -18L44 -30" stroke="#9a3412" stroke-width="4" stroke-linecap="round"/></g>
  </g>`;
  return `${endzone}${chainBuddy}${toy("redzone", 276, 230, "ball")}`;
}

function pressScene() {
  sceneConfig = [{ id: "press", x: 268, y: 178, kind: "presspass", anchor: { x: 268, y: 126 }, buddy: "press" }];
  const desk = state.pile ? `<rect class="scene-ground" x="48" y="242" width="324" height="16" rx="6" fill="#8c7a5b" ${stroke}/>` : "";
  const owlBuddy = `<g data-buddy="press" transform="translate(148 164)">
    <ellipse cy="34" rx="36" ry="42" fill="#8c735b" ${stroke}/>
    <ellipse cy="38" rx="23" ry="28" fill="#e8dccb"/>
    <path d="M-12 28L-4 34L4 28M-14 42L-6 48L2 42M6 34L14 40" fill="none" stroke="#8c735b" stroke-width="2" stroke-linecap="round"/>
    <g class="companion-head">
      <path d="M-26-26L-32-44L-12-32M26-26L32-44L12-32" fill="#6e5844" ${stroke}/>
      <ellipse cy="-8" rx="32" ry="26" fill="#8c735b" ${stroke}/>
      <circle cx="-11" cy="-9" r="10" fill="#f7f3eb" ${stroke}/><circle cx="11" cy="-9" r="10" fill="#f7f3eb" ${stroke}/>
      ${eyes(0, -9)}
      <path d="M-4-2L0 6L4-2Z" fill="#d99b4e"/>
    </g>
    <path class="companion-arm" d="M28 16Q46 24 34 44" fill="#6e5844" ${stroke}/>
  </g><path d="M268 242V126" stroke="#7e778f" stroke-width="4"/>`;
  return `${desk}${owlBuddy}${toy("press", 268, 178, "presspass", { x: 268, y: 126 })}`;
}

const sceneNames = {
  none: "Classic palette stage",
  cozy: "Cat-tree corners",
  snow: "Snowbank friend",
  leaves: "Acorn lookout",
  footballs: "Marshawn’s snack break (#24 + Skittles & Henny)",
  kickoff: "Prime time sideline pylon & flag",
  redzone: "Red zone 1st-down marker",
  press: "Late-night press desk",
};

const instructions = {
  none: "Clean editorial surfaces. Switch Light or Dark to compare contrast before leaving Account.",
  cozy: "Move a hanging toy to wake its cat.",
  snow: "Roll the snowball to get a mitten wave.",
  leaves: "Move the acorn to catch a curious eye.",
  footballs: "Bring Marshawn his Skittles for a gold-tooth grin (Henny stays on the side table).",
  kickoff: "Toss the yellow flag to signal the sideline pylon.",
  redzone: "Spot the football by the 10-yard chain marker.",
  press: "Swing the press pass by the broadcast desk.",
};

function renderShell() {
  const host = document.getElementById("appearance-content");
  const controlsHtml = `
    <div class="appearance-head">
      <div>
        <h2>Appearance</h2>
        <p>Choose your color mode, bold theme identity, and companion scene across the app.</p>
      </div>
      <span class="contrast-badge" id="contrast-badge">AA 4.5:1+ verified</span>
    </div>

    <fieldset>
      <div class="fieldset-head">
        <legend>Color mode</legend>
        <span class="fieldset-meta">Saved in this browser · instant</span>
      </div>
      <div class="mode-options">
        ${["system", "light", "dark"]
          .map(
            (m) => `<label class="mode-choice">
              <input type="radio" name="mode" value="${m}" ${m === state.mode ? "checked" : ""}>
              <span>${m[0].toUpperCase() + m.slice(1)}</span>
            </label>`
          )
          .join("")}
      </div>
    </fieldset>

    <fieldset>
      <div class="fieldset-head">
        <legend>Theme palette</legend>
        <span class="fieldset-meta">Each theme sets its own surface, hero wash &amp; accent</span>
      </div>
      <div class="theme-options">
        ${themes
          .map(
            (t) => `<label class="theme-choice">
              <input type="radio" name="theme" value="${t.id}" ${t.id === state.theme ? "checked" : ""}>
              <span class="theme-card">
                <span class="swatch-chip" aria-hidden="true">
                  <span class="swatch-half" style="background:${t.darkBg}">
                    <span class="swatch-lines">
                      <span class="swatch-line" style="background:${t.darkText}"></span>
                      <span class="swatch-line swatch-line--short" style="background:${t.accentDark}"></span>
                    </span>
                  </span>
                  <span class="swatch-half" style="background:${t.lightBg}">
                    <span class="swatch-lines">
                      <span class="swatch-line" style="background:${t.lightText}"></span>
                      <span class="swatch-line swatch-line--short" style="background:${t.accentLight}"></span>
                    </span>
                  </span>
                  <span class="swatch-accent-bar" style="background:${t.accentDark};color:#102139;font-weight:700;">●</span>
                </span>
                <span class="theme-card-body">
                  <span class="theme-card-title-row">
                    <strong>${t.name}</strong>
                    ${t.badge ? `<span class="theme-badge-new">${t.badge}</span>` : ""}
                  </span>
                  <small>${t.sub}</small>
                </span>
              </span>
            </label>`
          )
          .join("")}
      </div>
    </fieldset>

    <fieldset>
      <div class="fieldset-head">
        <legend>Scene layers</legend>
        <span class="fieldset-meta" id="layer-status" role="status"></span>
      </div>
      <div class="switches">
        <label class="switch-row">
          <span>
            <strong>Falling decorations</strong>
            <small>Footballs, yarn &amp; toys, snow, leaves, or flags behind the board.</small>
          </span>
          <span class="switch-control">
            <input id="falling" type="checkbox" role="switch" aria-label="Falling decorations" checked>
            <span class="switch-track" aria-hidden="true"></span>
          </span>
        </label>
        <label class="switch-row">
          <span>
            <strong>Companions</strong>
            <small>Marshawn #24, ragdoll cats, snowman, squirrel, and habitats.</small>
          </span>
          <span class="switch-control">
            <input id="companions" type="checkbox" role="switch" aria-label="Companions" checked>
            <span class="switch-track" aria-hidden="true"></span>
          </span>
        </label>
        <label class="switch-row switch-row--nested">
          <span>
            <strong>Playful reactions</strong>
            <small>Requires Companions · wakes only when you drag or nudge their toy.</small>
          </span>
          <span class="switch-control">
            <input id="reactions" type="checkbox" role="switch" aria-label="Playful reactions" checked>
            <span class="switch-track" aria-hidden="true"></span>
          </span>
        </label>
      </div>
    </fieldset>

    <div class="scene-tuning-card">
      <div class="fieldset-head">
        <legend>Atmosphere density &amp; ground</legend>
        <span class="fieldset-meta">Live stage updates immediately</span>
      </div>
      <div class="intensity-options" role="radiogroup" aria-label="Intensity">
        ${[
          ["subtle", "Subtle"],
          ["standard", "Standard"],
          ["lively", "Lively"],
        ]
          .map(
            ([id, label]) => `<label class="intensity-choice">
              <input type="radio" name="intensity" value="${id}" ${id === state.intensity ? "checked" : ""}>
              <span>${label}</span>
            </label>`
          )
          .join("")}
      </div>
      <div class="tuning-pills">
        <label class="tuning-pill">
          <input type="checkbox" id="pile" checked>
          <span>Ground base beneath companions</span>
        </label>
        <label class="tuning-pill">
          <input type="checkbox" id="wash" checked>
          <span>Background color wash</span>
        </label>
      </div>
    </div>
  `;

  const stageHtml = `
    <section class="scene-preview" aria-label="Appearance preview">
      <div class="scene-caption">
        <div class="scene-caption-title">
          <strong id="scene-title"></strong>
        </div>
        <span id="scene-mode-pill">Live preview</span>
      </div>
      <div class="preview-ui-card" aria-label="Sample board card">
        <div class="preview-ui-hero">
          <span class="preview-ui-kicker">This Week · Lineup call</span>
          <span class="preview-ui-chip">Theme accent</span>
        </div>
        <div class="preview-ui-sample">
          <div class="preview-ui-player">
            <span class="preview-ui-tier">S</span>
            <div class="preview-ui-meta">
              <strong>Bijan Robinson · ATL</strong>
              <small>Week P50 · 22.4 pts · Floor 14.2 – 31.0</small>
            </div>
          </div>
          <div class="preview-ui-right">
            <span class="preview-ui-delta">$4 under est.</span>
            <span class="preview-ui-cta">Start</span>
          </div>
        </div>
      </div>
      <div id="scene-stage" class="scene-stage"></div>
      <div class="scene-hint">
        <p id="scene-instruction"></p>
      </div>
    </section>
    <details class="appearance-details">
      <summary><span>How scenes behave across ScoreSense</span><span>+</span></summary>
      <p style="margin-top:0.5rem;">Scenes wait for page content to finish loading, stay clear of live draft rooms, and freeze automatically when Reduced Motion is enabled.</p>
    </details>
  `;

  if (option === "b") {
    host.innerHTML = `<div class="appearance-workbench"><div class="appearance-workbench-controls">${controlsHtml}</div><div class="appearance-workbench-stage">${stageHtml}</div></div>`;
  } else {
    host.innerHTML = `${controlsHtml}${stageHtml}`;
  }
}

renderShell();
const stage = document.getElementById("scene-stage");

function fallingField() {
  if (!state.falling || state.theme === "none") return "";
  const count = state.intensity === "subtle" ? 6 : state.intensity === "lively" ? 15 : 10;
  const alpha = state.intensity === "subtle" ? 0.38 : state.intensity === "lively" ? 0.78 : 0.56;
  return `<div class="particle-field" aria-hidden="true">${Array.from({ length: count }, (_, i) => {
    const content =
      state.theme === "cozy"
        ? i % 2
          ? mouse(0, 0, 1.1)
          : yarn(0, 0, 0.9)
        : state.theme === "snow"
          ? '<g stroke="#b1d8e9" stroke-width="2.5" stroke-linecap="round"><path d="M0-17V17M-15-8L15 8M-15 8L15-8M-5-13L0-8L5-13M-5 13L0 8L5 13"/></g>'
          : state.theme === "leaves"
            ? leaf(0, 0, 0.85, i % 2 ? "#d3a75f" : "#d68a59")
            : state.theme === "kickoff"
              ? penaltyFlag(0, 0)
              : state.theme === "press"
                ? pressPass(0, 0)
                : ball(0, 0, 0.8);
    return `<span class="falling-bit" style="--x:${5 + ((i * 91) % 90)}%;--size:${i % 3 === 0 ? 22 : 15}px;--duration:${13 + (i % 4) * 3}s;--delay:-${i * 2.3}s;--static-y:${16 + (i % 4) * 20}%;--bit-alpha:${alpha}"><svg viewBox="-25 -25 50 50">${content}</svg></span>`;
  }).join("")}</div>`;
}

function updateMode() {
  const resolved = state.mode === "system" ? (systemDark.matches ? "dark" : "light") : state.mode;
  root.dataset.mode = resolved;
  const pill = document.getElementById("scene-mode-pill");
  if (pill) {
    const themeObj = themes.find((t) => t.id === state.theme) || themes[0];
    pill.textContent = `${themeObj.name} · ${resolved[0].toUpperCase() + resolved.slice(1)}`;
  }
}

function render() {
  clearTimeout(settleTimer);
  cancelAnimationFrame(physicsFrame);
  physicsFrame = 0;
  movingToys.clear();
  drag = null;
  stage.dataset.playing = "false";
  stage.dataset.settling = "false";
  root.dataset.theme = state.theme;
  document.body.classList.toggle("wash-off", !state.wash);
  updateMode();
  sceneConfig = [];
  const hasCompanions = state.companions && state.theme !== "none";
  const canReact = hasCompanions && state.reactions && !reduced.matches;
  const builders = {
    cozy: cozyScene,
    snow: snowScene,
    leaves: autumnScene,
    footballs: footballScene,
    kickoff: kickoffScene,
    redzone: redzoneScene,
    press: pressScene,
  };
  const scene = hasCompanions && builders[state.theme] ? builders[state.theme]() : "";
  document.body.classList.toggle("still", reduced.matches);
  stage.innerHTML =
    fallingField() +
    svg(scene) +
    '<div class="scene-drag-area" aria-hidden="true" hidden></div>' +
    (!scene && !state.falling
      ? '<div class="scene-empty">Palette-only mode · Sample card above shows your active surfaces and accent.</div>'
      : !scene && state.falling
        ? '<div class="scene-empty">Falling decorations only · Companions are hidden.</div>'
        : "");
  document.getElementById("scene-title").textContent = sceneNames[state.theme] || "Classic";
  document.getElementById("scene-instruction").textContent =
    state.theme === "none"
      ? instructions.none
      : canReact
        ? `${instructions[state.theme]} Drag the toy or use arrow keys.`
        : hasCompanions
          ? "Still companion scene · Playful reactions are off."
          : state.falling
            ? "Subtle falling decorations behind your boards."
            : "Coordinated colors across every page.";

  const reactionsInput = document.getElementById("reactions");
  reactionsInput.disabled = !hasCompanions || reduced.matches;
  reactionsInput.checked = hasCompanions && state.reactions && !reduced.matches;
  ["falling", "companions", "pile", "wash"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = state.theme === "none";
  });
  document.querySelectorAll('input[name="intensity"]').forEach((el) => {
    el.disabled = state.theme === "none";
  });

  document.getElementById("layer-status").textContent = reduced.matches
    ? "Reduced motion on · scene stays still"
    : state.theme === "none"
      ? "Classic palette · no decorations"
      : `${state.falling ? "Falling on" : "Falling off"} · ${hasCompanions ? "Companions on" : "Companions off"}${hasCompanions ? (canReact ? " · Reactions on" : " · Reactions off") : ""}`;

  if (canReact) {
    sceneConfig.forEach((c) => {
      c.bounds = {
        left: c.x - 50,
        right: c.x + 50,
        top: c.anchor ? c.y - 50 : c.y - 100,
        bottom: c.anchor ? c.y + 50 : c.y,
      };
      const button = document.createElement("button");
      button.className = "scene-interaction";
      button.dataset.toy = c.id;
      button.type = "button";
      button.setAttribute("aria-label", `${c.kind} toy · drag, arrow keys, or Enter`);
      stage.append(button);
      positionButton(c);
      button.addEventListener("focus", () => showArea(c));
      button.addEventListener("blur", () => {
        if (!drag && !movingToys.size) stage.querySelector(".scene-drag-area").hidden = true;
      });
      button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        movingToys.delete(c.id);
        c.releaseVX = 0;
        c.releaseVY = 0;
        c.sample = null;
        button.focus({ preventScroll: true });
        button.setPointerCapture(e.pointerId);
        drag = { c, pointer: e.pointerId };
        showArea(c);
      });
      button.addEventListener("pointermove", (e) => {
        if (!drag || drag.c !== c) return;
        const bounds = stage.querySelector("svg.companion-svg").getBoundingClientRect();
        moveToy(c, ((e.clientX - bounds.left) / bounds.width) * 420, ((e.clientY - bounds.top) / bounds.height) * 270);
      });
      const release = () => {
        if (drag?.c === c) {
          drag = null;
          releaseToy(c);
        }
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
      button.addEventListener("keydown", (e) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(e.key)) return;
        e.preventDefault();
        const x = c.currentX ?? c.x;
        const y = c.currentY ?? c.y;
        showArea(c);
        moveToy(
          c,
          x + (e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : e.key === "Enter" || e.key === " " ? -8 : 0),
          y + (e.key === "ArrowUp" || e.key === "Enter" || e.key === " " ? -8 : e.key === "ArrowDown" ? 8 : 0)
        );
      });
      button.addEventListener("keyup", (e) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(e.key)) {
          e.preventDefault();
          c.releaseVX = 0;
          c.releaseVY = 0;
          releaseToy(c);
        }
      });
    });
  }
}

function positionButton(c) {
  const svgEl = stage.querySelector("svg.companion-svg");
  if (!svgEl) return;
  const box = svgEl.getBoundingClientRect();
  const container = stage.getBoundingClientRect();
  const button = stage.querySelector(`.scene-interaction[data-toy="${c.id}"]`);
  if (!button) return;
  button.style.left = `${box.left - container.left + ((c.currentX ?? c.x) / 420) * box.width}px`;
  button.style.top = `${box.top - container.top + ((c.currentY ?? c.y) / 270) * box.height}px`;
  const area = stage.querySelector(".scene-drag-area");
  if (!area?.hidden && area?.dataset.toy === c.id) showArea(c);
}

function showArea(c) {
  const area = stage.querySelector(".scene-drag-area");
  const svgEl = stage.querySelector("svg.companion-svg");
  if (!area || !c.bounds || !svgEl) return;
  const box = svgEl.getBoundingClientRect();
  const container = stage.getBoundingClientRect();
  area.hidden = false;
  area.dataset.toy = c.id;
  area.style.left = `${box.left - container.left + (c.bounds.left / 420) * box.width}px`;
  area.style.top = `${box.top - container.top + (c.bounds.top / 270) * box.height}px`;
  area.style.width = `${((c.bounds.right - c.bounds.left) / 420) * box.width}px`;
  area.style.height = `${((c.bounds.bottom - c.bounds.top) / 270) * box.height}px`;
}

function moveToy(c, x, y) {
  clearTimeout(settleTimer);
  movingToys.delete(c.id);
  x = clamp(x, c.bounds.left, c.bounds.right);
  y = clamp(y, c.bounds.top, c.bounds.bottom);
  if (drag?.c === c) {
    const now = performance.now();
    if (c.sample) {
      const dt = Math.max((now - c.sample.time) / 1000, 0.008);
      c.releaseVX = clamp((x - c.sample.x) / dt, -350, 350);
      c.releaseVY = clamp((y - c.sample.y) / dt, -350, 350);
    }
    c.sample = { x, y, time: now };
  }
  paintToy(c, x, y);
}

function paintToy(c, x, y) {
  c.currentX = x;
  c.currentY = y;
  stage.querySelector(`#toy-${c.id}`)?.setAttribute("transform", `translate(${x} ${y}) rotate(${c.rotation || 0})`);
  const cord = stage.querySelector(`#cord-${c.id}`);
  if (cord) cord.setAttribute("d", `M${c.anchor.x} ${c.anchor.y}L${x} ${y}`);
  positionButton(c);
  stage.dataset.playing = "true";
  const buddy = stage.querySelector(`[data-buddy="${c.buddy}"]`);
  if (buddy) {
    buddy.classList.add("playing");
    buddy.querySelectorAll(".awake-eyes").forEach((e) => (e.style.display = ""));
    buddy.querySelectorAll(".sleep-eyes").forEach((e) => (e.style.display = "none"));
    const svgEl = stage.querySelector("svg.companion-svg");
    const ctm = svgEl?.getScreenCTM();
    if (ctm) {
      const scenePoint = new DOMPoint(x, y).matrixTransform(ctm);
      buddy.querySelectorAll(".companion-pupil").forEach((p) => {
        const faceCtm = p.parentElement.getScreenCTM();
        if (!faceCtm) return;
        const facePoint = scenePoint.matrixTransform(faceCtm.inverse());
        const dx = facePoint.x - Number(p.dataset.gazeX);
        const dy = facePoint.y - Number(p.dataset.gazeY);
        const distance = Math.hypot(dx, dy, 28);
        p.style.transform = `translate(${(dx / distance) * Number(p.dataset.gazeRangeX || 1.5)}px,${(dy / distance) * Number(p.dataset.gazeRangeY || 1.1)}px)`;
      });
    }
    if (c.hand) buddy.classList.toggle("snack-happy", Math.hypot(x - c.hand.x, y - c.hand.y) < 43);
  }
}

function releaseToy(c) {
  if (reduced.matches || !state.reactions || !state.companions) return;
  clearTimeout(settleTimer);
  const fresh = !c.sample || performance.now() - c.sample.time < 100;
  movingToys.set(c.id, { c, vx: fresh ? c.releaseVX || 0 : 0, vy: fresh ? c.releaseVY || 0 : 0, age: 0 });
  stage.dataset.settling = "true";
  if (!physicsFrame) {
    physicsTime = performance.now();
    physicsFrame = requestAnimationFrame(stepPhysics);
  }
}

function stepPhysics(now) {
  const dt = clamp((now - physicsTime) / 1000, 0.001, 0.025);
  physicsTime = now;
  for (const [id, p] of movingToys) {
    const c = p.c;
    let x = c.currentX ?? c.x;
    let y = c.currentY ?? c.y;
    let ax = 0;
    let ay = GRAVITY;
    p.age += dt;
    if (c.anchor) {
      const dx = x - c.anchor.x;
      const dy = y - c.anchor.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const restLength = Math.max(8, Math.hypot(c.x - c.anchor.x, c.y - c.anchor.y) - GRAVITY / 70);
      const extension = Math.max(0, length - restLength);
      const radialSpeed = (p.vx * dx + p.vy * dy) / length;
      const pull = Math.max(0, extension * 70 + radialSpeed * 3.5);
      ax -= (pull * dx) / length;
      ay -= (pull * dy) / length;
    }
    p.vx = (p.vx + ax * dt) * Math.exp(-1.8 * dt);
    p.vy = (p.vy + ay * dt) * Math.exp(-1.8 * dt);
    x += p.vx * dt;
    y += p.vy * dt;
    if (x < c.bounds.left || x > c.bounds.right) {
      x = clamp(x, c.bounds.left, c.bounds.right);
      p.vx *= -0.3;
    }
    if (y < c.bounds.top) {
      y = c.bounds.top;
      p.vy = Math.abs(p.vy) * 0.3;
    }
    if (y > c.bounds.bottom) {
      y = c.bounds.bottom;
      p.vy = -Math.abs(p.vy) * 0.32;
      if (Math.abs(p.vy) < 18) p.vy = 0;
      p.vx *= Math.exp(-8 * dt);
    }
    if (c.anchor) c.rotation = (-Math.atan2(x - c.anchor.x, Math.max(1, y - c.anchor.y)) * 180) / Math.PI;
    else c.rotation = (c.rotation || 0) + p.vx * dt * 0.7;
    paintToy(c, x, y);
    const settled = c.anchor
      ? Math.hypot(p.vx, p.vy) < 3 && Math.abs(x - c.anchor.x) < 0.5 && Math.abs(y - c.y) < 0.6
      : Math.abs(p.vx) < 2 && p.vy === 0 && Math.abs(y - c.y) < 0.1;
    if (settled || p.age > 8) movingToys.delete(id);
  }
  if (movingToys.size) physicsFrame = requestAnimationFrame(stepPhysics);
  else {
    physicsFrame = 0;
    stage.dataset.settling = "false";
    if (!drag) restSoon();
  }
}

function restSoon() {
  settleTimer = setTimeout(() => {
    if (drag || movingToys.size) return;
    stage.dataset.playing = "false";
    stage.querySelectorAll(".playing,.snack-happy").forEach((e) => e.classList.remove("playing", "snack-happy"));
    stage.querySelectorAll(".awake-eyes").forEach((e) => (e.style.display = "none"));
    stage.querySelectorAll(".sleep-eyes").forEach((e) => (e.style.display = ""));
    stage.querySelectorAll(".companion-pupil").forEach((e) => (e.style.transform = ""));
    const area = stage.querySelector(".scene-drag-area");
    if (area) area.hidden = true;
  }, 450);
}

document.addEventListener("change", (e) => {
  const input = e.target;
  if (input.name === "theme") {
    state.theme = input.value;
    render();
  } else if (input.name === "mode") {
    state.mode = input.value;
    updateMode();
  } else if (input.name === "intensity") {
    state.intensity = input.value;
    render();
  } else if (["falling", "companions", "reactions", "pile", "wash"].includes(input.id)) {
    state[input.id] = input.checked;
    render();
  }
});

reduced.addEventListener("change", render);
systemDark.addEventListener("change", updateMode);
new ResizeObserver(() => sceneConfig.forEach(positionButton)).observe(stage);
render();
