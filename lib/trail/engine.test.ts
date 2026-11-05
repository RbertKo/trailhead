import { describe, expect, it } from "vitest";

import type { ConceptAnalysis, TurnAnalysis } from "./analysis";
import {
  advanceTime,
  applyTurn,
  completeTurn,
  fadeStaleNodes,
  findByLabel,
  isRecallDue,
  lastAnswerFor,
  normalizeLabel,
} from "./engine";
import { EMPTY_TRAIL, type TrailState, type TurnPlan } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const START = 1_800_000_000_000;

function concept(
  label: string,
  overrides: Partial<ConceptAnalysis> = {},
): ConceptAnalysis {
  return {
    label,
    summary: `${label} summary`,
    parentLabel: null,
    childLabels: [],
    prerequisites: [],
    blockingPrerequisite: null,
    ...overrides,
  };
}

function analysis(overrides: Partial<TurnAnalysis> = {}): TurnAnalysis {
  return {
    moment: "question",
    focusLabel: null,
    concepts: [],
    nextSteps: [],
    imageDescription: null,
    keyRegion: null,
    recallVerdict: null,
    recallNote: null,
    revisitChoice: null,
    ...overrides,
  };
}

function asking(label: string, overrides: Partial<ConceptAnalysis> = {}) {
  return analysis({ focusLabel: label, concepts: [concept(label, overrides)] });
}

let lastId = 0;

/** Drives the engine turn by turn, the way the API route does. */
function session(initial: TrailState = EMPTY_TRAIL, startAt = START) {
  let trail = initial;
  let now = startAt;
  const context = () => ({ now, newId: () => `id-${++lastId}` });

  return {
    get trail() {
      return trail;
    },
    node(label: string) {
      const node = findByLabel(trail.nodes, label);
      if (!node) throw new Error(`No node labelled ${label}`);
      return node;
    },
    turn(
      turnAnalysis: TurnAnalysis | null,
      text = "a message",
      imageId: string | null = null,
      reply = "the reply",
    ): TurnPlan {
      const result = applyTurn(trail, { text, imageId }, turnAnalysis, context());
      trail = completeTurn(result.trail, result.plan, reply, context());
      now += 1000;
      return result.plan;
    },
    /** Applies a turn without completing it, like a reply stopped midway. */
    startTurn(turnAnalysis: TurnAnalysis, text = "a message") {
      const result = applyTurn(
        trail,
        { text, imageId: null },
        turnAnalysis,
        context(),
      );
      trail = result.trail;
      now += 1000;
      return result;
    },
    wait(ms: number) {
      trail = advanceTime(trail, ms, now);
    },
  };
}

describe("the demo scenario", () => {
  it("runs from a broad wish through a hole, a recall failure and a re-teach", () => {
    const s = session();

    // 1. No curriculum, and nothing on the map yet.
    expect(s.turn(analysis({ moment: "broad_wish" })).kind).toBe("open");
    expect(s.trail.nodes).toEqual([]);

    // 2. Free questions and a dropped image grow the map.
    s.turn(asking("신경망"));
    expect(s.node("신경망").state).toBe("seen");
    s.turn(
      analysis({
        focusLabel: "활성화 함수",
        concepts: [concept("활성화 함수", { parentLabel: "신경망" })],
        imageDescription: "A diagram of a neuron",
      }),
      "",
      "image-1",
    );
    expect(s.node("활성화 함수").parentId).toBe(s.node("신경망").id);
    const drop = s.trail.traces.find((trace) => trace.type === "drop");
    expect(drop?.imageId).toBe("image-1");
    expect(drop?.content).toBe("A diagram of a neuron");

    // 3. The hole appears, only that piece is filled, and the turn stays on
    // the original question.
    const started = s.startTurn(
      asking("역전파", {
        prerequisites: ["경사하강법", "연쇄 법칙"],
        blockingPrerequisite: "경사하강법",
      }),
    );
    expect(started.plan).toMatchObject({
      kind: "gap",
      reason: "never_seen",
      gapId: s.node("경사하강법").id,
      focusId: s.node("역전파").id,
    });
    expect(s.node("경사하강법").state).toBe("unseen");
    expect(s.node("연쇄 법칙").state).toBe("unseen");

    const finished = completeTurn(s.trail, started.plan, "gd then backprop", {
      now: START + 10_000,
      newId: () => "answer-1",
    });
    expect(findByLabel(finished.nodes, "경사하강법")?.state).toBe("seen");
    // The other hole stays put: only what is needed right now gets filled.
    expect(findByLabel(finished.nodes, "연쇄 법칙")?.state).toBe("unseen");
    expect(finished.focusId).toBe(findByLabel(finished.nodes, "역전파")?.id);
    expect(
      lastAnswerFor(finished, findByLabel(finished.nodes, "역전파")!.id),
    ).toBe("gd then backprop");
  });

  it("tests memory first on a related topic, demotes on failure, then returns", () => {
    const s = session();
    s.turn(asking("경사하강법"));
    s.turn(asking("역전파", { prerequisites: ["경사하강법"] }));
    expect(s.node("역전파").state).toBe("seen");

    s.wait(7 * DAY);

    const asked = s.turn(asking("CNN", { prerequisites: ["역전파"] }), "CNN은 어떻게 학습해?");
    expect(asked).toMatchObject({
      kind: "recall_ask",
      nodeId: s.node("역전파").id,
    });
    expect(s.trail.pending).toEqual({
      kind: "recall",
      nodeId: s.node("역전파").id,
      originalQuestion: "CNN은 어떻게 학습해?",
      returnToId: s.node("CNN").id,
    });
    // Asked, not yet graded.
    expect(s.node("역전파").state).toBe("seen");
    expect(s.node("역전파").lastCheckedAt).toBeNull();

    const graded = s.turn(
      analysis({
        moment: "other",
        recallVerdict: "fuzzy",
        recallNote: "Remembered it goes backwards, not why.",
      }),
      "음... 뒤로 뭔가 보내는 거였나?",
    );
    expect(graded).toMatchObject({
      kind: "recall_result",
      verdict: "fuzzy",
      note: "Remembered it goes backwards, not why.",
      originalQuestion: "CNN은 어떻게 학습해?",
      returnToId: s.node("CNN").id,
    });
    // Stays fuzzy after being re-taught, and the conversation returns to CNN.
    expect(s.node("역전파").state).toBe("fuzzy");
    expect(s.node("역전파").lastCheckedAt).not.toBeNull();
    expect(s.trail.pending).toBeNull();
    expect(s.trail.focusId).toBe(s.node("CNN").id);
    expect(
      s.trail.traces.find((trace) => trace.type === "recall_check"),
    ).toMatchObject({ verdict: "fuzzy", content: "음... 뒤로 뭔가 보내는 거였나?" });
  });

  it("promotes to solid on a correct recall", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    expect(s.turn(asking("역전파")).kind).toBe("recall_ask");
    s.turn(analysis({ moment: "other", recallVerdict: "solid" }));
    expect(s.node("역전파").state).toBe("solid");
  });
});

