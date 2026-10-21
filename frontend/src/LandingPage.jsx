import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PRODUCT_NAME, STUDIO_NAME } from "./brand";
import ThemeToggle from "./layout/ThemeToggle";
import { useAuth } from "./AuthContext";
import { LANDING_COPY as C, LANDING_INTENTS, LANDING_PLAYERS, landingAction, landingAuthHref, landingContent, landingForPath, landingIntent, landingPlayerRangeLabel, landingSelectionAnnouncement } from "./landingPresentation";
import "./styles/landing.css";

const Arrow = () => <span aria-hidden="true">↗</span>;
const Lines = ({ lines }) => lines.map((line, i) => <React.Fragment key={line}>{i > 0 && <br />}{line}</React.Fragment>);

function IntentIcon({ intent }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {intent === "weekly" ? <path d="M4 19h16M6 15v-4m6 4V5m6 10V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : intent === "fantasy" ? <path d="m8 3 4 2 4-2 5 4-3 5-2-1v10H8V11l-2 1-3-5 5-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /> : <><circle cx="5" cy="18" r="2" stroke="currentColor" strokeWidth="1.5" /><path d="M5 16V9h8l6-6m-5 0h5v5M12 15l6 6m0-6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>}
  </svg>;
}

function AmbientLight({ stageRef }) {
  const atmosphereRef = useRef(null);
  useEffect(() => {
    const stage = stageRef.current;
    const atmosphere = atmosphereRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0, x = 0, y = 0;
    const paint = () => { frame = 0; atmosphere.style.setProperty("--pointer-x", `${x.toFixed(1)}px`); atmosphere.style.setProperty("--pointer-y", `${y.toFixed(1)}px`); };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
    const move = event => {
      if (reduced.matches || !fine.matches || event.pointerType !== "mouse") return;
      const bounds = stage.getBoundingClientRect();
      x = Math.max(-24, Math.min(24, ((event.clientX - bounds.left) / bounds.width - .5) * 48));
      y = Math.max(-16, Math.min(16, ((event.clientY - bounds.top) / bounds.height - .5) * 32));
      schedule();
    };
    const reset = () => { x = 0; y = 0; schedule(); };
    stage.addEventListener("pointermove", move, { passive: true });
    stage.addEventListener("pointerleave", reset, { passive: true });
    reduced.addEventListener("change", reset);
    return () => { stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerleave", reset); reduced.removeEventListener("change", reset); if (frame) window.cancelAnimationFrame(frame); };
  }, [stageRef]);
  return <div className="interactive-atmosphere" ref={atmosphereRef} aria-hidden="true"><div className="atmosphere-light" /><svg className="atmosphere-lines" width="1300" height="1000" viewBox="0 0 1300 1000" fill="none"><defs><linearGradient id="landing-contour" x1="300" y1="0" x2="1150" y2="850" gradientUnits="userSpaceOnUse"><stop stopColor="var(--text-muted)" stopOpacity="0" /><stop offset=".5" stopColor="var(--text-muted)" stopOpacity=".45" /><stop offset="1" stopColor="var(--text-muted)" stopOpacity="0" /></linearGradient></defs><g stroke="url(#landing-contour)" strokeWidth=".8">{[580, 640, 700, 760, 820].map(n => <path key={n} d={`M${n}-150C${n + 580} 70 ${n + 110} 380 ${n + 650} 780`} />)}</g></svg></div>;
}

function RadioChoices({ label, options, value, onChange, className = "" }) {
  const buttons = useRef([]);
  function keyDown(event, index) {
    const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : null;
    if (delta == null && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + delta + options.length) % options.length;
    onChange(options[next].id); buttons.current[next]?.focus();
  }
  return <div className={className} role="radiogroup" aria-label={label}>{options.map((option, index) => <button key={option.id} ref={node => { buttons.current[index] = node; }} type="button" role="radio" aria-checked={value === option.id} tabIndex={value === option.id ? 0 : -1} className={option.className} onClick={() => onChange(option.id)} onKeyDown={event => keyDown(event, index)} {...option.attributes}>{option.content || option.label}</button>)}</div>;
}

function Jersey({ number }) {
  return <span className="jersey jersey-blue" aria-hidden="true"><svg width="96" height="100" viewBox="0 0 96 100" fill="none"><defs><linearGradient id="landing-jersey" x1="10" x2="87" y1="30" y2="70" gradientUnits="userSpaceOnUse"><stop stopColor="var(--accent)" /><stop offset=".46" stopColor="var(--accent-muted)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient><pattern id="landing-knit" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".35" fill="var(--bg-base)" opacity=".25" /></pattern></defs><path d="m29 8 12 9h14l12-9 21 13-9 22-11-4v53H28V39l-11 4-9-22L29 8Z" fill="url(#landing-jersey)" /><path d="m29 8 12 9h14l12-9 21 13-9 22-11-4v53H28V39l-11 4-9-22L29 8Z" fill="url(#landing-knit)" /><path d="m41 17 7 8 7-8M28 39V27M68 39V27" stroke="var(--bg-base)" strokeWidth="2" /><path d="m17 22 13-8m36 0 13 8M32 83v5h32v-5" stroke="var(--text-primary)" strokeOpacity=".35" strokeWidth="1.5" /></svg><b>{number}</b></span>;
}

function WeeklyPreview({ playerId, onPlayer }) {
  const p = LANDING_PLAYERS.find(player => player.id === playerId);
  const c = C.weekly;
  return <><div className="preview-heading"><p className="eyebrow">{c.eyebrow}</p><h2>{c.title}</h2></div><div className="projection-sample"><div className="projection-lead"><Jersey number={p.number} /><div className="projection-player"><small>{c.selected}</small><h3>{p.name}</h3><p>{c.outlook}</p></div><div className="median"><strong>{p.typical}</strong><span>{c.typical}</span></div></div><div className="range-visual" role="img" aria-label={landingPlayerRangeLabel(p)}><div className="range-labels"><span>{c.floor} <strong>{p.floor}</strong><small>{c.p10}</small></span><span className="range-mid">{c.range}</span><span>{c.ceiling} <strong>{p.ceiling}</strong><small>{c.p90}</small></span></div><div className="range-track"><svg className="range-plot" width="600" height="112" viewBox="0 0 600 112" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="landing-range" x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--accent-muted)" stopOpacity=".65" /><stop offset="1" stopColor="var(--accent)" stopOpacity=".03" /></linearGradient></defs><g className="plot-grid" stroke="var(--border-strong)" strokeWidth=".7">{[60, 120, 180, 240, 300, 360, 420, 480, 540].map(x => <path key={x} d={`M${x} 0v108`} />)}</g><path d="M0 108C70 108 94 100 139 82C187 62 221 10 290 10C359 10 389 63 445 85C495 105 536 108 600 108V112H0Z" fill="url(#landing-range)" /><path d="M0 108C70 108 94 100 139 82C187 62 221 10 290 10C359 10 389 63 445 85C495 105 536 108 600 108" stroke="var(--accent-muted)" strokeWidth="2" fill="none" /></svg><span className="median-marker" style={{ left: p.marker }}><i /></span><span className="range-dot range-dot-start" /><span className="range-dot range-dot-end" /></div><div className="range-scale"><span>{c.lower}</span><span>{c.higher}</span></div></div></div><RadioChoices className="player-picks" label={c.choices} value={playerId} onChange={onPlayer} options={LANDING_PLAYERS.map(item => ({ id: item.id, className: "player-pick", content: <><span>{item.name}<small>{c.rowHint}</small></span><strong>{item.typical} <small>{c.points}</small></strong></> }))} /><p className="preview-note">{c.note}</p></>;
}

function FantasyPreview({ backdrop, onBackdrop }) {
  const c = C.fantasy;
  return <><div className="preview-heading"><p className="eyebrow">{c.eyebrow}</p><h2><Lines lines={c.title} /></h2></div><div className="sample-matchup"><div className="team-identity"><span className="team-shield">N<span>04</span></span><strong>{c.first}</strong><small>{c.firstOwner}</small></div><div className="matchup-center"><small>{c.sample}</small><div><b>{c.firstScore}</b><span>{c.vs}</span><b>{c.secondScore}</b></div><p>{c.points}</p></div><div className="team-identity"><span className="team-shield team-shield-away">S<span>11</span></span><strong>{c.second}</strong><small>{c.secondOwner}</small></div></div><div className="sample-chat"><span className="chat-initial" aria-hidden="true">J</span><p><strong>{c.author}<small>{c.chatLabel}</small></strong>{c.chat}</p><span aria-hidden="true">↳</span></div><div className="room-switch"><p><strong>{c.room}</strong><span>{c.roomHint}</span></p><RadioChoices label={c.group} value={backdrop} onChange={onBackdrop} options={[{ id: "stadium", label: c.stadium }, { id: "city", label: c.city }]} /></div><p className="preview-note">{c.note}</p></>;
}

function ToolsPreview({ strategy, onStrategy }) {
  const c = C.tools, receivers = strategy === "receivers";
  return <><div className="preview-heading"><p className="eyebrow">{c.eyebrow}</p><h2><Lines lines={c.title} /></h2></div><div className="practice-board"><div className="practice-header"><span>{c.sample}</span><strong>{c.round} <span>·</span> {c.pick}</strong></div><div className="draft-seats"><div><small>2.05</small><span>WR</span><strong>{c.receiver}</strong></div><div><small>2.06</small><span>RB</span><strong>{c.runningBack}</strong></div><div className="your-pick"><small>{c.yourPick}</small><span>{receivers ? "WR" : "RB"}</span><strong>{receivers ? c.receiversPick : c.balancedPick}</strong></div></div><div className="strategy-controls"><span>{c.choices}</span><RadioChoices label={c.group} value={strategy} onChange={onStrategy} options={[{ id: "balanced", label: c.balanced }, { id: "receivers", label: c.receivers }]} /></div><p className="strategy-note">{receivers ? c.receiversNote : c.balancedNote}</p></div><div className="tool-index">{c.index.map(item => <span key={item}>{item}</span>)}</div><p className="preview-note">{c.note}</p></>;
}

function WayArt({ intent }) {
  if (intent === "weekly") return <div className="way-art range-art" aria-hidden="true"><span className="range-art-line" /><b>{LANDING_PLAYERS[0].floor}</b><strong>{LANDING_PLAYERS[0].typical}</strong><b>{LANDING_PLAYERS[0].ceiling}</b><span>{C.weekly.floor}</span><span>{C.weekly.typical.split(" ·")[0]}</span><span>{C.weekly.ceiling}</span></div>;
  if (intent === "fantasy") return <div className="way-art rivalry-art" aria-hidden="true"><span className="rivalry-initial">N</span><span className="rivalry-vs">{C.fantasy.vs}</span><span className="rivalry-initial away">S</span><small>{C.ways.rivalry}</small></div>;
  return <div className="way-art play-art" aria-hidden="true"><svg width="240" height="150" viewBox="0 0 240 150" fill="none"><path d="M28 117h184M28 35h184M45 116V70h51l44-42M117 116V78h72V47" stroke="currentColor" strokeWidth="2" /><path d="m129 28 11-1-1 11M178 55l11-10 9 11" stroke="currentColor" strokeWidth="2" /><circle cx="45" cy="116" r="7" fill="var(--bg-elevated)" stroke="currentColor" strokeWidth="2" /><circle cx="117" cy="116" r="7" fill="var(--bg-elevated)" stroke="currentColor" strokeWidth="2" /><path d="m173 111 12 12m0-12-12 12" stroke="currentColor" strokeWidth="2" /></svg></div>;
}

export default function LandingPage() {
  const location = useLocation();
  const { authenticated } = useAuth();
  const product = landingForPath(location.pathname);
  const C = landingContent(product?.id);
  const [intent, setIntent] = useState(() => landingIntent(new URLSearchParams(location.search).get("intent")).id);
  const [playerId, setPlayerId] = useState(LANDING_PLAYERS[0].id);
  const [backdrop, setBackdrop] = useState("stadium");
  const [strategy, setStrategy] = useState("balanced");
  const [interacted, setInteracted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const stageRef = useRef(null), workspaceRef = useRef(null);
  const selected = product || landingIntent(intent);
  const activeIntent = selected.id;
  const signup = landingAuthHref(activeIntent), login = landingAuthHref(activeIntent, "login");
  const action = landingAction(activeIntent, { authenticated, overview: !product });
  useEffect(() => { document.title = `${C.pageTitle} · ${PRODUCT_NAME}`; }, [C.pageTitle]);
  useEffect(() => { setIntent(landingIntent(new URLSearchParams(location.search).get("intent")).id); }, [location.search]);
  useEffect(() => { setAnnouncement(""); window.scrollTo({ top: 0, behavior: "instant" }); }, [location.pathname]);
  function chooseIntent(value) { setIntent(value); setInteracted(true); setAnnouncement(landingSelectionAnnouncement(value)); }
  function explore(event, value) {
    event.preventDefault(); chooseIntent(value);
    workspaceRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    workspaceRef.current?.focus({ preventScroll: true });
  }
  function choosePlayer(value) { setPlayerId(value); setAnnouncement(landingPlayerRangeLabel(LANDING_PLAYERS.find(item => item.id === value))); }
  function chooseBackdrop(value) { setBackdrop(value); setAnnouncement(`${value === "city" ? C.fantasy.city : C.fantasy.stadium} ${C.fantasy.backdropSelected}`); }
  function chooseStrategy(value) { setStrategy(value); setAnnouncement(value === "receivers" ? C.tools.receiversNote : C.tools.balancedNote); }
  return <div className="ss-landing" data-intent={activeIntent} data-product={product?.id || "overview"}>
    <a className="app-skip-link" href="#main-content">{C.skip}</a><AmbientLight stageRef={stageRef} />
    <header className="site-header wrap"><Link className="brand" to="/" aria-label={C.home}><span className="brand-symbol" aria-hidden="true">S<span>↗</span></span><span className="brand-name">{PRODUCT_NAME}<small>{C.by} {STUDIO_NAME}</small></span></Link><nav className="product-nav" aria-label={C.nav}>{LANDING_INTENTS.map(item => <Link key={item.id} to={item.landing} aria-current={product?.id === item.id ? "page" : undefined}>{item.area}</Link>)}</nav><div className="header-actions"><ThemeToggle compact />{authenticated ? <Link className="button button-outline" to={selected.path}>{C.openProduct} <Arrow /></Link> : <><Link className="sign-in" to={login}>{C.signIn}</Link>{product?.id !== "weekly" && <Link className="button button-outline" to={signup}>{C.create} <Arrow /></Link>}</>}</div></header>
    <main id="main-content" tabIndex={-1}>
      <section className="hero wrap" ref={stageRef} aria-labelledby="landing-title">
        <div className="hero-heading"><div><p className="eyebrow hero-brandline"><span className="hero-wordmark">{PRODUCT_NAME}</span><span className="hero-category">{C.eyebrow}</span></p><h1 id="landing-title">{C.heading[0]}<br /><span>{C.heading[1]}</span></h1></div><p className="hero-intro">{C.intro}</p></div>
        <div className="decision-layout"><div className="decision-start">
          {product ? <div className="product-points"><p className="eyebrow">{C.inside}</p><ul>{C.points.map(([title, text]) => <li key={title}><strong>{title}</strong><span>{text}</span></li>)}</ul></div> : <fieldset className="intent-picker"><legend>{C.start}</legend>{LANDING_INTENTS.map(item => <label className="intent-choice" key={item.id}><input type="radio" name="landing-intent" value={item.id} checked={intent === item.id} onChange={() => chooseIntent(item.id)} aria-controls="decision-preview" aria-label={item.title} /><span className="choice-number" aria-hidden="true"><IntentIcon intent={item.id} /></span><span className="choice-copy"><strong>{item.title}</strong><span className="choice-mobile-name">{item.mobile}</span><small>{item.hint}</small></span><span className="choice-arrow" aria-hidden="true">↗</span></label>)}</fieldset>}
          <div className="start-action"><Link className="button button-primary" to={action.href}>{action.label} <Arrow /></Link><p>{action.note}</p></div>
        </div><div className="workspace" id="decision-preview" ref={workspaceRef} tabIndex={-1} role="region" aria-label={`${selected.area} · ${C.sampleRegion}`}><div className="workspace-chrome"><span className="workspace-mark" aria-hidden="true">S</span><span>{selected.area}</span><span className="sample-tag">{C.sample}</span></div><section key={activeIntent} className={`preview-panel ${activeIntent === "fantasy" ? "fantasy-preview" : activeIntent === "tools" ? "tools-preview" : ""}${interacted ? " is-entering" : ""}`} data-backdrop={activeIntent === "fantasy" ? backdrop : undefined}>{activeIntent === "weekly" ? <WeeklyPreview playerId={playerId} onPlayer={choosePlayer} /> : activeIntent === "fantasy" ? <FantasyPreview backdrop={backdrop} onBackdrop={chooseBackdrop} /> : <ToolsPreview strategy={strategy} onStrategy={chooseStrategy} />}</section></div></div>
        <p className="landing-announcement" aria-live="polite" role="status">{announcement}</p><div className="hero-tail"><span>{C.heroTail[0]}</span><span>{C.heroTail[1]}</span><a href="#ways-to-play" aria-label={C.exploreLabel}>{C.explore} <span aria-hidden="true">↓</span></a></div>
      </section>
      <section className="ways-section section-pad" id="ways-to-play" aria-labelledby="ways-heading"><div className="wrap"><div className="section-heading"><p className="eyebrow">{C.ways.eyebrow}</p><h2 id="ways-heading"><Lines lines={C.ways.title} /></h2><p>{C.ways.intro}</p></div><div className="ways-list">{C.ways.rows.map((row, i) => <article key={row.intent}><span className="way-number">{String(i + 1).padStart(2, "0")}</span><div><p className="eyebrow">{row.area}</p><h3><Lines lines={row.title} /></h3><p>{row.text}</p>{row.preview ? <a href="#decision-preview" onClick={event => explore(event, row.intent)}>{row.link} <Arrow /></a> : <Link to={row.path || landingIntent(row.intent).landing}>{row.link} <Arrow /></Link>}</div><WayArt intent={row.intent} /></article>)}</div></div></section>
      {(!product || activeIntent === "fantasy") && <><section className="league-section section-pad wrap" aria-labelledby="league-heading"><div className="clubhouse-art"><div className="clubhouse-top"><span>{C.league.sampleName}</span><span>{C.league.sample}</span></div><div className="clubhouse-lockers" aria-hidden="true">{["11", "04", "26"].map((number, i) => <div key={number}><span>{number}</span><small>{C.league.jerseyLabels[i]}</small></div>)}</div><p>{C.league.caption}</p></div><div className="league-copy"><p className="eyebrow">{C.league.eyebrow}</p><h2 id="league-heading"><Lines lines={C.league.title} /></h2><p>{C.league.intro}</p><div className="league-features">{C.league.features.map(([title, text]) => <p key={title}><strong>{title}</strong><span>{text}</span></p>)}</div></div></section>
      <section className="league-model-section section-pad" aria-labelledby="model-heading"><div className="wrap model-layout"><div><p className="eyebrow">{C.models.eyebrow}</p><h2 id="model-heading"><Lines lines={C.models.title} /></h2><p>{C.models.intro}</p></div><div className="model-options"><article><span className="model-icon" aria-hidden="true">S</span><div><h3>{C.models.native}</h3><p>{C.models.nativeText}</p></div></article><article><span className="model-icon sleeper-icon" aria-hidden="true">↔</span><div><h3>{C.models.linked}</h3><p>{C.models.linkedText}</p></div></article><p className="model-footnote">{C.models.note}</p></div></div></section></>}
      <section className="faq-section section-pad wrap" aria-labelledby="faq-heading"><div className="section-heading"><p className="eyebrow">{C.faq.eyebrow}</p><h2 id="faq-heading">{C.faq.title}</h2></div><div className="faq-list">{C.faq.rows.map(([question, answer]) => <details key={question}><summary><span>{question}</span><span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="closing-section section-pad wrap" aria-labelledby="closing-heading"><p className="eyebrow">{C.closing.eyebrow}</p><h2 id="closing-heading"><Lines lines={C.closing.title} /></h2><p>{selected.closing}</p><Link className="button button-primary" to={action.href}>{action.label} <Arrow /></Link><span className="closing-note">{product ? action.note : C.closing.note}</span></section>
    </main><footer className="site-footer wrap"><Link className="footer-brand" to="/">{PRODUCT_NAME} <span>{C.by} {STUDIO_NAME}</span></Link><nav aria-label={C.legalNav}>{!authenticated && <Link to={login}>{C.signIn}</Link>}<Link to="/terms">{C.terms}</Link><Link to="/privacy">{C.privacy}</Link></nav><p>{C.disclaimer}</p></footer>
  </div>;
}
