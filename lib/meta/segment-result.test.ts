import { parseImageStream, type ResponsesEvent } from "@meta-sam/parser";
import { describe, expect, it } from "vitest";

import { toSegmentedObjects } from "./segment-result";

// Real SAM 3.1 wire output, taken from the @meta-sam/parser README.
const TWO_OBJECTS =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>" +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ",1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>" +
  "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n";

const lane = { item_id: "message-1", output_index: 0, content_index: 0 };

async function* events(
  text: string,
  terminal: ResponsesEvent = { type: "response.completed" },
): AsyncIterable<ResponsesEvent> {
  // Zero matches still arrive as a finished lane, just with no text in it.
  if (text) yield { type: "response.output_text.delta", delta: text, ...lane };
  yield { type: "response.output_text.done", text, ...lane };
  yield terminal;
}

describe("toSegmentedObjects", () => {
  it("returns each object's box, mask path and raster size", async () => {
    const result = await parseImageStream(events(TWO_OBJECTS)).finalResult;

    const objects = toSegmentedObjects(result);

    expect(objects.map((object) => object.objectId)).toEqual(["0", "1"]);
    expect(objects[0]).toMatchObject({
      // The raster starts at the box corner and is 60 wide by 27 tall.
      bounds: { left: 211, top: 228, right: 271, bottom: 255 },
      maskWidth: 60,
      maskHeight: 27,
    });
    expect(objects[0].maskPath).toMatch(/^M.*Z/);
  });

  it("treats a completed response without matches as an empty result", async () => {
    const result = await parseImageStream(events("")).finalResult;

    expect(toSegmentedObjects(result)).toEqual([]);
  });

  it("rejects output the parser had to drop instead of reporting no matches", async () => {
    const result = await parseImageStream(
      events("<0f>0<|box;broken|>\n"),
    ).finalResult;

    expect(() => toSegmentedObjects(result)).toThrow(/could not be parsed/);
  });

  it("rejects a response that ended early", async () => {
    const result = await parseImageStream(
      events(TWO_OBJECTS, {
        type: "response.incomplete",
        response: { incomplete_details: { reason: "max_output_tokens" } },
      }),
    ).finalResult;

    expect(() => toSegmentedObjects(result)).toThrow(/ended early/);
  });
});