describe("what a recall result records as explained", () => {
  function waitingOnBackprop() {
    const s = session();
    s.turn(asking("역전파"), "역전파 알려줘", null, "backprop explanation");
    s.wait(4 * DAY);
    s.turn(asking("CNN", { prerequisites: ["역전파"] }), "CNN은?");
    expect(s.trail.pending?.kind).toBe("recall");
    return s;
  }

  const gradedAs = (verdict: "solid" | "fuzzy") =>
    analysis({ moment: "other", recallVerdict: verdict });

  it("keeps a remembered concept's explanation when the reply moves on", () => {
    const s = waitingOnBackprop();
    s.turn(gradedAs("solid"), "오차를 거꾸로 보내", null, "cnn explanation");

    expect(lastAnswerFor(s.trail, s.node("역전파").id)).toBe("backprop explanation");
    expect(lastAnswerFor(s.trail, s.node("CNN").id)).toBe("cnn explanation");
  });

  it("records a re-teach for the concept that was re-taught", () => {
    const s = waitingOnBackprop();
    s.turn(gradedAs("fuzzy"), "모르겠어", null, "backprop again, then cnn");

    expect(lastAnswerFor(s.trail, s.node("역전파").id)).toBe("backprop again, then cnn");
    expect(lastAnswerFor(s.trail, s.node("CNN").id)).toBe("backprop again, then cnn");
  });

  it("keeps the explanation when the question was about the recalled concept", () => {
    const s = session();
    s.turn(asking("역전파"), "역전파 알려줘", null, "backprop explanation");
    s.wait(4 * DAY);
    expect(s.turn(asking("역전파"), "역전파 또 뭐였지?").kind).toBe("recall_ask");

    s.turn(gradedAs("solid"), "오차를 거꾸로 보내", null, "잘 기억하네");
    expect(lastAnswerFor(s.trail, s.node("역전파").id)).toBe("backprop explanation");
  });

  it("doesn't replace an explanation with praise after wrapping up", () => {
    const s = session();
    s.turn(asking("A"), "A?", null, "the explanation of A");
    s.wait(4 * DAY);
    s.turn(analysis({ moment: "wrapping_up" }), "이제 뭐 볼까");
    s.turn(gradedAs("solid"), "그건 이거야", null, "잘 기억하네");

    expect(lastAnswerFor(s.trail, s.node("A").id)).toBe("the explanation of A");
  });
});

