const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function readScoringRuntime() {
  const definitions = html.match(
    /const FREQ5[\s\S]*?const INDICATORS_CONFIG = \{[\s\S]*?\n\};/
  );
  const getFieldName = html.match(
    /function getFieldName\(q, index\) \{[\s\S]*?\n\}/
  );
  const scoringFunctions = html.match(
    /function getQuestionByFieldName[\s\S]*?(?=function clearInvalidUI)/
  );

  assert.ok(definitions, "Definições de pontuação não encontradas");
  assert.ok(getFieldName, "getFieldName não encontrado");
  assert.ok(scoringFunctions, "Funções de pontuação não encontradas");

  const context = {};
  vm.runInNewContext(
    `${definitions[0]}\n${getFieldName[0]}\n${scoringFunctions[0]}\n` +
      "this.runtime = { FORM_QUESTIONS, INDICATORS_CONFIG, buildScoringResult, getFieldName };",
    context
  );

  return context.runtime;
}

function readIndicatorsConfig() {
  const match = html.match(
    /const INDICATORS_CONFIG = (\{[\s\S]*?\n\});\s*\/\*{10,}/
  );

  assert.ok(match, "INDICATORS_CONFIG não encontrado no index.html");
  return vm.runInNewContext(`(${match[1]})`);
}

function readReverseItems() {
  return Array.from(
    html.matchAll(/\{\s*name:\s*"(\d+)",([\s\S]*?)\n\},/g)
  )
    .filter((match) => /reverse:\s*true/.test(match[2]))
    .map((match) => Number(match[1]));
}

const config = readIndicatorsConfig();
const runtime = readScoringRuntime();

const expectedDomains = {
  linguagem: [2, 7, 15, 27, 35, 58, 66],
  relacionamento_social: [
    1, 3, 5, 6, 8, 11, 12, 14, 17, 18, 20, 21, 22,
    23, 25, 26, 28, 31, 37, 38, 39, 43, 44, 45, 47, 48,
    53, 54, 55, 60, 61, 64, 68, 69, 72, 76, 77, 79, 80
  ],
  sensorio_motor: [
    4, 10, 16, 19, 29, 33, 34, 36, 40, 46,
    49, 51, 57, 59, 62, 65, 67, 71, 73, 74
  ],
  interesses_circunscritos: [
    9, 13, 24, 30, 32, 41, 42, 50, 52, 56, 63, 70, 75, 78
  ]
};

test("configura os cinco indicadores enviados em results_meta", () => {
  assert.deepEqual(Object.keys(config), [
    "total_raads_r",
    "linguagem",
    "relacionamento_social",
    "sensorio_motor",
    "interesses_circunscritos"
  ]);

  assert.deepEqual(
    Array.from(config.total_raads_r.questions),
    Array.from({ length: 80 }, (_, index) => index + 1)
  );
});

test("usa o crivo de domínios do manual e cobre os 80 itens uma única vez", () => {
  for (const [key, expectedItems] of Object.entries(expectedDomains)) {
    assert.deepEqual(Array.from(config[key].questions), expectedItems, key);
  }

  const domainItems = Object.keys(expectedDomains).flatMap(
    (key) => Array.from(config[key].questions)
  );

  assert.equal(domainItems.length, 80);
  assert.equal(new Set(domainItems).size, 80);
  assert.deepEqual(
    [...new Set(domainItems)].sort((a, b) => a - b),
    Array.from({ length: 80 }, (_, index) => index + 1)
  );
});

test("mantém o crivo reverso e os limites máximos da RAADS-R", () => {
  assert.deepEqual(readReverseItems(), [
    1, 6, 11, 18, 23, 26, 33, 37, 43,
    47, 48, 53, 58, 62, 68, 72, 77
  ]);

  assert.deepEqual(
    {
      total_raads_r: config.total_raads_r.questions.length * 3,
      linguagem: config.linguagem.questions.length * 3,
      relacionamento_social: config.relacionamento_social.questions.length * 3,
      sensorio_motor: config.sensorio_motor.questions.length * 3,
      interesses_circunscritos: config.interesses_circunscritos.questions.length * 3
    },
    {
      total_raads_r: 240,
      linguagem: 21,
      relacionamento_social: 117,
      sensorio_motor: 60,
      interesses_circunscritos: 42
    }
  );
});

test("calcula o total e os quatro domínios com as funções usadas no envio", () => {
  function scoreAllWith(answer) {
    const answers = Object.fromEntries(
      runtime.FORM_QUESTIONS.map((question, index) => [
        runtime.getFieldName(question, index),
        answer
      ])
    );
    const scoring = runtime.buildScoringResult(
      runtime.FORM_QUESTIONS,
      answers,
      runtime.INDICATORS_CONFIG
    );

    return Object.fromEntries(
      Object.entries(scoring.indicators).map(([key, indicator]) => [
        key,
        indicator.sum
      ])
    );
  }

  const allPresent = JSON.parse(JSON.stringify(
    scoreAllWith("Verdadeiro hoje e quando eu era jovem")
  ));
  const allNever = JSON.parse(JSON.stringify(
    scoreAllWith("Nunca foi verdadeiro")
  ));

  assert.deepEqual(allPresent, {
    total_raads_r: 189,
    linguagem: 18,
    relacionamento_social: 75,
    sensorio_motor: 54,
    interesses_circunscritos: 42
  });
  assert.deepEqual(allNever, {
    total_raads_r: 51,
    linguagem: 3,
    relacionamento_social: 42,
    sensorio_motor: 6,
    interesses_circunscritos: 0
  });

  for (const result of [allPresent, allNever]) {
    assert.equal(
      result.total_raads_r,
      result.linguagem +
        result.relacionamento_social +
        result.sensorio_motor +
        result.interesses_circunscritos
    );
  }
});
