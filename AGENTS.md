<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 프로젝트 규칙

Meta Global AI Developer Hackathon 제출 프로젝트 **Trailhead**다. ADHD 당사자를 위한 학습 도구로, 커리큘럼을 미리 주지 않는다. 호기심을 따라 질문하고 자료를 던지면 흔적이 사후에 지식 지도가 되고, 실제로 기억하는지 확인하며, 빠진 선행 지식은 그 조각만 메운다.

- **통합 브랜치:** `main`. 분기 기준이자 PR base다.
- **제출 마감:** 2026-11-04 21:00 ET = 2026-11-05 11:00 KST. 늦은 제출은 받지 않는다.
- **제출 필수 항목:** 공개 GitHub 저장소, 3분 데모 영상. [제출 폼](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit)과 [참가자 가이드](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)는 로그인해야 보인다.
- **심사 배점:** Impact 30, Use of Meta AI Tooling 25, Demo 25, Technical Depth & Execution 20.
- **문제 영역:** Build for Your World.
- **언어:** 심사위원이 영어를 쓰므로 화면 기본값은 영어이고, 상단 버튼으로 한국어로 바꾼다. 답변은 사용자가 쓴 언어를 따른다. 새 문구는 `lib/trail/copy.ts`에 두 언어 모두 넣고, `npm run smoke`는 데모 대본을 두 언어로 확인한다.
- **라이선스:** Sustainable Use License (n8n과 같음, `LICENSE.md`). 저장소는 공개지만 OSI 승인 오픈소스는 아니며 상업적 재판매와 유료 제공을 막는다. 해커톤 규칙의 "Open source: Repositories must be public"은 공개 저장소로 충족한다. 오픈소스라고 표현하지 않는다.

## 설계 원칙: 기능보다 우선한다

이 원칙을 어기는 기능은 추가하지 않는다.

1. **커리큘럼을 미리 주지 않는다.** 구조는 입력이 아니라 결과물이다. 다만 깊게 개입하지 않는다는 뜻이지 아무것도 제시하지 않는다는 뜻은 아니다. 질문이 3개쯤 쌓이거나 "다음에 뭐 볼까?"라고 물으면, 그 흔적에서 나온 짧은 길(최대 3단계)을 무시할 수 있는 선택지로 제시한다. 일정이나 숙제로 만들지 않는다.
2. **성실함을 요구하지 않는다.** "나중에 다시 보세요"는 작동하지 않는다. 사용자가 원래 하는 행동(또 같은 질문을 하는 것)에 맞춘다.
3. **산만함은 데이터다.** 주제에서 벗어나도 막지 않고 흔적으로 남긴다.
4. **봤다와 안다를 구분한다.** 지도는 방문이 아니라 실제 기억을 기준으로 상태를 관리한다.
5. **구멍은 그 조각만 메운다.** 여러 개여도 지금 필요한 하나만 짚고 바로 원래 질문으로 돌아간다.
6. **능동 개입은 대화 안에서만 한다.** 문맥 없는 알림은 금지다.

하지 말 것: 진단·증상 평가·집중력 점수, 치료·개선 주장(학습을 돕는 도구로만 표현한다), 마인드맵을 결과물로 만들어 주고 끝내기.

## 반드시 지킬 것

- **새 코드만 쓴다.** 해커톤 기간에 만든 것만 인정되고, 새로 만든 부분을 심사위원이 구별하지 못하면 실격될 수 있다. 다른 프로젝트의 코드를 복사하지 않는다.
- **Muse Wonder를 쓰지 않는다.** 한국에서 제공되지 않고, 해외 서버를 거치는 우회는 Meta 지역 정책 위반이다.
- **API 키는 서버에만 둔다.** `NEXT_PUBLIC_`을 붙이지 않고, 키를 쓰는 모듈에는 `server-only`를 넣는다. 저장소가 공개되므로 `.env*`의 실제 값을 커밋하지 않는다.
- **Contributor 모델에 실제 사용자 데이터를 넣지 않는다.** 보낸 내용이 Meta 모델 학습에 쓰일 수 있다. 코드 기본값은 Standard이고, 개발 환경에서만 `META_TEXT_MODEL`로 켠다.
- **피할 주제:** 의료 조언 AI, 단순 RAG, 단순 이미지 분석기, 단순 교육 챗봇, 채용 지원서 심사, 영양 코치, 성격 분석, 스포츠 분석·코치, 정치·전쟁 관련. 단순 교육 챗봇으로 보이지 않도록 지도와 복기가 데모의 중심이어야 한다.

## 구조