describe("nothing counts as seen until the reply has been delivered", () => {
  it("stays unseen while the reply is on its way, then becomes seen", () => {
    const s = session();
    const { plan, trail } = s.startTurn(asking("역전파"));
    expect(s.node("역전파").state).toBe("unseen");
    expect(trail.focusId).toBe(s.node("역전파").id);

    const delivered = completeTurn(trail, plan, "explained", {
      now: START,
      newId: () => "answer-1",
    });
    expect(findByLabel(delivered.nodes, "역전파")?.state).toBe("seen");
  });

  it("keeps a hole open when a reply about it is stopped", () => {
    const s = session();
    s.turn(asking("신경망", { prerequisites: ["행렬"] }));
    expect(s.node("행렬").state).toBe("unseen");

    s.startTurn(asking("행렬"));
    expect(s.node("행렬").state).toBe("unseen");

    // So what needs it still stops for it, and it can't be tested later.
    const plan = s.turn(
      asking("선형 변환", { prerequisites: ["행렬"], blockingPrerequisite: "행렬" }),
    );
    expect(plan).toMatchObject({ kind: "gap", gapId: s.node("행렬").id });
  });

  it("marks every concept the question was about, not only the main one", () => {
    const s = session();
    s.turn(
      analysis({
        focusLabel: "역전파",
        concepts: [concept("역전파"), concept("경사하강법")],
      }),
    );
    expect(s.node("역전파").state).toBe("seen");
    expect(s.node("경사하강법").state).toBe("seen");
  });

  it("records the explanation for every concept the question was about", () => {
    const s = session();
    s.turn(
      analysis({
        focusLabel: "CNN",
        concepts: [concept("CNN"), concept("RNN")],
      }),
      "CNN이랑 RNN 차이가 뭐야?",
      null,
      "the comparison",
    );
    expect(lastAnswerFor(s.trail, s.node("CNN").id)).toBe("the comparison");
    expect(lastAnswerFor(s.trail, s.node("RNN").id)).toBe("the comparison");
  });

  it("does the same when the reply also fills a hole", () => {
    const s = session();
    s.turn(
      analysis({
        focusLabel: "CNN",
        concepts: [
          concept("CNN", {
            prerequisites: ["역전파"],
            blockingPrerequisite: "역전파",
          }),
          concept("RNN"),
        ],
      }),
      "CNN이랑 RNN 차이가 뭐야?",
      null,
      "backprop, then the comparison",
    );
    for (const label of ["역전파", "CNN", "RNN"]) {
      expect(s.node(label).state).toBe("seen");
      expect(lastAnswerFor(s.trail, s.node(label).id)).toBe(
        "backprop, then the comparison",
      );
    }
  });

  it("finishes every concept of a question resumed after a recall check", () => {
    const s = session();
    s.turn(asking("역전파"), "역전파?", null, "backprop explanation");
    s.wait(4 * DAY);

    const asked = s.turn(
      analysis({
        focusLabel: "CNN",
        concepts: [concept("CNN", { prerequisites: ["역전파"] }), concept("RNN")],
      }),
      "CNN이랑 RNN 차이가 뭐야?",
    );
    expect(asked.kind).toBe("recall_ask");
    expect(s.node("CNN").state).toBe("unseen");
    expect(s.node("RNN").state).toBe("unseen");

    s.turn(
      analysis({ moment: "other", recallVerdict: "solid" }),
      "오차를 거꾸로 보내",
      null,
      "the comparison",
    );
    expect(s.node("CNN").state).toBe("seen");
    expect(s.node("RNN").state).toBe("seen");
    expect(lastAnswerFor(s.trail, s.node("RNN").id)).toBe("the comparison");
    expect(lastAnswerFor(s.trail, s.node("역전파").id)).toBe("backprop explanation");
  });

  it("leaves everything unseen when a check raised by wrapping up has no question", () => {
    const s = session();
    s.turn(asking("A", { prerequisites: ["hole"] }));
    s.wait(4 * DAY);
    s.turn(analysis({ moment: "wrapping_up" }), "이제 뭐 볼까");
    s.turn(analysis({ moment: "other", recallVerdict: "solid" }));
    expect(s.node("hole").state).toBe("unseen");
  });

  it("doesn't mark anything for small talk", () => {
    const s = session();
    s.turn(asking("신경망", { prerequisites: ["행렬"] }));
    s.turn(analysis({ moment: "other" }), "고마워");
    expect(s.node("행렬").state).toBe("unseen");
  });

  it("doesn't suggest what the reply is explaining right now", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    const { callout } = s.startTurn({
      ...analysis({
        focusLabel: "C",
        concepts: [concept("C"), concept("D")],
      }),
      nextSteps: ["D", "C", "E"],
    });
    expect(callout.nextSteps).toEqual(["E"]);
  });
});

describe("a concept whose explanation is put off", () => {
  function askedDuringCheck() {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    s.turn(asking("CNN", { prerequisites: ["역전파"] }), "CNN은?");
    return s;
  }

  it("stays unseen while a recall check comes first", () => {
    const s = askedDuringCheck();
    expect(s.node("CNN").state).toBe("unseen");
    // The question is still on the record.
    expect(s.trail.traces.at(-1)).toMatchObject({
      type: "question",
      content: "CNN은?",
      nodeIds: [s.node("CNN").id],
    });
  });

  it("becomes seen once the reply after the check has explained it", () => {
    const s = askedDuringCheck();
    s.turn(analysis({ moment: "other", recallVerdict: "fuzzy" }));
    expect(s.node("CNN").state).toBe("seen");
    expect(s.trail.focusId).toBe(s.node("CNN").id);
  });

  it("stays unseen when the check's reply never arrives", () => {
    const s = askedDuringCheck();
    s.startTurn(analysis({ moment: "other", recallVerdict: "fuzzy" }));
    expect(s.node("CNN").state).toBe("unseen");
  });

  it("stays unseen when the learner ignores the check and moves on", () => {
    const s = askedDuringCheck();
    s.turn({ ...asking("강화학습"), recallVerdict: "not_answered" });
    expect(s.node("CNN").state).toBe("unseen");
    // So it isn't tested later as if it had been seen.
    expect(isRecallDue(s.node("CNN"), START + 365 * DAY)).toBe(false);
  });

  it("can then be stopped for as a hole, like anything never explained", () => {
    const s = askedDuringCheck();
    s.turn({ ...asking("강화학습"), recallVerdict: "not_answered" });
    const plan = s.turn(
      asking("전이 학습", {
        prerequisites: ["CNN"],
        blockingPrerequisite: "CNN",
      }),
    );
    expect(plan).toMatchObject({ kind: "gap", gapId: s.node("CNN").id });
  });

  it("doesn't undo what the learner had already seen", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("경사하강법"));
    s.wait(4 * DAY);
    s.turn(asking("역전파", { prerequisites: ["경사하강법"] }));
    expect(s.trail.pending?.kind).toBe("recall");
    expect(s.node("역전파").state).toBe("seen");
    expect(s.node("경사하강법").state).toBe("seen");
  });

  it("stays unseen while a continue-or-review offer is waiting", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("강화학습"));
    const plan = s.turn(
      analysis({
        moment: "coming_back",
        focusLabel: "역전파",
        concepts: [concept("역전파"), concept("연쇄 법칙")],
      }),
    );
    expect(plan.kind).toBe("revisit_offer");
    expect(s.node("역전파").state).toBe("seen");
    expect(s.node("연쇄 법칙").state).toBe("unseen");
  });
});

