import type { NodeState, Trace } from "./types";

export type Locale = "ko" | "en";

export interface Copy {
  languageName: string;
  tagline: string;
  emptyTitle: string;
  emptyBody: string;
  placeholder: string;
  dropHere: string;
  attach: string;
  send: string;
  stop: string;
  thinking: string;
  removeImage: string;
  droppedImageAlt: string;
  imageUnreadable: string;
  imagesOnly: string;
  regionNote: (concept: string) => string;

  mapTitle: string;
  mapEmpty: string;
  stats: (walked: number, known: number, holes: number) => string;
  states: Record<NodeState, string>;
  stateHelp: Record<NodeState, string>;
  due: string;
  youAreHere: string;

  timeLabel: string;
  plusDays: (days: number) => string;
  elapsed: (days: number) => string;

  close: string;
  needs: string;
  under: string;
  traces: string;
  noSummary: string;
  lastTouched: (when: string) => string;
  lastChecked: (when: string) => string;
  neverChecked: string;
  traceTypes: Record<Trace["type"], string>;
  ago: (ms: number) => string;

  gapTitle: string;
  fuzzyGapTitle: string;
  recallAskTitle: string;
  recallResult: (verdict: "solid" | "fuzzy") => string;
  revisitTitle: string;
  placedTitle: string;
  imageReadTitle: string;
  continueReply: string;
  reviewReply: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const COPY: Record<Locale, Copy> = {
  ko: {
    languageName: "한국어",
    tagline: "내 발자국이 길이 된다",
    emptyTitle: "뭘 배울지 안 정해도 돼.",
    emptyBody:
      "궁금한 걸 묻거나 캡처를 던져봐. 지나간 길은 오른쪽에 저절로 그려져.",
    placeholder: "궁금한 걸 그냥 물어봐. 스크린샷을 던져도 돼.",
    dropHere: "아무 데나 던져. 알아서 꽂아둘게.",
    attach: "이미지 던지기",
    send: "보내기",
    stop: "멈추기",
    thinking: "지도를 살피는 중…",
    removeImage: "이미지 빼기",
    droppedImageAlt: "던진 이미지",
    imageUnreadable: "이 이미지는 읽지 못했어. 다른 형식으로 다시 던져줘.",
    imagesOnly: "이미지만 던질 수 있어. 코드는 그냥 붙여넣어 줘.",
    regionNote: (concept) => `SAM 3.1이 짚은 부분: ${concept}`,

    mapTitle: "내가 밟은 길",
    mapEmpty: "아직 길이 없어. 질문하면 여기에 발자국이 남아.",
    stats: (walked, known, holes) =>
      `${walked}곳 밟음 · ${known}곳 기억 확인 · 구멍 ${holes}개`,
    states: {
      solid: "기억함",
      seen: "봤음",
      fuzzy: "흐릿함",
      unseen: "구멍",
    },
    stateHelp: {
      solid: "복기에서 제대로 답했어.",
      seen: "봤지만 기억하는지는 아직 몰라.",
      fuzzy: "복기에서 막혔거나, 오래돼서 흐려졌어.",
      unseen: "다른 개념에 필요한데 아직 안 봤어.",
    },
    due: "복기할 때가 됐어",
    youAreHere: "지금 여기",

    timeLabel: "시간 흐름 시뮬레이션",
    plusDays: (days) => `+${days}일`,
    elapsed: (days) => `${days}일 지난 상태`,

    close: "닫기",
    needs: "먼저 알아야 할 것",
    under: "상위 개념",
    traces: "남긴 흔적",
    noSummary: "아직 안 본 개념이야.",
    lastTouched: (when) => `마지막으로 본 때: ${when}`,
    lastChecked: (when) => `마지막 기억 확인: ${when}`,
    neverChecked: "아직 기억 확인 전",
    traceTypes: {
      question: "질문",
      drop: "던짐",
      answer: "설명",
      recall_check: "복기",
    },
    ago: (ms) => {
      if (ms < MINUTE) return "방금";
      if (ms < HOUR) return `${Math.floor(ms / MINUTE)}분 전`;
      if (ms < DAY) return `${Math.floor(ms / HOUR)}시간 전`;
      return `${Math.floor(ms / DAY)}일 전`;
    },

    gapTitle: "구멍 발견",
    fuzzyGapTitle: "흐릿해진 선행 지식",
    recallAskTitle: "기억 확인",
    recallResult: (verdict) =>
      verdict === "solid" ? "기억함으로 표시" : "흐릿함으로 표시",
    revisitTitle: "전에 왔던 곳",
    placedTitle: "지도에 꽂음",
    imageReadTitle: "이미지 읽음",
    continueReply: "이어서 할래",
    reviewReply: "복습할래",
  },
  en: {
    languageName: "English",
    tagline: "Your footsteps become the trail",
    emptyTitle: "You don't have to decide what to learn.",
    emptyBody:
      "Ask what you're curious about, or throw in a screenshot. The ground you cover draws itself on the right.",
    placeholder: "Ask anything. You can throw in a screenshot, too.",
    dropHere: "Throw it anywhere. It'll find its place.",
    attach: "Add an image",
    send: "Send",
    stop: "Stop",
    thinking: "Checking the map…",
    removeImage: "Remove image",
    droppedImageAlt: "Dropped image",
    imageUnreadable: "That image couldn't be read. Try another format.",
    imagesOnly: "Only images can be dropped. Paste code as text.",
    regionNote: (concept) => `Picked out by SAM 3.1: ${concept}`,

    mapTitle: "Where I've been",
    mapEmpty: "No trail yet. Ask something and your footsteps show up here.",
    stats: (walked, known, holes) =>
      `${walked} visited · ${known} confirmed · ${holes} ${holes === 1 ? "hole" : "holes"}`,
    states: {
      solid: "Remembered",
      seen: "Seen",
      fuzzy: "Fuzzy",
      unseen: "Hole",
    },
    stateHelp: {
      solid: "You answered a recall check correctly.",
      seen: "You've seen it. Whether you remember it is still unknown.",
      fuzzy: "A recall check stumped you, or it's been too long.",
      unseen: "Another concept needs this, and you haven't seen it yet.",
    },
    due: "Due for a recall check",
    youAreHere: "You are here",

    timeLabel: "Simulate time passing",
    plusDays: (days) => `+${days}d`,
    elapsed: (days) => `${days} days later`,

    close: "Close",
    needs: "Needs first",
    under: "Part of",
    traces: "Traces",
    noSummary: "You haven't seen this one yet.",
    lastTouched: (when) => `Last seen: ${when}`,
    lastChecked: (when) => `Last recall check: ${when}`,
    neverChecked: "No recall check yet",
    traceTypes: {
      question: "Asked",
      drop: "Dropped",
      answer: "Explained",
      recall_check: "Recall",
    },
    ago: (ms) => {
      if (ms < MINUTE) return "just now";
      if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
      if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
      return `${Math.floor(ms / DAY)} d ago`;
    },

    gapTitle: "Hole found",
    fuzzyGapTitle: "Prerequisite gone fuzzy",
    recallAskTitle: "Memory check",
    recallResult: (verdict) =>
      verdict === "solid" ? "Marked remembered" : "Marked fuzzy",
    revisitTitle: "Been here before",
    placedTitle: "Placed on the map",
    imageReadTitle: "Read the image",
    continueReply: "Continue from there",
    reviewReply: "Review it",
  },
};
