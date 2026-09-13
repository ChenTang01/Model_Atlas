import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const topics = require("../assets/topics.js");
const records = JSON.parse(await readFile(new URL("../data/atlas_articles.json", import.meta.url), "utf8")).records;
const categoryIds = ["platforms", "information", "pricing", "supply-chains", "mechanisms", "organizations", "innovation", "policy"];

test("the eight navigational topics account for every audited paper exactly once", () => {
  const index = topics.createTopicIndex(records);
  assert.deepEqual(index.map((topic) => topic.id), categoryIds);
  const assignedIds = index.flatMap((topic) => topic.ids);
  assert.equal(assignedIds.length, records.length);
  assert.equal(new Set(assignedIds).size, records.length);
  assert.deepEqual(new Set(assignedIds), new Set(records.map((record) => record.id)));
  for (const topic of index) {
    assert.ok(topic.count > 0, `${topic.label} is populated`);
    assert.equal(topic.count, topic.ids.length);
    assert.ok(topic.label && topic.description);
    assert.deepEqual(topic.ids, records.filter((record) => topics.classifyPaper(record) === topic.id).map((record) => record.id));
  }
});

test("classification follows deterministic weighted topic metadata, not query or full text", () => {
  const examples = [
    ["platforms", "Platforms and marketplaces"],
    ["information", "Information disclosure and signaling"],
    ["pricing", "Pricing, assortment, and revenue management"],
    ["supply-chains", "Supply chains and contracts"],
    ["mechanisms", "Auctions and market design"],
    ["organizations", "Finance and crowdfunding"],
    ["innovation", "Innovation and product development"],
    ["policy", "Sustainability and responsible operations"]
  ];
  for (const [expected, primary_topic] of examples) {
    const paper = { primary_topic, title: "platform information consumer supply auction finance innovation policy", query: "finance", method: "machine learning", business_question: "Financial markets" };
    assert.equal(topics.classifyPaper(paper), expected, primary_topic);
    assert.equal(topics.classifyPaper(paper), topics.classifyPaper(structuredClone(paper)));
  }
  assert.equal(topics.classifyPaper({ primary_topic: "Supply-chain coordination", topic_families: ["Pricing"], model_topic: "Dynamic pricing" }), "supply-chains");
  assert.equal(topics.classifyPaper({ topic_families: ["Platforms and marketplaces"] }), "platforms");
  assert.equal(topics.classifyPaper({ topics: ["Information disclosure"] }), "information");
  assert.equal(topics.classifyPaper({ model_topic: "Carbon regulation" }), "policy");
  assert.equal(topics.classifyPaper({ primary_topic: "NONLINEAR PRICING" }), "pricing");
});

test("repeated metadata and record ordering cannot change classification", () => {
  const base = { primary_topic: "Supply-chain contracts", topic_families: ["Pricing"], topics: ["Pricing"] };
  assert.equal(topics.classifyPaper(base), topics.classifyPaper({ ...base, topics: Array(100).fill("Pricing") }));
  const reversed = topics.createTopicIndex([...records].reverse());
  const original = topics.createTopicIndex(records);
  assert.deepEqual(reversed.map((topic) => topic.id), original.map((topic) => topic.id));
  assert.deepEqual(reversed.map((topic) => topic.count), original.map((topic) => topic.count));
  for (let index = 0; index < original.length; index += 1) {
    assert.deepEqual(reversed[index].ids, [...original[index].ids].reverse());
  }
});

test("empty data retains topic definitions and missing metadata has an explicit fallback", () => {
  const empty = topics.createTopicIndex([]);
  assert.equal(empty.length, 8);
  assert.ok(empty.every((topic) => topic.count === 0 && topic.ids.length === 0));
  assert.equal(topics.classifyPaper({}), "organizations");
  assert.equal(topics.classifyPaper(null), "organizations");
  assert.equal(topics.classifyPaper({ primary_topic: "Unclassified material" }), "organizations");
  empty[0].ids.push("a caller mutation");
  assert.deepEqual(topics.createTopicIndex([])[0].ids, []);
  assert.ok(Object.isFrozen(topics.DEFINITIONS));
});

test("the same dependency-free API is available to plain browser scripts", async () => {
  const source = await readFile(new URL("../assets/topics.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  assert.equal(typeof context.AtlasTopics.classifyPaper, "function");
  assert.equal(context.AtlasTopics.classifyPaper({ primary_topic: "Mechanism design" }), "mechanisms");
  assert.deepEqual(Array.from(context.AtlasTopics.DEFINITIONS, (topic) => topic.id), categoryIds);
});