describe("holes", () => {
  it("leaves a non-blocking prerequisite as a quiet hole", () => {
    const s = session();
    const plan = s.turn(asking("신경망", { prerequisites: ["행렬"] }));
    expect(plan.kind).toBe("answer");
    expect(s.node("행렬").state).toBe("unseen");
  });

  it("does not stop for a blocking prerequisite the learner has already seen", () => {
    const s = session();
    s.turn(asking("경사하강법"));
    const plan = s.turn(
      asking("역전파", {
        prerequisites: ["경사하강법"],
        blockingPrerequisite: "경사하강법",
      }),
    );
    expect(plan.kind).toBe("answer");
  });

  it("does not flag the same hole twice once it has been filled", () => {
    const s = session();
    const backprop = asking("역전파", {
      prerequisites: ["경사하강법"],
      blockingPrerequisite: "경사하강법",
    });
    expect(s.turn(backprop).kind).toBe("gap");
    expect(s.turn(backprop).kind).toBe("answer");
  });

  it("keeps the hole open when the reply is stopped before completing", () => {
    const s = session();
    const { plan } = s.startTurn(
      asking("역전파", {
        prerequisites: ["경사하강법"],
        blockingPrerequisite: "경사하강법",
      }),
    );
    expect(plan.kind).toBe("gap");
    expect(s.node("경사하강법").state).toBe("unseen");
  });

  it("treats a fuzzy prerequisite as a hole once a re-teach has had time to settle", () => {
    const s = session();
    s.turn(asking("경사하강법"));
    s.wait(4 * DAY);
    s.turn(asking("경사하강법"));
    s.turn(analysis({ moment: "other", recallVerdict: "fuzzy" }));
    expect(s.node("경사하강법").state).toBe("fuzzy");

    // Right after the re-teach it is not flagged again.
    expect(s.turn(asking("역전파", { prerequisites: ["경사하강법"] })).kind).toBe(
      "answer",
    );

    s.wait(2 * 60 * 60 * 1000);
    const plan = s.turn(asking("CNN", { prerequisites: ["경사하강법"] }));
    expect(plan).toMatchObject({ kind: "gap", reason: "fuzzy" });
    // Re-taught through the hole: told again, still untested.
    expect(s.node("경사하강법").state).toBe("seen");
  });

  it("still treats a fuzzy prerequisite as a hole when it is mentioned this turn", () => {
    const s = session();
    s.turn(asking("경사하강법"));
    s.wait(4 * DAY);
    s.turn(asking("경사하강법"));
    s.turn(analysis({ moment: "other", recallVerdict: "fuzzy" }));
    s.wait(2 * 60 * 60 * 1000);

    const plan = s.turn(
      analysis({
        focusLabel: "역전파",
        concepts: [
          concept("역전파", {
            prerequisites: ["경사하강법"],
            blockingPrerequisite: "경사하강법",
          }),
          concept("경사하강법"),
        ],
      }),
    );
    expect(plan).toMatchObject({ kind: "gap", reason: "fuzzy" });
  });

  it("does not stop for a hole the learner is asking about right now", () => {
    const s = session();
    s.turn(asking("신경망", { prerequisites: ["경사하강법"] }));
    expect(s.node("경사하강법").state).toBe("unseen");

    const plan = s.turn(
      analysis({
        focusLabel: "역전파",
        concepts: [
          concept("역전파", {
            prerequisites: ["경사하강법"],
            blockingPrerequisite: "경사하강법",
          }),
          concept("경사하강법"),
        ],
      }),
    );
    expect(plan.kind).toBe("answer");
    expect(s.node("경사하강법").state).toBe("seen");
  });

  it("ignores a concept listed as its own prerequisite", () => {
    const s = session();
    const plan = s.turn(
      asking("역전파", {
        prerequisites: ["역전파"],
        blockingPrerequisite: "역전파",
      }),
    );
    expect(plan.kind).toBe("answer");
    expect(s.node("역전파").prerequisiteIds).toEqual([]);
  });

  it("stops for a blocking prerequisite the model left out of the list", () => {
    const s = session();
    const plan = s.turn(
      asking("역전파", {
        prerequisites: ["A", "B", "C", "D"],
        blockingPrerequisite: "경사하강법",
      }),
    );
    expect(plan).toMatchObject({ kind: "gap", gapId: s.node("경사하강법").id });
    expect(s.node("역전파").prerequisiteIds).toHaveLength(3);
    expect(s.node("역전파").prerequisiteIds[0]).toBe(s.node("경사하강법").id);
  });

  it("lists a prerequisite once when the model names it twice", () => {
    const s = session();
    s.turn(
      asking("역전파", {
        prerequisites: ["경사 하강법", "경사하강법"],
        blockingPrerequisite: "경사하강법",
      }),
    );
    expect(s.node("역전파").prerequisiteIds).toHaveLength(1);
    expect(s.trail.nodes).toHaveLength(2);
  });

  it("fills a hole when the learner asks about it directly", () => {
    const s = session();
    s.turn(asking("신경망", { prerequisites: ["행렬"] }));
    expect(s.node("행렬").state).toBe("unseen");
    s.turn(asking("행렬"));
    expect(s.node("행렬").state).toBe("seen");
  });
});