- **한 턴:** `app/api/turn/route.ts`. Muse Spark가 턴을 구조화 출력으로 읽고(`lib/trail/analyze.ts`), 엔진이 지도를 바꾸며 이번 턴에 할 일을 하나 정하고(`lib/trail/engine.ts`), Muse Spark가 그 지시대로 답변을 스트리밍한다(`lib/trail/prompts.ts`).
- **상태 변경은 엔진만 한다.** 모델은 읽고 쓰기만 한다. 답변 문구에 따라 지도가 달라지면 안 되고, 새 규칙은 `lib/trail/engine.test.ts`에 테스트로 남긴다.
- **전달된 뒤에 확정한다.** 구멍을 메운 것과 복기·이어서/복습 질문을 물어본 것은 답변이 끝까지 전달된 뒤 `completeTurn`에서 기록한다. 중단되거나 잘린 답변은 치지 않는다. 그래야 다음 말이 본 적 없는 질문의 답으로 채점되지 않는다. 턴을 시작할 때는 어떤 개념도 `seen`으로 올리지 않는다. 답을 받을 때까지 `unseen`이고, 화면에서는 현재 위치의 개념을 "보는 중"으로 보여준다. 복기를 통과한 답변은 그 개념의 설명으로 기록하지 않는다.
- **세션은 브라우저에 있다.** 서버에 저장하지 않고, 지도는 턴마다 브라우저가 보낸다. 그래서 `lib/trail/types.ts`의 크기 제한이 프롬프트 크기와 비용의 상한이다.
- **상태는 스펙의 3개에 `seen`을 더한 4개다.** 3개로는 막 본 개념을 나타낼 수 없다. `fuzzy`로 두면 스펙 3.6에 따라 바로 구멍으로 잡혀 같은 설명을 반복하고, 복기 실패로 흐려지는 변화도 보이지 않는다. `solid`로 두면 봤다와 안다의 구분이 사라진다.
- **접근은 `proxy.ts`가 막는다.** `AUTH_EMAIL`·`AUTH_PASSWORD` 한 계정으로 `/login`에서 로그인하고, 서명한 쿠키(7일)로 유지한다. 서버에 세션을 저장하지 않는다. 값이 없으면 아무도 못 들어온다. 새 페이지와 `/api` 경로는 자동으로 로그인을 요구하므로, 로그인 없이 열어야 하는 경로만 `proxy.ts`에서 뺀다. 학습자 계정이 아니라 크레딧을 지키는 임시 관문이다. 로그인 시도는 크레딧 상한과 따로 IP별 분당 10회로 센다.

## Meta Model API 연동

- **문서는 원문으로 읽는다.** `https://dev.meta.ai/docs/<경로>.md`로 마크다운을 받을 수 있고, 전체 목록은 `https://dev.meta.ai/llms.txt`에 있다.
- **텍스트:** AI SDK의 `metaTextModel()`과 `metaTextOptions()`를 함께 쓴다. 구조화 출력은 `generateText`의 `Output.object`로 받고, `strictJsonSchema: false`로 보낸다. Meta는 strict와 상관없이 출력을 스키마에 맞추므로 strict는 실패 경로만 늘린다.
- **추론 토큰은 출력 토큰 상한에 포함된다.** `maxOutputTokens`를 줄이면 JSON이 잘릴 수 있다.
- **이미지는 던진 턴에만 보낸다.** 이후 턴에는 모델이 읽은 설명만 보낸다(`lib/trail/request.ts`). 이미지는 `user` 메시지에만 넣을 수 있다.
- **SAM은 부가 기능이고 턴과 분리돼 있다.** `/api/region`으로 따로 호출하므로 느려도 답변과 입력을 막지 않고, 실패하거나 아무것도 못 찾아도 턴은 그대로다. 마스크는 `bounds`에 맞춰 늘려 그린다.
- **응답이 비거나 JSON이 깨지면 지도 변경 없이 대화를 잇는다.** `NoObjectGeneratedError`와 `NoOutputGeneratedError` 모두 해당한다. 키·결제·호출 제한 오류는 답변도 실패하므로 그대로 오류로 보여준다.
- **Vercel 함수 본문 제한은 4.5MB다.** 그래서 브라우저에서 이미지를 줄여 보낸다(`lib/trail/image.ts`).
- **모델 답변의 이미지와 링크는 글자로만 보여준다.** 스크린샷 속 글자로 모델을 속이면 대화 내용이 담긴 주소를 불러오게 만들 수 있다(`components/trail/reply-text.tsx`). 프롬프트에 넣는 지도 내용은 `quoted()`와 `plainName()`을 거친다.
- **새 `/api` 경로는 `proxy.ts`의 호출 제한을 자동으로 적용받는다.** IP별 분당 상한과, 공개 데모의 크레딧을 지키는 하루 전체 상한이 있다. 둘 다 프로세스 메모리에서 세므로 재시작하면 초기화된다. 본문 크기 상한은 `parseJsonBody`로 경로마다 정한다. 요청 본문은 곧 과금되는 입력 토큰이다.

## 배포

- **공개 데모는 컨테이너로 돈다.** `compose.yaml`의 `web`은 읽기 전용 파일시스템, 비루트, capability 없이 돌고, 전용 Tailscale 노드(`tailscale`)와 네트워크를 공유한다. 그 노드가 Funnel로 앱만 공개한다(`deploy/tailscale/funnel.json`).
- **서버 자체를 Funnel로 공개하지 않는다.** 서버 노드에서 `tailscale funnel`을 켜지 않는다. Tailscale Service(`svc:`)는 tailnet 안에서만 보이고 Funnel을 지원하지 않는다.
- **API 키는 이미지에 들어가지 않는다.** `.dockerignore`가 `.env*`를 빼고, 서버의 `.env.local`을 컨테이너를 시작할 때 `env_file`로 넘긴다.
- **갱신은 `git pull && docker compose up -d --build web`이다.** 노드는 그대로 두고 앱만 바꾼다.
- **`docker compose down -v`를 쓰지 않는다.** 볼륨에 노드의 정체성이 있어 지우면 다시 로그인해야 한다. 첫 로그인은 시작 스크립트가 60초만 기다리고 재시작해 링크가 계속 바뀌므로, entrypoint를 바꿔 `tailscaled`와 `tailscale up`을 직접 실행하면 링크가 고정된다(명령은 README의 Deploying에 있다).

## 작업 전후 확인

```bash
npm run typecheck && npm run lint && npm run test && npm run build
npm run smoke   # 실제 API 호출과 데모 리허설. 실행당 약 $0.10이 든다.
```

개발 서버는 `localhost`로 접속한다. `127.0.0.1`은 Next 16이 교차 출처로 막아 화면은 보이지만 동작하지 않는다. 앱 화면은 `.env.local`의 `AUTH_EMAIL`·`AUTH_PASSWORD`로 로그인해야 보인다.
