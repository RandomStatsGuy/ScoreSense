import test from "node:test";
import assert from "node:assert/strict";
import { playerCardPace, playerCardNumber, playerCardInjuryCode } from "./projectionsPresentation.js";

test("season pace compares equal games played, never the full preseason total", () => {
  const summary={points:129.4,games_played:5,complete:true};
  assert.deepEqual(playerCardPace(summary,{points:344,games:17}), {difference:28.2,tone:"positive",label:"↑ 28.2 ahead of preseason pace"});
  assert.equal(playerCardPace(summary,{points:460,games:17}).tone,"negative");
  assert.equal(playerCardPace({...summary,points:0},{points:0,games:17}).label,"On preseason pace");
});
test("missing baseline, incomplete results, and missing scores stay unknown", () => {
  assert.equal(playerCardPace({points:129,games_played:5,complete:true},null),null);
  assert.equal(playerCardPace({points:129,games_played:5,complete:false},{points:344,games:17}),null);
  assert.equal(playerCardPace({points:129,games_played:5,complete:true},{points:344,games:0}),null);
  for(const value of [null,undefined,NaN,Infinity,"0"])assert.equal(playerCardNumber(value),"—");
  assert.equal(playerCardNumber(0),"0.0");
});
test("injury tags omit healthy players and retain actual designations", () => {
  assert.equal(playerCardInjuryCode("Questionable"),"Q");
  assert.equal(playerCardInjuryCode("Out"),"O");
  assert.equal(playerCardInjuryCode("IR"),"IR");
  for(const status of [null,"","Healthy","Active"])assert.equal(playerCardInjuryCode(status),null);
});