describe("recall checks", () => {
  it("is not due right after being seen", () => {
    const s = session();
    s.turn(asking("역전파"));
    expect(isRecallDue(s.node("역전파"), START + DAY)).toBe(false);
    expect(isRecallDue(s.node("역전파"), START + 4 * DAY)).toBe(true);
  });

  it("never tests a hole", () => {
    const s = session();
    s.turn(asking("신경망", { prerequisites: ["행렬"] }));
    expect(isRecallDue(s.node("행렬"), START + 365 * DAY)).toBe(false);
  });

  it("does not test a concept just created in this turn", () => {
    const s = session();
    expect(s.turn(asking("역전파")).kind).toBe("answer");
  });

  it("drops an ignored check, without repeating it or leaving it pending", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    expect(s.turn(asking("역전파")).kind).toBe("recall_ask");

    const plan = s.turn({
      ...asking("강화학습"),
      recallVerdict: "not_answered",
    });
    expect(plan.kind).toBe("answer");
    expect(s.trail.pending).toBeNull();
    expect(s.node("역전파").state).toBe("seen");
    expect(s.node("역전파").lastCheckedAt).toBeNull();
    expect(s.trail.focusId).toBe(s.node("강화학습").id);
  });

  it("doesn't count a check as asked until the question has been delivered", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);

    const { plan } = s.startTurn(asking("역전파"));
    expect(plan.kind).toBe("recall_ask");
    expect(s.trail.pending).toBeNull();
    expect(s.node("역전파").lastPromptedAt).toBeNull();

    // The reply failed or was stopped, so what comes next is not an answer.
    s.turn({ ...asking("강화학습"), recallVerdict: "fuzzy" });
    expect(s.node("역전파").state).toBe("seen");
    expect(s.node("역전파").lastCheckedAt).toBeNull();
  });

  it("comes before filling a hole, after days away", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(7 * DAY);

    const backprop = {
      ...asking("CNN", {
        prerequisites: ["역전파", "합성곱"],
        blockingPrerequisite: "합성곱",
      }),
    };
    expect(s.turn(backprop)).toMatchObject({
      kind: "recall_ask",
      nodeId: s.node("역전파").id,
    });
    s.turn(analysis({ moment: "other", recallVerdict: "fuzzy" }));

    // The hole waits for the next question, in the same sitting.
    expect(
      s.turn(
        asking("풀링", {
          prerequisites: ["합성곱"],
          blockingPrerequisite: "합성곱",
        }),
      ),
    ).toMatchObject({ kind: "gap", gapId: s.node("합성곱").id });
  });

  it("asks again if the question never reached the learner", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);

    expect(s.startTurn(asking("역전파")).plan.kind).toBe("recall_ask");
    // Stopped, so nothing changed: the check is still due.
    expect(s.startTurn(asking("역전파")).plan.kind).toBe("recall_ask");
  });

  it("tests at most one concept in a sitting", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    s.wait(4 * DAY);

    expect(s.turn(asking("A")).kind).toBe("recall_ask");
    s.turn(analysis({ moment: "other", recallVerdict: "solid" }));
    expect(s.turn(asking("B")).kind).toBe("answer");
  });

  it("tests the oldest due concept when the learner wraps up", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    s.wait(4 * DAY);
    expect(s.turn(analysis({ moment: "wrapping_up" }), "이제 뭐 볼까")).toMatchObject({
      kind: "recall_ask",
      nodeId: s.node("A").id,
    });
  });

  it("comes back to 'what's next?' after a check raised by wrapping up", () => {
    const s = session();
    s.turn(asking("A"));
    s.wait(4 * DAY);
    s.turn(analysis({ moment: "wrapping_up" }), "이제 뭐 볼까");
    expect(s.trail.pending).toMatchObject({
      originalQuestion: "이제 뭐 볼까",
      returnToId: null,
    });

    const graded = s.turn(analysis({ moment: "other", recallVerdict: "solid" }));
    expect(graded).toMatchObject({
      kind: "recall_result",
      originalQuestion: "이제 뭐 볼까",
    });
  });

  it("has a hole to mention when wrapping up with nothing to suggest", () => {
    const s = session();
    s.turn(asking("신경망", { prerequisites: ["행렬", "미분"] }));
    expect(s.turn(analysis({ moment: "wrapping_up" }))).toEqual({
      kind: "wander",
      holeId: s.node("행렬").id,
      steps: [],
    });
  });
});

