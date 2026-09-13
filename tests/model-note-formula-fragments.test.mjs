import assert from "node:assert/strict";
import test from "node:test";

import { formalStructureIssue } from "../scripts/model-note-formula-quality.mjs";

const STRICT = "Source-extracted equation (not visually verified)";

test("strict formula validation rejects corpus-observed PDF equation shards", () => {
  const fragments = [
    "2 and ρ(K) = 1",
    "• if(πb/(πb + hm))≤ 1−π2",
    "(P; o) ≥ π",
    "{Xjt, pjt, Iit}, ...",
    "γ(K)ρ(K) = O(d/s0) and log K",
    "t=Tm−1+1",
    "Xjt = pjt + Iit",
    "L1 = v-p+e"
  ];
  for (const fragment of fragments) {
    assert.notEqual(formalStructureIssue(fragment, STRICT), "", fragment);
  }
});

test("strict formula validation preserves complete neighboring forms", () => {
  const complete = [
    "ρ(K) = 1",
    "π_b/(π_b + h_m) ≤ 1−π_2",
    "π_g^*(P;o) ≥ π_g^*(P';o)",
    "X_{jt} ∈ {0,1}",
    "t = T_{m-1}+1",
    "X_{jt} = p_{jt} + I_{it}",
    "L_1 = v-p+e",
    "γ(K)ρ(K) = O(d/s_0)"
  ];
  for (const formula of complete) {
    assert.equal(formalStructureIssue(formula, STRICT), "", formula);
  }
});
