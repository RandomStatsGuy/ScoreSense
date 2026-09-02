/** Dating-profile facts for Fantasy → Vibes. Sleeper cache + composed bio — not Wikipedia. */

import { lookupPlayerMedia } from "./draftMedia.js";

const TEAM_JOB = Object.freeze({
  ARI: "Cardinals",
  ATL: "Falcons",
  BAL: "Ravens",
  BUF: "Bills",
  CAR: "Panthers",
  CHI: "Bears",
  CIN: "Bengals",
  CLE: "Browns",
  DAL: "Cowboys",
  DEN: "Broncos",
  DET: "Lions",
  GB: "Packers",
  HOU: "Texans",
  IND: "Colts",
  JAX: "Jaguars",
  JAC: "Jaguars",
  KC: "Chiefs",
  LA: "Rams",
  LAR: "Rams",
  LAC: "Chargers",
  LV: "Raiders",
  MIA: "Dolphins",
  MIN: "Vikings",
  NE: "Patriots",
  NO: "Saints",
  NYG: "Giants",
  NYJ: "Jets",
  PHI: "Eagles",
  PIT: "Steelers",
  SEA: "Seahawks",
  SF: "49ers",
  TB: "Buccaneers",
  TEN: "Titans",
  WAS: "Commanders",
  WSH: "Commanders",
});

const POS_JOB = Object.freeze({
  QB: "Quarterback",
  RB: "Running back",
  WR: "Receiver",
  TE: "Tight end",
  K: "Kicker",
  DEF: "Defense",
  DST: "Defense",
});

export const DEMO_VIBE_PROFILES = Object.freeze({
  "demo-allen": {
    hometown: "Firebaugh, CA",
    college: "Wyoming",
    job: "Quarterback for the Bills",
    age: 30,
    bio: "Firebaugh kid, Wyoming walk-on energy, now I launch footballs in Orchard Park. If you sit me you're the one explaining it in the group chat.",
  },
  "demo-bijan": {
    hometown: "Tucson, AZ",
    college: "Texas",
    job: "Running back for the Falcons",
    age: 24,
    bio: "Tucson to Austin to Atlanta. I want the rock on early downs and the last five minutes. Swipe right if you draft backs to use them.",
  },
  "demo-gibbs": {
    hometown: "Dalton, GA",
    college: "Alabama",
    job: "Running back for the Lions",
    age: 24,
    bio: "Dalton, then Tuscaloosa, now Detroit. I score in bunches and I do not love a timeshare. Start me when the lights are on.",
  },
  "demo-jefferson": {
    hometown: "Destrehan, LA",
    college: "LSU",
    job: "Receiver for the Vikings",
    age: 27,
    bio: "Destrehan, LSU, Minnesota. I run past corners for a living. If your vibe is 'wait for a safer floor,' that's a you problem.",
  },
  "demo-puka": {
    hometown: "Orem, UT",
    college: "BYU",
    job: "Receiver for the Rams",
    age: 25,
    bio: "Orem kid who showed up on a late-round card and refused to leave. I work the middle of the field. Don't make me a secret.",
  },
  "demo-cd": {
    hometown: "Richmond, TX",
    college: "Oklahoma",
    job: "Receiver for the Cowboys",
    age: 27,
    bio: "Foster High, then Norman, now Dallas. I want targets and I want them early. Sit me and I'll still be open.",
  },
  "demo-bowers": {
    hometown: "Napa, CA",
    college: "Georgia",
    job: "Tight end for the Raiders",
    age: 23,
    bio: "Napa to Athens to Vegas. I play tight end like a receiver who grew extra size. If you're waiting on 'the safe TE,' that's not this card.",
  },
  "demo-kittle": {
    hometown: "Norman, OK",
    college: "Iowa",
    job: "Tight end for the 49ers",
    age: 32,
    bio: "Norman, Iowa, then every yard after contact in Santa Clara. I block, I YAC, I talk. Start me or hear about it.",
  },
  "demo-saquon": {
    hometown: "Whitehall, PA",
    college: "Penn State",
    job: "Running back for the Eagles",
    age: 29,
    bio: "Whitehall to Happy Valley to Philly. I still bounce it outside and I still want the goal line. Year nine. Don't overthink it.",
  },
  "demo-sun-god": {
    hometown: "Santa Ana, CA",
    college: "USC",
    job: "Receiver for the Lions",
    age: 26,
    bio: "Mater Dei, USC, Detroit. Slot, boundary, third down — I live there. If you need a 'vibe' to start me, the vibe is volume.",
  },
});