describe("coming back", () => {
  it("offers continue or review, then acts on the choice", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("강화학습"));

    const offer = s.turn(
      { ...asking("역전파"), moment: "coming_back" },
      "역전파 다시 알려줘",
    );
    expect(offer).toMatchObject({
      kind: "revisit_offer",
      nodeId: s.node("역전파").id,
    });

    const resume = s.turn(analysis({ moment: "other", revisitChoice: "review" }));
    expect(resume).toMatchObject({
      kind: "revisit_resume",
      choice: "review",
      originalQuestion: "역전파 다시 알려줘",
    });
    expect(s.trail.pending).toBeNull();
  });

  it("does not offer it for a follow-up on the topic just discussed", () => {
    const s = session();
    s.turn(asking("역전파"));
    const plan = s.turn({ ...asking("역전파"), moment: "coming_back" });
    expect(plan.kind).toBe("answer");
  });

  it("offers it for a real return, even with nothing asked in between", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(1 * DAY);
    const plan = s.turn({ ...asking("역전파"), moment: "coming_back" });
    expect(plan).toMatchObject({
      kind: "revisit_offer",
      nodeId: s.node("역전파").id,
    });
  });

  it("finishes what the offer put off once the choice has been answered", () => {
    const s = session();
    s.turn(asking("역전파"), "역전파?", null, "backprop explanation");
    s.turn(asking("강화학습"));

    const offer = s.turn(
      analysis({
        moment: "coming_back",
        focusLabel: "역전파",
        concepts: [concept("역전파"), concept("연쇄 법칙")],
      }),
      "역전파랑 연쇄 법칙 다시 알려줘",
    );
    expect(offer.kind).toBe("revisit_offer");
    expect(s.node("연쇄 법칙").state).toBe("unseen");

    s.turn(
      analysis({ moment: "other", revisitChoice: "review" }),
      "복습할래",
      null,
      "both of them",
    );
    expect(s.node("연쇄 법칙").state).toBe("seen");
    expect(lastAnswerFor(s.trail, s.node("연쇄 법칙").id)).toBe("both of them");
    expect(lastAnswerFor(s.trail, s.node("역전파").id)).toBe("both of them");
  });

  it("moves on when the learner changes the subject instead of choosing", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("강화학습"));
    s.turn({ ...asking("역전파"), moment: "coming_back" });

    const plan = s.turn({ ...asking("CNN"), revisitChoice: "other" });
    expect(plan.kind).toBe("answer");
    expect(s.trail.pending).toBeNull();
  });
});

describe("offering a path", () => {
  const withSteps = (label: string, nextSteps: string[]) => ({
    ...asking(label),
    nextSteps,
  });

  function reported(s: ReturnType<typeof session>, turn: TurnAnalysis) {
    const { callout } = s.startTurn(turn);
    return callout.nextSteps;
  }

  it("offers nothing up front", () => {
    const s = session();
    expect(reported(s, withSteps("A", ["B", "C"]))).toEqual([]);
  });

  it("offers a short path once a few questions have made a trail", () => {
    const s = session();
    s.turn(withSteps("A", ["X"]));
    s.turn(withSteps("B", ["X"]));
    expect(reported(s, withSteps("C", ["X", "Y", "Z"]))).toEqual(["X", "Y", "Z"]);
  });

  it("waits for a few more questions before offering again", () => {
    const s = session();
    s.turn(withSteps("A", ["X"]));
    s.turn(withSteps("B", ["X"]));
    s.turn(withSteps("C", ["X"]));
    expect(s.trail.questionsSinceOffer).toBe(0);

    s.turn(withSteps("D", ["X"]));
    s.turn(withSteps("E", ["X"]));
    expect(reported(s, withSteps("F", ["X"]))).toEqual(["X"]);
  });

  it("keeps waiting when there is nothing new to suggest yet", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    s.turn(asking("C"));
    expect(s.trail.questionsSinceOffer).toBe(3);
    expect(reported(s, withSteps("D", ["X"]))).toEqual(["X"]);
  });

  it("doesn't count small talk as a question", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(analysis({ moment: "other" }));
    s.turn(analysis({ moment: "other" }));
    expect(s.trail.questionsSinceOffer).toBe(1);
  });

  it("suggests new ground and holes, not what is already covered", () => {
    const s = session();
    s.turn(asking("A", { prerequisites: ["hole"] }));
    s.turn(asking("B"));
    expect(
      reported(s, withSteps("C", ["A", "C", "Hole", "new one", "extra", "more"])),
    ).toEqual(["hole", "new one", "extra"]);
  });

  it("doesn't suggest the hole this reply is already filling", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    const { plan, callout } = s.startTurn({
      ...asking("역전파", {
        prerequisites: ["경사하강법"],
        blockingPrerequisite: "경사하강법",
      }),
      nextSteps: ["경사하강법", "CNN"],
    });
    expect(plan.kind).toBe("gap");
    expect(callout.nextSteps).toEqual(["CNN"]);
  });

  it("doesn't interrupt a question it is waiting on", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    s.wait(4 * DAY);
    const { plan, callout } = s.startTurn(withSteps("A", ["X"]));
    expect(plan.kind).toBe("recall_ask");
    expect(callout.nextSteps).toEqual([]);
  });

  it("answers 'what's next?' with a path whenever it is asked", () => {
    const s = session();
    s.turn(asking("A"));
    const plan = s.turn({
      ...analysis({ moment: "wrapping_up" }),
      nextSteps: ["X", "Y"],
    });
    expect(plan).toEqual({ kind: "wander", holeId: null, steps: ["X", "Y"] });
    expect(s.trail.questionsSinceOffer).toBe(0);
  });
});

describe("an image thrown while a question is waiting", () => {
  const thrown = {
    ...asking("활성화 함수"),
    imageDescription: "A neuron diagram",
    keyRegion: "diagram",
  };

  it("is placed on the map instead of being taken as a recall answer", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    expect(s.turn(asking("역전파")).kind).toBe("recall_ask");

    const plan = s.turn(thrown, "", "image-1");
    expect(plan.kind).toBe("answer");
    expect(s.node("활성화 함수").state).toBe("seen");
    expect(s.node("역전파").lastCheckedAt).toBeNull();
    expect(s.trail.pending).toBeNull();
    expect(s.trail.traces.find((t) => t.type === "drop")?.imageId).toBe("image-1");
  });

  it("is placed on the map instead of being taken as a revisit choice", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("강화학습"));
    s.turn({ ...asking("역전파"), moment: "coming_back" });

    const plan = s.turn({ ...thrown, revisitChoice: "continue" }, "", "image-1");
    expect(plan.kind).toBe("answer");
    expect(s.trail.pending).toBeNull();
  });
});

describe("an image and memory checks", () => {
  const thrown = {
    ...asking("역전파"),
    imageDescription: "A backpropagation diagram",
  };

  it("can test memory when a thrown image connects to something seen before", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    expect(s.turn(thrown, "", "image-1").kind).toBe("recall_ask");
  });

  it("answers an image sent with words even if they sound like wrapping up", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    const plan = s.turn(
      { ...thrown, moment: "wrapping_up" },
      "이해했어, 이건 뭐야?",
      "image-1",
    );
    expect(plan.kind).toBe("answer");

    const wish = session();
    expect(
      wish.turn({ ...thrown, moment: "broad_wish" }, "AI 공부하고 싶어", "image-2")
        .kind,
    ).toBe("answer");
  });

  it("answers right away when the image comes with a question", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    expect(s.turn(thrown, "여기 왜 에러나?", "image-1").kind).toBe("answer");
  });

  it("never turns an image into a continue-or-review offer", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("강화학습"));
    const plan = s.turn({ ...thrown, moment: "coming_back" }, "", "image-1");
    expect(plan.kind).toBe("answer");
  });

  it("keeps a waiting check when the reading of an image fails", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    s.turn(asking("역전파"));
    expect(s.trail.pending?.kind).toBe("recall");

    s.turn(null, "", "image-1");
    expect(s.trail.pending?.kind).toBe("recall");
  });
});

describe("what a turn reports for the conversation", () => {
  it("names the placed concepts, the reading and the region to look for", () => {
    const { callout } = applyTurn(
      EMPTY_TRAIL,
      { text: "", imageId: "image-1" },
      {
        ...asking("활성화 함수"),
        imageDescription: "A neuron diagram",
        keyRegion: "diagram",
      },
      { now: START, newId: () => crypto.randomUUID() },
    );
    expect(callout).toMatchObject({
      placed: ["활성화 함수"],
      imageDescription: "A neuron diagram",
      keyRegion: "diagram",
    });
  });

  it("keeps the region to what the SAM route accepts", () => {
    const { callout } = applyTurn(
      EMPTY_TRAIL,
      { text: "", imageId: "image-1" },
      { ...asking("역전파"), keyRegion: "very long phrase ".repeat(20) },
      { now: START, newId: () => crypto.randomUUID() },
    );
    expect(callout.keyRegion?.length).toBeLessThanOrEqual(100);
  });

  it("asks for no region when no image was sent", () => {
    const { callout } = applyTurn(
      EMPTY_TRAIL,
      { text: "역전파", imageId: null },
      { ...asking("역전파"), keyRegion: "diagram", imageDescription: "x" },
      { now: START, newId: () => crypto.randomUUID() },
    );
    expect(callout.keyRegion).toBeNull();
    expect(callout.imageDescription).toBeNull();
  });
});

describe("a trail sent by the browser", () => {
  it("does not hang on a parent cycle that is already in it", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    const [a, b] = s.trail.nodes;
    const cyclic: TrailState = {
      ...s.trail,
      nodes: [
        { ...a, parentId: b.id },
        { ...b, parentId: a.id },
      ],
    };

    const looped = session(cyclic);
    looped.turn(asking("C", { parentLabel: "A" }));
    expect(looped.node("C").parentId).toBe(a.id);
  });

  it("keeps a much-visited concept's sources bounded", () => {
    const s = session();
    for (let index = 0; index < 40; index += 1) s.turn(asking("A"));
    expect(s.node("A").sources.length).toBeLessThanOrEqual(20);
  });
});