const HS_TOWN = /^(.+?)\s*\(([A-Za-z]{2})\)\s*$/;

export function hometownFromHighSchool(highSchool) {
  const text = String(highSchool || "").trim();
  if (!text) return "";
  const match = text.match(HS_TOWN);
  if (!match) return text;
  const town = match[1].trim();
  const state = match[2].toUpperCase();
  return town && state ? `${town}, ${state}` : text;
}

export function hometownFromFacts(facts = {}) {
  const city = String(facts.birth_city || "").trim();
  const state = String(facts.birth_state || "").trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  return hometownFromHighSchool(facts.high_school);
}

export function teamNickname(team) {
  const abbr = String(team || "").trim().toUpperCase();
  return TEAM_JOB[abbr] || abbr;
}

export function positionJob(position) {
  const pos = String(position || "").trim().toUpperCase();
  return POS_JOB[pos] || pos || "Player";
}

export function jobLine({ position, team, number } = {}) {
  const role = positionJob(position);
  const nick = teamNickname(team);
  if (!nick) return role;
  const jersey = number != null && String(number).trim() !== "" ? `#${number} · ` : "";
  return `${jersey}${role} for the ${nick}`;
}

export function formatHeight(raw) {
  if (raw == null || raw === "") return "";
  const text = String(raw).trim();
  const feetIn = text.match(/^(\d)\s*['′]\s*(\d{1,2})\s*["″]?$/);
  if (feetIn) return `${feetIn[1]}'${Number(feetIn[2])}"`;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 48 || n > 90) return "";
  const feet = Math.floor(n / 12);
  const inches = Math.round(n % 12);
  return `${feet}'${inches}"`;
}

export function firstName(playerName) {
  return String(playerName || "").trim().split(/\s+/)[0] || "";
}

export function composeBio({ hometown, college, team, position, yearsExp } = {}) {
  const parts = [];
  if (hometown) parts.push(`Grew up in ${hometown}.`);
  if (college) parts.push(`${college} is where I learned the job.`);
  const nick = teamNickname(team);
  const role = positionJob(position).toLowerCase();
  if (nick) parts.push(`Now I play ${role} for the ${nick}.`);
  const years = Number(yearsExp);
  if (Number.isFinite(years) && years <= 0) {
    parts.push("Rookie year. Don't sit me on a feeling.");
  } else if (Number.isFinite(years) && years > 0) {
    parts.push(`Year ${years + 1}. I still want the snap.`);
  }
  return parts.join(" ") || "Rate the week. I'll take it from there.";
}

export function profileFacts(profile) {
  const rows = [];
  if (profile.hometown) rows.push({ id: "from", label: "From", value: profile.hometown });
  if (profile.college) rows.push({ id: "college", label: "College", value: profile.college });
  if (profile.job) rows.push({ id: "job", label: "Job", value: profile.job });
  if (profile.age) rows.push({ id: "age", label: "Age", value: String(profile.age) });
  if (profile.size) rows.push({ id: "size", label: "Size", value: profile.size });
  return rows;
}

function pick(demo, media, key) {
  if (demo?.[key] != null && demo[key] !== "") return demo[key];
  if (media?.[key] != null && media[key] !== "") return media[key];
  return "";
}

export function buildVibeProfile(player, mediaMap) {
  const demo = DEMO_VIBE_PROFILES[player?.player_id] || null;
  const media = lookupPlayerMedia(mediaMap, player?.player_id) || {};
  const hometown = demo?.hometown || hometownFromFacts({
    birth_city: media.birth_city,
    birth_state: media.birth_state,
    high_school: media.high_school || player?.high_school,
  });
  const college = pick(demo, media, "college") || player?.college || "";
  const age = demo?.age || media.age || player?.age || null;
  const yearsExp = media.years_exp ?? player?.years_exp;
  const number = media.jersey_number || media.number || player?.number;
  const job = demo?.job || jobLine({
    position: player?.position,
    team: player?.team || media.team,
    number,
  });
  const height = formatHeight(media.height || player?.height);
  const weight = media.weight || player?.weight;
  const size = [height, weight ? `${weight} lbs` : ""].filter(Boolean).join(" · ");
  const bio = demo?.bio || composeBio({
    hometown,
    college,
    team: player?.team || media.team,
    position: player?.position,
    yearsExp,
  });
  const profile = {
    hometown,
    college,
    job,
    age,
    size,
    bio,
  };
  return {
    ...profile,
    facts: profileFacts(profile),
  };
}