describe("placing concepts", () => {
  it("reuses a node when the label differs only by spacing or case", () => {
    const s = session();
    s.turn(asking("Gradient Descent"));
    s.turn(asking("gradientdescent"));
    expect(s.trail.nodes).toHaveLength(1);
    expect(normalizeLabel("Gradient  Descent")).toBe("gradientdescent");
  });

  it("links a parent that arrives after its child, without a cycle", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.turn(asking("신경망", { childLabels: ["역전파"] }));
    expect(s.node("역전파").parentId).toBe(s.node("신경망").id);

    s.turn(asking("역전파", { childLabels: ["신경망"] }));
    expect(s.node("신경망").parentId).toBeNull();
  });

  it("links concepts within one response in any order", () => {
    const s = session();
    s.turn(
      analysis({
        focusLabel: "역전파",
        concepts: [
          concept("역전파", { parentLabel: "신경망" }),
          concept("신경망"),
        ],
      }),
    );
    expect(s.node("역전파").parentId).toBe(s.node("신경망").id);
  });

  it("ignores a parent that is not on the map", () => {
    const s = session();
    s.turn(asking("역전파", { parentLabel: "존재하지 않는 개념" }));
    expect(s.node("역전파").parentId).toBeNull();
    expect(s.trail.nodes).toHaveLength(1);
  });

  it("places a concept once when the model spells it two ways", () => {
    const s = session();
    s.turn(
      analysis({
        focusLabel: "역전파",
        concepts: [
          concept("역전파", { summary: "the first" }),
          concept("역 전파", { summary: "the second" }),
        ],
      }),
    );
    expect(s.trail.nodes).toHaveLength(1);
    expect(s.node("역전파").summary).toBe("the first");
  });

  it("places at most three concepts from one response", () => {
    const s = session();
    s.turn(
      analysis({
        concepts: ["A", "B", "C", "D", "E"].map((label) => concept(label)),
      }),
    );
    expect(s.trail.nodes).toHaveLength(3);
  });

  it("keeps a concept's prerequisites bounded across many visits", () => {
    const s = session();
    for (let index = 0; index < 6; index += 1) {
      s.turn(
        asking("A", {
          prerequisites: [`p${index}`, `q${index}`, `r${index}`],
        }),
      );
    }
    expect(s.node("A").prerequisiteIds.length).toBeLessThanOrEqual(8);
    expect(s.node("A").prerequisiteIds).toContain(s.node("r5").id);
  });

  it("keeps at most three prerequisites from one response", () => {
    const s = session();
    s.turn(asking("A", { prerequisites: ["B", "C", "D", "E"] }));
    expect(s.node("A").prerequisiteIds).toHaveLength(3);
    expect(s.trail.nodes).toHaveLength(4);
  });

  it("finds a node again by an overlong label", () => {
    const s = session();
    const long = "개념".repeat(100);
    s.turn(asking(long));
    s.turn(asking(long));
    expect(s.trail.nodes).toHaveLength(1);
  });

  it("clamps oversized output so the next request still validates", () => {
    const s = session();
    const huge = "x".repeat(5_000);
    s.turn(
      analysis({
        focusLabel: huge,
        concepts: [concept(huge, { summary: huge })],
      }),
      huge,
    );
    const [node] = s.trail.nodes;
    expect(node.label.length).toBeLessThanOrEqual(120);
    expect(node.summary.length).toBeLessThanOrEqual(1_000);
    expect(s.trail.traces[0].content.length).toBeLessThanOrEqual(2_000);
  });

  it("falls back to the first concept when the focus label is unknown", () => {
    const s = session();
    const plan = s.turn(
      analysis({ focusLabel: "엉뚱한 이름", concepts: [concept("역전파")] }),
    );
    expect(plan).toEqual({ kind: "answer", focusId: s.node("역전파").id });
  });

  it("does not attach small talk to the concept in focus", () => {
    const s = session();
    s.turn(asking("역전파"));
    const answers = () =>
      s.trail.traces.filter((trace) => trace.type === "answer").length;
    const before = answers();

    const plan = s.turn(analysis({ moment: "other" }), "고마워");
    expect(plan).toEqual({ kind: "answer", focusId: null });
    expect(answers()).toBe(before);
    expect(s.trail.focusId).toBe(s.node("역전파").id);
  });
});

describe("when the model's reading fails", () => {
  it("keeps the conversation going without touching the map", () => {
    const s = session();
    s.turn(asking("역전파"));
    const nodes = s.trail.nodes;

    const plan = s.turn(null, "그래서 왜 그래?");
    expect(plan).toEqual({ kind: "answer", focusId: null });
    expect(s.trail.nodes).toEqual(nodes);
    expect(s.trail.traces.at(-1)?.content).not.toBe("");
  });
});

describe("when the reading fails while a recall check is waiting", () => {
  it("keeps the check, so the next message can still answer it", () => {
    const s = session();
    s.turn(asking("역전파"));
    s.wait(4 * DAY);
    expect(s.turn(asking("역전파")).kind).toBe("recall_ask");

    expect(s.turn(null, "오차를 거꾸로 보내는 거").kind).toBe("answer");
    expect(s.trail.pending?.kind).toBe("recall");

    const graded = s.turn(analysis({ moment: "other", recallVerdict: "solid" }));
    expect(graded.kind).toBe("recall_result");
    expect(s.node("역전파").state).toBe("solid");
  });
});

describe("the passing of time", () => {
  it("fades seen and solid concepts that have gone untouched for a month", () => {
    const s = session();
    s.turn(asking("A"));
    s.turn(asking("B"));
    s.turn(asking("C", { prerequisites: ["hole"] }));
    s.wait(29 * DAY);
    expect(s.node("A").state).toBe("seen");

    s.wait(2 * DAY);
    expect(s.node("A").state).toBe("fuzzy");
    expect(s.node("B").state).toBe("fuzzy");
    expect(s.node("hole").state).toBe("unseen");
  });

  it("fades on the server too, in case the browser state is stale", () => {
    const s = session();
    s.turn(asking("A"));
    const faded = fadeStaleNodes(s.trail, START + 40 * DAY);
    expect(findByLabel(faded.nodes, "A")?.state).toBe("fuzzy");
  });

  it("moves every timestamp and keeps null ones null", () => {
    const s = session();
    s.turn(asking("A"));
    const { lastTouchedAt, firstSeenAt } = s.node("A");
    const createdAt = s.trail.traces[0].createdAt;

    s.wait(DAY);
    expect(s.node("A").lastTouchedAt).toBe(lastTouchedAt - DAY);
    expect(s.node("A").firstSeenAt).toBe(firstSeenAt - DAY);
    expect(s.node("A").lastCheckedAt).toBeNull();
    expect(s.trail.traces[0].createdAt).toBe(createdAt - DAY);
  });
});
